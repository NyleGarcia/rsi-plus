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

/** Rows passing every facet and range (optionally all but `except`, for that facet's own counts). */
export function applyFacets<T>(rows: T[], facets: Facet<T>[], values: FacetValues, ranges: RangeFacet<T>[] = [], except?: string): T[] {
  return rows.filter((r) => facets.every((f) => f.id === except || passesFacet(r, f, values[f.id])) && ranges.every((g) => g.id === except || passesRange(r, g, values[g.id])));
}

/** `counts[facetId][optionId]` = rows that would show with that option picked (other facets as chosen). */
export function facetCounts<T>(rows: T[], facets: Facet<T>[], values: FacetValues, ranges: RangeFacet<T>[] = []): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const f of facets) {
    const base = applyFacets(rows, facets, values, ranges, f.id);
    out[f.id] = Object.fromEntries(f.options.map((o) => [o.id, base.filter(o.test).length]));
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
