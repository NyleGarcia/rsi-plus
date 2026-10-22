import { describe, expect, it } from 'vitest';
import { activeFilters, BROWSE_RANGES, browseFacets, DEFAULT_FACETS, DEFAULT_FILTER, discountPct, filterItems, matchesFilter, matchesQuery, parseFacetValues, parseUsd, type BrowseFilter } from '@/lib/browse';
import { applyFacets, facetCounts, type FacetValues } from '@/lib/facets';
import type { StoreItem } from '@/lib/store';

const item = (o: Partial<StoreItem> & { id: number }): StoreItem => ({
  name: `Item ${o.id}`,
  url: 'https://robertsspaceindustries.com/pledge/x',
  price: 1000,
  discounted: 1000,
  available: true,
  thumb: null,
  category: 'paints',
  subtitle: 'Paints',
  vip: false,
  warbond: false,
  ...o,
});
const f = (o: Partial<BrowseFilter> = {}): BrowseFilter => ({ ...DEFAULT_FILTER, ...o });
const none = () => 0;
const ids = (list: StoreItem[]) => list.map((x) => x.id);

const ITEMS = [
  item({ id: 1 }),
  item({ id: 2, available: false }),
  item({ id: 3, category: 'packs', subtitle: 'Packs', price: 4500, discounted: 3600 }),
  item({ id: 4, category: 'gear', subtitle: 'Gear', warbond: true, price: 200, discounted: 200 }),
  item({ id: 5, category: 'ships', subtitle: 'Standalone Ships', vip: true, price: 60000, discounted: 60000 }),
  item({ id: 6, category: 'subscribers', subtitle: 'Subscribers Store', price: 500, discounted: 500 }),
  item({ id: 7, category: 'gear', subtitle: 'Gear', price: 1000, discounted: 1000, contents: [{ name: 'Helmet' }, { name: 'Core' }, { name: '6 Month Insurance' }] }),
];

describe('filterItems', () => {
  it('defaults to what the store sells now: in stock, every category and audience', () => {
    expect(ids(filterItems(ITEMS, f(), none))).toEqual([1, 3, 4, 5, 6, 7]);
  });
  it('out-of-stock rows come back when the in-stock cut is off', () => {
    expect(ids(filterItems(ITEMS, f({ inStock: false }), none))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('category tabs cut one category', () => {
    expect(ids(filterItems(ITEMS, f({ cat: 'packs' }), none))).toEqual([3]);
    expect(ids(filterItems(ITEMS, f({ cat: 'paints', inStock: false }), none))).toEqual([1, 2]);
  });
  it('audience: Concierge = vip rows, Subscribers = the subscribers category', () => {
    expect(ids(filterItems(ITEMS, f({ who: 'concierge' }), none))).toEqual([5]);
    expect(ids(filterItems(ITEMS, f({ who: 'subscribers' }), none))).toEqual([6]);
  });
  it('sale / warbond / price bounds / search stack', () => {
    expect(ids(filterItems(ITEMS, f({ sale: true }), none))).toEqual([3]);
    expect(ids(filterItems(ITEMS, f({ edition: 'warbond' }), none))).toEqual([4]);
    expect(ids(filterItems(ITEMS, f({ edition: 'standard' }), none))).toEqual([1, 3, 5, 6, 7]);
    expect(ids(filterItems(ITEMS, f({ min: 1000, max: 5000 }), none))).toEqual([1, 3, 7]);
    expect(ids(filterItems(ITEMS, f({ max: 500 }), none))).toEqual([4, 6]);
    expect(ids(filterItems(ITEMS, f({ q: 'standalone' }), none))).toEqual([5]);
    expect(ids(filterItems(ITEMS, f({ q: 'item', max: 500, edition: 'warbond' }), none))).toEqual([4]);
    expect(ids(filterItems(ITEMS, f({ bundles: true }), none))).toEqual([7]);
  });
  it('owned cuts use the hangar count', () => {
    const owned = (it: StoreItem) => (it.id === 1 || it.id === 4 ? 2 : 0);
    expect(ids(filterItems(ITEMS, f({ owned: 'owned' }), owned))).toEqual([1, 4]);
    expect(ids(filterItems(ITEMS, f({ owned: 'missing' }), owned))).toEqual([3, 5, 6, 7]);
  });
  it('piece cuts: all / some / none go by what the hangar holds of the pieces, not the listing', () => {
    // 1: owned outright · 3: a pack, two of five pieces · 4: a pack, every piece collected one by one · 7: nothing of it
    const h = (it: StoreItem) => (it.id === 1 ? 1 : it.id === 3 ? { count: 0, have: 2, of: 5 } : it.id === 4 ? { count: 0, have: 3, of: 3 } : 0);
    expect(ids(filterItems(ITEMS, f({ owned: 'all' }), h))).toEqual([1, 4]);
    expect(ids(filterItems(ITEMS, f({ owned: 'some' }), h))).toEqual([3]);
    expect(ids(filterItems(ITEMS, f({ owned: 'none' }), h))).toEqual([5, 6, 7]);
    expect(ids(filterItems(ITEMS, f({ owned: 'owned' }), h))).toEqual([1]);
    expect(ids(filterItems(ITEMS, f({ owned: 'missing' }), h))).toEqual([3, 4, 5, 6, 7]);
  });
  it('price bounds apply to the price paid now (the discounted one)', () => {
    expect(matchesFilter(ITEMS[2]!, f({ max: 4000 }), 0)).toBe(true);
    expect(matchesFilter(ITEMS[2]!, f({ min: 4000 }), 0)).toBe(false);
  });
});

describe('helpers', () => {
  it('discountPct rounds and is 0 without a discount', () => {
    expect(discountPct({ price: 4500, discounted: 3600 })).toBe(20);
    expect(discountPct({ price: 1000, discounted: 1000 })).toBe(0);
    expect(discountPct({ price: 0, discounted: 0 })).toBe(0);
  });
  it('parseUsd reads dollars into cents', () => {
    expect(parseUsd('12')).toBe(1200);
    expect(parseUsd('$1,234.5')).toBe(123450);
    expect(parseUsd('')).toBeNull();
    expect(parseUsd('abc')).toBeNull();
    expect(parseUsd('-3')).toBeNull();
  });
  it('activeFilters counts what differs from the default, not tabs', () => {
    expect(activeFilters(f())).toBe(0);
    expect(activeFilters(f({ who: 'concierge', cat: 'gear' }))).toBe(0);
    expect(activeFilters(f({ inStock: false, sale: true, min: 100, q: 'x' }))).toBe(4);
    expect(activeFilters(f({ bundles: true }))).toBe(1);
  });
});

describe('browse facets', () => {
  const RIB = [
    ...ITEMS,
    item({ id: 8, tags: ['Limited Time', 'New'], stockLevel: 'low' }),
    item({ id: 9, tags: ['Best Value', 'Bonus Paints'], stockLevel: 'high' }),
    item({ id: 10, tags: ['FITS Cutlass'], available: false, stockLevel: 'low' }),
  ];
  const own = (it: StoreItem) => (it.id === 1 ? 1 : it.id === 3 ? { count: 0, have: 2, of: 5 } : it.id === 4 ? { count: 0, have: 3, of: 3 } : 0);
  const facets = browseFacets(own);
  const run = (v: FacetValues) => ids(applyFacets(RIB, facets, v, BROWSE_RANGES));

  it('defaults to in stock only', () => {
    expect(run(DEFAULT_FACETS)).toEqual([1, 3, 4, 5, 6, 7, 8, 9]);
    expect(run({ stock: 'out' })).toEqual([2, 10]);
    expect(run({})).toHaveLength(RIB.length);
  });
  it('special is OR within the facet', () => {
    expect(run({ special: ['sale'] })).toEqual([3]);
    expect(run({ special: ['limited'] })).toEqual([8]);
    expect(run({ special: ['new', 'bestvalue'] })).toEqual([8, 9]);
    expect(run({ special: ['bonus'] })).toEqual([9]);
    expect(run({ special: ['concierge', 'subscribers'] })).toEqual([5, 6]);
    expect(run({ special: ['lowstock'] })).toEqual([8]); // 10 is low but out of stock
  });
  it('edition, bundles, hangar and price stack with the rest', () => {
    expect(run({ ...DEFAULT_FACETS, edition: 'warbond' })).toEqual([4]);
    expect(run({ ...DEFAULT_FACETS, edition: 'standard' })).toEqual([1, 3, 5, 6, 7, 8, 9]);
    expect(run({ bundles: 'yes' })).toEqual([7]);
    expect(run({ owned: 'all' })).toEqual([1, 4]);
    expect(run({ owned: 'some' })).toEqual([3]);
    expect(run({ owned: 'owned' })).toEqual([1]);
    expect(run({ ...DEFAULT_FACETS, price: { min: 10, max: 50 } })).toEqual([1, 3, 7, 8, 9]);
    expect(run({ ...DEFAULT_FACETS, price: { min: null, max: 5 } })).toEqual([4, 6]);
  });
  it('counts per option apply the other facets', () => {
    const c = facetCounts(RIB, facets, { stock: 'in', edition: 'warbond' }, BROWSE_RANGES);
    expect(c.edition).toEqual({ warbond: 1, standard: 7 });
    expect(c.stock).toEqual({ in: 1, out: 0 });
  });
  it('search matches name and subtitle', () => {
    expect(matchesQuery(RIB[4]!, 'standalone')).toBe(true);
    expect(matchesQuery(RIB[4]!, 'paint')).toBe(false);
    expect(matchesQuery(RIB[4]!, '')).toBe(true);
  });
  it('saved values: unknown ids and junk are dropped, nothing saved → defaults', () => {
    expect(parseFacetValues(null, facets, BROWSE_RANGES, DEFAULT_FACETS)).toEqual({ stock: 'in' });
    expect(parseFacetValues('{nope', facets, BROWSE_RANGES, DEFAULT_FACETS)).toEqual({ stock: 'in' });
    expect(parseFacetValues(JSON.stringify({ special: ['new', 'bogus'], edition: 'x', stock: null, price: { min: 5, max: null }, zz: 1 }), facets, BROWSE_RANGES, DEFAULT_FACETS)).toEqual({
      special: ['new'],
      stock: null,
      price: { min: 5, max: null },
    });
    expect(parseFacetValues('{}', facets, BROWSE_RANGES, DEFAULT_FACETS)).toEqual({});
  });
});
