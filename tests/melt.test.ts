import { describe, expect, it } from 'vitest';
import type { Pledge } from '@/lib/hangar';
import { canMelt, copiesElsewhere, duplicatePlan, holdersIndex, marginalLoss, meltSummary, targetPlan } from '@/lib/melt';

const pledge = (id: number, items: [string, string][], extra: Partial<Pledge> = {}): Pledge => ({
  id, name: `Pledge ${id}`, value: 10, date: '', type: 'ship', items: items.map(([title, kind]) => ({ title, kind })), ships: [], upgrade: null,
  lti: false, insurance: '', warbond: false, giftable: false, meltable: true, hasGame: false, upgraded: false, nickname: '', ...extra,
});

describe('melt', () => {
  const all = [
    pledge(1, [['Cutlass Black', 'Ship']], { value: 100, lti: true }),
    pledge(2, [['Cutlass Black', 'Ship']], { value: 110 }),
    pledge(3, [['Cutlass Black', 'Ship'], ['Cutlass - Frost Livery', 'Skin']], { value: 120 }),
    pledge(4, [['Carrack', 'Ship']], { value: 500 }),
    pledge(5, [['Aurora MR', 'Ship'], ['Star Citizen Digital Download', '']], { value: 45, hasGame: true }),
    pledge(6, [['Aurora MR', 'Ship']], { value: 25, meltable: false }),
    pledge(7, [], { type: 'upgrade', value: 20, upgrade: { fromId: 1, fromName: 'Aurora MR', toId: 2, toName: 'Cutlass Black' } }),
    pledge(8, [['Cutlass Black', 'Ship']], { value: 0 }), // gifted / reward: melts for nothing
  ];

  it('summary: credit, what is lost vs still owned, LTI counts', () => {
    const s = meltSummary(all, new Set([2, 4]));
    expect(s).toMatchObject({ credit: 610, pledges: 2, lost: ['Carrack'], stillOwned: ['Cutlass Black'] });
    expect(meltSummary(all, new Set([1])).lost).toEqual(['LTI on cutlass black']);
    expect(meltSummary(all, new Set([7])).lost).toEqual(['Upgrade Aurora MR → Cutlass Black']);
  });

  it('duplicate plan melts the highest-value safe copies only', () => {
    // Cutlass ×3: keep the LTI one (1) and one more. Pledge 3 (120) is safe only if its paint survives — it doesn't.
    // So melt 2 (110). Carrack unique → keep. Aurora: 5 has the game, 6 isn't meltable → keep both. CCU skipped.
    expect(duplicatePlan(all).map((p) => p.id)).toEqual([2]);
    expect(meltSummary(all, new Set(duplicatePlan(all).map((p) => p.id))).lost).toEqual([]);
  });

  it('pledges labelled Keep are never picked', () => {
    expect(duplicatePlan(all, { never: new Set([2]) }).map((p) => p.id)).not.toContain(2);
    expect(targetPlan(all, 100, { never: new Set([2, 4]) }).picked.map((p) => p.id)).not.toContain(4);
  });

  it('$0 pledges are never picked (nothing to gain)', () => {
    expect(canMelt(all[7]!)).toBe(false);
    expect(duplicatePlan(all).map((p) => p.id)).not.toContain(8);
  });

  it('a non-LTI copy never replaces the LTI one', () => {
    const two = [pledge(1, [['Carrack', 'Ship']], { lti: true, value: 500 }), pledge(2, [['Carrack', 'Ship']], { value: 600 })];
    expect(duplicatePlan(two).map((p) => p.id)).toEqual([2]);
  });

  it('marginal loss: what one more pledge costs given the current picks', () => {
    expect(marginalLoss(all, new Set(), all[1]!)).toEqual([]); // Cutlass ×3 → a pure duplicate
    expect(marginalLoss(all, new Set([2, 3]), all[0]!)).toEqual(['LTI on cutlass black']); // the $0 copy (8) keeps the hull, LTI goes
    expect(marginalLoss(all, new Set(), all[3]!)).toEqual(['Carrack']);
    expect(marginalLoss(all, new Set(), all[2]!)).toEqual(['Cutlass - Frost Livery']);
  });

  it('target plan: duplicates first, then fewest extra losses, trimmed to the target', () => {
    // $100: the duplicate (2, $110) alone covers it, nothing lost.
    expect(targetPlan(all, 100)).toMatchObject({ reached: true, picked: [expect.objectContaining({ id: 2 })], summary: expect.objectContaining({ lost: [] }) });
    // $300: dupe (110) + the cheapest-loss pledge. Pledge 3 ($120, loses only the paint) beats Carrack ($500, loses a ship)
    // on loss count (1 each) … no: equal loss → most $ per lost item → Carrack. 110 + 500 = 610 ≥ 300 → trim: dropping
    // 2 keeps 500 ≥ 300, so the plan is just Carrack (1 item lost, $500).
    const t = targetPlan(all, 300);
    expect(t.picked.map((p) => p.id)).toEqual([4]);
    expect(t.summary.lost).toEqual(['Carrack']);
    // Unreachable: everything meltable is < $10k.
    expect(targetPlan(all, 10_000).reached).toBe(false);
    // Game packages are never candidates.
    expect(targetPlan(all, 10_000).picked.some((p) => p.hasGame)).toBe(false);
  });

  it('copies elsewhere: where each item of a melted pledge still lives', () => {
    const idx = holdersIndex(all);
    const w = copiesElsewhere(idx, new Set([2, 3]), all[2]!); // melting 2 and 3; pledge 3 = Cutlass + paint
    expect(w.map((x) => [x.title, x.in.map((p) => p.id)])).toEqual([
      ['Cutlass Black', [1, 8]], // 2 is picked too, so it doesn't count
      ['Cutlass - Frost Livery', []], // last copy
    ]);
    // One index serves every pick: nothing else picked → 2 counts again; the pledge itself never does.
    expect(copiesElsewhere(idx, new Set([3]), all[2]!)[0]!.in.map((p) => p.id)).toEqual([1, 2, 8]);
    // A pledge listing an item twice is indexed once.
    expect(holdersIndex([pledge(1, [['Mug', 'Hangar decoration'], ['Mug', 'Hangar decoration']])]).get('mug')!.map((p) => p.id)).toEqual([1]);
  });

  it('dedupe options: exclude types, never LTI', () => {
    const list = [
      pledge(1, [['Cutlass Black', 'Ship']], { value: 100 }),
      pledge(2, [['Cutlass Black', 'Ship']], { value: 100 }),
      pledge(3, [['Cutlass - Frost Livery', 'Skin']], { type: 'paint', value: 5 }),
      pledge(4, [['Cutlass - Frost Livery', 'Skin']], { type: 'paint', value: 5 }),
      pledge(5, [['Carrack', 'Ship']], { value: 500, lti: true }),
      pledge(6, [['Carrack', 'Ship']], { value: 500, lti: true }),
    ];
    expect(duplicatePlan(list).map((p) => p.id)).toEqual([5, 1, 3]);
    expect(duplicatePlan(list, { types: new Set(['paint']) }).map((p) => p.id)).toEqual([3]);
    expect(duplicatePlan(list, { keepLti: true }).map((p) => p.id)).toEqual([1, 3]);
    expect(targetPlan(list, 400, { types: new Set(['paint']) }).reached).toBe(false);
  });

  it('keep: a paint for N owned hulls isn\'t a duplicate until there are more than N', () => {
    const list = [
      pledge(1, [['Cutlass Black', 'Ship']]),
      pledge(2, [['Cutlass Red', 'Ship']]),
      pledge(3, [['Cutlass - Frost Livery', 'Skin']], { type: 'paint', value: 5 }),
      pledge(4, [['Cutlass - Frost Livery', 'Skin']], { type: 'paint', value: 5 }),
      pledge(5, [['Cutlass - Frost Livery', 'Skin']], { type: 'paint', value: 5 }),
    ];
    const keep = new Map([['cutlass - frost livery', 2]]);
    expect(duplicatePlan(list).map((p) => p.id)).toEqual([3, 4]); // without the rule: keep 1
    expect(duplicatePlan(list, { keep }).map((p) => p.id)).toEqual([3]); // with: keep 2
    expect(meltSummary(list, new Set([3, 4]), { keep }).short).toEqual(['Cutlass - Frost Livery (1 of 2 needed)']);
    expect(marginalLoss(list, new Set([3]), list[3]!, { keep })).toEqual(['Cutlass - Frost Livery']);
  });

  it('target plan stays fast on a big hangar', () => {
    const big: Pledge[] = Array.from({ length: 600 }, (_, i) =>
      pledge(i + 1, [[`Ship ${i % 150}`, 'Ship'], [`Paint ${i % 90}`, 'Skin']], { value: 50 + (i % 37) * 10, lti: i % 5 === 0 }),
    );
    const t0 = performance.now();
    const r = targetPlan(big, 20_000);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(r.reached).toBe(true);
    expect(r.summary.credit).toBeGreaterThanOrEqual(20_000);
  });
});
