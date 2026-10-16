import { afterEach, describe, expect, it, vi } from 'vitest';
import { addable, addStandalone, addUpgrade, CartError, csrfFrom, readCart, signedIn, verifyUpgrade } from '@/lib/cart';
import type { Step } from '@/lib/ccu';
import type { CatalogShip } from '@/lib/store';

type Call = { url: string; init?: RequestInit };
function mockFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    return Promise.resolve(handler(c));
  });
  return calls;
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const isSession = (c: Call) => c.url.endsWith('/setAuthToken') || c.url.endsWith('/setContextToken');
const isTicket = (c: Call) => c.url.endsWith('/api/store/v2/cart/token');
const tag = (c: Call) => (c.url.endsWith('/setAuthToken') ? 'auth' : c.url.endsWith('/setContextToken') ? 'context' : isTicket(c) ? 'ticket' : gqlBody(c).operationName);
const gqlBody = (c: Call) => (JSON.parse(String(c.init?.body)) as { operationName: string; variables: Record<string, unknown> }[])[0]!;

afterEach(() => vi.unstubAllGlobals());

const signedInBody = [{ data: { app: { mode: 'upgrade', isAnonymous: false } } }];

describe('cart: upgrades', () => {
  it('context → price → addToCart, in order, with RSI\'s ids', async () => {
    const calls = mockFetch((c) => {
      if (isSession(c)) return json({ success: 1 });
      if (isTicket(c)) return json({ success: 1, code: 'OK' });
      const o = gqlBody(c).operationName;
      if (o === 'initShipUpgrade') return json(signedInBody);
      if (o === 'getPrice') return json([{ data: { price: { amount: 2500, nativeAmount: 2500 } } }]);
      if (o === 'addToCart') return json([{ data: { addToCart: { jwt: 'x.y.z' } } }]);
      return json([{ errors: [{ message: 'unexpected' }] }]);
    });
    const r = await addUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300 });
    expect(r.price).toBe(2500);
    expect(calls.map(tag)).toEqual(['auth', 'context', 'initShipUpgrade', 'context', 'initShipUpgrade', 'getPrice', 'addToCart', 'ticket']);
    const ctx = calls.filter((c) => c.url.endsWith('/setContextToken')).at(-1)!;
    expect(JSON.parse(String(ctx.init?.body))).toEqual({ fromShipId: 1, toShipId: 3, toSkuId: 300 });
    expect(gqlBody(calls.find((c) => tag(c) === 'addToCart')!).variables).toEqual({ from: 1, to: 300 });
    expect(JSON.parse(String(calls.at(-1)!.init?.body))).toEqual({ jwt: 'x.y.z' });
    expect((calls.at(-1)!.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(calls.every((c) => c.init?.credentials === 'include')).toBe(true);
  });

  it('buy-back adds the pledge id to the context and needs buy-back mode; a plain upgrade refuses buy-back mode', async () => {
    let ctxCalls = 0;
    const calls = mockFetch((c) => {
      if (isSession(c)) {
        if (c.url.endsWith('/setContextToken')) ctxCalls++;
        return json({});
      }
      if (isTicket(c)) return json({ success: 1 });
      const o = gqlBody(c).operationName;
      // Mode flips to buyback once a context with a pledge id was set (the 2nd context call in this flow).
      if (o === 'initShipUpgrade') return json([{ data: { app: { mode: ctxCalls >= 2 ? 'buyback' : 'upgrade', isAnonymous: false } } }]);
      if (o === 'getPrice') return json([{ data: { price: { amount: 100 } } }]);
      return json([{ data: { addToCart: { jwt: 'j' } } }]);
    });
    await addUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300, pledgeId: 77 });
    const ctx = calls.filter((c) => c.url.endsWith('/setContextToken')).at(-1)!;
    expect(JSON.parse(String(ctx.init?.body))).toEqual({ fromShipId: 1, toShipId: 3, toSkuId: 300, pledgeId: 77 });

    // Session stuck in buy-back mode → a normal upgrade is refused as a cart conflict, nothing added.
    let adds = 0;
    mockFetch((c) => {
      if (isSession(c)) return json({});
      const o = gqlBody(c).operationName;
      if (o === 'initShipUpgrade') return json([{ data: { app: { mode: 'buyback', isAnonymous: false } } }]);
      adds++;
      return json([{ data: { addToCart: { jwt: 'j' } } }]);
    });
    await expect(addUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300 })).rejects.toMatchObject({ code: 'conflict' });
    expect(adds).toBe(0);
  });

  it('a ticket the cart rejects is a refusal (and still not retried)', async () => {
    let tickets = 0;
    mockFetch((c) => {
      if (isSession(c)) return json({});
      if (isTicket(c)) return (tickets++, json({ success: 0, msg: 'Your cart contains a pending order' }));
      const o = gqlBody(c).operationName;
      if (o === 'initShipUpgrade') return json(signedInBody);
      if (o === 'getPrice') return json([{ data: { price: { amount: 100 } } }]);
      return json([{ data: { addToCart: { jwt: 'j' } } }]);
    });
    await expect(addUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300 })).rejects.toMatchObject({ code: 'conflict' });
    expect(tickets).toBe(1);
  });

  it('verifyUpgrade: eligible only when RSI lists the source ship, with the live price', async () => {
    mockFetch((c) => {
      if (isSession(c)) return json({});
      const b = gqlBody(c);
      if (b.operationName === 'filterShips') {
        expect(b.variables).toEqual({ toId: 300, fromFilters: [] });
        return json([{ data: { from: { ships: [{ id: 1 }, { id: 2 }] } } }]);
      }
      if (b.operationName === 'getPrice') return json([{ data: { price: { amount: 2600 } } }]);
      return json([{ errors: [{ message: 'unexpected' }] }]);
    });
    expect(await verifyUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300 })).toEqual({ eligible: true, price: 2600 });
    expect(await verifyUpgrade({ fromShipId: 9, toShipId: 3, toSkuId: 300 })).toEqual({ eligible: false, price: null });
  });

  it('signed out → signed-out error before any cart call', async () => {
    const calls = mockFetch((c) => (isSession(c) ? json({}) : json([{ data: { app: { mode: 'browse', isAnonymous: true } } }])));
    await expect(addUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300 })).rejects.toMatchObject({ code: 'signed-out' });
    expect(calls.filter((c) => !isSession(c))).toHaveLength(1); // the app query only — no price, no add
    expect((await signedIn()).ok).toBe(false);
  });

  it('addToCart is never retried; refusals are classified', async () => {
    let adds = 0;
    mockFetch((c) => {
      if (isSession(c)) return json({});
      const o = gqlBody(c).operationName;
      if (o === 'initShipUpgrade') return json(signedInBody);
      if (o === 'getPrice') return json([{ data: { price: { amount: 100 } } }]);
      adds++;
      return json([{ errors: [{ message: 'Your cart already contains a buy-back' }] }]);
    });
    const e = (await addUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300 }).catch((x) => x)) as CartError;
    expect(e).toBeInstanceOf(CartError);
    expect(e.code).toBe('conflict');
    expect(adds).toBe(1);

    mockFetch((c) => {
      if (isSession(c)) return json({});
      const o = gqlBody(c).operationName;
      if (o === 'initShipUpgrade') return json(signedInBody);
      if (o === 'getPrice') return json([{ data: { price: { amount: 100 } } }]);
      return new Response('', { status: 502 });
    });
    await expect(addUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300 })).rejects.toMatchObject({ code: 'network' });
  });
});

describe('cart: standalone', () => {
  it('reads the csrf token from the cart page and posts the store mutation', async () => {
    const calls = mockFetch((c) => {
      if (c.url.endsWith('/pledge/cart')) return new Response('<html><head><meta name="csrf-token" content="abc123" /></head></html>');
      if (isSession(c)) return json({});
      if (c.url.endsWith('/upgrade/graphql')) return json(signedInBody);
      return json({ data: { store: { cart: { mutations: { add: true } } } } });
    });
    await addStandalone(555);
    const g = calls.find((c) => /robertsspaceindustries\.com\/graphql$/.test(c.url))!;
    expect((g.init?.headers as Record<string, string>)['x-csrf-token']).toBe('abc123');
    expect(JSON.parse(String(g.init?.body)).query).toMatch(/add\(skuId: 555, qty: 1\)/);
    expect(csrfFrom('<meta content="zz" name="csrf-token">')).toBe('zz');
    expect(csrfFrom('<meta name="other">')).toBeNull();
  });
});

describe('cart: read back', () => {
  it('parses lines, prices, discounts and totals; empty cart → no lines', async () => {
    const calls = mockFetch((c) => {
      if (c.url.endsWith('/pledge/cart')) return new Response('<meta name="csrf-token" content="t0k">');
      return json({
        data: {
          store: {
            cart: {
              id: 'c1',
              totals: { subTotal: 2275, total: 2275 },
              lineItemsQties: 3,
              lineItems: [
                { id: '1', skuId: '17703', qty: 1, unitPriceWithTax: { amount: 1500, discounted: 975, discountDescription: '35% off' }, discounts: [{ id: 'd', type: 'BUNDLE', details: '10+ paints', bundle: null }], sku: { id: '17703', label: 'Cutlass - Frost Paint', subtitle: null } },
                { id: '2', skuId: 55, qty: 2, unitPriceWithTax: { amount: 650, discounted: null, discountDescription: null }, discounts: [], sku: { label: 'Aurora', subtitle: 'Red Paint' } },
                { id: '3', skuId: 9, qty: 1, unitPriceWithTax: null, sku: null, upgrade: { name: 'Upgrade - Aurora MR to 300i' } },
              ],
            },
          },
        },
      });
    });
    const cart = await readCart();
    expect(cart).toMatchObject({ id: 'c1', subTotal: 2275, total: 2275, qty: 3 });
    expect(cart.lines).toEqual([
      { id: '1', skuId: 17703, qty: 1, title: 'Cutlass - Frost Paint', unit: 1500, unitDiscounted: 975, discount: '35% off', discounts: ['BUNDLE · 10+ paints'], upgrade: null },
      { id: '2', skuId: 55, qty: 2, title: 'Aurora Red Paint', unit: 650, unitDiscounted: 650, discount: '', discounts: [], upgrade: null },
      { id: '3', skuId: 9, qty: 1, title: 'Upgrade - Aurora MR to 300i', unit: 0, unitDiscounted: 0, discount: '', discounts: [], upgrade: 'Upgrade - Aurora MR to 300i' },
    ]);
    const g = calls.find((c) => /robertsspaceindustries\.com\/graphql$/.test(c.url))!;
    expect((g.init?.headers as Record<string, string>)['x-csrf-token']).toBe('t0k');
    expect(JSON.parse(String(g.init?.body)).operationName).toBe('MiniCartWidgetQuery');

    mockFetch((c) => (c.url.endsWith('/pledge/cart') ? new Response('<meta name="csrf-token" content="t">') : json({ data: { store: { cart: null } } })));
    expect((await readCart()).lines).toEqual([]);
    mockFetch((c) => (c.url.endsWith('/pledge/cart') ? new Response('<meta name="csrf-token" content="t">') : new Response('', { status: 401 })));
    await expect(readCart()).rejects.toMatchObject({ code: 'signed-out' });
  });
});

describe('cart: which steps are addable', () => {
  const ship = (id: number, ccu: { id: number; title: string }[] = []): CatalogShip => ({
    id, name: `S${id}`, manufacturer: '', focus: '', msrp: 0, flyable: '', link: '', thumb: null, standalone: [],
    ccu: ccu.map((k) => ({ ...k, price: 0, available: true, stock: null })),
  });
  const byId = new Map([[1, ship(1)], [3, ship(3, [{ id: 31, title: 'Warbond Edition' }, { id: 30, title: 'Standard Edition' }])], [4, ship(4)]]);
  const step = (s: Partial<Step>): Step => ({ fromId: 1, toId: 3, kind: 'standard', cost: 0, cash: 0, paid: 0, label: '', ...s });
  it('store CCU / standalone carry their SKU; owned never; buy-back uses the target\'s standard CCU SKU', () => {
    expect(addable(step({ skuId: 30 }), byId)).toEqual({ kind: 'upgrade', ref: { fromShipId: 1, toShipId: 3, toSkuId: 30 } });
    expect(addable(step({ kind: 'standalone', fromId: 0, skuId: 9 }), byId)).toEqual({ kind: 'standalone', skuId: 9 });
    expect(addable(step({ kind: 'owned', ref: 5 }), byId).kind).toBe('none');
    expect(addable(step({ kind: 'buyback', ref: 7 }), byId)).toEqual({ kind: 'upgrade', ref: { fromShipId: 1, toShipId: 3, toSkuId: 30, pledgeId: 7 } });
    expect(addable(step({ kind: 'buyback', ref: 7, toId: 4 }), byId).kind).toBe('none');
  });
});
