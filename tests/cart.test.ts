import { afterEach, describe, expect, it, vi } from 'vitest';
import { addable, addStandalone, addUpgrade, CartError, csrfFrom, signedIn } from '@/lib/cart';
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
const gqlBody = (c: Call) => (JSON.parse(String(c.init?.body)) as { operationName: string; variables: Record<string, unknown> }[])[0]!;

afterEach(() => vi.unstubAllGlobals());

const signedInBody = [{ data: { app: { mode: 'upgrade', isAnonymous: false } } }];

describe('cart: upgrades', () => {
  it('context → price → addToCart, in order, with RSI\'s ids', async () => {
    const calls = mockFetch((c) => {
      if (c.url.endsWith('/setContextToken')) return json({ success: 1 });
      const o = gqlBody(c).operationName;
      if (o === 'initShipUpgrade') return json(signedInBody);
      if (o === 'getPrice') return json([{ data: { price: { amount: 2500, nativeAmount: 2500 } } }]);
      if (o === 'addToCart') return json([{ data: { addToCart: { jwt: 'x.y.z' } } }]);
      return json([{ errors: [{ message: 'unexpected' }] }]);
    });
    const r = await addUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300 });
    expect(r.price).toBe(2500);
    expect(calls.map((c) => (c.url.endsWith('/setContextToken') ? 'context' : gqlBody(c).operationName))).toEqual(['initShipUpgrade', 'context', 'getPrice', 'addToCart']);
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ fromShipId: 1, toShipId: 3, toSkuId: 300 });
    expect(gqlBody(calls[3]!).variables).toEqual({ from: 1, to: 300 });
    expect(calls.every((c) => c.init?.credentials === 'include')).toBe(true);
  });

  it('buy-back adds the pledge id to the context', async () => {
    const calls = mockFetch((c) => {
      if (c.url.endsWith('/setContextToken')) return json({});
      const o = gqlBody(c).operationName;
      if (o === 'initShipUpgrade') return json(signedInBody);
      if (o === 'getPrice') return json([{ data: { price: { amount: 100 } } }]);
      return json([{ data: { addToCart: { jwt: 'j' } } }]);
    });
    await addUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300, pledgeId: 77 });
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ fromShipId: 1, toShipId: 3, toSkuId: 300, pledgeId: 77 });
  });

  it('signed out → signed-out error before any cart call', async () => {
    const calls = mockFetch(() => json([{ data: { app: { mode: 'upgrade', isAnonymous: true } } }]));
    await expect(addUpgrade({ fromShipId: 1, toShipId: 3, toSkuId: 300 })).rejects.toMatchObject({ code: 'signed-out' });
    expect(calls).toHaveLength(1);
    expect(await signedIn()).toBe(false);
  });

  it('addToCart is never retried; refusals are classified', async () => {
    let adds = 0;
    mockFetch((c) => {
      if (c.url.endsWith('/setContextToken')) return json({});
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
      if (c.url.endsWith('/setContextToken')) return json({});
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
