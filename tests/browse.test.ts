import { describe, expect, it } from 'vitest';
import { activeFilters, DEFAULT_FILTER, discountPct, filterItems, matchesFilter, parseUsd, type BrowseFilter } from '@/lib/browse';
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
