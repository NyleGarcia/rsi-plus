/**
 * Links to the Star Citizen Wiki (starcitizen.tools). Pure — no request is made: pages render a plain `<a>` the user
 * clicks (see `WikiLink.svelte`). Ships use RSI's catalog name as the page title (the wiki redirects variants);
 * everything else the wiki covers (components, FPS weapons, armour, paints) goes through its search, which jumps
 * straight to the page when the title exists. Packages, insurance, hangar flair, credits, CCUs and subscriber items
 * have no page and get no link.
 */
import { categorize, type Category } from './items';
import type { CatalogShip, StoreCategory } from './store';

export const WIKI_ORIGIN = 'https://starcitizen.tools';

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Page URL for a MediaWiki title: spaces → `_`, each `/`-segment percent-encoded but `' ( ) : ,` kept readable. */
export function wikiUrl(title: string): string {
  const path = tidy(title)
    .replace(/ /g, '_')
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%3A/gi, ':').replace(/%2C/gi, ','))
    .join('/');
  return `${WIKI_ORIGIN}/${path}`;
}

/** Search URL: MediaWiki's "Go" opens the page when the title exists, else lists results. */
export function wikiSearchUrl(name: string): string {
  return `${WIKI_ORIGIN}/index.php?search=${encodeURIComponent(tidy(name))}&go=Go`;
}

/** Item categories (`lib/items` → `categorize`) the wiki has pages for besides ships. */
export const WIKI_ITEM_CATEGORIES: ReadonlySet<Category> = new Set<Category>(['paint', 'armor', 'weapon', 'fps', 'component']);

/**
 * Wiki link for a hangar / buyback item. `ship` is the catalog match of a ship item — its catalog name is the page
 * title; an unmatched ship falls back to a search on the item title. Null when the wiki has no page for the kind.
 */
export function itemWikiUrl(category: Category, title: string, ship?: CatalogShip | null): string | null {
  if (category === 'ship') return ship ? wikiUrl(ship.name) : title.trim() ? wikiSearchUrl(title) : null;
  return WIKI_ITEM_CATEGORIES.has(category) && title.trim() ? wikiSearchUrl(title) : null;
}

/**
 * Gear listings (also Concierge specials, which land in `gear`): by title — a paint / armour title links; else only a
 * title that reads as an FPS weapon or armour piece. Flair, credits and other one-offs get none.
 */
function gearWikiUrl(name: string): string | null {
  const c = categorize(name, '');
  if (c !== 'other') return itemWikiUrl(c, name);
  const fps = categorize(name, 'fps');
  return fps === 'armor' || fps === 'weapon' ? itemWikiUrl(fps, name) : null;
}

/**
 * Wiki link for a store listing. Standalone ships → the catalog ship's page; paints → search; gear by title (`gearWikiUrl`); add-ons only
 * when the title reads as a covered item (paint / armour). Packs, game packages and the subscribers store → null.
 */
export function storeWikiUrl(category: StoreCategory, name: string, ship?: CatalogShip | null): string | null {
  switch (category) {
    case 'ships':
      return itemWikiUrl('ship', name, ship);
    case 'paints':
      return name.trim() ? wikiSearchUrl(name) : null;
    case 'gear':
      return gearWikiUrl(name);
    case 'addons':
      return itemWikiUrl(categorize(name, ''), name);
    default:
      return null;
  }
}
