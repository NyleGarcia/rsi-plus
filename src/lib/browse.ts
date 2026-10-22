/**
 * Store → Browse filters, kept out of the component so they can be tested. The default is "what the store sells right
 * now": in-stock listings only, every category, every audience — out-of-stock rows (RSI keeps them listed for a while)
 * are a switch, like the Ship catalog's "All hulls".
 */
import { STORE_CATEGORIES, type StoreCategory, type StoreItem } from './store';
import { isBundle } from './bundle';

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
  const h = hangarMatch(owned);
  if (f.owned === 'owned' && h.count <= 0) return false;
  if (f.owned === 'missing' && h.count > 0) return false;
  if (f.owned === 'all' && (h.of === 0 || h.have < h.of)) return false;
  if (f.owned === 'some' && (h.have === 0 || h.have >= h.of)) return false;
  if (f.owned === 'none' && h.have > 0) return false;
  if (f.min != null && it.discounted < f.min) return false;
  if (f.max != null && it.discounted > f.max) return false;
  if (query && !`${it.name} ${it.subtitle}`.toLowerCase().includes(query)) return false;
  return true;
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
