import { describe, expect, it } from 'vitest';
import type { Pledge } from '@/lib/hangar';
import type { CatalogShip } from '@/lib/store';
import { ownedHulls, ownedTitleCount, ownedTitleCounts } from '@/lib/owned-counts';
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
    expect(m.exact.get(paintKey('Cutlass - Frost Paint'))).toBe(2);
    expect(m.exact.get(paintKey('Cutlass Black'))).toBe(1);
    expect(m.exact.get(paintKey('Package - Starter'))).toBe(1);
    expect(ownedTitleCount(m, 'Cutlass Frost Livery')).toBe(2);
  });
  it('matches a store title against a hangar title RSI cut short with "..." (prefix, once per pledge)', () => {
    const m = ownedTitleCounts([
      pledge(1, 'RSI Discovery Month Digital Goodies Pack', [["Lightning Bolt Co. Atzkav 'Starwalker' Sniper R...", 'FPS Weapon'], ["Gemini S71 'Infrared' Rifle", 'FPS Weapon']]),
      pledge(2, "Stegman's IndVest 'Pathfinder' S...", [["Stegman's IndVest 'Pathfinder' S...", 'Armor']]),
    ]);
    expect(m.cut.size).toBe(2);
    expect(ownedTitleCount(m, "Lightning Bolt Co. Atzkav 'Starwalker' Sniper Rifle")).toBe(1);
    expect(ownedTitleCount(m, "Gemini S71 'Infrared' Rifle")).toBe(1);
    expect(ownedTitleCount(m, "Stegman's IndVest 'Pathfinder' Set")).toBe(1); // name + item, one pledge, one copy
    expect(ownedTitleCount(m, "Lightning Bolt Co. Atzkav 'Deadeye' Sniper Rifle")).toBe(0);
    expect(ownedTitleCount(m, 'Lightning Bolt Co. Atzkav')).toBe(0); // shorter than the cut title: not a match
  });
  it('empty without a hangar', () => {
    expect(ownedTitleCounts(null).exact.size).toBe(0);
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
