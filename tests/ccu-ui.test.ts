import { describe, expect, it } from 'vitest';
import { STORE_START } from '@/lib/ccu';
import { lastSaleLabel, shipName, uid } from '@/lib/ccu-ui';
import type { CatalogShip } from '@/lib/store';

const ship = (id: number, name: string): CatalogShip => ({ id, name, manufacturer: '', focus: '', msrp: 1000, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });

describe('ccu-ui helpers', () => {
  const byId = new Map([[7, ship(7, 'Cutlass Black')]]);

  it('names hulls, the store start and unknown ids', () => {
    expect(shipName(byId, 7)).toBe('Cutlass Black');
    expect(shipName(byId, STORE_START)).toBe('Store');
    expect(shipName(byId, null)).toBe('Auto');
    expect(shipName(byId, 42)).toBe('#42');
  });

  it('says when a hull was last on sale, or that it was never seen', () => {
    expect(lastSaleLabel({}, 7)).toBe('not seen on sale since RSI+ was installed');
    const at = Date.UTC(2026, 0, 15);
    expect(lastSaleLabel({ 7: { ccu: at } }, 7)).toBe(`last on sale ${new Date(at).toLocaleDateString()}`);
  });

  it('makes distinct ids', () => {
    const ids = new Set(Array.from({ length: 50 }, uid));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-z]+$/);
  });
});
