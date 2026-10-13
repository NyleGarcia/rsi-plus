/**
 * RSI account pages → data. Server-rendered HTML fetched page by page (logged-in session cookies):
 * - Hangar `/account/pledges?page=N` — `.list-items > li`, hidden inputs `.js-pledge-id|name|value`,
 *   `.js-upgrade-data` (JSON: match_items / target_items) for CCUs, `.items .item` with `.title` + `.kind`.
 *   Structure as used by HangarXPLOR (MIT, updated 2026-04).
 * - Buyback `/account/buy-back-pledges?page=N` — **unverified**: `article.pledge` / list items with a heading,
 *   `dt/dd` pairs (Last Modified, Contained) and buyback links/buttons carrying data-* ids for CCUs.
 * Parsers take a ParentNode (DOMParser output in the hub page; happy-dom in tests). Pure otherwise.
 */

export type PledgeType = 'ship' | 'package' | 'combo' | 'upgrade' | 'paint' | 'gear' | 'hangar' | 'subscriber' | 'other';

export interface PledgeItem {
  title: string;
  kind: string;
}

export interface Upgrade {
  fromId: number | null;
  fromName: string;
  toId: number | null;
  toName: string;
}

export interface Pledge {
  id: number;
  name: string;
  /** Melt value in USD (0 for gifted / no-value items). */
  value: number;
  /** "Created" date text as shown (e.g. "October 01, 2026"). */
  date: string;
  type: PledgeType;
  items: PledgeItem[];
  /** Ship titles inside the pledge (as listed, not normalized). */
  ships: string[];
  upgrade: Upgrade | null;
  lti: boolean;
  /** Insurance as listed: 'LTI', '120 mo', '6 mo', … or '' when the pledge lists none. */
  insurance: string;
  warbond: boolean;
  giftable: boolean;
  meltable: boolean;
  /** Contains a Star Citizen / Squadron 42 game package. */
  hasGame: boolean;
  /** Upgraded ship (a CCU was applied — RSI marks it `.upgraded`). */
  upgraded: boolean;
  nickname: string;
  /** Hangar page it was read from (`/account/pledges?page=N&pagesize=50`) — for "open in hangar" links. */
  page?: number;
}

export interface BuybackItem {
  id: number;
  name: string;
  date: string;
  contained: string;
  type: PledgeType;
  upgrade: Upgrade | null;
  /** Link to buy it back (null when RSI shows no action, e.g. token limit). */
  url: string | null;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const val = (root: ParentNode, sel: string) => (root.querySelector(sel) as HTMLInputElement | null)?.value?.trim() ?? '';

export function parseMoney(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.,-]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const PREFIX = /^(add-ons|standalone ships?|combo|package|packages|ship upgrades|extras|paints|gear|subscribers?) - /i;
export const cleanName = (s: string) => s.replace(/\s{2,}/g, ' ').replace(PREFIX, '').trim();

const isWarbond = (s: string) => /\b(warbond|war bond|wb)\b/i.test(s);

export function parseUpgradeJson(raw: string | null | undefined): Upgrade | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    const from = d?.match_items?.[0];
    const to = d?.target_items?.[0];
    if (!from || !to) return null;
    return { fromId: from.id != null ? Number(from.id) : null, fromName: String(from.name ?? ''), toId: to.id != null ? Number(to.id) : null, toName: String(to.name ?? '') };
  } catch {
    return null;
  }
}

/** "Upgrade - Cutlass Black to Constellation Andromeda Warbond Edition" → names (fallback when no JSON). */
export function upgradeFromName(name: string): Upgrade | null {
  const m = cleanName(name).match(/^(?:upgrade\s*-\s*)?(.+?)\s+to\s+(.+?)(?:\s+(?:warbond edition|standard edition|warbond|wb))?$/i);
  return m ? { fromId: null, fromName: m[1]!.trim(), toId: null, toName: m[2]!.trim() } : null;
}

function classify(name: string, items: PledgeItem[], upgrade: Upgrade | null): PledgeType {
  const kinds = items.map((i) => i.kind.toLowerCase());
  const shipCount = kinds.filter((k) => k === 'ship').length;
  const lower = name.toLowerCase();
  if (upgrade || /^upgrade\b/.test(lower)) return 'upgrade';
  if (items.some((i) => /digital download/i.test(i.title))) return 'package';
  if (shipCount > 1) return 'combo';
  if (shipCount === 1) return 'ship';
  if (/subscri/.test(lower)) return 'subscriber';
  if (/paint|livery|skin/.test(lower) || kinds.includes('skin')) return 'paint';
  if (/hangar/.test(lower) || kinds.includes('hangar decoration')) return 'hangar';
  if (kinds.some((k) => /fps|armor|weapon|component|equipment/.test(k))) return 'gear';
  return 'other';
}

function parseItems(root: ParentNode): PledgeItem[] {
  const out: PledgeItem[] = [];
  for (const it of root.querySelectorAll('.items .item, .item')) {
    const title = text(it.querySelector('.title'));
    const kind = text(it.querySelector('.kind'));
    if (title && !out.some((o) => o.title === title && o.kind === kind)) out.push({ title, kind });
  }
  return out;
}

/** Insurance from item titles / pledge name: "Lifetime Insurance" → LTI, "120 Month Insurance" → 120 mo, "10 Year …" → 120 mo. */
export function parseInsurance(text: string): string {
  if (/lifetime insurance|\blti\b/i.test(text)) return 'LTI';
  const months = [...text.matchAll(/(\d+)[\s-]*(month|year)s?[\s-]*insurance/gi)].map((m) => Number(m[1]) * (m[2]!.toLowerCase() === 'year' ? 12 : 1));
  return months.length ? `${Math.max(...months)} mo` : '';
}

/** Account balances shown in the hangar sidebar: store credit (USD), UEC, REC. */
export interface Credits {
  usd: number;
  uec: number;
  rec: number;
}

/** Credits box of /account/billing (`div.credits > div.credit-line`): store credit, UEC, REC. null if absent (logged out / other page). */
export function parseCredits(root: ParentNode): Credits | null {
  // Text nodes joined with spaces: textContent glues neighbours ("USDUEC") and breaks the word boundaries.
  const parts: string[] = [];
  const walk = (n: Node) => (n.nodeType === 3 ? parts.push(n.textContent ?? '') : n.childNodes.forEach(walk));
  walk((root as Document).body ?? root);
  const text = parts.join(' ').replace(/\s+/g, ' ');
  // Numbers may be split over elements ("$ 812 . 17"): grab the whole digit/space/comma/dot run, then squash it.
  const num = (re: RegExp) => {
    const m = re.exec(text);
    const n = m ? Number(m[1]!.replace(/[^\d.]/g, '')) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const N = '(\\d(?:[\\d,\\s]*\\d)?(?:\\s*\\.\\s*\\d+)?)'; // digits with commas/spaces inside, optional decimals
  // /account/billing: "$812.17 USD STORE CREDITS · ¤45,000 UEC · ¤1,440,000 REC" (amount, then label).
  // Other layouts put the label first ("Store credit $812.17"); try both.
  const usd = num(new RegExp(`\\$\\s*${N}\\s*USD\\s*STORE CREDITS?`, 'i')) ?? num(new RegExp(`store credits?[\\s:]*\\$?\\s*${N}`, 'i'));
  if (usd == null) return null;
  const uec = num(new RegExp(`¤\\s*${N}\\s*UEC\\b`, 'i')) ?? num(new RegExp(`\\bUEC[\\s:]*¤?\\s*${N}`, 'i')) ?? 0;
  const rec = num(new RegExp(`¤\\s*${N}\\s*REC\\b`, 'i')) ?? num(new RegExp(`\\bREC[\\s:]*¤?\\s*${N}`, 'i')) ?? 0;
  return { usd, uec, rec };
}

/** When `parseCredits` finds nothing: what the page says near "credit" / "UEC" and any credit-ish class names. */
export function creditsDebug(root: ParentNode): string {
  const parts: string[] = [];
  const walk = (n: Node) => (n.nodeType === 3 ? parts.push(n.textContent ?? '') : n.childNodes.forEach(walk));
  walk((root as Document).body ?? root);
  const text = parts.join(' ').replace(/\s+/g, ' ');
  const near = (re: RegExp) => {
    const m = re.exec(text);
    return m ? `“…${text.slice(Math.max(0, m.index - 60), m.index + 120)}…”` : '(not on page)';
  };
  const classes = [...root.querySelectorAll('[class*="credit" i], [class*="balance" i], [class*="wallet" i], [class*="uec" i]')]
    .map((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className}`)
    .slice(0, 8);
  const signedIn = !!root.querySelector('.list-items');
  return `${signedIn ? 'hangar list present' : 'no hangar list (logged out?)'} · near "credit": ${near(/credit/i)} · near "UEC": ${near(/\bUEC\b/)} · elements: ${classes.join(', ') || 'none'}`;
}

/** Parse one hangar page. Returns [] for an empty page. */
export function parseHangarPage(root: ParentNode): Pledge[] {
  const out: Pledge[] = [];
  for (const li of root.querySelectorAll('.list-items > li')) {
    if (li.querySelector('.empty-list')) continue;
    const rawName = val(li, '.js-pledge-name');
    const id = parseInt(val(li, '.js-pledge-id'), 10);
    if (!rawName || !Number.isFinite(id)) continue;
    const name = cleanName(rawName);
    const items = parseItems(li);
    const upgrade = parseUpgradeJson(val(li, '.js-upgrade-data')) ?? (/^upgrade\b/i.test(name) ? upgradeFromName(name) : null);
    const ships = items.filter((i) => i.kind.toLowerCase() === 'ship').map((i) => i.title);
    const titles = items.map((i) => i.title).join(' | ');
    const value = parseMoney(val(li, '.js-pledge-value'));
    out.push({
      id,
      name,
      value,
      date: text(li.querySelector('.date-col')).replace(/^created:?\s*/i, ''),
      type: classify(name, items, upgrade),
      items,
      ships,
      upgrade,
      lti: /lifetime insurance/i.test(titles) || /\blti\b/i.test(name),
      insurance: parseInsurance(`${titles} | ${name}`),
      warbond: isWarbond(name),
      giftable: [...li.querySelectorAll('.label')].some((l) => /gift/i.test(l.textContent ?? '')) || !!li.querySelector('.js-gift'),
      meltable: !!li.querySelector('.js-reclaim'),
      hasGame: /digital download/i.test(titles),
      upgraded: !!li.querySelector('.upgraded'),
      nickname: [...li.querySelectorAll('.custom-name-text')].map((e) => text(e)).filter(Boolean).join(', '),
    });
  }
  return out;
}

function dd(root: ParentNode, label: RegExp): string {
  for (const dt of root.querySelectorAll('dt')) if (label.test(dt.textContent ?? '')) return text(dt.nextElementSibling);
  return '';
}

/** Parse one buyback page (defensive — markup unverified). */
export function parseBuybackPage(root: ParentNode): BuybackItem[] {
  const out: BuybackItem[] = [];
  const blocks = root.querySelectorAll('article.pledge, .list-items > li, .pledge');
  for (const b of blocks) {
    if (b.parentElement?.closest('article.pledge, .pledge')) continue; // nested match
    const name = cleanName(text(b.querySelector('h1, h3, .title-col h3, .information h1')));
    if (!name) continue;
    const btn = b.querySelector<HTMLElement>('[data-pledgeid], [data-pledge-id], a[href*="buyback"]');
    const idRaw = btn?.dataset.pledgeid ?? btn?.dataset.pledgeId ?? btn?.getAttribute('href')?.match(/(\d+)\/?$/)?.[1] ?? '';
    const id = parseInt(idRaw, 10);
    const fromId = btn?.dataset.fromshipid ? Number(btn.dataset.fromshipid) : null;
    const toId = btn?.dataset.toshipid ? Number(btn.dataset.toshipid) : null;
    let upgrade: Upgrade | null = null;
    if (fromId != null || toId != null || /^upgrade\b/i.test(name)) {
      const byName = upgradeFromName(name);
      upgrade = { fromId, toId, fromName: byName?.fromName ?? '', toName: byName?.toName ?? '' };
    }
    const contained = dd(b, /contained/i);
    const href = b.querySelector<HTMLAnchorElement>('a[href*="buyback"]')?.getAttribute('href') ?? null;
    out.push({
      id: Number.isFinite(id) ? id : 0,
      name,
      date: dd(b, /last modified|date/i),
      contained,
      type: classify(name, contained.split(/,\s*/).filter(Boolean).map((title) => ({ title, kind: '' })), upgrade),
      upgrade,
      url: href ? new URL(href, 'https://robertsspaceindustries.com').href : null,
    });
  }
  return out;
}

export interface HangarTotals {
  pledges: number;
  value: number;
  ships: number;
  upgrades: number;
  lti: number;
  giftable: number;
  byType: Record<PledgeType, { count: number; value: number }>;
}

export function totals(list: Pledge[]): HangarTotals {
  const byType = {} as HangarTotals['byType'];
  for (const p of list) {
    const t = (byType[p.type] ??= { count: 0, value: 0 });
    t.count++;
    t.value += p.value;
  }
  return {
    pledges: list.length,
    value: Math.round(list.reduce((s, p) => s + p.value, 0) * 100) / 100,
    ships: list.reduce((s, p) => s + p.ships.length, 0),
    upgrades: list.filter((p) => p.upgrade).length,
    lti: list.filter((p) => p.lti).length,
    giftable: list.filter((p) => p.giftable).length,
    byType,
  };
}

export const cell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function hangarCsv(list: Pledge[]): string {
  const head = ['id', 'name', 'type', 'value_usd', 'date', 'ships', 'lti', 'insurance', 'warbond', 'giftable', 'meltable', 'upgrade_from', 'upgrade_to'];
  return [
    head.join(','),
    ...list.map((p) =>
      [p.id, p.name, p.type, p.value, p.date, p.ships.join('; '), p.lti, p.insurance, p.warbond, p.giftable, p.meltable, p.upgrade?.fromName ?? '', p.upgrade?.toName ?? '']
        .map(cell)
        .join(','),
    ),
  ].join('\n');
}


/** Page size every hangar read uses — a pledge's page is its position in the list (RSI order) at this size. */
export const HANGAR_PAGE = 50;

/**
 * Hangar page a pledge sits on (gift / melt / reclaim happen there). Page = the one it was read from, else from its
 * index in the saved list. `rsiplus=<id>` makes the RSI content script scroll to and highlight that pledge;
 * `rsiplus_do=melt|gift` also opens RSI's own melt / gift dialog for it (the password is typed there, never in RSI+).
 */
export function hangarUrl(all: Pledge[], id: number, action?: 'melt' | 'gift'): string {
  const idx = all.findIndex((p) => p.id === id);
  const page = all[idx]?.page ?? (idx >= 0 ? Math.floor(idx / HANGAR_PAGE) + 1 : 1);
  return `https://robertsspaceindustries.com/account/pledges?page=${page}&pagesize=${HANGAR_PAGE}&rsiplus=${id}${action ? `&rsiplus_do=${action}` : ''}`;
}

/** Identical pledges stacked into one row: same name, type, value, contents, LTI / warbond / upgrade. */
export interface PledgeStack {
  key: string;
  /** Representative (the newest entry). */
  rep: Pledge;
  entries: Pledge[];
}

export function stackKey(p: Pledge): string {
  const items = p.items.map((i) => `${i.title.toLowerCase().trim()}|${i.kind.toLowerCase()}`).sort();
  const up = p.upgrade ? `${p.upgrade.fromName}>${p.upgrade.toName}`.toLowerCase() : '';
  return [p.type, p.name.toLowerCase().trim(), p.value, p.lti, p.insurance, p.warbond, p.meltable, up, ...items].join('\u0001');
}

/** Keeps the input order (first occurrence = position); entries keep their order within a stack. */
export function stackPledges(list: Pledge[]): PledgeStack[] {
  const m = new Map<string, PledgeStack>();
  for (const p of list) {
    const key = stackKey(p);
    const s = m.get(key);
    if (s) s.entries.push(p);
    else m.set(key, { key, rep: p, entries: [p] });
  }
  return [...m.values()];
}
