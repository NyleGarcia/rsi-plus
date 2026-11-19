import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchShipListings } from '@/lib/store';

afterEach(() => vi.unstubAllGlobals());

describe('fetchShipListings', () => {
  const answer = (resources: unknown[]) => new Response(JSON.stringify([{ data: { store: { listing: { resources, totalCount: resources.length } } } }]), { headers: { date: 'Tue, 17 Nov 2026 16:00:00 GMT' } });
  const row = (id: number, name: string, available: boolean, isWarbond = false) => ({ id: String(id), name, url: `/pledge/${id}`, price: { amount: 100, discounted: 100 }, stock: { available }, isWarbond });

  it('with ids: one request for just those SKUs (the wave poll)', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body))), answer([row(7, 'Kraken - 10 Year', true, true)])));
    const r = await fetchShipListings([7]);
    expect(bodies).toHaveLength(1);
    expect((bodies[0] as { variables: { query: { skus: unknown } } }[])[0]!.variables.query.skus).toEqual({ products: ['72'], ids: ['7'] });
    expect(r.items).toMatchObject([{ id: 7, available: true, warbond: true }]);
    expect(r.serverAt).toBe(Date.parse('2026-11-17T16:00:00Z'));
  });
  it('without ids: the whole standalone-ship listing', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body))), answer([row(1, 'A', false), row(2, 'B', true)])));
    const r = await fetchShipListings();
    expect((bodies[0] as { variables: { query: { skus: unknown } } }[])[0]!.variables.query.skus).toEqual({ products: ['72'] });
    expect(r.items.map((i) => i.id)).toEqual([1, 2]);
  });
});
