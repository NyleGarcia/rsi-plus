import { describe, expect, it } from 'vitest';
import type { BuybackItem, Pledge } from '@/lib/hangar';
import { storePaintFor, storePaintIndex } from '@/lib/items';
import { bestScenario, bundleScenarios, bundleTotals, buybackCompare, costAlone, countTitles, hangarCounts, packHint, storeLinksFor, titleWithCount, gainAt, meltOnlySplit, nextPaintTier, optionAt, optionPay, optionSubset, paintDiscount, paintLine, planBundle, rebuyCandidates, storePacks } from '@/lib/paints';
import { inventory, ownedShipsWithPaints } from '@/lib/items';
import type { CatalogShip } from '@/lib/store';
import type { StorePaint } from '@/lib/store';

const sp = (id: number, name: string, price: number, extra: Partial<StorePaint> = {}): StorePaint => ({ id, name, url: `https://rsi/${id}`, price, discounted: price, available: true, thumb: null, ...extra });
const pledge = (id: number, value: number, items: [string, string][], extra: Partial<Pledge> = {}): Pledge => ({
  id, name: `Pledge ${id}`, value, date: '', type: 'paint', items: items.map(([title, kind]) => ({ title, kind })), ships: [], upgrade: null,
  lti: false, insurance: '', warbond: false, giftable: false, meltable: true, hasGame: false, upgraded: false, nickname: '', ...extra,
});
const pickIds = (list: { cand: { pledge: Pledge } }[]) => list.map((p) => p.cand.pledge.id).sort((a, b) => a - b);

const store = [
  sp(1, 'Cutlass - Frost Paint', 1500),
  sp(2, 'Carrack - Ghoulish Green Paint', 2500, { discounted: 2000 }),
  sp(3, 'Hornet - Pyrotechnic Paint', 1000, { available: false }),
  sp(4, '890 Jump - 3 Paint Pack', 5500, { discounted: 4400 }),
  sp(5, 'Aurora - Red Paint', 500),
  // Real store shape (2026-10): the pack's singles add up to its list price exactly.
  sp(6, '890 Jump - Meridian Paint', 2200),
  sp(7, '890 Jump - Penumbra Paint', 1650),
  sp(8, '890 Jump - Skyline Paint', 1650),
  sp(9, 'Keystone Paint Collection', 1400, { discounted: 980 }),
  sp(10, 'ATLS - Keystone Paint', 500),
  sp(11, 'RAFT - Keystone Paint', 900),
  sp(12, 'Racing Paint Collection', 5000, { discounted: 3500 }), // singles not on the store → contents unknown
];
const idx = storePaintIndex(store);
const packs = storePacks(store);
const JUMP: [string, string][] = [['890 Jump - Meridian Paint', 'Skin'], ['890 Jump - Penumbra Paint', 'Skin'], ['890 Jump - Skyline Paint', 'Skin']];

describe('paint tiers', () => {
  it('discount by paints in the cart + next tier', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 50].map(paintDiscount)).toEqual([0, 0, 0.15, 0.2, 0.2, 0.25, 0.25, 0.3, 0.3, 0.35, 0.35]);
    expect(nextPaintTier(0)).toEqual({ min: 2, rate: 0.15 });
    expect(nextPaintTier(5)).toEqual({ min: 7, rate: 0.3 });
    expect(nextPaintTier(10)).toBeNull();
  });
});

describe('store packs', () => {
  it('finds contents by hull / collection word, confirmed by price sum; implied discount', () => {
    expect(packs.map((p) => [p.pack.name, p.paints?.map((s) => s.id) ?? null, p.singlesTotal, +p.impliedRate.toFixed(2)])).toEqual([
      ['890 Jump - 3 Paint Pack', [6, 7, 8], 5500, 0.2],
      ['Keystone Paint Collection', [10, 11], 1400, 0.3],
      ['Racing Paint Collection', null, 0, 0],
    ]);
  });
});

describe('rebuy candidates', () => {
  it('only meltable, paint-only pledges whose paints are on the store and in stock', () => {
    const { ok, skipped } = rebuyCandidates(
      [
        pledge(1, 15, [['Cutlass - Frost Livery', 'Skin']]), // on store, same price
        pledge(2, 25, [['Carrack - Ghoulish Green Paint', 'Skin']]), // on sale today
        pledge(3, 10, [['Hornet - Pyrotechnic Paint', 'Skin']]), // out of stock
        pledge(4, 15, [['Cutlass - Frost Livery', 'Skin']], { meltable: false }),
        pledge(5, 0, [['Cutlass - Frost Livery', 'Skin']]), // gift
        pledge(6, 80, [['Carrack', 'Ship'], ['Carrack - Ghoulish Green Paint', 'Skin']], { type: 'ship' }), // paint in a ship pack
        pledge(7, 12, [['Mystery Livery', 'Skin']]), // not sold any more
        pledge(9, 100, [['Carrack', 'Ship']], { type: 'ship' }), // no paint → ignored
        pledge(10, 5, [], { name: 'Aurora - Red Paint' }), // paint pledge with no item list
      ],
      idx,
    );
    expect(ok.map((c) => [c.pledge.id, c.credit, c.single?.cost, c.pack, c.single?.lines.length])).toEqual([
      [2, 2500, 2000, null, 1],
      [1, 1500, 1500, null, 1],
      [10, 500, 500, null, 1],
    ]);
    expect(skipped.map((s) => [s.pledge.id, s.why])).toEqual([
      [3, 'out-of-stock'],
      [4, 'not-meltable'],
      [5, 'no-value'],
      [6, 'other-items'],
      [7, 'not-on-store'],
    ]);
    expect(skipped.find((s) => s.pledge.id === 6)!.titles).toEqual(['Carrack']);
  });

  it('partial packs: paints still sold are rebuyable, the rest flagged missing; never auto-planned; per-paint opt-out', () => {
    const { ok, skipped } = rebuyCandidates(
      [
        pledge(1, 40, [['Cutlass - Frost Livery', 'Skin'], ['Mystery Livery', 'Skin'], ['Hornet - Pyrotechnic Paint', 'Skin']], { name: 'Mixed - 3 Paint Pack' }),
        pledge(2, 20, [['Mystery Livery', 'Skin'], ['Other Livery', 'Skin']], { name: 'Gone - 2 Paint Pack' }), // nothing sold
      ],
      idx,
    );
    expect(ok.map((c) => [c.pledge.id, c.single!.lines.map((l) => l.title), c.missing])).toEqual([[1, ['Cutlass - Frost Livery'], ['Mystery Livery', 'Hornet - Pyrotechnic Paint']]]);
    expect(skipped.map((s) => [s.pledge.id, s.why])).toEqual([[2, 'not-on-store']]);
    expect(planBundle(ok, [])).toEqual([]); // gain would be 4000 − 1500 but two paints vanish — hand pick only
    const whole = rebuyCandidates([pledge(3, 40, [['Cutlass - Frost Livery', 'Skin'], ['Carrack - Ghoulish Green Paint', 'Skin']])], idx).ok[0]!;
    const sub = optionSubset(whole.single!, new Set([2]));
    expect([sub.lines.length, sub.count, sub.cost, sub.list]).toEqual([1, 1, 1500, 1500]);
    expect(optionSubset(whole.single!, new Set())).toBe(whole.single);
  });

  it('packs: a pack pledge gets pack + singles options; singles that make a whole pack get the pack option', () => {
    const { ok } = rebuyCandidates(
      [
        pledge(1, 44, JUMP, { name: '890 Jump - 3 Paint Pack' }),
        pledge(2, 55, JUMP), // three singles bought together
        pledge(3, 22, [['890 Jump - Meridian Paint', 'Skin']]), // one single: no pack
        pledge(4, 35, [['Racing Paint Collection', 'Skin']], { name: 'Racing Paint Collection' }), // singles not sold: pack only
      ],
      idx,
      { packs, packTier: 'one' },
    );
    const by = (id: number) => ok.find((c) => c.pledge.id === id)!;
    expect(by(1).pack).toMatchObject({ kind: 'pack', count: 1, tiered: true, cost: 4400 });
    expect(by(1).single).toMatchObject({ kind: 'single', count: 3, cost: 5500 });
    expect(by(2).pack).toMatchObject({ kind: 'pack', cost: 4400 });
    expect(by(3).pack).toBeNull();
    expect(by(4).pack).toMatchObject({ kind: 'pack', cost: 3500 });
    expect(by(4).single).toBeNull();
    // The pack's own 20 % stacks with the tier, so it stays cheaper at every rate; singles only count more toward the tier.
    expect(optionAt(by(1), 0).kind).toBe('pack');
    expect(optionAt(by(1), 0.35).kind).toBe('pack');
    expect(optionAt(by(1), 0.35, 'single').kind).toBe('single');
    expect(costAlone(by(1))).toBe(4400);
    expect(gainAt(by(1), 0)).toBe(0); // paid the pack price, rebuy the pack alone: nothing gained
    expect(gainAt(by(2), 0)).toBe(1100); // paid singles, rebuy as the pack
    expect(rebuyCandidates([pledge(1, 44, [], { name: '890 Jump - 3 Paint Pack' })], idx, { packs, packTier: 'each' }).ok[0]!.pack!.count).toBe(3);
    // Default (safe): a pack line is outside the tier — full pack price, counts nothing.
    const safe = rebuyCandidates([pledge(1, 44, [], { name: '890 Jump - 3 Paint Pack' })], idx, { packs }).ok[0]!;
    expect(safe.pack).toMatchObject({ count: 0, tiered: false, cost: 4400 });
    expect(optionPay(safe.pack!, 0.35)).toBe(4400);
    expect(optionPay(safe.single!, 0.35)).toBe(3575); // singles win in a big cart
    expect(optionAt(safe, 0.35).kind).toBe('single');
    expect(bundleTotals([{ cand: safe, option: safe.pack! }], []).lines).toBe(0);
  });
});

describe('bundle plan', () => {
  const cands = rebuyCandidates(
    [
      pledge(1, 15, [['Cutlass - Frost Livery', 'Skin']]),
      pledge(2, 15, [['Cutlass - Frost Livery', 'Skin']]),
      pledge(3, 25, [['Carrack - Ghoulish Green Paint', 'Skin']]),
      pledge(4, 3, [['Aurora - Red Paint', 'Skin']]), // paid less than today's price
    ],
    idx,
  ).ok;
  const pick = (list: typeof cands) => list.map((c) => ({ cand: c, option: c.single! }));

  it('totals: melt credit vs discounted rebuy, wanted paints ride along', () => {
    const t = bundleTotals(pick(cands.filter((c) => c.pledge.id !== 4)), []);
    expect(t.lines).toBe(3);
    expect(t.rate).toBe(0.2);
    expect(t.credit).toBe(5500);
    expect(t.list).toBe(5000);
    expect(t.pay).toBe(4000);
    expect(t.rebuyGain).toBe(1500);
    expect(t.net).toBe(1500);
    expect(t.next).toEqual({ min: 5, rate: 0.25 });

    const w = bundleTotals(pick(cands.filter((c) => c.pledge.id !== 4)), [sp(9, 'New Paint', 2000)]);
    expect(w.lines).toBe(4);
    expect(w.wantedAlone).toBe(2000); // alone: 1 paint, no tier
    expect(w.wantedPay).toBe(1600); // 20 % off in the bundle
    expect(w.net).toBe(w.rebuyGain + 400);
  });

  it('plans the best set: positive gains in, a loss only when it unlocks a tier, limit respected', () => {
    // 3 → 20 %: 300 + 300 + 500 = 1100; the $3 Aurora (paid 300, rebuy 400 at 20 %) loses → out.
    expect(pickIds(planBundle(cands, []))).toEqual([1, 2, 3]);
    expect(gainAt(cands.find((c) => c.pledge.id === 4)!, 0.2)).toBe(-100);
    // Cap 2: the two best at 15 % — Carrack (800) and one Cutlass (225).
    expect(pickIds(planBundle(cands, [], 2))).toEqual([1, 3]);
    // A wanted paint fills the cart too.
    expect(pickIds(planBundle(cands, [sp(9, 'New', 2000)], 2))).toEqual([3]);
    expect(planBundle(cands.filter((c) => c.pledge.id === 4), [])).toEqual([]);
  });

  it('a pack is never a tier-filler at a loss — keep it unless its paints are cheaper apart', () => {
    // Carrack gains big; the 2-paint "pack" (paid 2900, singles 3000 → −100 at 15 %: 2900 − 2550 = +350? no: 3000 × 0.85 = 2550 → +350 gain)
    // so use a pack paid under its singles: paid 2400, singles 3000 → at 15 % costs 2550 → −150. Alone: Carrack 8000; with the pack
    // as filler: 10000 − 1700 + 2400 − 2550 = 8150 > 8000, but packs are kept → plan is Carrack alone.
    const list = rebuyCandidates([pledge(1, 100, [['Carrack - Ghoulish Green Paint', 'Skin']]), pledge(2, 24, [['Cutlass - Frost Livery', 'Skin'], ['Cutlass - Frost Livery', 'Skin']])], idx).ok;
    expect(pickIds(planBundle(list, []))).toEqual([1]);
  });

  it('takes a small loss to reach a tier when the rest gains more', () => {
    const big = rebuyCandidates([pledge(1, 100, [['Carrack - Ghoulish Green Paint', 'Skin']]), pledge(2, 4.5, [['Aurora - Red Paint', 'Skin']])], idx).ok;
    // Alone: 10000 − 2000 = 8000. Together at 15 %: 10000 − 1700 + 450 − 425 = 8325 → both.
    expect(pickIds(planBundle(big, []))).toEqual([1, 2]);
  });

  it('pack vs singles: the plan takes whichever nets more', () => {
    const list = rebuyCandidates([pledge(1, 55, JUMP), pledge(2, 25, [['Carrack - Ghoulish Green Paint', 'Skin']])], idx, { packs, packTier: 'one' }).ok;
    // Pack + Carrack = 2 paints → 15 %: 5500 − 3740 + 2500 − 1700 = 2560. Singles + Carrack = 4 → 20 %: 1100 + 900 = 2000.
    const plan = planBundle(list, []);
    expect(plan.find((p) => p.cand.pledge.id === 1)!.option.kind).toBe('pack');
    expect(bundleTotals(plan, []).net).toBe(2560);
    // Singles win when they are what reaches a tier worth more: pack $44 vs three $5 singles + one $25 paint.
    const cheap = storePaintIndex([sp(4, 'Trio Paint Pack', 1500, { discounted: 1200 }), sp(6, 'Trio - A Paint', 500), sp(7, 'Trio - B Paint', 500), sp(8, 'Trio - C Paint', 500), sp(2, 'Carrack - Ghoulish Green Paint', 2500)]);
    const cheapPacks = storePacks([...cheap.values()]);
    const l2 = rebuyCandidates([pledge(1, 15, [['Trio - A Paint', 'Skin'], ['Trio - B Paint', 'Skin'], ['Trio - C Paint', 'Skin']]), pledge(2, 25, [['Carrack - Ghoulish Green Paint', 'Skin']])], cheap, { packs: cheapPacks, packTier: 'one' }).ok;
    // Pack: 2 paints → 15 %: 1500 − 1020 + 2500 − 2125 = 855. Singles: 4 paints → 20 %: 1500 − 1200 + 2500 − 2000 = 800. Pack still wins here…
    expect(bundleTotals(planBundle(l2, []), []).net).toBe(855);
    // …but with two more singles in the cart the singles push it to 7 → 30 %: pack 1500 − 840 + 3 × (2500 − 1750) = 2910 at 4 paints → 20 %?
    // Pack route: 1 + 3 = 4 paints → 20 %: 1500 − 960 + 3 × 500 = 2040. Singles route: 3 + 3 = 6 → 25 %: 1500 − 1125 + 3 × 625 = 2250 → singles.
    const l3 = rebuyCandidates([pledge(1, 15, [['Trio - A Paint', 'Skin'], ['Trio - B Paint', 'Skin'], ['Trio - C Paint', 'Skin']]), pledge(2, 25, [['Carrack - Ghoulish Green Paint', 'Skin']]), pledge(3, 25, [['Carrack - Ghoulish Green Paint', 'Skin']]), pledge(4, 25, [['Carrack - Ghoulish Green Paint', 'Skin']])], cheap, { packs: cheapPacks, packTier: 'one' }).ok;
    const p3 = planBundle(l3, []);
    expect(p3.find((p) => p.cand.pledge.id === 1)!.option.kind).toBe('single');
    expect(bundleTotals(p3, []).net).toBe(2250);
  });
});

describe('melt only', () => {
  const ship = (id: number, name: string): CatalogShip => ({ id, name, manufacturer: '', focus: '', msrp: id * 1000, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
  const ships = [ship(1, 'Cutlass Black'), ship(2, 'Cutlass Red'), ship(5, 'Carrack'), ship(6, 'Aurora MR')];
  const pledges = [
    pledge(1, 90, [['Cutlass Black', 'Ship']], { type: 'ship' }),
    pledge(2, 15, [['Cutlass - Frost Livery', 'Skin']]), // fits a hull I own → keep
    pledge(3, 15, [['Cutlass - Frost Livery', 'Skin']]), // second copy, one Cutlass → surplus
    pledge(4, 25, [['Carrack - Ghoulish Green Paint', 'Skin']]), // no Carrack → melt only
    pledge(5, 25, [['Carrack - Ghoulish Green Paint', 'Skin']]), // no Carrack, duplicate too → melt only (no-ship first)
    pledge(6, 12, [['Mystery Livery', 'Skin']]), // unknown ship → keep
    pledge(7, 40, [['Cutlass - Frost Livery', 'Skin'], ['Carrack - Ghoulish Green Paint', 'Skin']]), // mixed: Frost still needed? no (pledge 2 took it) but Carrack no-ship → every paint qualifies → melt only
    pledge(8, 5, [['Aurora - Red Paint', 'Skin']], { value: 0 }), // gift → not meltable → keep (never melt-only)
    pledge(9, 100, [['Aurora MR', 'Ship'], ['Aurora - Red Paint', 'Skin']], { type: 'ship' }), // ship pack → keep
  ];
  const rows = inventory(pledges, ships);
  const fleet = ownedShipsWithPaints(rows);

  it('no-ship and surplus copies melt only; one copy per owned hull, unknown ships and ship packs are kept', () => {
    const { meltOnly, keep } = meltOnlySplit(pledges, rows, fleet);
    expect(meltOnly.map((m) => [m.pledge.id, m.why, m.credit])).toEqual([
      [3, 'duplicate', 1500],
      [4, 'no-ship', 2500],
      [5, 'no-ship', 2500],
      [7, 'duplicate', 4000],
    ]);
    expect(keep.map((p) => p.id)).toEqual([1, 2, 6, 8, 9]);
    // Two Cutlasses → two Frost copies wanted → pledge 3 kept, pledge 7 still melts (Carrack side).
    const two = meltOnlySplit([...pledges, pledge(10, 90, [['Cutlass Red', 'Ship']], { type: 'ship' })], rows, ownedShipsWithPaints(inventory([...pledges, pledge(10, 90, [['Cutlass Red', 'Ship']], { type: 'ship' })], ships)));
    expect(two.meltOnly.map((m) => m.pledge.id)).toEqual([4, 5, 7]);
    // Options off.
    expect(meltOnlySplit(pledges, rows, fleet, { noShip: false }).meltOnly.map((m) => [m.pledge.id, m.why])).toEqual([[3, 'duplicate'], [5, 'duplicate'], [7, 'duplicate']]); // one Carrack copy kept (pledge 4)
    expect(meltOnlySplit(pledges, rows, fleet, { duplicates: false }).meltOnly.map((m) => m.pledge.id)).toEqual([4, 5]); // pledge 7 has a Frost with a hull → kept
    expect(meltOnlySplit(pledges, rows, fleet, { except: new Set([4, 7]) }).meltOnly.map((m) => m.pledge.id)).toEqual([3, 5]); // forced rebuy
  });

  it('variants share paints: a Cutlass Red paint is not "no ship" when you own a Cutlass Black; 300-series too', () => {
    const cat = [...ships, ship(10, 'L-21 Wolf'), ship(11, 'L-22 Alpha Wolf'), ship(12, 'Constellation Phoenix'), ship(13, 'F7C Hornet'), ship(14, 'F7C-M Super Hornet')];
    expect(paintLine('Cutlass Red', cat)).toBe('cutlass');
    expect(paintLine('Constellation Andromeda', cat)).toBe('constellation');
    expect(paintLine('L-22 Alpha Wolf', cat)).toBe('wolf');
    expect(paintLine('L-21 Wolf', cat)).toBe('wolf');
    expect(paintLine('F7C-M Super Hornet', cat)).toBe('hornet');
    expect(paintLine('315p')).toBe('300 series');
    expect(paintLine('325a')).toBe('300 series');
    expect(paintLine('Carrack', cat)).toBe('carrack');
    const pl = [
      pledge(1, 90, [['Cutlass Black', 'Ship']], { type: 'ship' }),
      pledge(2, 15, [['Cutlass Red Paint - Medivac', 'Skin']]), // named for the Red → fits the Black you own
      pledge(3, 15, [['Cutlass Red Paint - Medivac', 'Skin']]), // second copy, one Cutlass → surplus
      pledge(4, 25, [['Carrack Paint - Ghoulish Green', 'Skin']]), // no Carrack at all → no ship
    ];
    const r = inventory(pl, ships);
    expect(r.find((x) => x.title.startsWith('Cutlass Red'))!.fits.map((s) => s.id)).toEqual([2]); // exact fit is the Red only…
    const { meltOnly, keep } = meltOnlySplit(pl, r, ownedShipsWithPaints(r));
    expect(keep.map((p) => p.id)).toEqual([1, 2]); // …but the Black counts as a hull for it
    expect(meltOnly.map((m) => [m.pledge.id, m.why])).toEqual([[3, 'duplicate'], [4, 'no-ship']]);
  });

  it('dedupe inside kept packs: paints owned elsewhere or for no ship are redundant (melt, no rebuy); planner honours the drop', () => {
    const pl = [
      pledge(1, 90, [['Cutlass Black', 'Ship']], { type: 'ship' }),
      pledge(2, 15, [['Cutlass - Frost Livery', 'Skin']]), // standalone copy → covers the one Cutlass
      pledge(3, 60, [['Cutlass - Frost Livery', 'Skin'], ['Aurora - Red Paint', 'Skin'], ['Carrack - Ghoulish Green Paint', 'Skin']]), // pack: Frost dup, Aurora needed, Carrack no-ship
      pledge(4, 50, [['Aurora MR', 'Ship']], { type: 'ship' }),
    ];
    const r = inventory(pl, ships);
    const f = ownedShipsWithPaints(r);
    const { meltOnly, keep, redundant } = meltOnlySplit(pl, r, f);
    expect(meltOnly).toEqual([]);
    expect(keep.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(redundant.get(3)).toEqual([{ title: 'Cutlass - Frost Livery', why: 'duplicate' }, { title: 'Carrack - Ghoulish Green Paint', why: 'no-ship' }]);
    expect(redundant.has(2)).toBe(false);
    // With the two redundant paints dropped, the pack rebuys only the Aurora: 6000 − 500 at 0 % → gain 5500 (vs 6000 − 4000 whole).
    const cands = rebuyCandidates(keep, idx).ok;
    const pack = cands.find((c) => c.pledge.id === 3)!;
    const drop = new Map([[3, new Set(pack.single!.lines.filter((l) => l.title !== 'Aurora - Red Paint').map((l) => l.store.id))]]);
    const plan = planBundle(cands, [], 50, drop);
    const pk = plan.find((p) => p.cand.pledge.id === 3)!;
    expect(pk.option.lines.map((l) => l.title)).toEqual(['Aurora - Red Paint']);
    expect(bundleScenarios(cands, [], 50, drop).at(-1)!.picks.find((p) => p.cand.pledge.id === 3)!.option.cost).toBe(500);
  });
});

describe('bundle scenarios', () => {
  const idx2 = storePaintIndex([sp(1, 'Cutlass - Frost Paint', 1500), sp(2, 'Carrack - Ghoulish Green Paint', 2500)]);
  const cands = rebuyCandidates(
    Array.from({ length: 12 }, (_, i) => pledge(i + 1, i % 2 ? 15 : 25, [[i % 2 ? 'Cutlass - Frost Livery' : 'Carrack - Ghoulish Green Paint', 'Skin']])),
    idx2,
  ).ok;

  it('one row per distinct best plan, net rises with the tier, best picked', () => {
    const sc = bundleScenarios(cands, [], 50);
    expect(sc.map((s) => s.limit)).toEqual([2, 3, 5, 7, 10, 15]);
    expect(sc.map((s) => s.totals.lines)).toEqual([2, 3, 5, 7, 10, 12]);
    expect(sc.map((s) => s.totals.rate)).toEqual([0.15, 0.2, 0.25, 0.3, 0.35, 0.35]);
    for (let i = 1; i < sc.length; i++) expect(sc[i]!.totals.net).toBeGreaterThan(sc[i - 1]!.totals.net);
    expect(bestScenario(sc)).toBe(sc.length - 1);
    expect(sc[0]!.perPaint).toBe(Math.round(sc[0]!.totals.net / 2));
    expect(bundleScenarios(cands, [], 7).map((s) => s.limit)).toEqual([2, 3, 5, 7]);
    expect(bestScenario([])).toBe(-1);
  });
});

describe('buyback compare', () => {
  const ship = (id: number, name: string): CatalogShip => ({ id, name, manufacturer: '', focus: '', msrp: id * 1000, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
  const ships = [ship(1, 'Cutlass Black'), ship(2, 'Cutlass Red'), { ...ship(5, 'Carrack'), link: 'https://rsi/pledge/ships/carrack', standalone: [{ id: 50, title: 'Standalone', price: 60000, available: true, stock: null }] }, ship(6, 'Aurora MR')];
  const bb = (id: number, name: string, contained = '', extra: Partial<BuybackItem> = {}): BuybackItem => ({ id, name, date: '', contained, type: 'paint', upgrade: null, url: `https://rsi/buyback/${id}`, ...extra });
  const pl = [pledge(1, 90, [['Cutlass Black', 'Ship']], { type: 'ship' }), pledge(2, 15, [['Cutlass - Frost Livery', 'Skin']]), pledge(3, 5, [['Pembroke Helmet', 'FPS Equipment']], { type: 'gear' })];
  const rows = inventory(pl, ships);
  const fleet = ownedShipsWithPaints(rows);
  const list = [
    bb(1, 'Cutlass - Frost Livery'), // own it again → not listed
    bb(2, 'Cutlass Red Paint - Medivac'), // for my Cutlass line, not owned
    bb(3, 'Cutlass Red Paint - Medivac'), // second copy
    bb(4, 'Carrack Paint - Ghoulish Green'), // no Carrack
    bb(5, 'Mystery Livery'), // unknown ship
    bb(6, 'Carrack', 'Carrack, Lifetime Insurance', { type: 'ship' }), // ship I don't have
    bb(7, 'Starter Pack', 'Cutlass Black, Pembroke Helmet, Cutlass - Frost Livery', { type: 'package' }), // all owned again
    bb(8, 'Mixed Pack', 'Cutlass Black, Odd Mug', { type: 'combo' }), // mug missing
    bb(9, 'Upgrade - Aurora to Carrack', '', { type: 'upgrade', upgrade: { fromId: 6, toId: 5, fromName: 'Aurora MR', toName: 'Carrack' } }), // CCU → planner
  ];
  it('splits paints for my ships / other paints / items I lack; counts entries owned again; skips CCUs', () => {
    const c = buybackCompare(list, rows, fleet, ships, idx);
    expect(c.paintsForMyShips.map((p) => [p.title, p.copies, p.store?.id ?? null, p.fits.map((s) => s.id)])).toEqual([['Cutlass Red Paint - Medivac', 2, null, [2]]]);
    expect(c.otherPaints.map((p) => [p.title, p.forMyShip, p.store?.id ?? null])).toEqual([
      ['Carrack Paint - Ghoulish Green', false, 2],
      ['Mystery Livery', false, null],
    ]);
    expect(c.missing.map((m) => [m.item.id, m.titles, m.have])).toEqual([
      [6, ['Carrack', 'Lifetime Insurance'], []],
      [8, ['Odd Mug'], ['Cutlass Black']],
    ]);
    expect(c.haveAgain).toBe(2);
    expect(c.ownedAgain.map((b) => b.id)).toEqual([1, 7]);
    expect(countTitles(['A', 'B', 'A', 'A'])).toEqual([{ title: 'A', n: 3 }, { title: 'B', n: 1 }]);
    expect(countTitles(['A', 'B', 'A']).map(titleWithCount)).toEqual(['A ×2', 'B']);
    // RSI listing only "5 items": not matchable → unknown, with the hull's paints you own as the hint.
    const u = buybackCompare([bb(20, 'Cutlass - 5 Paint Pack', '5 items', { type: 'paint' }), bb(21, 'Mystery Bundle', '2 items', { type: 'combo' })], rows, fleet, ships, idx);
    expect(u.missing).toEqual([]);
    expect(u.haveAgain).toBe(0);
    expect(u.unknown.map((x) => [x.item.id, x.count, x.hull, x.ownedForHull])).toEqual([
      [20, 5, 'Cutlass', [{ title: 'Cutlass - Frost Livery', n: 1 }]],
      [21, 2, '', []],
    ]);
    // packHint direct: the cached paint-line index answers the same twice, and a new ships array rebuilds it.
    const pack = bb(20, 'Cutlass - 5 Paint Pack', '5 items', { type: 'paint' });
    expect(packHint(pack, rows, ships).ownedForHull).toEqual([{ title: 'Cutlass - Frost Livery', n: 1 }]);
    expect(packHint(pack, rows, ships).ownedForHull).toEqual([{ title: 'Cutlass - Frost Livery', n: 1 }]);
    expect(packHint(pack, rows, [...ships]).ownedForHull).toEqual([{ title: 'Cutlass - Frost Livery', n: 1 }]);
    const hc = hangarCounts(pl);
    expect([hc.get('cutlass black'), hc.get('cutlass - frost livery'), hc.get('pembroke helmet'), hc.get('nope')]).toEqual([1, 1, 1, undefined]);
    expect(hangarCounts([pledge(9, 5, [], { name: 'Aurora - Red Paint' }), pledge(9, 5, [], { name: 'Aurora - Red Paint' })]).get('aurora - red paint')).toBe(2);
    // Buyable on the store today: the Carrack paint (listing in stock) and the Carrack itself (standalone SKU); not the mug, not the Medivac paint (no listing).
    expect(c.otherPaints.map((p) => [p.title, p.buyableNow])).toEqual([['Carrack Paint - Ghoulish Green', true], ['Mystery Livery', false]]);
    expect(c.paintsForMyShips[0]!.buyableNow).toBe(false);
    expect(c.missing.map((m) => [m.item.id, m.buyableNow])).toEqual([[6, false], [8, false]]); // Carrack yes but LTI no → entry not fully buyable
    const carrackOnly = buybackCompare([bb(6, 'Carrack', 'Carrack', { type: 'ship' })], rows, fleet, ships, idx);
    expect(carrackOnly.missing[0]!.buyableNow).toBe(true);
    expect(carrackOnly.missing[0]!.store).toEqual([{ title: 'Carrack', url: 'https://rsi/pledge/ships/carrack', price: 60000, sku: 50 }]);
    // Mixed entry: the Carrack has a store page, the insurance has none → not fully buyable, one link.
    expect(c.missing[0]!.store.map((l) => l.title)).toEqual(['Carrack']);
    expect(storeLinksFor(['Carrack Paint - Ghoulish Green', 'Odd Mug', 'Hornet - Pyrotechnic Paint'], ships, idx)).toEqual([{ title: 'Carrack Paint - Ghoulish Green', url: 'https://rsi/2', price: 2000, sku: 2 }]); // Hornet paint out of stock
  });
});

describe('storePaintFor', () => {
  const row = (title: string) => ({ key: `paint:${title}`, title, image: null, category: 'paint' as const, count: 1, pledges: [], ship: null, fits: [], fitsVia: null, giftable: 0, lti: 0, insurance: '' }) as unknown as Parameters<typeof storePaintFor>[0];
  it('by normalized title, else by prefix when the hangar page cut the title short', () => {
    expect(storePaintFor(row('890 Jump - Skyline Livery'), idx)?.id).toBe(8);
    expect(storePaintFor(row('Carrack - Ghoulish Gr...'), idx)?.id).toBe(2);
    expect(storePaintFor(row('Carrack - Nope...'), idx)).toBeNull();
    expect(storePaintFor(row('Carrack - Nope Paint'), idx)).toBeNull();
  });
});
