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
}
export interface StoreChange {
  at: number;
  action: 'add' | 'remove';
  entries: StoreEntry[];
}
/** Last seen entries per source; a source is compared only against its own previous copy. */
export type StoreSnapshot = Partial<Record<'catalog' | 'listing', { at: number; entries: StoreEntry[] }>>;

export const MAX_CHANGES = 400;

/** CCU targets and standalone ships on sale now. */
export function catalogEntries(c: Catalog): StoreEntry[] {
  const out: StoreEntry[] = [];
  for (const s of c.ships) {
    if (s.msrpSource === 'wiki') continue; // not from RSI
    for (const k of s.ccu) if (k.available) out.push({ key: `ccu:${k.id}`, name: `${k.title || s.name} CCU`, price: k.price, kind: 'ccu' });
    for (const k of s.standalone) if (k.available) out.push({ key: `ship:${k.id}`, name: k.title || s.name, price: k.price, kind: 'ship' });
  }
  return out;
}

/**
 * Store listing entries. Standalone ships come from the catalog (same SKUs), and Concierge / Subscribers rows depend
 * on who is signed in — logging out would read as them being removed — so both are left out.
 */
export function listingEntries(l: StoreListing): StoreEntry[] {
  return l.items.filter((i) => i.category !== 'ships' && i.category !== 'subscribers' && !i.vip).map((i) => ({ key: `item:${i.id}`, name: i.name, price: i.discounted, kind: i.category }));
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
