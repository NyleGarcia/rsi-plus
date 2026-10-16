import { describe, expect, it } from 'vitest';
import { chainEvents, DEFAULT_PLAN_OPTIONS, ownedCcus, ownedHulls, ownedShips, plan, planFleet, reservedRefs, STORE_START, type OwnedCcu, type PlanOptions, type SavedChain } from '@/lib/ccu';
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
  });

  it('buyback edges only when enabled; sold-out limited skipped', () => {
    const E = ship(5, 'Limited', 30000, [sku('Limited', 26000, { stock: 0 })]);
    expect(plan([...ships, E], [], 1, 5)).toBeNull();
    const owned = [own(4, 5, 7, { source: 'buyback' })];
    expect(plan([...ships, E], owned, 1, 5)).toBeNull();
    expect(plan([...ships, E], owned, 1, 5, o({ buyback: true }))?.steps.at(-1)).toMatchObject({ kind: 'buyback', cost: 6000 });
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
});
