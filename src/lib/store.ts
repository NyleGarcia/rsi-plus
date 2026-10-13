/**
 * RSI pledge-store catalog + CCU math. Read endpoint (public, no CSRF/context token needed — verified 2026-10):
 * `POST /pledge-store/api/upgrade/graphql` (batched array body). `ships` works with no session; `to` (upgrade
 * targets) needs `POST /api/account/v2/setAuthToken` first (verified with curl 2026-10).
 * - `initShipUpgrade.ships[]`: every ship with `msrp` (USD cents) and its currently sold `skus`.
 * - `filterShips(fromId)`: upgrade targets from a ship; each target sku `{price, upgradePrice}` where
 *   upgradePrice = sku.price − msrp(from) (checked: 16500 − 3500 = 13000). So one query gives every target sku.
 * A CCU A→B costs `sku(B).price − msrp(A)` and is only allowed when that is > 0.
 * Warbond SKUs need new money (no store credit) — tracked as `warbond` so the planner can report cash vs credit.
 */
import { SPECTRUM_ORIGIN } from './types';

export interface Sku {
  id: number;
  title: string;
  /** USD cents */
  price: number;
  available: boolean;
  /** Limited stock left (null = unlimited / hidden). */
  stock: number | null;
}

export interface CatalogShip {
  id: number;
  name: string;
  manufacturer: string;
  focus: string;
  /** USD cents; 0 = no price (concept not on sale). */
  msrp: number;
  flyable: string;
  link: string;
  thumb: string | null;
  /** Standalone ship SKUs on sale right now. */
  standalone: Sku[];
  /** CCU target SKUs on sale right now (Standard / Warbond / limited). */
  ccu: Sku[];
}

export interface Catalog {
  at: number;
  ships: CatalogShip[];
}

const GQL = `${SPECTRUM_ORIGIN}/pledge-store/api/upgrade/graphql`;

async function gql<T>(operationName: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(GQL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ operationName, variables, query }]),
  });
  if (!res.ok) throw new Error(`RSI store ${operationName}: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] }[];
  const first = body[0];
  if (!first?.data) throw new Error(`RSI store ${operationName}: ${first?.errors?.[0]?.message ?? 'no data'}`);
  return first.data;
}

type RawSku = { id: number; title?: string; price: number; available: boolean; unlimitedStock?: boolean; showStock?: boolean; availableStock?: number };
const sku = (s: RawSku): Sku => ({
  id: s.id,
  title: s.title ?? '',
  price: s.price,
  available: !!s.available,
  stock: s.unlimitedStock || !s.showStock ? null : (s.availableStock ?? null),
});

async function session() {
  for (const path of ['/api/account/v2/setAuthToken', '/api/ship-upgrades/setContextToken']) {
    const res = await fetch(`${SPECTRUM_ORIGIN}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error(`RSI store session ${path}: HTTP ${res.status}`);
  }
}

export async function fetchCatalog(): Promise<Catalog> {
  const init = await gql<{ ships: any[] }>(
    'initShipUpgrade',
    'query initShipUpgrade { ships { id name medias { productThumbMediumAndSmall } manufacturer { name } focus type flyableStatus msrp link skus { id title price available unlimitedStock showStock availableStock } } }',
  );
  const ships = init.ships.map(
    (s): CatalogShip => ({
      id: s.id,
      name: s.name,
      manufacturer: s.manufacturer?.name ?? '',
      focus: s.focus ?? '',
      msrp: s.msrp ?? 0,
      flyable: s.flyableStatus ?? '',
      link: s.link ? new URL(s.link, SPECTRUM_ORIGIN).href : '',
      thumb: s.medias?.productThumbMediumAndSmall ?? null,
      standalone: (s.skus ?? []).map(sku),
      ccu: [],
    }),
  );
  // Upgrade targets from the cheapest priced ship cover (nearly) every target. `to` needs an account context:
  // setAuthToken sets the Rsi-Account-Auth cookie (works anonymously, no CSRF), setContextToken the upgrade context.
  await session();
  const cheapest = ships.filter((s) => s.msrp > 0).sort((a, b) => a.msrp - b.msrp)[0];
  if (cheapest) {
    const to = await gql<{ to: { ships: { id: number; skus: RawSku[] }[] } }>(
      'filterShips',
      // GraphQL rejects declared-but-unused variables (HTTP 400), so declare only what `to` uses.
      'query filterShips($fromId: Int, $toFilters: [FilterConstraintValues]) { to(from: $fromId, filters: $toFilters) { ships { id skus { id title price available unlimitedStock showStock availableStock } } } }',
      { fromId: cheapest.id, toFilters: [] },
    );
    const byId = new Map(ships.map((s) => [s.id, s]));
    for (const t of to.to.ships) {
      const s = byId.get(t.id);
      if (s) s.ccu = t.skus.map(sku).filter((k) => k.available);
    }
  }
  return { at: Date.now(), ships };
}

export const isWarbondSku = (k: Pick<Sku, 'title'>) => /warbond/i.test(k.title);
export const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Normalize a ship name for matching hangar/buyback text against catalog names. */
export function shipKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(warbond|standard|edition|lti|wb|best in show|bis \d{4}|\d{4} best in show)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Find the catalog ship a free-text name refers to: exact key, then longest catalog name contained in it. */
export function matchShip(name: string, ships: CatalogShip[]): CatalogShip | null {
  const k = shipKey(name);
  if (!k) return null;
  let best: CatalogShip | null = null;
  for (const s of ships) {
    const sk = shipKey(s.name);
    if (sk === k) return s;
    if (sk && (` ${k} `.includes(` ${sk} `)) && (!best || sk.length > shipKey(best.name).length)) best = s;
  }
  return best;
}

/** Cheapest thing on sale for a ship right now (CCU target SKU or standalone), cents. */
export function lowestOffer(s: CatalogShip): { price: number; title: string; kind: 'ccu' | 'standalone' } | null {
  let best: { price: number; title: string; kind: 'ccu' | 'standalone' } | null = null;
  for (const k of s.ccu) if (k.available && k.stock !== 0 && (!best || k.price < best.price)) best = { price: k.price, title: k.title || 'CCU', kind: 'ccu' };
  for (const k of s.standalone) if (k.available && k.stock !== 0 && (!best || k.price < best.price)) best = { price: k.price, title: k.title || 'Standalone', kind: 'standalone' };
  return best;
}

/**
 * Wishlist alerts: a wished ship now has an offer cheaper than the last one seen (or any offer when there was none),
 * e.g. a warbond CCU going on sale. Returns events + the updated `lowest` per ship (null when nothing on sale,
 * so the next sale alerts again).
 */
export function wishlistEvents(
  wish: { id: number; name: string; lowest: number | null }[],
  catalog: CatalogShip[],
  now: number,
): { events: import('./watch').FeedEvent[]; lowest: Map<number, number | null> } {
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const events: import('./watch').FeedEvent[] = [];
  const lowest = new Map<number, number | null>();
  for (const w of wish) {
    const s = byId.get(w.id);
    if (!s) continue;
    const o = lowestOffer(s);
    lowest.set(w.id, o?.price ?? null);
    if (!o || (w.lowest != null && o.price >= w.lowest)) continue;
    events.push({
      key: `store:${s.id}:${o.price}:${now - (now % 86_400_000)}`,
      kind: 'store',
      title: `${s.name}: ${o.title} ${usd(o.price)}`,
      body: `${o.kind === 'ccu' ? 'CCU target on sale' : 'Standalone on sale'} — MSRP ${usd(s.msrp)}`,
      url: s.link || 'https://robertsspaceindustries.com/pledge',
      at: now,
      seen: false,
    });
  }
  return { events, lowest };
}

/** A paint (or paint pack) on the pledge store — public browse listing, no login needed. */
export interface StorePaint {
  id: number;
  name: string;
  /** Absolute store URL. */
  url: string;
  /** USD cents; `discounted` when on sale (else same as `price`). */
  price: number;
  discounted: number;
  available: boolean;
  thumb: string | null;
}
export interface PaintCatalog {
  at: number;
  paints: StorePaint[];
}

/** Store search API (`/graphql`, not the upgrade one). Product type 268 = paints; pages of 100. */
const SEARCH = `${SPECTRUM_ORIGIN}/graphql`;
const PAINT_PRODUCT = '268';
type RawListing = { id: string; name: string; url: string; price: { amount: number; discounted: number | null }; stock: { available: boolean }; media?: { thumbnail?: { storeSmall?: string } } };

export async function fetchPaints(): Promise<PaintCatalog> {
  const paints: StorePaint[] = [];
  for (let page = 1; page < 20; page++) {
    const res = await fetch(SEARCH, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          operationName: 'GetBrowseListingQuery',
          variables: { query: { page, limit: 100, skus: { products: [PAINT_PRODUCT] } } },
          query:
            'query GetBrowseListingQuery($query: SearchQuery) { store(browse: true) { listing: search(query: $query) { resources { id name url price { amount discounted } stock { available } media { thumbnail { storeSmall } } } totalCount } } }',
        },
      ]),
    });
    if (!res.ok) throw new Error(`RSI store paints: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { store: { listing: { resources: RawListing[]; totalCount: number } } }; errors?: { message: string }[] }[];
    const listing = body[0]?.data?.store.listing;
    if (!listing) throw new Error(`RSI store paints: ${body[0]?.errors?.[0]?.message ?? 'no data'}`);
    for (const r of listing.resources)
      paints.push({
        id: Number(r.id),
        name: r.name.replace(/\s+/g, ' ').trim(),
        url: new URL(r.url, SPECTRUM_ORIGIN).href,
        price: r.price.amount,
        discounted: r.price.discounted ?? r.price.amount,
        available: !!r.stock?.available,
        thumb: r.media?.thumbnail?.storeSmall ?? null,
      });
    if (listing.resources.length < 100 || paints.length >= listing.totalCount) break;
  }
  return { at: Date.now(), paints };
}

/** Same paint in the hangar and the store? Titles differ in suffix only ("… Livery" vs "… Paint"). */
export function paintKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—:]\s*/g, ' ')
    .replace(/\b(paint|livery|skin)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
