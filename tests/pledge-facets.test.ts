import { describe, expect, it } from 'vitest';
import type { Pledge } from '@/lib/hangar';
import type { OwnedShip } from '@/lib/items';
import type { CatalogShip } from '@/lib/store';
import { applyFacets } from '@/lib/facets';
import { hadAs, isGifted, packageShape, pledgeFacets, pledgeRanges, shipFacets, shipRanges } from '@/lib/pledge-facets';

const pledge = (id: number, items: [string, string][], extra: Partial<Pledge> = {}): Pledge => ({
  id, name: `Pledge ${id}`, value: 10, date: '', type: 'ship', items: items.map(([title, kind]) => ({ title, kind })), ships: [], upgrade: null,
  lti: false, insurance: '', warbond: false, giftable: false, meltable: true, hasGame: false, upgraded: false, nickname: '', ...extra,
});
const ship = (id: number, name: string, extra: Partial<CatalogShip> = {}): CatalogShip => ({
  id, name, manufacturer: 'Drake', focus: '', msrp: 10000, flyable: 'Flight Ready', size: 'Small', link: '', thumb: null, standalone: [], ccu: [], ...extra,
});
const catalog = [ship(1, 'Cutlass Black', { size: 'Medium' }), ship(2, 'Carrack', { manufacturer: 'Anvil', flyable: 'Flight Ready', size: 'Large' }), ship(3, 'Ironclad', { flyable: 'In Concept', size: 'Large' })];

const all = [
  pledge(1, [['Cutlass Black', 'Ship']], { ships: ['Cutlass Black'], value: 100, lti: true, insurance: 'LTI', warbond: true, giftable: true }),
  pledge(2, [['Ironclad', 'Ship'], ['Ironclad - Paint', 'Skin']], { ships: ['Ironclad'], value: 0, type: 'package', hasGame: true }), // gifted
  pledge(3, [['Coin', 'Hangar decoration']], { value: 0, type: 'other' }), // $0 flair
  pledge(4, [], { type: 'upgrade', value: 20, upgrade: { fromId: 1, fromName: 'Cutlass Black', toId: 2, toName: 'Carrack' } }),
  pledge(5, [['Carrack', 'Ship']], { ships: ['Carrack'], value: 500, meltable: false, upgraded: true, insurance: '120 mo' }),
];

describe('pledge facets', () => {
  it('gifted = $0 and not flair / hangar / subscriber', () => {
    expect(all.filter(isGifted).map((p) => p.id)).toEqual([2]);
    expect(isGifted({ value: 0, type: 'subscriber' })).toBe(false);
    expect(isGifted({ value: 0, type: 'upgrade' })).toBe(true);
  });
  it('package shapes overlap', () => {
    expect(packageShape(all[0]!)).toEqual(['ships', 'single']);
    expect(packageShape(all[1]!)).toEqual(['ships', 'multi']);
    expect(packageShape(all[3]!)).toEqual(['no-ships', 'ccu', 'single']);
  });
  it('filters by each facet', () => {
    const f = pledgeFacets({ ships: catalog, labels: { '5': ['Keep'] }, inStore: (p) => p.id === 1 });
    const ids = (v: Record<string, unknown>) => applyFacets(all, f, v as never, pledgeRanges).map((p) => p.id);
    expect(ids({ type: ['upgrade', 'other'] })).toEqual([3, 4]);
    expect(ids({ insurance: 'lti' })).toEqual([1]);
    expect(ids({ insurance: '120' })).toEqual([5]);
    expect(ids({ warbond: 'yes' })).toEqual([1]);
    expect(ids({ giftable: 'yes' })).toEqual([1]);
    expect(ids({ gifted: 'yes' })).toEqual([2]);
    expect(ids({ meltable: 'yes' })).toEqual([1, 4]);
    expect(ids({ meltable: 'no' })).toEqual([5]);
    expect(ids({ meltable: 'zero' })).toEqual([2, 3]);
    expect(ids({ package: 'ccu' })).toEqual([4]);
    expect(ids({ package: 'multi' })).toEqual([2]);
    expect(ids({ store: 'yes' })).toEqual([1]);
    expect(ids({ stage: 'concept' })).toEqual([2]);
    expect(ids({ stage: 'ready' })).toEqual([1, 5]);
    expect(ids({ game: 'yes' })).toEqual([2]);
    expect(ids({ upgraded: 'yes' })).toEqual([5]);
    expect(ids({ labels: 'keep' })).toEqual([5]);
    expect(ids({ value: { min: 50, max: null } })).toEqual([1, 5]);
  });
  it('drops facets without data', () => {
    const f = pledgeFacets({}).map((x) => x.id);
    expect(f).not.toContain('store');
    expect(f).not.toContain('stage');
    expect(f).not.toContain('labels');
  });
});

describe('ship facets', () => {
  const owned = (s: CatalogShip, extra: Partial<OwnedShip> = {}): OwnedShip => ({ ship: s, count: 1, game: 0, gameHow: [], lti: false, insurance: [], items: [], paints: [], ...extra });
  const fleet = [owned(catalog[0]!, { lti: true, insurance: ['LTI'], paints: [{} as never] }), owned(catalog[1]!, { count: 2, game: 1, insurance: ['120 mo'] }), owned(catalog[2]!, { game: 1 })];
  const f = shipFacets(fleet);
  const ids = (v: Record<string, unknown>) => applyFacets(fleet, f, v as never, shipRanges).map((o) => o.ship.id);
  it('had as', () => {
    expect(fleet.map(hadAs)).toEqual(['pledged', 'both', 'game']);
    expect(ids({ had: 'game' })).toEqual([3]);
  });
  it('filters', () => {
    expect(ids({ insurance: 'lti' })).toEqual([1]);
    expect(ids({ insurance: 'none' })).toEqual([3]);
    expect(ids({ stage: 'concept' })).toEqual([3]);
    expect(ids({ size: 'large' })).toEqual([2, 3]);
    expect(ids({ paints: 'yes' })).toEqual([1]);
    expect(ids({ maker: 'anvil' })).toEqual([2]);
    expect(f.find((x) => x.id === 'maker')!.options.map((o) => o.label)).toEqual(['Anvil', 'Drake']);
    expect(ids({ msrp: { min: 50, max: 150 } })).toEqual([1, 2, 3]);
  });
});
