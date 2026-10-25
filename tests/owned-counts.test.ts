import { describe, expect, it } from 'vitest';
import type { Pledge } from '@/lib/hangar';
import type { CatalogShip } from '@/lib/store';
import { ownedHulls, ownedTitleCounts } from '@/lib/owned-counts';
import { paintKey } from '@/lib/store';

const pledge = (id: number, name: string, items: [string, string][], extra: Partial<Pledge> = {}): Pledge => ({
  id, name, value: 0, date: '', type: 'ship', items: items.map(([title, kind]) => ({ title, kind })), ships: [], upgrade: null,
  lti: false, insurance: '', warbond: false, giftable: false, meltable: true, hasGame: false, upgraded: false, nickname: '', ...extra,
});
const ship = (id: number, name: string): CatalogShip => ({ id, name, manufacturer: 'Drake', focus: '', msrp: 0, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });

describe('ownedTitleCounts', () => {
  it('counts each pledge once per normalized title, pledge name and items together', () => {
    const m = ownedTitleCounts([
      pledge(1, 'Cutlass - Frost Paint', [['Cutlass - Frost Paint', 'Skin']]),
      pledge(2, 'Package - Starter', [['Cutlass - Frost Paint', 'Skin'], ['Cutlass Black', 'Ship']]),
    ]);
    expect(m.get(paintKey('Cutlass - Frost Paint'))).toBe(2);
    expect(m.get(paintKey('Cutlass Black'))).toBe(1);
    expect(m.get(paintKey('Package - Starter'))).toBe(1);
  });
  it('empty without a hangar', () => {
    expect(ownedTitleCounts(null).size).toBe(0);
  });
});

describe('ownedHulls', () => {
  const ships = [ship(1, 'Cutlass Black'), ship(2, 'Aurora MR')];
  it('pledged + in-game copies by catalog id', () => {
    const m = ownedHulls([pledge(1, 'Standalone Ship - Cutlass Black', [['Cutlass Black', 'Ship']])], [{ id: 1, name: 'Cutlass Black', how: 'earned', count: 1 }, { id: 2, name: 'Aurora MR', how: 'bought', count: 1 }], ships);
    expect(m.get(1)?.count).toBe(2);
    expect(m.get(1)?.game).toBe(1);
    expect(m.get(2)?.count).toBe(1);
  });
  it('in-game only without a hangar; empty without a catalog', () => {
    expect(ownedHulls(null, [{ id: 2, name: 'Aurora MR', how: 'bought', count: 1 }], ships).get(2)?.count).toBe(1);
    expect(ownedHulls([pledge(1, 'x', [['Cutlass Black', 'Ship']])], [], []).size).toBe(0);
  });
});
