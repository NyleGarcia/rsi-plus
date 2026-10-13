/** Column sorting shared by every hub table. Pure. */

export type Dir = 'asc' | 'desc';
export interface SortState<K extends string = string> {
  key: K;
  dir: Dir;
}

export type SortValue = string | number | boolean | null | undefined;

/** Click a header: same column flips direction, a new column starts at its default direction. */
export function nextSort<K extends string>(cur: SortState<K>, key: K, firstDir: Dir = 'asc'): SortState<K> {
  return cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Compare two cell values: numbers numerically, strings naturally ("Mk II" < "Mk 10"), empty always last. */
export function compare(a: SortValue, b: SortValue, dir: Dir): number {
  const ea = a == null || a === '' || (typeof a === 'number' && Number.isNaN(a));
  const eb = b == null || b === '' || (typeof b === 'number' && Number.isNaN(b));
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empties last in both directions
  let r: number;
  if (typeof a === 'number' && typeof b === 'number') r = a - b;
  else if (typeof a === 'boolean' && typeof b === 'boolean') r = Number(a) - Number(b);
  else r = collator.compare(String(a), String(b));
  return dir === 'asc' ? r : -r;
}

/**
 * Stable sort by the accessor for `state.key`; ties keep the incoming order (e.g. RSI's newest-first),
 * so pass the list in its natural order.
 */
export function sortBy<T, K extends string>(list: T[], state: SortState<K>, accessors: Record<K, (t: T) => SortValue>): T[] {
  const get = accessors[state.key];
  if (!get) return list;
  return list
    .map((t, i) => ({ t, i, v: get(t) }))
    .sort((x, y) => compare(x.v, y.v, state.dir) || x.i - y.i)
    .map((x) => x.t);
}

/** "October 01, 2026" / ISO / ms → ms (NaN when unparseable, which sorts last). */
export const dateValue = (s: string | number | null | undefined): number => (typeof s === 'number' ? s : s ? Date.parse(s) : NaN);
