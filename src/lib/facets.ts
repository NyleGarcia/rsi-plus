/**
 * Faceted filtering for the list pages (Pledges, My ships, My CCUs, Ship catalog, Browse): a page declares its facets
 * (a label, options with a predicate, single- or multi-select) and ranges (a numeric getter with min/max), keeps the
 * chosen values in one record, and gets back the rows that pass plus per-option counts computed with every *other*
 * facet applied — so a chip always says how many rows picking it would leave. Pure; `FacetBar.svelte` renders it.
 */
export interface FacetOption<T> {
  id: string;
  label: string;
  hint?: string;
  test: (row: T) => boolean;
}
export interface Facet<T> {
  id: string;
  label: string;
  hint?: string;
  /** Several options at once (OR within the facet). Single by default. */
  multiple?: boolean;
  options: FacetOption<T>[];
}
export interface RangeFacet<T> {
  id: string;
  label: string;
  /** Value in the range's unit, null = not applicable (never filtered out when no bound is set, out when one is). */
  get: (row: T) => number | null;
  unit?: 'usd' | 'n';
}
/** single: option id or null; multiple: option ids. Absent = any. */
export type FacetValue = string | string[] | null | undefined;
export type RangeValue = { min: number | null; max: number | null };
export type FacetValues = Record<string, FacetValue | RangeValue>;

const isRange = (v: FacetValue | RangeValue): v is RangeValue => !!v && typeof v === 'object' && !Array.isArray(v);

export function isActive(v: FacetValue | RangeValue | undefined): boolean {
  if (v == null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isRange(v)) return v.min != null || v.max != null;
  return true;
}
export const activeCount = (values: FacetValues) => Object.values(values).filter(isActive).length;

export function passesFacet<T>(row: T, facet: Facet<T>, value: FacetValue | RangeValue | undefined): boolean {
  if (!isActive(value) || isRange(value!)) return true;
  const ids = Array.isArray(value) ? value : [value as string];
  const opts = ids.map((id) => facet.options.find((o) => o.id === id)).filter((o): o is FacetOption<T> => !!o);
  return opts.length === 0 || opts.some((o) => o.test(row));
}
export function passesRange<T>(row: T, range: RangeFacet<T>, value: FacetValue | RangeValue | undefined): boolean {
  if (!isActive(value) || !isRange(value!)) return true;
  const n = range.get(row);
  if (n == null) return false;
  return (value.min == null || n >= value.min) && (value.max == null || n <= value.max);
}

/**
 * Membership index: for every facet option (and range), which rows pass — computed once per `rows` / `facets` change,
 * so counts and filtering are bit tests instead of re-running predicates (a hangar's "sold today" or "stage" checks
 * walk the catalog per pledge; 40 options × 12 facets × 500 rows of that froze the page for seconds).
 */
export interface FacetIndex<T> {
  rows: T[];
  /** facet id → option id → Uint8Array(rows.length) */
  opt: Map<string, Map<string, Uint8Array>>;
  /** range id → per-row value (NaN = not applicable) */
  val: Map<string, Float64Array>;
}
export function buildFacetIndex<T>(rows: T[], facets: Facet<T>[], ranges: RangeFacet<T>[] = []): FacetIndex<T> {
  const opt = new Map<string, Map<string, Uint8Array>>();
  for (const f of facets) {
    const m = new Map<string, Uint8Array>();
    for (const o of f.options) {
      const bits = new Uint8Array(rows.length);
      for (let i = 0; i < rows.length; i++) if (o.test(rows[i]!)) bits[i] = 1;
      m.set(o.id, bits);
    }
    opt.set(f.id, m);
  }
  const val = new Map<string, Float64Array>();
  for (const r of ranges) {
    const a = new Float64Array(rows.length);
    for (let i = 0; i < rows.length; i++) a[i] = r.get(rows[i]!) ?? NaN;
    val.set(r.id, a);
  }
  return { rows, opt, val };
}

/** Index per (rows, facets, ranges) identity — pages hand the same arrays back until their data changes. */
const cache = new WeakMap<object, WeakMap<object, { ranges: object; ix: FacetIndex<unknown> }>>();
export function indexFor<T>(rows: T[], facets: Facet<T>[], ranges: RangeFacet<T>[] = []): FacetIndex<T> {
  let byFacets = cache.get(rows);
  if (!byFacets) cache.set(rows, (byFacets = new WeakMap()));
  const hit = byFacets.get(facets);
  // A default `[]` is a fresh array per call: empty ranges are all the same key.
  if (hit && (hit.ranges === ranges || ((hit.ranges as unknown[]).length === 0 && ranges.length === 0))) return hit.ix as FacetIndex<T>;
  const ix = buildFacetIndex(rows, facets, ranges);
  byFacets.set(facets, { ranges, ix: ix as FacetIndex<unknown> });
  return ix;
}

/** Row `i` passes facet `f` under `value` (any when inactive; OR across picked options). */
function passIdx<T>(ix: FacetIndex<T>, f: Facet<T>, value: FacetValue | RangeValue | undefined, i: number): boolean {
  if (!isActive(value) || isRange(value!)) return true;
  const ids = Array.isArray(value) ? value : [value as string];
  const m = ix.opt.get(f.id);
  let any = false;
  for (const id of ids) {
    const bits = m?.get(id);
    if (!bits) continue;
    any = true;
    if (bits[i]) return true;
  }
  return !any;
}
function passRangeIdx<T>(ix: FacetIndex<T>, r: RangeFacet<T>, value: FacetValue | RangeValue | undefined, i: number): boolean {
  if (!isActive(value) || !isRange(value!)) return true;
  const n = ix.val.get(r.id)?.[i] ?? NaN;
  if (Number.isNaN(n)) return false;
  return (value.min == null || n >= value.min) && (value.max == null || n <= value.max);
}
/** Mask of rows passing every facet / range except `except`. */
function maskOf<T>(ix: FacetIndex<T>, facets: Facet<T>[], values: FacetValues, ranges: RangeFacet<T>[], except?: string): Uint8Array {
  const n = ix.rows.length;
  const mask = new Uint8Array(n).fill(1);
  for (const f of facets) {
    if (f.id === except || !isActive(values[f.id])) continue;
    for (let i = 0; i < n; i++) if (mask[i] && !passIdx(ix, f, values[f.id], i)) mask[i] = 0;
  }
  for (const r of ranges) {
    if (r.id === except || !isActive(values[r.id])) continue;
    for (let i = 0; i < n; i++) if (mask[i] && !passRangeIdx(ix, r, values[r.id], i)) mask[i] = 0;
  }
  return mask;
}

/** Rows passing every facet and range (optionally all but `except`, for that facet's own counts). Pass an index to reuse predicate results. */
export function applyFacets<T>(rows: T[], facets: Facet<T>[], values: FacetValues, ranges: RangeFacet<T>[] = [], except?: string, index?: FacetIndex<T>): T[] {
  if (!activeCount(values)) return rows;
  const ix = index && index.rows === rows ? index : indexFor(rows, facets, ranges);
  const mask = maskOf(ix, facets, values, ranges, except);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i++) if (mask[i]) out.push(rows[i]!);
  return out;
}

/** `counts[facetId][optionId]` = rows that would show with that option picked (other facets as chosen). */
export function facetCounts<T>(rows: T[], facets: Facet<T>[], values: FacetValues, ranges: RangeFacet<T>[] = [], index?: FacetIndex<T>): Record<string, Record<string, number>> {
  const ix = index && index.rows === rows ? index : indexFor(rows, facets, ranges);
  const out: Record<string, Record<string, number>> = {};
  for (const f of facets) {
    const mask = maskOf(ix, facets, values, ranges, f.id);
    const m = ix.opt.get(f.id)!;
    const rec: Record<string, number> = {};
    for (const o of f.options) {
      const bits = m.get(o.id)!;
      let n = 0;
      for (let i = 0; i < bits.length; i++) if (mask[i] && bits[i]) n++;
      rec[o.id] = n;
    }
    out[f.id] = rec;
  }
  return out;
}

/** Toggle an option: single facets pick / unpick, multiple facets add / remove. */
export function toggleFacet(values: FacetValues, facet: Pick<Facet<unknown>, 'id' | 'multiple'>, id: string): FacetValues {
  const cur = values[facet.id];
  if (facet.multiple) {
    const set = new Set(Array.isArray(cur) ? cur : []);
    set.has(id) ? set.delete(id) : set.add(id);
    return { ...values, [facet.id]: [...set] };
  }
  return { ...values, [facet.id]: cur === id ? null : id };
}
export const clearFacets = (values: FacetValues, keep: string[] = []): FacetValues => Object.fromEntries(Object.entries(values).filter(([k]) => keep.includes(k)));

/** Option helpers for the common yes / no facets. */
export const yesNo = <T>(label: string, test: (r: T) => boolean, hints?: [string, string]): FacetOption<T>[] => [
  { id: 'yes', label, hint: hints?.[0], test },
  { id: 'no', label: `Not ${label.toLowerCase()}`, hint: hints?.[1], test: (r) => !test(r) },
];
/** `'LTI' | '120 mo' | '6 mo' | ''` → the insurance facet bucket. */
export const insuranceBucket = (ins: string, lti = false): 'lti' | '120' | 'short' | 'none' => (lti || /lti/i.test(ins) ? 'lti' : /^120/.test(ins) ? '120' : ins ? 'short' : 'none');
export const INSURANCE_OPTIONS = <T>(get: (r: T) => string, lti: (r: T) => boolean = () => false): FacetOption<T>[] => [
  { id: 'lti', label: 'LTI', test: (r) => insuranceBucket(get(r), lti(r)) === 'lti' },
  { id: '120', label: '120 months', test: (r) => insuranceBucket(get(r), lti(r)) === '120' },
  { id: 'short', label: '< 120 months', test: (r) => insuranceBucket(get(r), lti(r)) === 'short' },
  { id: 'none', label: 'None listed', test: (r) => insuranceBucket(get(r), lti(r)) === 'none' },
];
/** RSI's `flyableStatus` → stage bucket. */
export const stageOf = (flyable: string): 'ready' | 'concept' | 'other' => (/flyable|flight.?ready/i.test(flyable) ? 'ready' : /concept/i.test(flyable) ? 'concept' : 'other');
export const STAGE_OPTIONS = <T>(get: (r: T) => string): FacetOption<T>[] => [
  { id: 'ready', label: 'Flight ready', test: (r) => stageOf(get(r)) === 'ready' },
  { id: 'concept', label: 'Concept', test: (r) => stageOf(get(r)) === 'concept' },
  { id: 'other', label: 'In production', hint: 'Neither flyable nor concept per RSI', test: (r) => stageOf(get(r)) === 'other' },
];
export const SIZE_IDS = ['Vehicle', 'Snub', 'Small', 'Medium', 'Large', 'Capital'] as const;
export const SIZE_OPTIONS = <T>(get: (r: T) => string): FacetOption<T>[] => SIZE_IDS.map((s) => ({ id: s.toLowerCase(), label: s, test: (r) => get(r).toLowerCase() === s.toLowerCase() }));
