import { describe, expect, it } from 'vitest';
import { ownedCcus, type SavedChain } from '@/lib/ccu';
import { ccuCsv, ccuFacets, ccuRanges, ccuRows, ccuTotals, groupCcus, savingOf } from '@/lib/ccu-rows';
import { applyFacets, facetCounts } from '@/lib/facets';
import type { BuybackItem, Pledge } from '@/lib/hangar';
import type { CatalogShip } from '@/lib/store';

const ship = (id: number, name: string, msrp: number, manufacturer: string, flyable = 'Flight Ready'): CatalogShip => ({
  id, name, manufacturer, focus: '', msrp, flyable, size: 'Small', link: `https://x/${id}`, thumb: null, standalone: [], ccu: [],
});
const A = ship(1, 'Aurora MR', 2500, 'RSI');
const C = ship(3, 'Cutlass Black', 11000, 'Drake');
const D = ship(4, 'Constellation Andromeda', 24000, 'RSI', 'In Concept');
const ships = [A, C, D];

const pledge = (id: number, value: number, from: string, to: string, extra: Partial<Pledge> = {}): Pledge => ({
  id, name: `Upgrade - ${from} to ${to}`, value, date: '', type: 'upgrade', items: [], ships: [], upgrade: { fromId: null, fromName: from, toId: null, toName: to },
  lti: false, insurance: '', warbond: false, giftable: true, meltable: true, hasGame: false, upgraded: false, nickname: '', ...extra,
});
const bb = (id: number, from: string, to: string, price?: number): BuybackItem => ({
  id, name: `Upgrade - ${from} to ${to} Warbond`, date: '', contained: '', type: 'upgrade', upgrade: { fromId: null, fromName: from, toId: null, toName: to }, url: `https://x/bb/${id}`, ...(price != null ? { price } : {}),
});

const pledges = [
  pledge(10, 60, 'Aurora MR', 'Cutlass Black', { warbond: true }), // gap 85, paid 60 → saves 25
  pledge(11, 0, 'Aurora MR', 'Cutlass Black'), // gifted → saves 85
  pledge(12, 140, 'Cutlass Black', 'Constellation Andromeda', { lti: true, insurance: 'LTI' }), // gap 130, paid 140 → −10
  pledge(13, 5, 'Foo', 'Bar'), // unmapped
];
const buyback = [bb(20, 'Aurora MR', 'Constellation Andromeda', 21500), bb(21, 'Cutlass Black', 'Constellation Andromeda')];
const chains: SavedChain[] = [
  { id: 'c', name: 'Connie', at: 0, startId: 1, targetId: 4, total: 0, cash: 0, opt: {} as SavedChain['opt'], steps: [{ fromId: 3, toId: 4, kind: 'owned', cost: 0, cash: 0, paid: 14000, label: 'Owned CCU', ref: 12 }] },
];
const { owned } = ownedCcus(pledges, buyback, ships);
const rows = ccuRows(owned, ships, pledges, buyback, chains);
const by = (key: string) => rows.find((r) => r.key === key)!;

describe('ccu rows', () => {
  it('joins hangar + buyback with the catalog', () => {
    expect(rows.map((r) => r.key)).toEqual(['hangar:10', 'hangar:11', 'hangar:12', 'hangar:13', 'buyback:20', 'buyback:21']);
    expect(by('hangar:10')).toMatchObject({ fromName: 'Aurora MR', toName: 'Cutlass Black', paid: 6000, sourceMsrp: 2500, targetMsrp: 11000, gap: 8500, saving: 2500, warbond: true, gifted: false, inChain: false });
    expect(by('hangar:11')).toMatchObject({ paid: 0, gifted: true, saving: 8500 });
    expect(by('hangar:12')).toMatchObject({ saving: -1000, lti: true, insurance: 'LTI', inChain: true, chain: 'Connie' });
    expect(by('hangar:13')).toMatchObject({ from: null, to: null, fromName: 'Foo', toName: 'Bar', gap: null, saving: null, paid: 500 });
    expect(by('buyback:20')).toMatchObject({ place: 'buyback', paid: 21500, gap: 21500, saving: 0, warbond: true, giftable: false, meltable: false });
    expect(by('buyback:21')).toMatchObject({ paid: null, gap: 13000, saving: null });
    expect(by('hangar:10').pledge?.id).toBe(10);
    expect(by('buyback:21').buyback?.id).toBe(21);
  });

  it('chain match is per place (a buyback id equal to a pledge id does not count)', () => {
    const r = ccuRows(owned, ships, pledges, [bb(12, 'Cutlass Black', 'Constellation Andromeda')], chains);
    expect(r.find((x) => x.key === 'buyback:12')?.inChain).toBe(false);
  });

  it('facets and ranges', () => {
    const f = ccuFacets(rows);
    expect(savingOf(by('buyback:20'))).toBe('none');
    expect(applyFacets(rows, f, { saving: 'saves' }).map((r) => r.ref)).toEqual([10, 11]);
    expect(applyFacets(rows, f, { saving: 'negative' }).map((r) => r.ref)).toEqual([12]);
    expect(applyFacets(rows, f, { place: 'buyback' })).toHaveLength(2);
    expect(applyFacets(rows, f, { insurance: 'lti' }).map((r) => r.ref)).toEqual([12]);
    expect(applyFacets(rows, f, { stage: 'concept' }).map((r) => r.ref)).toEqual([12, 20, 21]);
    expect(applyFacets(rows, f, { chain: 'yes' }).map((r) => r.ref)).toEqual([12]);
    expect(applyFacets(rows, f, { gifted: 'yes' }).map((r) => r.ref)).toEqual([11]);
    expect(f.find((x) => x.id === 'fromMaker')!.options.map((o) => o.id)).toEqual(['Drake', 'RSI']);
    expect(applyFacets(rows, f, { toMaker: ['Drake'] }).map((r) => r.ref)).toEqual([10, 11]);
    expect(facetCounts(rows, f, { place: 'hangar' }).warbond).toEqual({ yes: 1, no: 3 });
    expect(applyFacets(rows, f, { paid: { min: 100, max: null } }, ccuRanges).map((r) => r.ref)).toEqual([12, 20]);
    expect(applyFacets(rows, f, { savingAmt: { min: null, max: -1 } }, ccuRanges).map((r) => r.ref)).toEqual([12]);
  });

  it('totals, groups, csv', () => {
    expect(ccuTotals(rows)).toEqual({ count: 6, paid: 6000 + 0 + 14000 + 500 + 21500, gap: 8500 + 8500 + 13000 + 21500 + 13000, saving: 2500 + 8500 - 1000 + 0, unknown: 2 });
    const g = groupCcus(rows);
    expect(g.find((x) => x.rep.ref === 10)?.rows.map((r) => r.ref)).toEqual([10, 11]);
    expect(g).toHaveLength(5);
    const csv = ccuCsv(rows).split('\n');
    expect(csv).toHaveLength(7);
    expect(csv[1]).toBe('hangar,10,Aurora MR,RSI,Cutlass Black,Drake,60.00,25.00,110.00,85.00,25.00,true,,true,false,true,,Flight Ready,Small');
  });
});
