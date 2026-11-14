import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_OPTIONS, plan } from '@/lib/ccu';
import { ARCHIVE, archivePrices, expandSeed, lastSeen, lowestSeen, mergeImport, observe, recordPrices, RUN_GAP, withArchive, withExpected, type PriceHistory } from '@/lib/price-history';
import type { CatalogShip, Sku } from '@/lib/store';

const sku = (title: string, price: number, extra: Partial<Sku> = {}): Sku => ({ id: price, title, price, available: true, stock: null, ...extra });
const ship = (id: number, name: string, msrp: number, ccu: Sku[] = [], standalone: Sku[] = []): CatalogShip => ({ id, name, manufacturer: '', focus: '', msrp, flyable: '', link: '', thumb: null, standalone, ccu });
const DAY = 86_400_000;

describe('price history', () => {
  it('observes MSRP and the cheapest standard / warbond SKU on sale; nothing for a wiki-priced hull', () => {
    const s = ship(1, 'A', 10000, [sku('Standard Edition', 10000), sku('Warbond Edition', 9000), sku('Warbond Edition', 8500, { stock: 0 })], [sku('Standalone', 10000)]);
    expect(observe(s)).toEqual({ msrp: 10000, ccu: 10000, 'ccu-wb': 9000, ship: 10000 });
    expect(observe({ ...s, msrpSource: 'wiki' })).toEqual({});
  });

  it('the same price soon after stretches the run; a new price or a long gap starts one', () => {
    const on = ship(1, 'A', 10000, [sku('Warbond Edition', 9000)]);
    let h = recordPrices({}, [on], 1000);
    h = recordPrices(h, [on], 1000 + DAY);
    expect(h[1]!['ccu-wb']).toEqual([{ p: 9000, from: 1000, to: 1000 + DAY }]);
    h = recordPrices(h, [ship(1, 'A', 10000, [sku('Warbond Edition', 8000)])], 1000 + 2 * DAY);
    expect(h[1]!['ccu-wb']!.map((r) => r.p)).toEqual([9000, 8000]);
    // off sale for a while, back at the same price: a second run, the gap is not claimed
    h = recordPrices(h, [ship(1, 'A', 10000, [sku('Warbond Edition', 8000)])], 1000 + 2 * DAY + RUN_GAP + 1);
    expect(h[1]!['ccu-wb']).toHaveLength(3);
    // not on sale: nothing stamped for the CCU, MSRP still is
    const before = h[1]!['ccu-wb'];
    h = recordPrices(h, [ship(1, 'A', 10000)], 1000 + 60 * DAY);
    expect(h[1]!['ccu-wb']).toEqual(before);
    expect(h[1]!.msrp!.at(-1)).toMatchObject({ p: 10000, to: 1000 + 60 * DAY });
  });

  it('imports fill the years before; an overlap with our own reading is dropped, a re-import replaces', () => {
    const own: PriceHistory = { 1: { 'ccu-wb': [{ p: 9000, from: 100 * DAY, to: 110 * DAY }] } };
    const imp: PriceHistory = { 1: { 'ccu-wb': [{ p: 7000, from: 10 * DAY, to: 20 * DAY }, { p: 9500, from: 105 * DAY, to: 106 * DAY }] }, 2: { ccu: [{ p: 5000, from: DAY, to: 2 * DAY }] } };
    let h = mergeImport(own, imp, 'import');
    expect(h[1]!['ccu-wb']).toEqual([{ p: 7000, from: 10 * DAY, to: 20 * DAY, src: 'import' }, { p: 9000, from: 100 * DAY, to: 110 * DAY }]);
    expect(h[2]!.ccu).toEqual([{ p: 5000, from: DAY, to: 2 * DAY, src: 'import' }]);
    h = mergeImport(h, { 1: { 'ccu-wb': [{ p: 7200, from: 10 * DAY, to: 20 * DAY }] } }, 'import');
    expect(h[1]!['ccu-wb']!.filter((r) => r.src).map((r) => r.p)).toEqual([7200]);
    // most recent wins; on a tie our own reading does
    expect(lastSeen(h, 1, ['ccu-wb'])).toMatchObject({ p: 9000 });
    expect(lowestSeen(h, 1, ['ccu-wb'])).toMatchObject({ p: 7200, src: 'import' });
    const tie: PriceHistory = { 3: { ccu: [{ p: 1, from: 5, to: 9, src: 'x' }, { p: 2, from: 9, to: 9 }] } };
    expect(lastSeen(tie, 3, ['ccu'])).toMatchObject({ p: 2 });
  });

  it('planner: today\'s store beats history; a waiting step uses the last sale price seen, else MSRP', () => {
    const A = ship(1, 'A', 2500);
    const B = ship(2, 'B', 10000); // no CCU on sale today
    const h: PriceHistory = { 2: { 'ccu-wb': [{ p: 8000, from: DAY, to: 2 * DAY }], ccu: [{ p: 10000, from: DAY, to: 2 * DAY }] } };
    const ahead = { ...DEFAULT_PLAN_OPTIONS, planAhead: true };
    // no history → MSRP
    expect(plan([A, B], [], 1, 2, ahead)!.steps[0]).toMatchObject({ kind: 'future', cost: 7500 });
    // last warbond seen 8000 → 5500, new money, marked as an estimate; the standard one at MSRP says nothing
    const ships = withExpected([A, B], h);
    expect(ships[1]!.expect).toEqual({ wb: { price: 8000, at: 2 * DAY } });
    const p = plan(ships, [], 1, 2, ahead)!;
    expect(p.steps[0]).toMatchObject({ kind: 'future', cost: 5500, cash: 5500, est: { at: 2 * DAY, wb: true } });
    // warbond off, or the option off → MSRP again
    expect(plan(ships, [], 1, 2, { ...ahead, warbond: false })!.steps[0]).toMatchObject({ cost: 7500 });
    expect(plan(ships, [], 1, 2, { ...ahead, lastSeen: false })!.steps[0]).toMatchObject({ cost: 7500 });
    // on sale today (dearer than the old warbond): today's price, not the history
    const live = withExpected([A, ship(2, 'B', 10000, [sku('Standard Edition', 10000)])], h);
    const q = plan(live, [], 1, 2, ahead)!;
    expect(q.steps[0]).toMatchObject({ kind: 'standard', cost: 7500 });
    expect(q.steps[0]!.est).toBeUndefined();
  });

  it('the shipped archive: well-formed, and behind your own readings', async () => {
    const a = await archivePrices();
    const runs = Object.values(a).flatMap((k) => Object.values(k).flat());
    expect(Object.keys(a).length).toBeGreaterThan(200);
    expect(runs.every((r) => r.p > 0 && r.from <= r.to && !r.src)).toBe(true);
    expect(expandSeed({ through: 3, h: { 7: { 'ccu-wb': [[9000, 1, 2]] } } })).toEqual({ 7: { 'ccu-wb': [{ p: 9000, from: DAY, to: 2 * DAY }] } });
    // Caterpillar (RSI ship id 24): your own reading over the same days replaces the archive's, older runs stay
    const first = a[24]!.ccu![0]!;
    const own: PriceHistory = { 24: { ccu: [{ p: 1, from: first.from, to: first.to }] } };
    const h = await withArchive(own);
    expect(h[24]!.ccu!.filter((r) => r.from === first.from)).toEqual([{ p: 1, from: first.from, to: first.to }]);
    expect(h[24]!.ccu!.some((r) => r.src === ARCHIVE)).toBe(true);
  });
});
