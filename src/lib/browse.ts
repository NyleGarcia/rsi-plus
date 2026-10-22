/**
 * Store → Browse filters, kept out of the component so they can be tested. The default is "what the store sells right
 * now": in-stock listings only, every category, every audience — out-of-stock rows (RSI keeps them listed for a while)
 * are a switch, like the Ship catalog's "All hulls".
 */
import { bonusOf, isBestValue, isLimitedTime, isLowStock, isNewListing, STORE_CATEGORIES, type StoreCategory, type StoreItem } from './store';
import { isBundle } from './bundle';
import { isActive, type Facet, type FacetValues, type RangeFacet } from './facets';

export { isBundle };

export type Audience = 'all' | 'concierge' | 'subscribers';
/**
 * Hangar cut. `owned` / `missing` go by the listing itself (its name in the hangar); `all` / `some` / `none` go by its
 * pieces — a pack you never bought but whose paints you collected one by one is `all`, a pack with two of nine ships
 * is `some` (only packs can be), one with none of them `none`.
 */
export type Owned = 'any' | 'owned' | 'missing' | 'all' | 'some' | 'none';
/** What the hangar holds of a listing: copies of the listing itself, and pieces owned out of the pieces that can be. */
export interface HangarMatch {
  count: number;
  have: number;
  of: number;
}
/** A single listing's pieces are itself: owned or not, out of one. */
export const hangarMatch = (owned: number | HangarMatch): HangarMatch => (typeof owned === 'number' ? { count: owned, have: owned > 0 ? 1 : 0, of: 1 } : owned);
export type Edition = 'any' | 'warbond' | 'standard';
export type Cat = StoreCategory | 'all';

export interface BrowseFilter {
  who: Audience;
  cat: Cat;
  /** Hide listings the store reports out of stock (default). */
  inStock: boolean;
  /** Discounted below list price. */
  sale: boolean;
  /** Warbond (new money only, usually cheaper) vs standard (store credit welcome). */
  edition: Edition;
  /** Only listings that grant two or more pieces (packs, kits, collections). */
  bundles: boolean;
  owned: Owned;
  /** Price bounds on the price paid now (USD cents); null = no bound. */
  min: number | null;
  max: number | null;
  q: string;
}

export const DEFAULT_FILTER: BrowseFilter = { who: 'all', cat: 'all', inStock: true, sale: false, edition: 'any', bundles: false, owned: 'any', min: null, max: null, q: '' };

const CATS = new Set<string>(['all', ...STORE_CATEGORIES.map((c) => c.id)]);
export const isCat = (s: string | null | undefined): s is Cat => !!s && CATS.has(s);
export const isAudience = (s: string | null | undefined): s is Audience => s === 'all' || s === 'concierge' || s === 'subscribers';

export const discountPct = (it: Pick<StoreItem, 'price' | 'discounted'>) => (it.price > it.discounted ? Math.round((100 * (it.price - it.discounted)) / it.price) : 0);

export const forWho = (it: Pick<StoreItem, 'vip' | 'category'>, w: Audience) => (w === 'all' ? true : w === 'concierge' ? it.vip : it.category === 'subscribers');

/** Every cut except the category, so category tabs can count what each would show. */
export function matchesFilter(it: StoreItem, f: BrowseFilter, owned: number | HangarMatch, query = f.q.trim().toLowerCase()): boolean {
  if (!forWho(it, f.who)) return false;
  if (f.inStock && !it.available) return false;
  if (f.sale && discountPct(it) <= 0) return false;
  if (f.edition === 'warbond' && !it.warbond) return false;
  if (f.edition === 'standard' && it.warbond) return false;
  if (f.bundles && !isBundle(it)) return false;
  if (f.owned !== 'any' && !ownedCut(f.owned, hangarMatch(owned))) return false;
  if (f.min != null && it.discounted < f.min) return false;
  if (f.max != null && it.discounted > f.max) return false;
  if (query && !`${it.name} ${it.subtitle}`.toLowerCase().includes(query)) return false;
  return true;
}

/** Does a listing's hangar match pass one hangar cut (see `Owned`)? */
export function ownedCut(o: Exclude<Owned, 'any'>, h: HangarMatch): boolean {
  switch (o) {
    case 'owned':
      return h.count > 0;
    case 'missing':
      return h.count <= 0;
    case 'all':
      return h.of > 0 && h.have >= h.of;
    case 'some':
      return h.have > 0 && h.have < h.of;
    case 'none':
      return h.have === 0;
  }
}

export const matchesCat = (it: Pick<StoreItem, 'category'>, cat: Cat) => cat === 'all' || it.category === cat;

export function filterItems(items: StoreItem[], f: BrowseFilter, ownedCount: (it: StoreItem) => number | HangarMatch): StoreItem[] {
  const query = f.q.trim().toLowerCase();
  return items.filter((it) => matchesCat(it, f.cat) && matchesFilter(it, f, ownedCount(it), query));
}

/** Filters that differ from the default, apart from audience and category (which are tabs, not filters). */
export function activeFilters(f: BrowseFilter): number {
  let n = 0;
  if (f.inStock !== DEFAULT_FILTER.inStock) n++;
  if (f.sale) n++;
  if (f.edition !== 'any') n++;
  if (f.bundles) n++;
  if (f.owned !== 'any') n++;
  if (f.min != null || f.max != null) n++;
  if (f.q.trim()) n++;
  return n;
}

/** "$12.50" / "12" / "" → cents or null. Rejects negatives and nonsense. */
export function parseUsd(s: string): number | null {
  const n = Number(s.replace(/[$,\s]/g, ''));
  return s.trim() === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100);
}

// ---- facets (the Browse page's FacetBar); audience, category and search stay outside them ----

/** The search box: name + subtitle, case-insensitive. */
export const matchesQuery = (it: Pick<StoreItem, 'name' | 'subtitle'>, query: string) => !query || `${it.name} ${it.subtitle}`.toLowerCase().includes(query);

const OWNED_OPTIONS: { id: Exclude<Owned, 'any'>; label: string; hint: string }[] = [
  { id: 'owned', label: 'In my hangar', hint: 'The listing itself is in your hangar' },
  { id: 'missing', label: 'Not in my hangar', hint: 'The listing itself is not in your hangar' },
  { id: 'all', label: 'Pieces: all owned', hint: "Every piece of it is yours (a collection whose paints you bought one by one counts)" },
  { id: 'some', label: 'Pieces: some owned', hint: 'Some of its pieces are yours — two of nine ships (only packs can be)' },
  { id: 'none', label: 'Pieces: none owned', hint: 'None of its pieces are in your hangar' },
];

/** Browse facets. `hangarOf` = what the hangar holds of a listing (the page knows packs' pieces). */
export function browseFacets(hangarOf: (it: StoreItem) => number | HangarMatch): Facet<StoreItem>[] {
  return [
    {
      id: 'special',
      label: 'Special',
      multiple: true,
      options: [
        { id: 'sale', label: 'Discounted', hint: 'Below list price right now', test: (it) => discountPct(it) > 0 },
        { id: 'limited', label: 'Limited time', hint: 'RSI marks it time-limited', test: isLimitedTime },
        { id: 'new', label: 'New', hint: 'RSI marks it new', test: isNewListing },
        { id: 'bestvalue', label: 'Best value', hint: 'RSI marks it best value', test: isBestValue },
        { id: 'bonus', label: 'Bonus', hint: 'Comes with extras RSI calls out (bonus paints, gear, items)', test: (it) => bonusOf(it) != null },
        { id: 'concierge', label: 'Concierge', hint: 'Listed for Concierge members only', test: (it) => it.vip },
        { id: 'subscribers', label: 'Subscribers', hint: 'The Subscribers Store', test: (it) => it.category === 'subscribers' },
        { id: 'lowstock', label: 'Low stock', hint: 'RSI reports the stock running low', test: isLowStock },
      ],
    },
    {
      id: 'edition',
      label: 'Edition',
      options: [
        { id: 'warbond', label: 'Warbond', hint: 'New money only (no store credit), usually cheaper', test: (it) => it.warbond },
        { id: 'standard', label: 'Standard', hint: 'Store credit welcome', test: (it) => !it.warbond },
      ],
    },
    { id: 'owned', label: 'Hangar', options: OWNED_OPTIONS.map((o) => ({ ...o, test: (it: StoreItem) => ownedCut(o.id, hangarMatch(hangarOf(it))) })) },
    {
      id: 'stock',
      label: 'Stock',
      options: [
        { id: 'in', label: 'In stock', test: (it) => it.available },
        { id: 'out', label: 'Out of stock', hint: 'RSI keeps sold-out listings for a while', test: (it) => !it.available },
      ],
    },
    { id: 'bundles', label: 'Bundles', options: [{ id: 'yes', label: 'Bundles only', hint: 'Packs, kits and collections — two or more pieces; open one to see what each would cost apart', test: isBundle }] },
  ];
}
/** Price paid now, in dollars (the range fields take dollars). */
export const BROWSE_RANGES: RangeFacet<StoreItem>[] = [{ id: 'price', label: 'Price', unit: 'usd', get: (it) => it.discounted / 100 }];
export const BROWSE_PRIMARY = ['special', 'edition', 'owned'];
/** What the store sells now: in stock only. */
export const DEFAULT_FACETS: FacetValues = { stock: 'in' };
export const BROWSE_PREFS_KEY = 'rsiplus:browse';

const isRangeValue = (v: unknown): v is { min: unknown; max: unknown } => !!v && typeof v === 'object' && !Array.isArray(v) && 'min' in v && 'max' in v;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Saved facet values (JSON) → values the facets know; anything unreadable → the defaults. */
export function parseFacetValues<T>(raw: string | null | undefined, facets: Pick<Facet<T>, 'id' | 'multiple' | 'options'>[], ranges: Pick<RangeFacet<T>, 'id'>[] = [], fallback: FacetValues = {}): FacetValues {
  if (!raw) return { ...fallback };
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return { ...fallback };
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ...fallback };
  const rec = o as Record<string, unknown>;
  const out: FacetValues = {};
  for (const f of facets) {
    const v = rec[f.id];
    const ok = (id: unknown): id is string => typeof id === 'string' && f.options.some((x) => x.id === id);
    if (f.multiple && Array.isArray(v)) out[f.id] = v.filter(ok);
    else if (!f.multiple && ok(v)) out[f.id] = v;
    else if (v === null) out[f.id] = null; // explicitly "any" (e.g. stock unpicked)
  }
  for (const r of ranges) {
    const v = rec[r.id];
    if (isRangeValue(v) && isActive({ min: num(v.min), max: num(v.max) })) out[r.id] = { min: num(v.min), max: num(v.max) };
  }
  return out;
}
