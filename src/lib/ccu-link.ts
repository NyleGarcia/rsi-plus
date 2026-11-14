/**
 * The single CCU chain as a hub hash, to share or bookmark: `#ccu?from=<hull id|store>&to=<id>&via=1,2&obj=cash
 * &steps=more&warbond=1&buyback=0&stock=1&credit=1&gifted=0&ahead=0`. Only the route and the options that are not
 * per account / per day: force include / exclude refs and ignored SKUs stay out. `#ccu?to=<id>[&ahead=1]` (Store,
 * Ships, CCUs pages) is the same format with fewer params. Decoding is tolerant: a missing or garbled param is left
 * out, and ids are not checked against the catalog (the planner does that).
 */
import { STORE_START, type Objective, type PlanOptions, type StepsPreference } from './ccu';

/** Boolean options in the link → their param name. */
export const LINK_FLAGS = {
  warbond: 'warbond',
  buyback: 'buyback',
  inStockOnly: 'stock',
  storeCredit: 'credit',
  excludeGifted: 'gifted',
  planAhead: 'ahead',
} as const satisfies Partial<Record<keyof PlanOptions, string>>;
export type LinkFlag = keyof typeof LINK_FLAGS;

export interface CcuLink {
  /** Hull id, or `STORE_START` for a store start; unset = not in the link. */
  from?: number;
  to?: number;
  via?: number[];
  objective?: Objective;
  steps?: StepsPreference;
  flags: Partial<Record<LinkFlag, boolean>>;
  /** A saved chain's name, when the code was exported from one. */
  name?: string;
}

const OBJECTIVES: readonly Objective[] = ['spend', 'cash', 'longterm'];
const id = (s: string | null): number | undefined => {
  if (s == null || !/^\d+$/.test(s.trim())) return undefined;
  const n = Number(s.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};
const bool = (s: string | null): boolean | undefined => (s === '1' || s === 'true' ? true : s === '0' || s === 'false' ? false : undefined);

/** `#ccu?…` for a route and its options (`from` null = no source picked yet). */
export function encodeCcuLink(r: { from: number | null; to: number; via?: number[]; opt: Pick<PlanOptions, 'objective' | 'steps' | LinkFlag>; name?: string }): string {
  const p = new URLSearchParams();
  if (r.name?.trim()) p.set('name', r.name.trim().slice(0, 80));
  if (r.from != null) p.set('from', r.from === STORE_START ? 'store' : String(r.from));
  p.set('to', String(r.to));
  const via = (r.via ?? []).filter((v) => id(String(v)) != null);
  if (via.length) p.set('via', via.join(','));
  p.set('obj', r.opt.objective);
  p.set('steps', r.opt.steps === 'more' ? 'more' : 'fewer');
  for (const [k, name] of Object.entries(LINK_FLAGS) as [LinkFlag, string][]) p.set(name, r.opt[k] ? '1' : '0');
  // URLSearchParams escapes the commas of `via`; they are safe in a hash, keep the link readable.
  return `#ccu?${p.toString().replaceAll('%2C', ',')}`;
}

/** The link in a hub hash; null when the hash is not the CCU planner's. */
export function decodeCcuLink(hash: string): CcuLink | null {
  const [page = '', qs = ''] = hash.replace(/^#/, '').split('?');
  if (page !== 'ccu') return null;
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(qs);
  } catch {
    return { flags: {} };
  }
  const out: CcuLink = { flags: {} };
  const name = p.get('name')?.trim().slice(0, 80);
  if (name) out.name = name;
  const from = p.get('from');
  if (from === 'store') out.from = STORE_START;
  else if (id(from) != null) out.from = id(from);
  if (id(p.get('to')) != null) out.to = id(p.get('to'));
  const via = (p.get('via') ?? '')
    .split(',')
    .map((v) => id(v))
    .filter((v): v is number => v != null);
  if (via.length) out.via = [...new Set(via)];
  const obj = p.get('obj') as Objective | null;
  if (obj && OBJECTIVES.includes(obj)) out.objective = obj;
  const steps = p.get('steps');
  if (steps === 'more' || steps === 'fewer') out.steps = steps;
  for (const [k, name] of Object.entries(LINK_FLAGS) as [LinkFlag, string][]) {
    const b = bool(p.get(name));
    if (b != null) out.flags[k] = b;
  }
  return out;
}

/**
 * What a decoded link changes in the single planner. `has`: the id is a catalog hull (unknown ids are dropped);
 * `owns`: the hull is in your hangar (source mode *Ship in my hangar*, else *Any ship*). Options not in the link stay —
 * except for a full share link (one carrying `obj` / `steps`, from `encodeCcuLink`): it is a complete route, so it also
 * clears the stops it doesn't list, forced-in CCUs and ignored SKUs, which would send the chain another way. Force
 * excludes stay (your own CCUs, reserved by your saved chains).
 */
export function linkToPlanner(
  l: CcuLink,
  has: (id: number) => boolean,
  owns: (id: number) => boolean,
): { mode?: 'store' | 'hangar' | 'any'; fromId?: number | null; toId?: number; opt: Partial<PlanOptions> } {
  const out: ReturnType<typeof linkToPlanner> = { opt: {} };
  if (l.from === STORE_START) (out.mode = 'store'), (out.fromId = null);
  else if (l.from != null && has(l.from)) (out.mode = owns(l.from) ? 'hangar' : 'any'), (out.fromId = l.from);
  if (l.to != null && has(l.to)) out.toId = l.to;
  const full = l.objective != null || l.steps != null;
  if (l.via) out.opt.via = l.via.filter(has);
  else if (full) out.opt.via = [];
  if (full) (out.opt.include = []), (out.opt.skip = []);
  if (l.objective) out.opt.objective = l.objective;
  if (l.steps) out.opt.steps = l.steps;
  for (const [k, v] of Object.entries(l.flags) as [LinkFlag, boolean][]) out.opt[k] = v;
  return out;
}

/** Calls `apply` with the hub hash's link now and on every hash change (when it is a CCU link). Returns the cleanup. */
export function watchCcuLink(apply: (l: CcuLink) => void): () => void {
  const run = () => {
    const l = decodeCcuLink(location.hash);
    if (l) apply(l);
  };
  run();
  window.addEventListener('hashchange', run);
  return () => window.removeEventListener('hashchange', run);
}

// ---------------------------------------------------------------------------------------------------------------
// Chains as text, to export and import: one code per line, the same `#ccu?…` as the link (RSI's ship ids, so a code
// means the same route for anyone). A file is just those lines. Your own CCUs are not in a code — whoever imports it
// gets the chain planned on their own hangar and today's store.

/** Every chain code in a text: lines, a pasted link, a whole file. Lines that are not a code with a target are skipped. */
export function parseCcuCodes(text: string): CcuLink[] {
  const out: CcuLink[] = [];
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('ccu?');
    if (i < 0) continue;
    const l = decodeCcuLink(`#${line.slice(i).trim()}`);
    if (l?.to != null) out.push(l);
  }
  return out;
}

/** Chain codes as a text file / clipboard string. */
export const ccuCodesText = (codes: string[]): string => codes.join('\n') + (codes.length ? '\n' : '');
