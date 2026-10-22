/**
 * Store changes log (ccugame-style "Add - 2 items / Remove - 8 items"): every fresh copy of the store is reduced to a
 * flat set of entries — CCU targets and standalone ships from the upgrade catalog, everything else from the store
 * listing — and compared with the last snapshot. Each comparison writes at most one *add* and one *remove* group.
 *
 * Outage guard: RSI sometimes answers a query with nothing (a session hiccup, a GraphQL error dressed as data). A
 * group (CCUs, standalones, one listing category) that shrinks to under half of what it was is left alone — its old
 * entries stay in the snapshot and no removals are logged for it — so a bad fetch never reads as a mass delisting.
 */
import type { Catalog, StoreCategory, StoreListing } from './store';

export type EntryKind = 'ccu' | 'ship' | StoreCategory;
export interface StoreEntry {
  /** `ccu:<sku>` / `ship:<sku>` / `item:<id>`. */
  key: string;
  name: string;
  /** USD cents (the price paid now: sale price when discounted). */
  price: number;
  kind: EntryKind;
  /** RSI store page (ship page for CCUs / standalones, the listing's own page for items); missing on older copies. */
  link?: string;
  /** Catalog hull id for CCU / standalone entries (deep link to the Ship catalog row). */
  ship?: number;
  /** Store thumbnail (the hull's for CCUs / standalones, the listing's for items); missing on older copies. */
  thumb?: string | null;
}
export interface StoreChange {
  at: number;
  action: 'add' | 'remove';
  entries: StoreEntry[];
}
/** Last seen entries per source; a source is compared only against its own previous copy. */
export type StoreSnapshot = Partial<Record<'catalog' | 'listing', { at: number; entries: StoreEntry[] }>>;

export const MAX_CHANGES = 400;

/** A SKU's title is often just the edition ("Standard Edition", "Warbond Edition"): prefix the hull unless it is already named. */
export function skuName(ship: string, title: string): string {
  const t = title.trim();
  if (!t) return ship;
  return t.toLowerCase().includes(ship.toLowerCase()) ? t : `${ship} - ${t}`;
}

/** CCU targets and standalone ships on sale now. */
export function catalogEntries(c: Catalog): StoreEntry[] {
  const out: StoreEntry[] = [];
  for (const s of c.ships) {
    if (s.msrpSource === 'wiki') continue; // not from RSI
    const link = s.link || undefined;
    const thumb = s.thumb;
    for (const k of s.ccu) if (k.available) out.push({ key: `ccu:${k.id}`, name: `${skuName(s.name, k.title)} CCU`, price: k.price, kind: 'ccu', link, ship: s.id, thumb });
    for (const k of s.standalone) if (k.available) out.push({ key: `ship:${k.id}`, name: skuName(s.name, k.title), price: k.price, kind: 'ship', link, ship: s.id, thumb });
  }
  return out;
}

/**
 * Store listing entries. Standalone ships come from the catalog (same SKUs), and Concierge / Subscribers rows depend
 * on who is signed in — logging out would read as them being removed — so both are left out.
 */
export function listingEntries(l: StoreListing): StoreEntry[] {
  return l.items
    .filter((i) => i.category !== 'ships' && i.category !== 'subscribers' && !i.vip)
    .map((i) => ({ key: `item:${i.id}`, name: i.name, price: i.discounted, kind: i.category, link: i.url || undefined, thumb: i.thumb }));
}

/** Groups of the same action logged close together (a catalog check and a listing check of the same poll) shown as one. */
export interface MergedChange {
  at: number;
  action: StoreChange['action'];
  entries: StoreEntry[];
  /** The logged groups behind it, for dismissing. */
  parts: StoreChange[];
}
export const MERGE_WINDOW = 10 * 60_000;
/** The saved log with anything malformed dropped (a group written as `{}` when a reactive proxy reached chrome.storage). */
export const cleanLog = (log: unknown): StoreChange[] =>
  Array.isArray(log) ? log.filter((c): c is StoreChange => !!c && typeof c === 'object' && Array.isArray((c as StoreChange).entries) && typeof (c as StoreChange).at === 'number') : [];
/** Entries added / removed across a log (or one card's parts). */
export const tally = (groups: Pick<StoreChange, 'action' | 'entries'>[]) => groups.reduce((t, c) => ((t[c.action] += c.entries.length), t), { add: 0, remove: 0 });
/** Newest first (as the log is); a group joins the previous one when the action matches and they are within the window. */
export function mergeChanges(log: StoreChange[], window = MERGE_WINDOW): MergedChange[] {
  const out: MergedChange[] = [];
  for (const c of cleanLog(log)) {
    const last = out[out.length - 1];
    if (last && last.action === c.action && Math.abs(last.parts[last.parts.length - 1]!.at - c.at) <= window) {
      last.entries = [...last.entries, ...c.entries];
      last.parts.push(c);
    } else out.push({ at: c.at, action: c.action, entries: [...c.entries], parts: [c] });
  }
  return out;
}

/**
 * The log without a whole group (`entry` omitted), or without one / several of its entries; a group left empty goes
 * too. The group is the one with that `at`, `action` and first entry key — so several entries go in one call, not one
 * call each (the first key would move after the first removal).
 */
export function dismiss(log: StoreChange[], at: number, action: StoreChange['action'], firstKey: string, entry?: string | string[]): StoreChange[] {
  const gone = entry == null ? null : new Set(Array.isArray(entry) ? entry : [entry]);
  return log.flatMap((c) => {
    if (c.at !== at || c.action !== action || c.entries[0]?.key !== firstKey) return [c];
    if (!gone) return [];
    const entries = c.entries.filter((e) => !gone.has(e.key));
    return entries.length ? [{ ...c, entries }] : [];
  });
}

/** Compare `next` with `prev` (one source). `keep` = entries of groups the outage guard held back, to carry over. */
export function diffEntries(prev: StoreEntry[], next: StoreEntry[]): { added: StoreEntry[]; removed: StoreEntry[]; keep: StoreEntry[] } {
  const count = (list: StoreEntry[]) => list.reduce((m, e) => m.set(e.kind, (m.get(e.kind) ?? 0) + 1), new Map<EntryKind, number>());
  const before = count(prev);
  const after = count(next);
  const held = new Set([...before].filter(([k, n]) => n >= 4 && (after.get(k) ?? 0) < n / 2).map(([k]) => k));
  const had = new Set(prev.map((e) => e.key));
  const has = new Set(next.map((e) => e.key));
  return {
    added: next.filter((e) => !had.has(e.key) && !held.has(e.kind)),
    removed: prev.filter((e) => !has.has(e.key) && !held.has(e.kind)),
    keep: prev.filter((e) => held.has(e.kind)),
  };
}

/**
 * Fold a fresh copy of one source into the snapshot and the log. The first copy of a source only sets the baseline
 * (no "everything was added" group). Returns the new snapshot, the new log and what was logged now.
 */
export function recordStore(
  snap: StoreSnapshot,
  log: StoreChange[],
  source: keyof StoreSnapshot,
  next: StoreEntry[],
  now: number,
): { snap: StoreSnapshot; log: StoreChange[]; logged: StoreChange[] } {
  const prev = snap[source];
  if (!next.length) return { snap, log, logged: [] }; // nothing at all came back: not a store with nothing in it
  if (!prev) return { snap: { ...snap, [source]: { at: now, entries: next } }, log, logged: [] };
  const d = diffEntries(prev.entries, next);
  const byName = (a: StoreEntry, b: StoreEntry) => a.name.localeCompare(b.name);
  const logged: StoreChange[] = [];
  if (d.added.length) logged.push({ at: now, action: 'add', entries: [...d.added].sort(byName) });
  if (d.removed.length) logged.push({ at: now, action: 'remove', entries: [...d.removed].sort(byName) });
  const kept = new Set(next.map((e) => e.key));
  return {
    snap: { ...snap, [source]: { at: now, entries: [...next, ...d.keep.filter((e) => !kept.has(e.key))] } },
    log: [...logged, ...log].slice(0, MAX_CHANGES),
    logged,
  };
}
