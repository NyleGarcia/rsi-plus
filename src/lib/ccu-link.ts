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
}

const OBJECTIVES: readonly Objective[] = ['spend', 'cash', 'longterm'];
const id = (s: string | null): number | undefined => {
  if (s == null || !/^\d+$/.test(s.trim())) return undefined;
  const n = Number(s.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};
const bool = (s: string | null): boolean | undefined => (s === '1' || s === 'true' ? true : s === '0' || s === 'false' ? false : undefined);

/** `#ccu?…` for a route and its options (`from` null = no source picked yet). */
export function encodeCcuLink(r: { from: number | null; to: number; via?: number[]; opt: Pick<PlanOptions, 'objective' | 'steps' | LinkFlag> }): string {
  const p = new URLSearchParams();
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
 * `owns`: the hull is in your hangar (source mode *Ship in my hangar*, else *Any ship*). Options not in the link stay.
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
  if (l.via) out.opt.via = l.via.filter(has);
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
