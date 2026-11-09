/**
 * Star Hangar (star-hangar.com, a Magento marketplace of player sellers): what RSI+ reads off its listing cards and
 * product pages, turned into The Impound's listing shape (`ImpProduct`) so prices, markup, ownership, filters and
 * sorting are shared (lib/impound.ts, lib/market-dom.ts).
 *
 * Cards carry everything (checked 2026-11): title (`.product-item-link`), price (`data-price-amount`, USD), seller
 * (`.seller-name`) and attribute values in order — package type ("Single item", "Upgrade", "Add-On", …), insurance
 * ("LTI", "10y ins.", "no ins."), then for upgrades the from and to ship ("Hornet Ghost, F7C-S MK2", "Ironclad Base"),
 * and "CCU'ed Product" / "Original Product". No RSI ids: ships are matched by name, strictly (a "Corsair Plushie" is not
 * a Corsair). Nothing is fetched: RSI+ reads the pages you open.
 */
import { matchShip, type CatalogShip } from './store';
import type { ImpProduct } from './impound';

export const SH_ORIGIN = 'https://star-hangar.com';
/** Optional host asked for by Settings → Integrations → Star Hangar. */
export const SH_HOSTS = [`${SH_ORIGIN}/*`];

export interface ShCard {
  /** Magento product id. */
  id: string;
  title: string;
  url: string;
  /** USD cents. */
  price: number;
  /** Attribute values in card order. */
  attrs: string[];
  seller: string;
}

const text = (n: Element | null | undefined) => n?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** A listing card (`.product-item-info`) → its data; null when it has no price or title. */
export function parseCard(card: Element): ShCard | null {
  const link = card.querySelector<HTMLAnchorElement>('a.product-item-link');
  const priceEl = card.querySelector<HTMLElement>('[data-price-type="finalPrice"][data-price-amount], [data-price-amount]');
  const id = card.querySelector<HTMLElement>('[data-product-id]')?.dataset.productId ?? /(\d+)$/.exec(card.id)?.[1] ?? '';
  const amount = Number(priceEl?.dataset.priceAmount);
  if (!link || !id || !Number.isFinite(amount)) return null;
  return {
    id,
    title: text(link),
    url: link.href,
    price: Math.round(amount * 100),
    attrs: [...card.querySelectorAll('.attribute-value')].map(text).filter(Boolean),
    seller: text(card.querySelector('.seller-name')),
  };
}

/** A product page (`.product-info-main`) → the same data (attribute values from the labelled list). */
export function parsePage(doc: Document): ShCard | null {
  const main = doc.querySelector('.product-info-main');
  if (!main) return null;
  const priceEl = main.querySelector<HTMLElement>('[data-price-amount]');
  const id = main.querySelector<HTMLElement>('[data-product-id]')?.dataset.productId ?? doc.querySelector<HTMLInputElement>('input[name="product"]')?.value ?? '';
  const amount = Number(priceEl?.dataset.priceAmount ?? main.querySelector('meta[itemprop="price"]')?.getAttribute('content'));
  const title = text(main.querySelector('.page-title .base') ?? main.querySelector('h1'));
  if (!id || !title || !Number.isFinite(amount)) return null;
  return {
    id,
    title,
    url: doc.location?.href ?? '',
    price: Math.round(amount * 100),
    attrs: [...main.querySelectorAll('.attribute-value')].map(text).filter(Boolean),
    seller: text(doc.querySelector('.seller-name, .wk-mp-seller-name, [class*="seller-name"]')),
  };
}

/** Insurance attribute → the SKU insurance code The Impound uses: `L`, `<months>M`. */
export function insCode(attrs: string[]): string {
  for (const a of attrs) {
    if (/\bLTI\b|lifetime/i.test(a)) return 'L';
    const y = /(\d+)\s*y(?:ears?)?\b/i.exec(a);
    if (y && /ins/i.test(a)) return `${Number(y[1]) * 12}M`;
    const m = /(\d+)\s*m(?:onths?|o)?\b/i.exec(a);
    if (m && /ins/i.test(a)) return `${Number(m[1])}M`;
    if (/no ins/i.test(a)) return '0M';
  }
  return '0M';
}

/** Words a listing adds to a ship name that don't make it another thing. */
const SHIP_WORDS = new Set('lti standalone ship vehicle original concept warbond ccu ccued ccud ed edition base pledge pack package game star citizen with insurance year years month months ins'.split(' '));
const words = (s: string) => s.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
/**
 * The catalog ship a "single item" title is, or null: every word of the title (before " - ") must be in the ship's
 * name or be listing filler (LTI, Standalone, Warbond …). "Corsair - LTI" → Corsair; "Corsair Plushie" → null.
 */
export function strictShip(title: string, ships: CatalogShip[]): CatalogShip | null {
  const base = title.split(/\s+-\s+/)[0]!.replace(/\(.*?\)/g, ' ').trim();
  const s = matchShip(base, ships);
  if (!s) return null;
  const known = new Set([...words(s.name), ...words(s.manufacturer)]);
  return words(base).every((w) => known.has(w) || SHIP_WORDS.has(w) || /^mk(i+|\d)$|^i+$/.test(w)) ? s : null;
}

/** An upgrade's from / to: the title's "A to B" first, the card's ship attributes second. */
export function upgradeShips(c: ShCard, ships: CatalogShip[]): { from: CatalogShip; to: CatalogShip } | null {
  const m = /^(.+?)\s+to\s+(.+?)(?:\s+-\s+.*)?$/i.exec(c.title);
  const names = c.attrs.slice(2).filter((a) => !/product$|ins\.?$|^lti$/i.test(a));
  const from = (m && matchShip(m[1]!, ships)) || (names[0] ? matchShip(names[0], ships) : null);
  const to = (m && matchShip(m[2]!, ships)) || (names[1] ? matchShip(names[1], ships) : null);
  return from && to && from.id !== to.id ? { from, to } : null;
}

/**
 * The card as an Impound-style listing with a synthetic SKU, so `rowOf` prices and matches it the same way:
 * upgrades `<from>-<to>.0M.N`, ships `0-<id>.<ins>.S`, paints `p.0` (title matched to RSI's paint names).
 */
export function toListing(c: ShCard, ships: CatalogShip[]): ImpProduct {
  const kind = (c.attrs[0] ?? '').toLowerCase();
  let sku = 'x';
  let type = c.attrs[0] ?? '';
  let title = c.title;
  if (kind === 'upgrade' || /\bto\b/i.test(c.title) && /upgrade|ccu/i.test(c.title)) {
    const u = upgradeShips(c, ships);
    if (u) sku = `${u.from.id}-${u.to.id}.0M.N`;
    type = 'Upgrade';
  } else if (/\b(paint|livery|skin)\b/i.test(c.title)) {
    title = c.title.replace(/^paints?\s*-\s*/i, '');
    sku = 'p.0';
    type = 'Paint';
  } else if (kind === 'single item' || kind === '') {
    const s = strictShip(c.title, ships);
    if (s) sku = `0-${s.id}.${insCode(c.attrs)}.S`;
  }
  return {
    handle: c.id,
    title,
    type,
    vendor: c.seller,
    tags: [c.seller, ...c.attrs].filter(Boolean),
    variants: [{ id: Number(c.id), title: c.attrs.filter((a) => /ins|lti|ccu|original/i.test(a)).join(' · '), sku, price: c.price, compareAt: null, available: true }],
  };
}
