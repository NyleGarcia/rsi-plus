import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_OPTIONS, ownedCcus, ownedShips, plan, reservedRefs, STORE_START, type OwnedCcu, type PlanOptions } from '@/lib/ccu';
import { lowestOffer, matchShip, wishlistEvents, type CatalogShip, type Sku } from '@/lib/store';

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
