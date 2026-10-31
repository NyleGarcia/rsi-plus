/**
 * Links to the Star Citizen Wiki (starcitizen.tools). No request is made: pages render a plain `<a>` the user clicks
 * (see `WikiLink.svelte`). A name links only when the wiki has a page (or redirect) by that name — checked against the
 * bundled title list in `wiki-pages.svelte.ts` — so there is never a link to a missing page. Ships try RSI's catalog
 * name first, then the item title; the other kinds the wiki covers (components, FPS weapons, armour, paints) go by
 * title. Packages, insurance, hangar flair, credits, CCUs and subscriber items get no link.
 */
import { categorize, type Category } from './items';
import type { CatalogShip, StoreCategory } from './store';
import { wikiTitle } from './wiki-pages.svelte';

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

/** Page URL for `name` when the wiki has a page by that name (case and spacing ignored), else null. */
export function wikiPageUrl(name: string): string | null {
  const title = name.trim() ? wikiTitle(name) : null;
  return title ? wikiUrl(title) : null;
}

/** Item categories (`lib/items` → `categorize`) the wiki has pages for besides ships. */
export const WIKI_ITEM_CATEGORIES: ReadonlySet<Category> = new Set<Category>(['paint', 'armor', 'weapon', 'fps', 'component']);

/**
 * Wiki link for a hangar / buyback item. `ship` is the catalog match of a ship item — its catalog name is tried
 * first, then the item title. Null when the kind has no wiki pages or the wiki has no page by that name.
 */
export function itemWikiUrl(category: Category, title: string, ship?: CatalogShip | null): string | null {
  if (category === 'ship') return (ship && wikiPageUrl(ship.name)) || wikiPageUrl(title);
  return WIKI_ITEM_CATEGORIES.has(category) ? wikiPageUrl(title) : null;
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
 * Wiki link for a store listing, when the wiki has the page. Standalone ships → the catalog ship's page; paints by
 * name; gear by title (`gearWikiUrl`); add-ons only when the title reads as a covered item (paint / armour). Packs,
 * game packages and the subscribers store → null.
 */
export function storeWikiUrl(category: StoreCategory, name: string, ship?: CatalogShip | null): string | null {
  switch (category) {
    case 'ships':
      return itemWikiUrl('ship', name, ship);
    case 'paints':
      return wikiPageUrl(name);
    case 'gear':
      return gearWikiUrl(name);
    case 'addons':
      return itemWikiUrl(categorize(name, ''), name);
    default:
      return null;
  }
}
