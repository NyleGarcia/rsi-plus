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
import { token } from './api';
import { SPECTRUM_ORIGIN } from './types';
import { EXTRA_SHIPS } from './data/extra-ships';

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
  /** `wiki`: a hull RSI's upgrade catalog doesn't list (Kraken, Javelin…), MSRP from starcitizen.tools (`EXTRA_SHIPS`). */
  msrpSource?: 'wiki';
}

export interface Catalog {
  at: number;
  ships: CatalogShip[];
}

const GQL = `${SPECTRUM_ORIGIN}/pledge-store/api/upgrade/graphql`;

/** One operation against the upgrade-tool GraphQL (array body, like RSI's own page). */
export async function gql<T>(operationName: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  // RSI's own pages send the Rsi-Token cookie as a header too; harmless when absent (public reads work without).
  const rsi = await token().catch(() => '');
  const res = await fetch(GQL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(rsi ? { 'X-Rsi-Token': rsi } : {}) },
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

/**
 * Account context for the upgrade API: `setAuthToken` mints the short-lived `Rsi-Account-Auth` JWT cookie (≈30 min)
 * from the main login — without it the API treats even a signed-in browser as anonymous; `setContextToken` opens an
 * upgrade context. Both work anonymously too (no CSRF).
 */
export async function session() {
  // RSI's own bootstrap posts these with `X-Rsi-Token: <Rsi-Token cookie>` (attachStoreHeader); without the header the
  // platform API mints an *anonymous* account token even for a signed-in browser.
  const rsi = await token().catch(() => '');
  for (const path of ['/api/account/v2/setAuthToken', '/api/ship-upgrades/setContextToken']) {
    const res = await fetch(`${SPECTRUM_ORIGIN}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(rsi ? { 'X-Rsi-Token': rsi } : {}) },
      body: '{}',
    });
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
  return { at: Date.now(), ships: withExtraShips(ships) };
}

/** Add the hulls RSI's upgrade catalog never lists (`EXTRA_SHIPS`) unless it lists that name itself. */
export function withExtraShips(ships: CatalogShip[]): CatalogShip[] {
  const have = new Set(ships.map((s) => shipKey(s.name)));
  return [...ships, ...EXTRA_SHIPS.filter((x) => !have.has(shipKey(x.name)) && !ships.some((s) => s.id === x.id)).map((x) => ({ ...x, standalone: [], ccu: [] }))];
}

export const isWarbondSku = (k: Pick<Sku, 'title'>) => /warbond/i.test(k.title);
// Built once: `toLocaleString` makes a new formatter per call, which showed up in profiles of 500-row tables.
const USD_WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const USD_CENTS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (cents: number) => `$${(cents % 100 ? USD_CENTS : USD_WHOLE).format(cents / 100)}`;

const keys = new Map<string, string>();
/** Normalize a ship name for matching hangar/buyback text against catalog names. Memoized: matching walks the whole catalog per name. */
export function shipKey(name: string): string {
  let k = keys.get(name);
  if (k === undefined) {
    k = name
      .toLowerCase()
      .replace(/\b(warbond|standard|edition|lti|wb|best in show|bis \d{4}|\d{4} best in show)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (keys.size > 50_000) keys.clear();
    keys.set(name, k);
  }
  return k;
}

/** Per-catalog memo for name → match lookups (the catalog array is the key, so a new catalog starts fresh). */
export function memoFor<T>(cache: WeakMap<object, Map<string, T>>, ships: object, name: string, find: () => T): T {
  let m = cache.get(ships);
  if (!m) cache.set(ships, (m = new Map()));
  if (m.has(name)) return m.get(name)!;
  const v = find();
  m.set(name, v);
  return v;
}

const matched = new WeakMap<object, Map<string, CatalogShip | null>>();
/**
 * Find the catalog ship a free-text name refers to: exact key, then the longest catalog name contained in it, then
 * (hangar names drop model codes: "Wolf" for "L-21 Wolf") the catalog name that is the text with only a model code
 * in front — shortest wins ("Wolf" → L-21 Wolf, not L-22 Alpha Wolf).
 */
export function matchShip(name: string, ships: CatalogShip[]): CatalogShip | null {
  return memoFor(matched, ships, name, () => findShip(name, ships));
}
function findShip(name: string, ships: CatalogShip[]): CatalogShip | null {
  const k = shipKey(name);
  if (!k) return null;
  let best: CatalogShip | null = null;
  for (const s of ships) {
    const sk = shipKey(s.name);
    if (sk === k) return s;
    if (sk && (` ${k} `.includes(` ${sk} `)) && (!best || sk.length > shipKey(best.name).length)) best = s;
  }
  if (best) return best;
  // Every word of the text is in the catalog name and what the catalog adds is only model-code bits ("Wolf" or
  // "Wolf L-21" → "L-21 Wolf"; never "L-22 Alpha Wolf", which adds a real word). Shortest catalog name wins.
  // Words no catalog name uses ("Starlifter" in "Hercules Starlifter C2", RSI's older hangar spelling) can't decide
  // anything — drop them, as long as a real word is left.
  const vocab = new Set(ships.flatMap((s) => shipKey(s.name).split(' ')));
  const known = k.split(' ').filter((t) => vocab.has(t));
  const want = known.some((t) => t.length >= 3 && !/^\d+$/.test(t)) ? known : k.split(' ');
  if (!want.some((t) => t.length >= 3 && !/^\d+$/.test(t))) return null;
  for (const s of ships) {
    const toks = shipKey(s.name).split(' ');
    if (!want.every((t) => toks.includes(t))) continue;
    if (!toks.filter((t) => !want.includes(t)).every((t) => MODEL_BIT.test(t))) continue;
    if (!best || toks.length < shipKey(best.name).split(' ').length || (toks.length === shipKey(best.name).split(' ').length && s.name.length < best.name.length)) best = s;
  }
  if (best) return best;
  // Last resort: same words once model codes are dropped on both sides ("F7A Hornet Mk II", a hull the store doesn't
  // sell, → F7C Hornet Mk II — same line, same paints; never a Mk I). Shortest catalog name wins.
  const bare = (toks: string[]) => toks.filter((t) => !CODE_BIT.test(t)).join(' ');
  const wantBare = bare(want);
  if (!wantBare) return null;
  for (const s of ships) {
    if (bare(shipKey(s.name).split(' ')) !== wantBare) continue;
    if (!best || s.name.length < best.name.length) best = s;
  }
  return best;
}
/** A model code or its fragments: "f7c", "a2", "l", "21" — not "mk" / "ii" / variant suffixes like "es", which tell hulls apart. */
const CODE_BIT = /^([a-z]|\d{1,3}|[a-z]\d{1,3}[a-z]?)$/;
/** A model-code fragment: "l", "21", "f7c", "mk", "ii", "a2", "m". */
const MODEL_BIT = /^([a-z]{1,2}|\d{1,3}|[a-z]\d{1,3}[a-z]?|mk|ii|iii|iv)$/;

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

/**
 * When each ship was last seen on sale (ms), per ship id, from the catalog refreshes since install — RSI publishes
 * no sale calendar, so this is the only "it usually comes back at…" signal we have. `ccu` = any CCU to it, `standalone`.
 */
export type SaleHistory = Record<string, { ccu?: number; standalone?: number }>;

/** Stamp today's on-sale ships into the history (new object; untouched entries are kept). */
export function recordSales(history: SaleHistory, ships: CatalogShip[], now: number): SaleHistory {
  const out: SaleHistory = { ...history };
  for (const s of ships) {
    const ccu = s.ccu.some((k) => k.available && k.stock !== 0);
    const standalone = s.standalone.some((k) => k.available && k.stock !== 0);
    if (!ccu && !standalone) continue;
    out[s.id] = { ...out[s.id], ...(ccu ? { ccu: now } : {}), ...(standalone ? { standalone: now } : {}) };
  }
  return out;
}

/** Last time a ship was on sale in any form (ms), or null when never seen since install. */
export function lastSale(history: SaleHistory, id: number): number | null {
  const h = history[id];
  if (!h) return null;
  return Math.max(h.ccu ?? 0, h.standalone ?? 0) || null;
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

/**
 * Store search API (`/graphql`, not the upgrade one): `GetBrowseListingQuery` filtered by product-type ids, pages of
 * 100. Ids from the store's own `browseFilter` (checked 2026-10-15): 268 Paints, 270 Packs, 289 Gear, 3 Add-Ons,
 * 72 Standalone Ships, 241 Upgrades, 9 / 45 / 46 LTI packages / Package / Combo, 65 Subscribers Store, 41 UEC,
 * 60 Gift Cards, 67 Event Tickets. `isVip` marks Concierge-only listings — they only come back on a Concierge
 * account's session, so the all-categories catalog is stored per account.
 */
const SEARCH = `${SPECTRUM_ORIGIN}/graphql`;
const PAINT_PRODUCT = '268';
type RawListing = {
  id: string;
  name: string;
  subtitle?: string | null;
  url: string;
  price: { amount: number; discounted: number | null };
  stock: { available: boolean };
  media?: { thumbnail?: { storeSmall?: string } };
  isVip?: boolean;
  isWarbond?: boolean;
  isPackage?: boolean;
};
const LISTING_QUERY =
  'query GetBrowseListingQuery($query: SearchQuery) { store(browse: true) { listing: search(query: $query) { resources { id name subtitle url price { amount discounted } stock { available } media { thumbnail { storeSmall } } ... on TySku { isVip isWarbond isPackage } ... on TyProduct { isVip } } totalCount } } }';

export type StoreCategory = 'paints' | 'packs' | 'gear' | 'addons' | 'ships' | 'packages' | 'subscribers';
export const STORE_CATEGORIES: { id: StoreCategory; label: string; products: string[] }[] = [
  { id: 'ships', label: 'Standalone ships', products: ['72'] },
  { id: 'paints', label: 'Paints', products: ['268'] },
  { id: 'packs', label: 'Packs', products: ['270'] },
  { id: 'packages', label: 'Game packages', products: ['9', '45', '46'] },
  { id: 'gear', label: 'Gear', products: ['289'] },
  { id: 'addons', label: 'Add-ons', products: ['3'] },
  { id: 'subscribers', label: 'Subscribers store', products: ['65'] },
];
export interface StoreItem extends StorePaint {
  category: StoreCategory;
  /** RSI's own label ("Standalone Ships", "Packs" …). */
  subtitle: string;
  /** Concierge-only listing. */
  vip: boolean;
  warbond: boolean;
}
export interface StoreListing {
  at: number;
  items: StoreItem[];
  /** Session has RSI's subscriber badge (the Subscribers Store only lists for those); null = not logged in / unknown. */
  subscriber?: boolean | null;
}

/** RSI's `AccountBadgesQuery` (what the store's Subscribers Store page checks): badge id 5 = active subscriber. */
const SUBSCRIBER_BADGE = 5;
const BADGES_QUERY = 'query AccountBadgesQuery { account { ... on RsiAuthenticatedAccount { badges { id title } } } }';
export async function fetchSubscriberBadge(): Promise<boolean | null> {
  const res = await fetch(SEARCH, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ operationName: 'AccountBadgesQuery', variables: {}, query: BADGES_QUERY }]),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { account?: { badges?: { id: number | string }[] } | null } }[];
  const badges = body[0]?.data?.account?.badges;
  return badges ? badges.some((b) => Number(b.id) === SUBSCRIBER_BADGE) : null;
}

export const mapListing = (r: RawListing): StorePaint => ({
  id: Number(r.id),
  name: r.name.replace(/\s+/g, ' ').trim(),
  url: new URL(r.url, SPECTRUM_ORIGIN).href,
  price: r.price.amount,
  discounted: r.price.discounted ?? r.price.amount,
  available: !!r.stock?.available,
  thumb: r.media?.thumbnail?.storeSmall ?? null,
});

/** Every listing for the given product-type ids (all pages). */
async function fetchListing(products: string[], what = 'listing'): Promise<RawListing[]> {
  const out: RawListing[] = [];
  for (let page = 1; page < 30; page++) {
    const res = await fetch(SEARCH, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ operationName: 'GetBrowseListingQuery', variables: { query: { page, limit: 100, skus: { products } } }, query: LISTING_QUERY }]),
    });
    if (!res.ok) throw new Error(`RSI store ${what}: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { store: { listing: { resources: RawListing[]; totalCount: number } } }; errors?: { message: string }[] }[];
    const listing = body[0]?.data?.store.listing;
    if (!listing) throw new Error(`RSI store ${what}: ${body[0]?.errors?.[0]?.message ?? 'no data'}`);
    out.push(...listing.resources);
    if (listing.resources.length < 100 || out.length >= listing.totalCount) break;
  }
  return out;
}

export async function fetchPaints(): Promise<PaintCatalog> {
  return { at: Date.now(), paints: (await fetchListing([PAINT_PRODUCT], 'paints')).map(mapListing) };
}

/** Everything the pledge store lists in the categories above (one request per 100 items per category). */
export async function fetchStoreItems(): Promise<StoreListing> {
  const items: StoreItem[] = [];
  const seen = new Set<number>();
  for (const c of STORE_CATEGORIES) {
    for (const r of await fetchListing(c.products, c.label.toLowerCase())) {
      const it = mapListing(r);
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      items.push({ ...it, category: c.id, subtitle: (r.subtitle ?? '').trim(), vip: !!r.isVip, warbond: !!r.isWarbond || /warbond/i.test(it.name) });
    }
  }
  return { at: Date.now(), items, subscriber: await fetchSubscriberBadge().catch(() => null) };
}

/** Same paint in the hangar and the store? Titles differ in suffix only ("… Livery" vs "… Paint"). */
/** Manufacturer names RSI sometimes puts in front of the hull ("Drake Dragonfly - Coalfire Paint" vs "Dragonfly - Coalfire Paint"). */
const MAKERS =
  /^(drake( interplanetary)?|anvil( aerospace)?|aegis( dynamics)?|origin( jumpworks)?|roberts space industries|rsi|misc|musashi industrial (and|&) starflight concern|crusader( industries)?|argo( astronautics)?|consolidated outland|cnou|c\.o\.|kruger( intergalactic)?|tumbril( land systems)?|greycat( industrial)?|banu|esperia|gatac( manufacture)?|mirai|aopoa|vanduul|xi'?an|xnaa|kastak( arms)?) /;
export function paintKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—:]\s*/g, ' ')
    .replace(/\b(paint|livery|skin)\b/g, ' ')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
    .replace(MAKERS, '')
    .replace(/'/g, '')
    .trim();
}
