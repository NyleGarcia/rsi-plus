import { describe, expect, it } from 'vitest';
import { WAIT_RISK, chainEvents, chainGoal, dropBakedExcludes, mergeGoals, planChains, withPlans, DEFAULT_PLAN_OPTIONS, excludeReserved, legExclude, ownedCcus, ownedHulls, ownedShips, plan, planFleet, applyAlternative, farthestReachable, planAlternatives, planGraph, plannerExclude, reservedRefs, savedVsMsrp, STORE_START, type OwnedCcu, type PlanOptions, type SavedChain } from '@/lib/ccu';
import { lastSale, lowestOffer, matchShip, recordSales, wishlistEvents, withExtraShips, type CatalogShip, type Sku } from '@/lib/store';

const sku = (title: string, price: number, extra: Partial<Sku> = {}): Sku => ({ id: price, title, price, available: true, stock: null, ...extra });
const ship = (id: number, name: string, msrp: number, ccu: Sku[] = [], standalone: Sku[] = []): CatalogShip => ({
  id, name, manufacturer: '', focus: '', msrp, flyable: '', link: `https://x/${id}`, thumb: null, standalone, ccu,
});

// Prices in cents. Standard CCU sku price = target msrp; warbond cheaper.
const A = ship(1, 'Aurora MR', 2500);
const B = ship(2, 'Avenger Titan', 5500, [sku('Standard Edition', 5500)]);
const C = ship(3, 'Cutlass Black', 11000, [sku('Standard Edition', 11000), sku('Warbond Edition', 10000)]);
const D = ship(4, 'Constellation Andromeda', 24000, [sku('Standard Edition', 24000)]);
const ships = [A, B, C, D];
const o = (p: Partial<PlanOptions>): PlanOptions => ({ ...DEFAULT_PLAN_OPTIONS, ...p });
const own = (fromId: number, toId: number, ref: number, extra: Partial<OwnedCcu> = {}): OwnedCcu => ({ fromId, toId, ref, source: 'hangar', value: 0, gifted: false, ...extra });

describe('ccu planner', () => {
  it('uses the warbond step when cheaper', () => {
    const p = plan(ships, [], 1, 4)!;
    // Aurora → Cutlass WB (10000−2500=7500) → Connie std (24000−11000=13000) = 20500 vs direct 21500
    expect(p.steps.map((s) => [s.toId, s.kind])).toEqual([
      [3, 'warbond'],
      [4, 'standard'],
    ]);
    expect(p).toMatchObject({ total: 20500, cash: 7500, msrpDiff: 21500, savings: 1000 });
  });

  it('an ignored store SKU is routed around, and its hull does not turn into a wait-for-a-sale step', () => {
    // Cutlass warbond (sku id 10000) ignored → direct standard, as without warbond
    const p = plan(ships, [], 1, 4, o({ skip: [10000] }))!;
    expect(p.steps.map((s) => [s.toId, s.kind])).toEqual([[4, 'standard']]);
    // Every CCU to the target ignored: no chain today; planAhead must not price it "later at MSRP" (it is on sale)
    expect(plan(ships, [], 1, 2, o({ skip: [5500] }))).toBeNull();
    expect(plan(ships, [], 1, 2, o({ skip: [5500], planAhead: true }))).toBeNull();
  });

  it('without warbond = direct standard', () => {
    const p = plan(ships, [], 1, 4, o({ warbond: false }))!;
    expect(p.steps.map((s) => s.toId)).toEqual([4]);
    expect(p.savings).toBe(0);
  });

  it('owned CCUs are free edges', () => {
    const p = plan(ships, [own(1, 3, 99, { value: 7500 })], 1, 4)!;
    expect(p.steps[0]).toMatchObject({ kind: 'owned', cost: 0, ref: 99 });
    expect(p.total).toBe(13000);
    expect(p.paid).toBe(7500);
    // the headline saving counts what the owned CCU cost: gap 21500 − 13000 to pay − 7500 paid = 1000 (not 8500)
    expect(p.savings).toBe(8500);
    expect(savedVsMsrp(p)).toBe(1000);
  });

  it('a buyback CCU costs what RSI asks for it once its page was read, else the MSRP gap', () => {
    const bb = (price?: number) => [own(1, 3, 77, { source: 'buyback', ...(price ? { price } : {}) })];
    // Aurora → Cutlass: gap 8500; store warbond 7500
    expect(plan([A, ship(3, 'Cutlass Black', 11000)], bb(), 1, 3, o({ buyback: true }))!.steps[0]).toMatchObject({ kind: 'buyback', cost: 8500 }); // nothing else sells it
    expect(plan(ships, bb(4000), 1, 3, o({ buyback: true }))!.steps[0]).toMatchObject({ kind: 'buyback', cost: 4000, ref: 77 });
    // dearer than the store today → the store step wins
    expect(plan(ships, bb(9000), 1, 3, o({ buyback: true }))!.steps[0]).toMatchObject({ kind: 'warbond', cost: 7500 });
    const r = ownedCcus([], [{ id: 77, name: 'x', price: 4000, upgrade: { fromId: 1, fromName: 'Aurora MR', toId: 3, toName: 'Cutlass Black' } }], ships);
    expect(r.owned[0]).toMatchObject({ source: 'buyback', price: 4000, value: 0, gifted: false });
  });

  it('buyback edges only when enabled; sold-out limited skipped', () => {
    const E = ship(5, 'Limited', 30000, [sku('Limited', 26000, { stock: 0 })]);
    expect(plan([...ships, E], [], 1, 5)).toBeNull();
    const owned = [own(4, 5, 7, { source: 'buyback' })];
    expect(plan([...ships, E], owned, 1, 5)).toBeNull();
    expect(plan([...ships, E], owned, 1, 5, o({ buyback: true }))?.steps.at(-1)).toMatchObject({ kind: 'buyback', cost: 6000 });
  });

  it('never steps down in price', () => {
    // A cheaper target with an oddly priced sku, an owned CCU and a buyback CCU that all go down: none are edges.
    const X = ship(5, 'Cheaper', 9000, [sku('Odd', 12000)]);
    const owned = [own(3, 5, 1), own(3, 2, 2, { source: 'buyback' })];
    expect(plan([...ships, X], owned, 3, 5, o({ buyback: true }))).toBeNull();
    expect(plan([...ships, X], owned, 3, 2, o({ buyback: true }))).toBeNull();
    for (const st of plan([...ships, X], owned, 1, 4, o({ buyback: true }))!.steps) expect([...ships, X].find((x) => x.id === st.toId)!.msrp).toBeGreaterThan([...ships, X].find((x) => x.id === st.fromId)!.msrp);
  });

  it('maps hangar CCUs and ships by name', () => {
    const r = ownedCcus(
      [{ id: 10, name: 'Upgrade - Aurora MR to Cutlass Black Warbond Edition', value: 0, upgrade: { fromId: null, fromName: 'Aurora MR', toId: null, toName: 'Cutlass Black' } }],
      [{ id: 11, name: 'Upgrade - Foo to Bar', upgrade: { fromId: null, fromName: 'Foo', toId: null, toName: 'Bar' } }],
      ships,
    );
    expect(r.owned).toEqual([{ fromId: 1, toId: 3, ref: 10, source: 'hangar', value: 0, gifted: true }]);
    expect(r.unmapped).toEqual([{ name: 'Upgrade - Foo to Bar', source: 'buyback' }]);
    expect(ownedShips([{ ships: ['Cutlass Black - LTI', 'Avenger Titan'] }], ships).map((s) => s.id)).toEqual([2, 3]);
    expect(matchShip('Constellation Andromeda Warbond Edition', ships)?.id).toBe(4);
    // Hangar names drop the model code: "Wolf" is the L-21 Wolf (shortest with only a code in front), not the L-22 Alpha Wolf.
    const wolves = [...ships, { ...ships[0]!, id: 90, name: 'L-21 Wolf' }, { ...ships[0]!, id: 91, name: 'L-22 Alpha Wolf' }, { ...ships[0]!, id: 92, name: 'F7C Hornet' }, { ...ships[0]!, id: 93, name: 'F7C-M Super Hornet' }];
    expect(matchShip('Wolf', wolves)?.id).toBe(90);
    expect(matchShip('Alpha Wolf', wolves)?.id).toBe(91);
    expect(matchShip('Wolf L-21', wolves)?.id).toBe(90);
    expect(matchShip('Kruger Wolf', wolves)?.id).toBe(90); // a word no catalog name uses (the maker) is ignored
    expect(matchShip('Hornet', wolves)?.id).toBe(92);
    expect(matchShip('Nothing Here', wolves)).toBeNull();
  });

  it('steps preference: same cost, fewer steps by default, more steps on request', () => {
    // Without warbond every standard route Aurora → Connie costs 21500.
    const fewer = plan(ships, [], 1, 4, o({ warbond: false }))!;
    expect(fewer.steps.map((s) => s.toId)).toEqual([4]);
    expect(plan(ships, [], 1, 4, o({ warbond: false, steps: undefined }))!.steps.map((s) => s.toId)).toEqual([4]);
    const more = plan(ships, [], 1, 4, o({ warbond: false, steps: 'more' }))!;
    expect(more.steps.map((s) => s.toId)).toEqual([2, 3, 4]);
    expect(more.total).toBe(fewer.total);
    // Cost stays primary: the cheaper warbond chain wins whatever the preference.
    expect(plan(ships, [], 1, 4, o({ steps: 'more' }))).toMatchObject({ total: 20500 });
    for (const objective of ['cash', 'longterm'] as const) expect(plan(ships, [], 1, 4, o({ warbond: false, steps: 'more', objective }))!.total).toBe(21500);
  });

  it('steps preference more: free owned CCUs are chained, and a free cycle through an unpriced hull ends', () => {
    // Owned Aurora → Titan → Cutlass and Aurora → Cutlass, all free: same cost, more steps takes the long way.
    const owned = [own(1, 2, 51), own(2, 3, 52), own(1, 3, 53)];
    expect(plan(ships, owned, 1, 4)!.steps.map((s) => s.ref ?? s.toId)).toEqual([53, 4]);
    expect(plan(ships, owned, 1, 4, o({ steps: 'more' }))!.steps.map((s) => s.ref ?? s.toId)).toEqual([51, 52, 4]);
    // Unpriced hull U: owned Aurora → U and U → Aurora are both free edges, a zero-cost loop.
    const U = ship(9, 'Unpriced', 0);
    const loop = [own(1, 9, 61), own(9, 1, 62)];
    const p = plan([...ships, U], loop, 1, 4, o({ steps: 'more' }))!;
    expect(p.total).toBe(20500);
    expect(new Set(p.steps.map((s) => s.toId)).size).toBe(p.steps.length);
  });

  it('planAlternatives: other chains, each with the step it takes out, best first', () => {
    // Best Aurora → Connie: Cutlass warbond (sku 10000) → Connie standard (sku 24000) = 20500.
    const alts = planAlternatives(ships, [], 1, 4, o({}));
    // Without the warbond: the direct standard (21500). Without the Connie CCU: no chain at all.
    expect(alts).toEqual([{ plan: expect.objectContaining({ total: 21500 }), skip: [10000], exclude: [], noWait: [] }]);
    expect(alts[0]!.plan.steps.map((s) => s.toId)).toEqual([4]);
    // An owned CCU taken out goes to exclude; results are ranked and differ from the best and from each other.
    const owned = [own(1, 3, 99, { value: 7500 })];
    const best = plan(ships, owned, 1, 4)!;
    const a2 = planAlternatives(ships, owned, 1, 4, o({}), 5);
    expect(a2[0]).toMatchObject({ skip: [], exclude: [99], plan: { total: 20500 }, tag: 'without-owned' }); // listed once, marked as the route without my CCUs
    const keys = [best, ...a2.map((a) => a.plan)].map((p) => p.steps.map((s) => `${s.toId}:${s.kind}:${s.skuId ?? s.ref}`).join('|'));
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < a2.length; i++) expect(a2[i]!.plan.total).toBeGreaterThanOrEqual(a2[i - 1]!.plan.total);
    // Applying what an alternative removed gives that alternative.
    expect(plan(ships, owned, 1, 4, o(applyAlternative(o({}), a2[0]!)))).toEqual(a2[0]!.plan);
    expect(planAlternatives(ships, owned, 1, 4, o({}), 1)).toHaveLength(1);
    expect(planAlternatives(ships, [], 1, 2, o({ skip: [5500] }))).toEqual([]);
    // applyAlternative adds the removals once and un-forces an excluded CCU.
    expect(applyAlternative({ skip: [1], exclude: [99], include: [99, 98] }, { skip: [1, 2], exclude: [99] })).toEqual({ skip: [1, 2], exclude: [99], include: [98], noWait: [], useOwned: undefined });
  });

  it('farthestReachable: the priciest hull below the target a chain gets to', () => {
    const E = ship(5, 'Not on sale', 30000);
    const all = [...ships, E];
    expect(plan(all, [], 1, 5)).toBeNull();
    expect(farthestReachable(planGraph(all, [], o({})), 1, 5)).toBe(4);
    // The Connie CCU ignored: the chain stops at the Cutlass.
    expect(farthestReachable(planGraph(all, [], o({ skip: [24000] })), 1, 5)).toBe(3);
    // An owned CCU counts; the start itself does not; nothing below a cheap target; unknown target.
    expect(farthestReachable(planGraph(all, [own(1, 4, 7)], o({ skip: [24000] })), 1, 5)).toBe(4);
    expect(farthestReachable(planGraph(all, [], o({})), 4, 5)).toBeNull();
    expect(farthestReachable(planGraph(all, [], o({})), 3, 2)).toBeNull();
    expect(farthestReachable(planGraph(all, [], o({})), 1, 999)).toBeNull();
    // Store start: from the standalone ships on sale.
    const A2 = { ...A, standalone: [sku('Aurora MR - Standalone', 2500)] };
    expect(farthestReachable(planGraph([A2, B, C, E], [], o({})), STORE_START, 5)).toBe(3);
  });

  it('planAlternatives: two copies of one CCU are one route, and taking it out takes out both', () => {
    const owned = [own(1, 3, 71), own(1, 3, 72)];
    expect(plan(ships, owned, 1, 4)!.total).toBe(13000);
    const alts = planAlternatives(ships, owned, 1, 4, o({}), 5);
    expect(alts.length).toBeGreaterThan(0);
    expect(alts[0]!.exclude.sort()).toEqual([71, 72]);
    for (const a of alts) expect(a.plan.steps.some((s) => s.kind === 'owned' && s.fromId === 1 && s.toId === 3)).toBe(false);
    expect(alts.every((a) => a.plan.total > 13000)).toBe(true);
    // A copy another chain already reserved stays excluded and isn't listed again.
    expect(planAlternatives(ships, owned, 1, 4, o({ exclude: [72] }))[0]!.exclude).toEqual([71]);
  });

  it('planAlternatives with more steps: the best chain minus a hop is not another route', () => {
    const best = plan(ships, [], 1, 4, o({ warbond: false, steps: 'more' }))!;
    expect(best.steps.map((s) => s.toId)).toEqual([2, 3, 4]);
    const alts = planAlternatives(ships, [], 1, 4, o({ warbond: false, steps: 'more' }));
    const hulls = new Set(best.steps.map((s) => s.toId));
    for (const a of alts) expect(a.plan.steps.length >= best.steps.length || a.plan.steps.some((s) => !hulls.has(s.toId))).toBe(true);
  });

  it('farthestReachable: null when the graph reaches the target (a stop / forced CCU is the blocker)', () => {
    const E = ship(5, 'Pricey stop', 30000, [sku('Standard Edition', 30000)]);
    const all = [...ships, E];
    expect(plan(all, [], 1, 4, o({ via: [5] }))).toBeNull();
    expect(farthestReachable(planGraph(all, [], o({ via: [5] })), 1, 4)).toBeNull();
    expect(plan(all, [], 1, 4, o({ include: [80] }))).not.toBeNull(); // an unknown forced ref is dropped
    expect(farthestReachable(planGraph(all, [], o({})), 1, 4)).toBeNull();
  });

  it('planAlternatives: future steps are never taken out', () => {
    const E = ship(5, 'Not on sale', 30000);
    const alts = planAlternatives([...ships, E], [], 1, 5, o({ planAhead: true }));
    for (const a of alts) expect(a.skip.length + a.exclude.length).toBe(1);
    expect(alts.every((a) => a.plan.steps.at(-1)!.kind === 'future')).toBe(true);
  });

  it('objective cash: avoids warbond new money when credit can pay a standard chain', () => {
    // spend: Aurora → Cutlass WB (7500 cash) → Connie = 20500. cash: direct standard 21500, all credit.
    const spend = plan(ships, [], 1, 4, o({ objective: 'spend' }))!;
    expect(spend).toMatchObject({ total: 20500, cash: 7500 });
    const cash = plan(ships, [], 1, 4, o({ objective: 'cash' }))!;
    expect(cash).toMatchObject({ total: 21500, cash: 0 });
    expect(cash.steps.map((s) => s.kind)).toEqual(['standard']);
    // No store credit → everything is new money, so cash == total and spend decides again.
    expect(plan(ships, [], 1, 4, o({ objective: 'cash', storeCredit: false }))).toMatchObject({ total: 20500, cash: 20500 });
  });

  it('objective longterm: an owned CCU costs what you paid for it', () => {
    // Owned Aurora→Cutlass paid 9000: spend prefers it (0 now), longterm prefers the 7500 warbond.
    const owned = [own(1, 3, 99, { value: 9000 })];
    expect(plan(ships, owned, 1, 4, o({ objective: 'spend' }))!.steps[0]).toMatchObject({ kind: 'owned' });
    const lt = plan(ships, owned, 1, 4, o({ objective: 'longterm' }))!;
    expect(lt.steps[0]).toMatchObject({ kind: 'warbond', cost: 7500 });
    expect(lt.paid).toBe(0);
  });

  it('store start buys the cheapest standalone first; savings vs target msrp', () => {
    const A2 = { ...A, standalone: [sku('Aurora MR - Standalone', 2500)] };
    const B2 = { ...B, standalone: [sku('Titan Warbond', 4500)] };
    const p = plan([A2, B2, C, D], [], STORE_START, 4)!;
    // Aurora 2500 → Cutlass WB 7500 → Connie 13000 = 23000 (< Titan WB 4500 + 5500 + 13000 = 23000 tie → fewer steps? both 3) ; cheaper path wins on cost
    expect(p.steps[0]).toMatchObject({ kind: 'standalone', fromId: STORE_START });
    expect(p.total).toBeLessThanOrEqual(24000);
    expect(p.msrpDiff).toBe(24000);
    expect(p.savings).toBe(24000 - p.total);
    // Warbond standalone is new money; standard standalone is credit-payable.
    const wb = plan([A2, B2, C, D], [], STORE_START, 2, o({ warbond: true }))!;
    expect(wb.steps).toEqual([expect.objectContaining({ kind: 'standalone', toId: 2, cost: 4500, cash: 4500 })]);
    expect(plan([A2, B2, C, D], [], STORE_START, 4, o({ warbond: false }))!.steps[0]).toMatchObject({ toId: 1, cash: 0 });
    // Without any standalone on sale there is no way in.
    expect(plan(ships, [], STORE_START, 4)).toBeNull();
  });

  it('force exclude drops a CCU; force include routes through it', () => {
    const owned = [own(1, 3, 99), own(2, 3, 98)];
    expect(plan(ships, owned, 1, 4)!.steps[0]).toMatchObject({ ref: 99 });
    expect(plan(ships, owned, 1, 4, o({ exclude: [99] }))!.steps[1]).toMatchObject({ ref: 98 });
    expect(plan(ships, owned, 1, 4, o({ exclude: [99, 98] }))!.steps[0]).toMatchObject({ kind: 'warbond' });
    // Include 98 (Titan→Cutlass): Aurora → Titan (std 3000) → owned → Connie 13000.
    const inc = plan(ships, owned, 1, 4, o({ include: [98] }))!;
    expect(inc.steps.map((s) => [s.toId, s.kind])).toEqual([
      [2, 'standard'],
      [3, 'owned'],
      [4, 'standard'],
    ]);
    expect(inc.total).toBe(16000);
    // Forcing a CCU whose source ship can't be reached (no CCU sold to it) → null; unknown ref is ignored.
    const E = ship(5, 'Unsold', 30000);
    expect(plan([...ships, E], [own(5, 4, 1)], 1, 4, o({ include: [1] }))).toBeNull();
    expect(plan(ships, owned, 1, 4, o({ include: [12345] }))!.total).toBe(13000);
  });

  it('gifted CCUs are skipped when excluded; reserved refs come from saved chains', () => {
    const owned = [own(1, 3, 99, { gifted: true })];
    expect(plan(ships, owned, 1, 4)!.steps[0]).toMatchObject({ kind: 'owned' });
    expect(plan(ships, owned, 1, 4, o({ excludeGifted: true }))!.steps[0]).toMatchObject({ kind: 'warbond' });
    const chain = plan(ships, owned, 1, 4)!;
    expect(reservedRefs([chain, { steps: [] }])).toEqual([99]);
    expect(plan(ships, owned, 1, 4, o({ exclude: reservedRefs([chain]) }))!.steps[0]).toMatchObject({ kind: 'warbond' });
  });
});

describe('wishlist', () => {
  it('alerts on first offer and on a lower price, not on the same price', () => {
    expect(lowestOffer(C)).toMatchObject({ price: 10000, title: 'Warbond Edition' });
    const now = 1_000_000;
    const first = wishlistEvents([{ id: 3, name: 'Cutlass', lowest: null }], ships, now);
    expect(first.events).toHaveLength(1);
    expect(first.lowest.get(3)).toBe(10000);
    expect(wishlistEvents([{ id: 3, name: 'Cutlass', lowest: 10000 }], ships, now).events).toHaveLength(0);
    expect(wishlistEvents([{ id: 3, name: 'Cutlass', lowest: 11000 }], ships, now).events).toHaveLength(1);
  });
});

describe('plan ahead (long-term goals)', () => {
  // Nothing sells a CCU to the Carrack today; with planAhead the planner assumes a standard CCU at MSRP later.
  const K = ship(6, 'Carrack', 60000);
  const all = [...ships, K];

  it('is off by default: a target with no CCU on sale has no chain', () => {
    expect(plan(all, [], 1, 6)).toBeNull();
    expect(DEFAULT_PLAN_OPTIONS.planAhead).toBe(false);
  });

  it('routes through a future standard CCU at MSRP and counts the wait', () => {
    const p = plan(all, [], 1, 6, o({ planAhead: true }))!;
    // Aurora → Cutlass WB 7500 → Carrack later 49000 = 56500 (MSRP diff 57500); via the Connie costs the same
    // (7500 + 13000 + 36000) but takes a step more, so the shorter chain wins.
    expect(p.steps.map((s) => [s.toId, s.kind])).toEqual([
      [3, 'warbond'],
      [6, 'future'],
    ]);
    expect(p.steps.at(-1)).toMatchObject({ cost: 49000, cash: 0, label: 'Not on sale now' });
    expect(p.steps.at(-1)!.skuId).toBeUndefined();
    expect(p).toMatchObject({ total: 56500, waits: 1, later: 49000, savings: 1000 });
  });

  it('prefers a CCU on sale today over waiting when the price is the same', () => {
    // Direct Aurora → Connie standard (21500) costs the same as a future hop would; today's CCU must win.
    const noWb = all.map((s) => (s.id === 3 ? { ...s, ccu: [] } : s)); // Cutlass not on sale → future candidate
    const p = plan(noWb, [], 1, 4, o({ planAhead: true }))!;
    expect(p.steps.map((s) => s.kind)).toEqual(['standard']);
    expect(p.waits).toBe(0);
  });

  it('future steps are new money when store credit is off', () => {
    const p = plan(all, [], 4, 6, o({ planAhead: true, storeCredit: false }))!;
    expect(p.steps[0]).toMatchObject({ kind: 'future', cost: 36000, cash: 36000 });
  });

  it('chainEvents fires once per SKU when a waited-for CCU goes on sale', () => {
    const chain: SavedChain = {
      id: 'c1', name: 'Carrack goal', at: 0, startId: 1, targetId: 6, total: 56500, cash: 7500, opt: o({ planAhead: true }),
      steps: plan(all, [], 1, 6, o({ planAhead: true }))!.steps,
    };
    expect(chainEvents([chain], all, 1000)).toEqual([]);
    const onSale = all.map((s) => (s.id === 6 ? { ...s, ccu: [sku('Warbond Edition', 55000, { id: 777 })] } : s));
    const ev = chainEvents([chain], onSale, 1000);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ key: 'ccu:c1:3>6:777', kind: 'store', url: 'hub.html#ccu', title: 'Carrack goal: Cutlass Black → Carrack CCU on sale — $440' });
    expect(ev[0]!.body).toContain('planned $490');
    // Sold out = no alert; a CCU priced under the source hull is not a usable CCU either.
    expect(chainEvents([chain], all.map((s) => (s.id === 6 ? { ...s, ccu: [sku('Limited', 55000, { stock: 0 })] } : s)), 1000)).toEqual([]);
  });

  it('recordSales / lastSale stamp what is on sale today and keep older stamps', () => {
    const h1 = recordSales({}, ships, 100);
    expect(h1).toEqual({ 2: { ccu: 100 }, 3: { ccu: 100 }, 4: { ccu: 100 } });
    const h2 = recordSales(h1, [ship(2, 'Avenger Titan', 5500, [], [sku('Standalone', 5500)]), ship(3, 'Cutlass Black', 11000)], 200);
    expect(h2[2]).toEqual({ ccu: 100, standalone: 200 });
    expect(lastSale(h2, 2)).toBe(200);
    expect(lastSale(h2, 3)).toBe(100);
    expect(lastSale(h2, 1)).toBeNull();
  });

  it('via: passes through a stop hull, in MSRP order; impossible stop → null', () => {
    const p = plan(ships, [], 1, 4, o({ warbond: false, via: [3] }))!;
    expect(p.steps.map((s) => s.toId)).toEqual([3, 4]);
    expect(p.total).toBe(8500 + 13000);
    expect(plan(ships, [], 3, 4, o({ via: [2] }))).toBeNull(); // Titan is below the Cutlass start
  });

  it('fleet plan: owned CCUs go to the first goal only, each hull copy starts one chain', () => {
    const owned = [own(1, 3, 99)];
    const goals = [
      { id: 'a', fromId: 1, targetId: 3, via: [] },
      { id: 'b', fromId: null, targetId: 3, via: [] },
    ];
    const f = planFleet(ships, owned, goals, o({ warbond: false }), { hulls: [{ id: 1, count: 1 }, { id: 2, count: 1 }] });
    expect(f.legs[0]!.plan!.steps[0]).toMatchObject({ kind: 'owned', ref: 99 });
    // goal b: the Aurora copy is taken by goal a, so auto picks the Titan; the owned CCU is already used
    expect(f.legs[1]).toMatchObject({ startId: 2, auto: true });
    expect(f.legs[1]!.plan!.steps.map((s) => s.kind)).toEqual(['standard']);
    expect(f.total).toBe(0 + 5500);
    expect(f.failed).toBe(0);
  });

  it('fleet plan: auto skips kept hulls, can buy from the store, reports failures', () => {
    const E = ship(5, 'Mustang Alpha', 2000, [], [sku('Standalone', 2000)]);
    const all = [...ships, E];
    const goals = [{ id: 'a', fromId: null, targetId: 2, via: [] }, { id: 'b', fromId: null, targetId: 1, via: [] }, { id: 'c', fromId: 4, targetId: 2, via: [] }];
    const f = planFleet(all, [], goals, o({}), { hulls: [{ id: 1, count: 1 }], keep: [1], storeStart: true });
    expect(f.legs[0]).toMatchObject({ startId: STORE_START, ahead: false });
    expect(f.legs[0]!.plan!.steps.map((s) => s.toId)).toEqual([5, 2]);
    // Aurora: no CCU sold to it today, the kept Aurora can't start it → store ship, then wait for an Aurora CCU
    expect(f.legs[1]).toMatchObject({ startId: STORE_START, ahead: true });
    expect(f.legs[1]!.plan!.steps.map((s) => s.kind)).toEqual(['standalone', 'future']);
    expect(f.legs[2]!.plan).toBeNull(); // Connie → Titan goes down
    expect(f.failed).toBe(1);
    expect(ownedHulls([{ ships: ['Aurora MR'] }, { ships: ['Aurora MR', 'Cutlass Black'] }], all)).toEqual([{ id: 1, count: 2, lti: 0 }, { id: 3, count: 1, lti: 0 }]);
  });

  it('fleet plan: a target nothing sells today (Orion) is planned ahead even with the option off', () => {
    const F = ship(6, 'Orion', 65000);
    const f = planFleet([...ships, F], [], [{ id: 'o', fromId: 3, targetId: 6, via: [] }, { id: 'c', fromId: 1, targetId: 3, via: [] }], o({ planAhead: false }), { hulls: [] });
    expect(f.legs[0]).toMatchObject({ ahead: true });
    expect(f.legs[0]!.plan!.steps.at(-1)).toMatchObject({ toId: 6, kind: 'future' });
    expect(f.legs[1]).toMatchObject({ ahead: false }); // on sale today → no waiting
    expect(f.legs[1]!.plan!.waits).toBe(0);
  });

  it('saving a chain keeps its own CCUs in the plan on screen; other saved chains still reserve theirs', () => {
    const owned = [own(1, 3, 99)];
    const before = plan(ships, owned, 1, 4)!;
    expect(before.steps[0]).toMatchObject({ kind: 'owned', ref: 99 });
    const saved: SavedChain = { id: 's', name: 'x', at: 0, startId: 1, targetId: 4, steps: before.steps, total: before.total, cash: before.cash, opt: o({}) };
    const route = (c: SavedChain) => c.startId === 1 && c.targetId === 4;
    expect(excludeReserved([7], [saved], route)).toEqual([7]);
    expect(plan(ships, owned, 1, 4, o({ exclude: excludeReserved([], [saved], route) }))!.steps).toEqual(before.steps);
    // Another route: the saved chain's CCU stays reserved.
    expect(excludeReserved([], [saved], (c) => c.startId === 2)).toEqual([99]);
  });

  it('fleet plan: re-planning after Save plan gives the same legs; one leg re-plans alone with the CCUs the goals above it took', () => {
    const owned = [own(1, 3, 99)];
    const goals = [
      { id: 'a', fromId: 1, targetId: 4, via: [] },
      { id: 'b', fromId: 1, targetId: 3, via: [] },
    ];
    const fo = { hulls: [{ id: 1, count: 2 }] };
    const f = planFleet(ships, owned, goals, o({}), fo);
    expect(f.legs[0]!.plan!.steps[0]).toMatchObject({ kind: 'owned', ref: 99 });
    const saved: SavedChain[] = f.legs.map((l, i) => ({ id: `c${i}`, name: '', group: 'G', at: 0, startId: l.startId!, targetId: l.goal.targetId, steps: l.plan!.steps, total: l.plan!.total, cash: l.plan!.cash, opt: o({}) }));
    const again = planFleet(ships, owned, goals, o({ exclude: excludeReserved([], saved, (c) => c.group === 'G') }), fo);
    expect(again.legs.map((l) => l.plan!.steps)).toEqual(f.legs.map((l) => l.plan!.steps));
    // Goal b without goal a's CCU = the warbond step the fleet shows, not the owned CCU goal a uses.
    expect(f.legs[1]!.plan!.steps.map((s) => s.kind)).toEqual(['warbond']);
    expect(legExclude(f, 1, [])).toEqual([99]);
    expect(legExclude(f, 0, [5])).toEqual([5]);
    expect(plan(ships, owned, 1, 3, o({ exclude: legExclude(f, 1, []) }))!.steps).toEqual(f.legs[1]!.plan!.steps);
  });

  it('fleet plan: Open on a goal keeps its exclusions to the single planner, so the fleet plans the same afterwards', () => {
    const owned = [own(1, 3, 99)];
    const goals = [
      { id: 'a', fromId: 1, targetId: 4, via: [] },
      { id: 'b', fromId: 1, targetId: 3, via: [] },
    ];
    const fo = { hulls: [{ id: 1, count: 2 }] };
    const user = o({});
    const f = planFleet(ships, owned, goals, user, fo);
    // Open goal b: the single planner shows b's leg (goal a took CCU 99)…
    const leg = { startId: 1, targetId: 3, exclude: legExclude(f, 1, user.exclude) };
    expect(plannerExclude(user.exclude, [], true, 1, 3, leg)).toEqual([99]);
    expect(plan(ships, owned, 1, 3, o({ exclude: plannerExclude(user.exclude, [], true, 1, 3, leg) }))!.steps).toEqual(f.legs[1]!.plan!.steps);
    // …another route on screen drops the leg's exclusions…
    expect(plannerExclude([5], [], true, 1, 4, leg)).toEqual([5]);
    // …and the user's options the fleet shares are untouched: back on the fleet, goal a still uses its own CCU.
    expect(user.exclude).toEqual([]);
    expect(planFleet(ships, owned, goals, user, fo).legs.map((l) => l.plan!.steps)).toEqual(f.legs.map((l) => l.plan!.steps));
    // No leg: saved chains reserve their CCUs unless the switch is off or the chain is this route's own.
    const saved: SavedChain = { id: 's', name: 'x', at: 0, startId: 2, targetId: 4, steps: [{ ...f.legs[0]!.plan!.steps[0]! }], total: 0, cash: 0, opt: o({}) };
    expect(plannerExclude([], [saved], true, 1, 4, null)).toEqual([99]);
    expect(plannerExclude([], [saved], false, 1, 4, null)).toEqual([]);
    expect(plannerExclude([], [saved], true, 2, 4, null)).toEqual([]);
  });

  it('fleet plan: auto upgrades a preferred hull (LTI token) first, even when another saves more', () => {
    const goals = [{ id: 'd', fromId: null, targetId: 4, via: [] }];
    const hulls = [{ id: 1, count: 1 }, { id: 2, count: 1 }];
    const free = planFleet(ships, [], goals, o({ warbond: false }), { hulls });
    const pref = planFleet(ships, [], goals, o({ warbond: false }), { hulls, prefer: [2] });
    expect(pref.legs[0]!.startId).toBe(2);
    expect(free.legs[0]!.plan).not.toBeNull();
    // a preferred hull that can't get there is skipped, not forced
    const up = planFleet(ships, [], [{ id: 'b', fromId: null, targetId: 2, via: [] }], o({}), { hulls: [{ id: 1, count: 1 }, { id: 3, count: 1 }], prefer: [3] });
    expect(up.legs[0]!.startId).toBe(1);
  });

  it('extra hulls RSI does not list (Kraken, Javelin) join the catalog and plan ahead', () => {
    const all = withExtraShips(ships);
    const kraken = all.find((s) => s.name === 'Kraken')!;
    expect(kraken).toMatchObject({ msrp: 165000, msrpSource: 'wiki' });
    expect(withExtraShips([...ships, { ...kraken, id: 999, msrpSource: undefined }]).filter((s) => s.name === 'Kraken')).toHaveLength(1);
    expect(matchShip('Kraken Privateer', all)?.name).toBe('Kraken Privateer');
    const p = plan(all, [], 4, kraken.id, o({ planAhead: true }))!;
    expect(p.steps.at(-1)).toMatchObject({ toId: kraken.id, kind: 'future', cost: 165000 - 24000 });
  });

  it('fleet plan: per-goal LTI and store start', () => {
    const E = ship(5, 'Mustang Alpha', 2000, [], [sku('Standalone', 2000)]);
    const all = [...ships, E];
    // Aurora: 1 LTI + 1 plain copy; Titan: 1 plain copy
    const hulls = [{ id: 1, count: 2, lti: 1 }, { id: 2, count: 1, lti: 0 }];
    const goals = [
      { id: 'plain', fromId: null, targetId: 3, via: [], lti: 'any' as const },
      { id: 'lti', fromId: null, targetId: 4, via: [], lti: 'only' as const },
      { id: 'store', fromId: null, targetId: 2, via: [], storeStart: true },
    ];
    const f = planFleet(all, [], goals, o({ warbond: false }), { hulls, prefer: [] });
    // the "any" goal takes a plain copy, leaving the LTI Aurora for the LTI goal
    expect(f.legs[0]!.lti).toBe(false);
    expect(f.legs[1]).toMatchObject({ startId: 1, lti: true });
    // the store goal may use the store, but a free hull that pays less now wins
    expect(f.legs[2]!.plan).not.toBeNull();
    const onlyStore = planFleet(all, [], [goals[2]!], o({}), { hulls: [] });
    expect(onlyStore.legs[0]!.startId).toBe(STORE_START);
    const noStore = planFleet(all, [], [{ ...goals[2]!, storeStart: false }], o({}), { hulls: [] });
    expect(noStore.legs[0]!.plan).toBeNull();
    // LTI only with no LTI copy → no chain, never a store start
    const none = planFleet(all, [], [{ id: 'x', fromId: null, targetId: 4, via: [], lti: 'only' as const, storeStart: true }], o({}), { hulls: [{ id: 1, count: 1, lti: 0 }] });
    expect(none.legs[0]!.plan).toBeNull();
    // prefer LTI: picks the LTI copy's hull over a hull that saves more
    const pref = planFleet(all, [], [{ id: 'p', fromId: null, targetId: 4, via: [], lti: 'prefer' as const }], o({ warbond: false }), { hulls: [{ id: 1, count: 1, lti: 0 }, { id: 2, count: 1, lti: 1 }] });
    expect(pref.legs[0]).toMatchObject({ startId: 2, lti: true });
  });

  it('a shared planGraph gives the same chains as a graph per plan', () => {
    const E = ship(5, 'Carrack', 50000, [sku('Standard Edition', 50000), sku('Warbond Edition', 47000)], [sku('Standalone', 52000)]);
    const all = [...ships, { ...B, standalone: [sku('Standalone', 5500)] }, E].filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i);
    const owned = [own(1, 3, 91, { value: 7500 }), own(3, 5, 92, { source: 'buyback' }), own(2, 4, 93)];
    for (const objective of ['spend', 'cash', 'longterm'] as const) {
      for (const buyback of [false, true]) {
        const opt = o({ objective, buyback });
        const g = planGraph(all, owned, opt);
        for (const start of [STORE_START, 1, 2, 3]) {
          for (const target of [3, 4, 5]) {
            expect(plan(all, owned, start, target, opt, g)).toEqual(plan(all, owned, start, target, opt));
            const via = o({ objective, buyback, via: [3], include: [93] });
            expect(plan(all, owned, start, target, via, g)).toEqual(plan(all, owned, start, target, via));
          }
        }
      }
    }
    // planFleet shares graphs across candidates: same pick as planning each source alone
    const f = planFleet(all, owned, [{ id: 'g', fromId: 1, targetId: 5, via: [] }], o({ buyback: true }), { hulls: [{ id: 1, count: 1 }] });
    expect(f.legs[0]!.plan).toEqual(plan(all, owned, 1, 5, o({ buyback: true })));
  });
});

describe('my chains: the saved list planned together', () => {
  const chain = (id: string, startId: number, targetId: number, extra: Partial<SavedChain> = {}): SavedChain => ({ id, name: id, at: 0, startId, targetId, steps: [], total: 0, cash: 0, opt: o({}), ...extra });
  const fo = { hulls: [{ id: 1, count: 2 }] };

  it('order is priority: the chain on top gets the owned CCU, the next one buys', () => {
    const owned = [own(1, 3, 99, { value: 7000 })];
    const list = [chain('a', 1, 3), chain('b', 1, 3)];
    const f = planChains(ships, owned, list, fo);
    expect(f.legs[0]!.plan!.steps[0]).toMatchObject({ kind: 'owned', ref: 99 });
    expect(f.legs[1]!.plan!.steps[0]).toMatchObject({ kind: 'warbond', cost: 7500 });
    const flipped = planChains(ships, owned, [list[1]!, list[0]!], fo);
    expect(flipped.legs[0]!.goal.id).toBe('b');
    expect(flipped.legs[0]!.plan!.steps[0]).toMatchObject({ kind: 'owned' });
  });

  it('each chain plans with its own options; a CCU nobody may use stays out', () => {
    const list = [chain('wb', 1, 4), chain('std', 1, 4, { opt: o({ warbond: false }) })];
    const f = planChains(ships, [], list, fo);
    expect(f.legs[0]!.plan!.steps.map((s) => s.kind)).toEqual(['warbond', 'standard']);
    expect(f.legs[1]!.plan!.steps.map((s) => s.kind)).toEqual(['standard']);
    const owned = [own(1, 3, 99)];
    expect(planChains(ships, owned, [chain('a', 1, 3)], fo, [99]).legs[0]!.plan!.steps[0]!.kind).toBe('warbond');
    // a chain's own forced-out CCU counts for that chain only
    const g = planChains(ships, owned, [chain('a', 1, 3, { opt: o({ exclude: [99] }) }), chain('b', 1, 3)], fo);
    expect(g.legs.map((l) => l.plan!.steps[0]!.kind)).toEqual(['warbond', 'owned']);
  });

  it('an auto chain picks its source; the kept plan follows, and only a real change makes a new list', () => {
    const list = [chain('auto', 0, 4, { auto: true })];
    expect(chainGoal(list[0]!).fromId).toBeNull();
    const f = planChains(ships, [], list, { hulls: [{ id: 2, count: 1 }, { id: 1, count: 1 }] });
    const kept = withPlans(list, f);
    expect(kept).not.toBe(list);
    expect(kept[0]!.startId).toBe(f.legs[0]!.startId);
    expect(kept[0]!.steps).toEqual(f.legs[0]!.plan!.steps);
    expect(kept[0]!.total).toBe(f.legs[0]!.plan!.total);
    expect(withPlans(kept, f)).toBe(kept);
    // no chain today: nothing kept, so it holds no CCU back
    const broken = withPlans([chain('x', 4, 1, { steps: [{ fromId: 1, toId: 3, kind: 'owned', cost: 0, cash: 0, paid: 0, label: '', ref: 9 }], total: 5 })], planChains(ships, [], [chain('x', 4, 1)], fo));
    expect(broken[0]).toMatchObject({ steps: [], total: 0, startId: 4 });
  });

  it('old fleet goals fold in once: a goal Save plan already saved marks its chain, the rest are appended', () => {
    const saved = [chain('s1', 1, 4, { group: 'Fleet plan', opt: o({ exclude: [5, 6] }) })];
    const goals = [
      { id: 'g1', fromId: null, targetId: 4, via: [], lti: 'prefer' as const, storeStart: true },
      { id: 'g2', fromId: 1, targetId: 3, via: [2] },
    ];
    const out = mergeGoals(saved, goals, (id) => `#${id}`, 7);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 's1', auto: true, lti: 'prefer', storeStart: true });
    expect(out[1]).toMatchObject({ name: '#1 → #3', startId: 1, targetId: 3, steps: [], at: 7 });
    expect(out[1]!.opt.via).toEqual([2]);
    expect(out[1]!.auto).toBeUndefined();
    expect(saved[0]!.auto).toBeUndefined(); // the input is left alone
    // an auto goal never swallows a chain saved by hand to the same ship (no group): both stay
    const hand = [chain('h', 3, 4)];
    const both = mergeGoals(hand, [{ id: 'g', fromId: null, targetId: 4, via: [] }], (id) => `#${id}`, 7);
    expect(both.map((c) => [c.id, !!c.auto, c.startId])).toEqual([['h', false, 3], ['g0', true, 0]]);
  });

  it('existing saved chains convert as they are: same order, same routes, other chains\' CCUs no longer baked in', () => {
    const step = (ref: number): SavedChain['steps'][number] => ({ fromId: 1, toId: 3, kind: 'owned', cost: 0, cash: 0, paid: 0, label: '', ref });
    // two chains saved the old way: b was saved while a held CCU 99, so 99 sits in b's excludes; 55 was forced out by hand
    const before = [chain('a', 1, 4, { steps: [step(99)], total: 13000 }), chain('b', 1, 3, { opt: o({ exclude: [99, 55], include: [], via: [2] }), steps: [step(98)] })];
    const after = dropBakedExcludes(mergeGoals(before, [], (id) => `#${id}`, 1));
    expect(after.map((c) => [c.id, c.startId, c.targetId, c.name])).toEqual(before.map((c) => [c.id, c.startId, c.targetId, c.name]));
    expect(after[0]).toEqual(before[0]); // nothing to change
    expect(after[1]!.opt.exclude).toEqual([55]);
    expect(after[1]!.opt.via).toEqual([2]);
    expect(after[1]!.auto).toBeUndefined();
    // converting again changes nothing
    expect(dropBakedExcludes(mergeGoals(after, [], (id) => `#${id}`, 2))).toEqual(after);
    // and the list plans: a (on top) keeps its owned CCU, b plans around it
    const f = planChains(ships, [own(1, 3, 99)], after, fo);
    expect(f.legs[0]!.plan!.steps[0]).toMatchObject({ kind: 'owned', ref: 99 });
    expect(f.legs[1]!.plan).not.toBeNull();
    expect(f.legs[1]!.plan!.steps.some((s) => s.ref === 99)).toBe(false);
  });

  it('an auto chain with two equally good sources leaves alone the hull another chain starts from', () => {
    // two cheap hulls (same price), each with an owned CCU to the Cutlass; chain b names hull 1 as its source
    const P = ship(1, 'Pulse', 3000);
    const H = ship(9, 'HoverQuad', 3000);
    const cat = [P, H, ...ships.slice(1)];
    const owned = [own(1, 3, 71, { value: 5000 }), own(9, 3, 72, { value: 5000 })];
    const hulls = { hulls: [{ id: 1, count: 1 }, { id: 9, count: 1 }] };
    const list = [chain('auto', 0, 3, { auto: true }), chain('b', 1, 3)];
    const f = planChains(cat, owned, list, hulls);
    expect(f.legs[0]!.startId).toBe(9); // not the Pulse
    expect(f.legs[0]!.plan!.steps[0]).toMatchObject({ kind: 'owned', ref: 72 });
    expect(f.legs[1]!.plan!.steps[0]).toMatchObject({ kind: 'owned', ref: 71 }); // b keeps its own CCU
    // the same whichever hull comes first in the hangar
    expect(planChains(cat, owned, list, { hulls: [...hulls.hulls].reverse() }).legs[0]!.startId).toBe(9);
  });

  it('a step that waits for a sale must beat buying today by WAIT_RISK', () => {
    const A1 = ship(1, 'A', 2500);
    const mid = (seen: number) => ({ ...ship(2, 'Mid', 6000), expect: { wb: { price: seen, at: 1 } } }); // not on sale; last warbond seen
    const T = ship(3, 'T', 10000, [sku('Standard Edition', 10000)]); // on sale: A → T today costs 7500
    const ahead = o({ planAhead: true });
    // via Mid: wait for A → Mid at (seen − 2500), then Mid → T today 4000
    const cheap = plan([A1, mid(3500), T], [], 1, 3, ahead)!; // 1000 + 4000 = 5000: saves 2500 = WAIT_RISK → not worth a wait
    expect(cheap.steps.map((s) => s.kind)).toEqual(['standard']);
    expect(WAIT_RISK).toBe(2500);
    const worth = plan([A1, mid(3000), T], [], 1, 3, ahead)!; // 500 + 4000 = 4500: saves 3000 > WAIT_RISK → waits
    expect(worth.steps.map((s) => s.kind)).toEqual(['future', 'standard']);
    expect(worth.total).toBe(4500); // the total is the real money, without the risk margin
  });

  it('a waiting step can be skipped: the chain stops waiting for that hull and goes another way', () => {
    const A1 = ship(1, 'A', 2500);
    const mid = { ...ship(2, 'Mid', 6000), expect: { wb: { price: 3000, at: 1 } } }; // not on sale, cheap last time
    const T = ship(3, 'T', 10000, [sku('Standard Edition', 10000)]);
    const ahead = o({ planAhead: true });
    const best = plan([A1, mid, T], [], 1, 3, ahead)!;
    expect(best.steps.map((s) => s.kind)).toEqual(['future', 'standard']);
    const skipped = plan([A1, mid, T], [], 1, 3, { ...ahead, noWait: [2] })!;
    expect(skipped.steps.map((s) => [s.toId, s.kind])).toEqual([[3, 'standard']]);
    // Show other routes offers it, marked with the hull no longer waited for
    const alts = planAlternatives([A1, mid, T], [], 1, 3, ahead);
    expect(alts.some((a) => a.noWait.includes(2) && a.plan.total === skipped.total)).toBe(true);
    expect(applyAlternative(ahead, alts.find((a) => a.noWait.length)!).noWait).toEqual([2]);
  });

  it('own vs not: the same route planned without the CCUs in the hangar, and back', () => {
    const owned = [own(1, 3, 99, { value: 7000 })];
    const withMine = plan(ships, owned, 1, 4)!;
    expect(withMine.steps[0]!.kind).toBe('owned');
    const fresh = plan(ships, owned, 1, 4, o({ useOwned: false }))!;
    expect(fresh.steps.some((s) => s.kind === 'owned')).toBe(false);
    expect(fresh.total).toBe(20500);
    // offered next to the other routes, either way round
    const a = planAlternatives(ships, owned, 1, 4, o({})).find((x) => x.tag === 'without-owned')!;
    expect(a.plan).toEqual(fresh);
    // two CCUs of mine in the chain: taking one out is not the fresh route, so that one is its own row and switches the option
    const two = [own(1, 2, 98), own(2, 3, 99)];
    const v = planAlternatives(ships, two, 1, 4, o({})).find((x) => x.useOwned === false)!;
    expect(v.tag).toBe('without-owned');
    expect(v.plan.steps.some((s) => s.kind === 'owned')).toBe(false);
    expect(applyAlternative(o({ include: [99] }), v)).toMatchObject({ useOwned: false, include: [] });
    const b = planAlternatives(ships, owned, 1, 4, o({ useOwned: false })).find((x) => x.tag === 'with-owned')!;
    expect(b.plan).toEqual(withMine);
    // a buyback CCU is not "owned": its own switch decides
    expect(plan(ships, [own(1, 3, 5, { source: 'buyback', price: 1000 })], 1, 3, o({ useOwned: false, buyback: true }))!.steps[0]!.kind).toBe('buyback');
  });
});
