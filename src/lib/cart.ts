/**
 * Put CCU-chain steps into the user's RSI cart, with RSI's own calls in the signed-in session (cookies).
 *
 * Upgrades (CCU / buyback CCU) — the upgrade tool's API (`/pledge-store/api/upgrade/graphql`, observed from RSI's
 * ship-upgrades window and documented by Open Hangar's cart work, 2026-10):
 *   1. `POST /api/ship-upgrades/setContextToken { fromShipId, toShipId, toSkuId }` — the session's upgrade context;
 *      adding `pledgeId` switches it to buy-back mode for that melted CCU.
 *   2. `query getPrice(from: shipId, to: skuId) { price { amount } }` — RSI's live price in cents.
 *   3. `mutation addToCart(from: shipId, to: skuId) { jwt }` — a ticket, not yet a cart line;
 *   4. `POST /api/store/v2/cart/token { jwt }` — the cart takes the ticket (`success: 1`). Only now is it in the cart.
 * Eligibility: `filterShips` → `from(to: skuId) { ships { id } }` lists every ship RSI lets you upgrade *from* to that
 * SKU; a chain step whose source ship is missing there is one RSI won't sell, whatever the catalog math says.
 * Standalone ships — the regular store (`POST /graphql`, `store(name:"pledge"){cart{mutations{add(skuId, qty)}}}`,
 * header `x-csrf-token` from an RSI page's `<meta name="csrf-token">`).
 *
 * Rules: sign-in checked first (`initShipUpgrade { app { isAnonymous } }`); `addToCart` is never retried (a lost
 * answer may still have added the line — the user checks the cart); a buy-back checks out alone (RSI rule), so the
 * caller adds it on its own. Nothing here checks out or pays.
 */
import type { Step } from './ccu';
import { token } from './api';
import { gql, session, type CatalogShip } from './store';
import { SPECTRUM_ORIGIN } from './types';

export const CART_URL = `${SPECTRUM_ORIGIN}/en/store/pledge/cart`;
const CART_TOKEN_PATH = '/api/store/v2/cart/token';

export type CartErrorCode = 'signed-out' | 'refused' | 'conflict' | 'network' | 'not-addable';

export class CartError extends Error {
  constructor(
    public code: CartErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const CONFLICT = /cart|buy-?back|pending|invalid/i;

function classify(e: unknown): CartError {
  if (e instanceof CartError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/HTTP (401|403)/.test(msg)) return new CartError('signed-out', 'Sign in to RSI first.');
  if (/HTTP 5|HTTP 429|Failed to fetch|NetworkError/i.test(msg)) return new CartError('network', `RSI did not answer (${msg}). Check your RSI cart before trying again.`);
  if (CONFLICT.test(msg)) return new CartError('conflict', `RSI refused: ${msg}. A pending order or a buy-back in the cart blocks new lines — open the cart.`);
  return new CartError('refused', `RSI refused: ${msg}`);
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  let res: Response;
  const rsi = await token().catch(() => '');
  try {
    res = await fetch(`${SPECTRUM_ORIGIN}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(rsi ? { 'X-Rsi-Token': rsi } : {}), ...headers },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new CartError('network', `RSI unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) throw classify(new Error(`HTTP ${res.status}`));
  return res;
}

/**
 * Signed in to RSI in this browser context? Runs `setAuthToken` first: the upgrade API reads the account from the
 * `Rsi-Account-Auth` JWT cookie that call mints (≈30 min), not from the login session itself — without it even a
 * signed-in browser reads as anonymous. Anonymous visitors get an `Rsi-Token` too, so that cookie alone says nothing.
 */
export async function signedIn(): Promise<{ ok: boolean; why: string }> {
  try {
    await session();
    const r = await gql<{ app?: { mode?: string; isAnonymous?: boolean } }>('initShipUpgrade', 'query initShipUpgrade { app { mode isAnonymous } }');
    if (!r.app) return { ok: false, why: 'RSI returned no app state' };
    return r.app.isAnonymous ? { ok: false, why: `RSI sees this browser as anonymous (mode ${r.app.mode ?? '?'}) — sign in on robertsspaceindustries.com in this window` } : { ok: true, why: '' };
  } catch (e) {
    return { ok: false, why: `Sign-in check failed: ${(e as Error).message}` };
  }
}

async function requireSignIn() {
  const s = await signedIn();
  if (!s.ok) throw new CartError('signed-out', s.why);
}

export interface UpgradeRef {
  fromShipId: number;
  toShipId: number;
  toSkuId: number;
  /** Buy-back: the melted CCU's pledge id. */
  pledgeId?: number;
}

/** Upgrade context for the session; a buy-back adds its pledge id (RSI switches to buy-back mode). */
async function setContext(u: UpgradeRef): Promise<void> {
  const body: Record<string, number> = { fromShipId: u.fromShipId, toShipId: u.toShipId, toSkuId: u.toSkuId };
  if (u.pledgeId) body.pledgeId = u.pledgeId;
  await post('/api/ship-upgrades/setContextToken', body);
}

async function appMode(): Promise<string | null> {
  try {
    const r = await gql<{ app?: { mode?: string } }>('initShipUpgrade', 'query initShipUpgrade { app { mode isAnonymous } }');
    return r.app?.mode ?? null;
  } catch {
    return null;
  }
}

export interface Verified {
  /** RSI lists the source ship among those allowed to upgrade to this SKU. */
  eligible: boolean;
  /** RSI's live price in cents (null when it did not answer). */
  price: number | null;
}

/** Is this upgrade really on offer from that ship, and at what price? Read-only. */
export async function verifyUpgrade(u: UpgradeRef): Promise<Verified> {
  await session();
  await setContext(u);
  let eligible = false;
  try {
    const r = await gql<{ from: { ships: { id: number }[] } }>(
      'filterShips',
      'query filterShips($toId: Int, $fromFilters: [FilterConstraintValues]) { from(to: $toId, filters: $fromFilters) { ships { id } } }',
      { toId: u.toSkuId, fromFilters: [] },
    );
    eligible = r.from.ships.some((x) => x.id === u.fromShipId);
  } catch (e) {
    throw classify(e);
  }
  if (!eligible) return { eligible, price: null };
  const price = await livePrice(u).catch(() => null);
  return { eligible, price };
}

async function livePrice(u: UpgradeRef): Promise<number> {
  try {
    const r = await gql<{ price: { amount: number } }>('getPrice', 'query getPrice($from: Int!, $to: Int!) { price(from: $from, to: $to) { amount nativeAmount } }', {
      from: u.fromShipId,
      to: u.toSkuId,
    });
    return Number(r.price?.amount ?? NaN);
  } catch (e) {
    throw classify(e);
  }
}

/** RSI's live price for the upgrade (cents), after setting the context. */
export async function upgradePrice(u: UpgradeRef): Promise<number> {
  await setContext(u);
  return livePrice(u);
}

/**
 * Adds the upgrade to the RSI cart: context → mode guard → price → addToCart ticket → cart takes the ticket.
 * Returns RSI's price (cents) for the line. Neither the add nor the cart step is ever retried.
 */
export async function addUpgrade(u: UpgradeRef): Promise<{ price: number }> {
  await requireSignIn();
  await setContext(u);
  // A buy-back only after RSI really switched to buy-back mode; a new upgrade never while it is in that mode.
  const mode = await appMode();
  if (u.pledgeId && mode !== 'buyback') throw new CartError('refused', `RSI did not open buy-back mode for pledge #${u.pledgeId} (mode ${mode ?? '?'}).`);
  if (!u.pledgeId && mode === 'buyback') throw new CartError('conflict', 'RSI is in buy-back mode — finish or clear that buy-back first.');
  const price = await livePrice(u);
  let jwt: string;
  try {
    const r = await gql<{ addToCart: { jwt?: string } | null }>('addToCart', 'mutation addToCart($from: Int!, $to: Int!) { addToCart(from: $from, to: $to) { jwt } }', {
      from: u.fromShipId,
      to: u.toSkuId,
    });
    if (!r.addToCart?.jwt) throw new Error('no cart ticket returned');
    jwt = r.addToCart.jwt;
  } catch (e) {
    throw classify(e);
  }
  const res = await post(CART_TOKEN_PATH, { jwt });
  const body = (await res.json().catch(() => null)) as { success?: number | boolean; msg?: string; code?: string } | null;
  if (!body || body.success === 0 || body.success === false) throw classify(new Error(body?.msg || body?.code || 'cart did not take the ticket'));
  return { price };
}

/** `<meta name="csrf-token">` of an RSI page (the store's `/graphql` wants it). */
export function csrfFrom(html: string): string | null {
  const m = /<meta\s+name="csrf-token"\s+content="([^"]+)"/i.exec(html) ?? /<meta\s+content="([^"]+)"\s+name="csrf-token"/i.exec(html);
  return m?.[1] ?? null;
}

async function csrfToken(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(CART_URL, { credentials: 'include' });
  } catch (e) {
    throw new CartError('network', `RSI unreachable: ${(e as Error).message}`);
  }
  const t = csrfFrom(await res.text());
  if (!t) throw new CartError('refused', 'Could not read the store CSRF token — open the RSI store once and retry.');
  return t;
}

/** Adds a standalone-ship SKU (regular store line) to the RSI cart. Never retries. */
export async function addStandalone(skuId: number, qty = 1): Promise<void> {
  await requireSignIn();
  const csrf = await csrfToken();
  const query = `mutation AddCartItemMutation { store(name: "pledge") { cart { mutations { add(skuId: ${Math.trunc(skuId)}, qty: ${Math.trunc(qty)}) } } } }`;
  const res = await post('/graphql', { query }, { 'x-csrf-token': csrf });
  const body = (await res.json().catch(() => null)) as { data?: { store?: { cart?: { mutations?: { add?: unknown } } } }; errors?: { message: string }[] } | null;
  if (body?.errors?.length) throw classify(new Error(body.errors[0]!.message));
  if (!body?.data?.store?.cart?.mutations) throw new CartError('refused', 'RSI did not confirm the cart line.');
}

export type Addable = { kind: 'upgrade'; ref: UpgradeRef } | { kind: 'standalone'; skuId: number } | { kind: 'none'; why: string };

/**
 * What a chain step needs to go into the cart. Store CCU / standalone steps carry their SKU; a buy-back CCU needs
 * the target's current standard CCU SKU for the context (RSI's buy-back list doesn't expose the SKU to us).
 */
export function addable(s: Step, byId: Map<number, CatalogShip>): Addable {
  if (s.kind === 'owned') return { kind: 'none', why: 'already in your hangar' };
  if (s.kind === 'standalone') return s.skuId ? { kind: 'standalone', skuId: s.skuId } : { kind: 'none', why: 'no store SKU' };
  if (s.kind === 'buyback') {
    const to = byId.get(s.toId);
    const sku = to?.ccu.find((k) => /standard/i.test(k.title) || !k.title) ?? to?.ccu[0];
    if (!sku || !s.ref) return { kind: 'none', why: 'target CCU not on sale — buy back from the buyback page' };
    return { kind: 'upgrade', ref: { fromShipId: s.fromId, toShipId: s.toId, toSkuId: sku.id, pledgeId: s.ref } };
  }
  return s.skuId ? { kind: 'upgrade', ref: { fromShipId: s.fromId, toShipId: s.toId, toSkuId: s.skuId } } : { kind: 'none', why: 'no store SKU' };
}

/** Adds one step. Returns RSI's price (cents) when the API reports one. */
export async function addStep(s: Step, byId: Map<number, CatalogShip>): Promise<{ price: number | null }> {
  const a = addable(s, byId);
  if (a.kind === 'none') throw new CartError('not-addable', a.why);
  if (a.kind === 'standalone') {
    await addStandalone(a.skuId);
    return { price: null };
  }
  return addUpgrade(a.ref);
}
