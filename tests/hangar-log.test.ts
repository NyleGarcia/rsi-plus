import { describe, expect, it } from 'vitest';
import { consumedUpgrades, parseHangarLog, upgradeHulls } from '@/lib/hangar-log';
import { DEFAULT_PLAN_OPTIONS, goneRefs, planChains, reconcileApplied, reconcileByTarget, type AppliedUpgrade, type SavedChain, type Step } from '@/lib/ccu';
import type { CatalogShip } from '@/lib/store';

// The wording of RSI's log (Nov 2026); the markup around it is a guess on purpose — the parser reads the text.
const row = (date: string, name: string, id: number, rest: string) => `<div class="row"><span class="date">${date}</span> - <a href="/account/pledges?x=${id}">${name}</a> #${id} - ${rest}</div>`;
const HTML = [
  row('Nov 14 2026, 6:33 pm', 'Upgrade - Pulse to Meteor Warbond Edition', 115341930, 'Consumed by Someone on pledge #103546693, value: $210.00 USD'),
  row('Nov 14 2026, 6:33 pm', 'Standalone Ships - Pulse plus Dominion Paint', 103546693, 'Upgrade applied: #115341930 Upgrade - Pulse to Meteor Warbond Edition, new value: $235.00 USD'),
  row('Nov 14 2026, 6:30 pm', 'Upgrade - Galaxy to Arrastra Standard Edition', 115341159, 'Consumed by Someone on pledge #102519192, value: $175.00 USD'),
  row('Nov 2 2026, 11:05 am', 'Upgrade - A &amp; B to C', 99, 'Reclaimed by Someone for $1,015.50 USD'),
  row('Nov 1 2026, 9:00 am', 'Upgrade - Galaxy to 600i Touring Warbond Edition', 77, 'Created by Someone - order #3N5AR50MF67D8, value: $10.00 USD'),
  '<div class="row">not a log row</div>',
].join('\n');

describe('hangar log', () => {
  it('reads applied and consumed rows from the text, whatever the markup', () => {
    const log = parseHangarLog(HTML);
    expect(log).toHaveLength(5);
    expect(log[4]).toMatchObject({ kind: 'created', order: '3N5AR50MF67D8', value: 1000 });
    expect(log[0]).toMatchObject({ name: 'Upgrade - Pulse to Meteor Warbond Edition', id: 115341930, kind: 'consumed', pledgeId: 103546693, upgradeId: 115341930, value: 21000 });
    expect(log[1]).toMatchObject({ name: 'Standalone Ships - Pulse plus Dominion Paint', id: 103546693, kind: 'applied', upgradeId: 115341930, pledgeId: 103546693, value: 23500 });
    expect(log[3]).toMatchObject({ name: 'Upgrade - A & B to C', id: 99, kind: 'reclaimed' });
    expect(new Date(log[0]!.at).getHours()).toBe(18);
    expect(new Date(log[3]!.at).getDate()).toBe(2);
    expect(parseHangarLog('')).toEqual([]);
    // RSI's real markup (Nov 2026): <div class="pledge-log-entry"><p>date - <span class="important">name</span> #id - …</p></div>
    const real = '<div class="pledge-log-entry"> <p>Nov 14 2026, 6:30 pm - <span class="important">Upgrade - Galaxy to Arrastra Standard Edition</span> #115341159 - Consumed by Someone on pledge #102519192, value: $175.00 USD</p> </div>';
    expect(parseHangarLog(real)[0]).toMatchObject({ kind: 'consumed', id: 115341159, pledgeId: 102519192, value: 17500 });
    expect(upgradeHulls('Upgrade - Galaxy to 600i Touring Warbond Edition')).toEqual(['Galaxy', '600i Touring']);
    expect(upgradeHulls('Upgrade - Constellation Mk V Centaurus to Galaxy Standard Edition')).toEqual(['Constellation Mk V Centaurus', 'Galaxy']);
    expect(upgradeHulls('Upgrade - Aurora ES to Mantis Standard Upgrade')).toEqual(['Aurora ES', 'Mantis']);
    expect(upgradeHulls('Paints - Galaxy - Magnitude Paint')).toBeNull();
    const used = consumedUpgrades(log);
    expect([...used.keys()]).toEqual([115341930, 115341159]);
    expect(used.get(115341159)).toMatchObject({ pledgeId: 102519192, value: 17500 });
  });
});

describe('a chain applied in the hangar', () => {
  const ship = (id: number, msrp: number): CatalogShip => ({ id, name: `S${id}`, manufacturer: '', focus: '', msrp, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
  const owned = (fromId: number, toId: number, ref: number): Step => ({ fromId, toId, kind: 'owned', cost: 0, cash: 0, paid: 0, label: '', ref });
  const chain = (extra: Partial<SavedChain>): SavedChain => ({ id: 'c', name: 'c', at: 0, startId: 1, targetId: 4, steps: [owned(1, 2, 11), owned(2, 3, 12), owned(3, 4, 13)], total: 0, cash: 0, opt: { ...DEFAULT_PLAN_OPTIONS, include: [12], exclude: [] }, ...extra });
  const hit = (pledgeId: number, at: number, value: number) => ({ pledgeId, at, value });

  it('CCUs gone from the hangar are looked up; one in the hangar, or already recorded, is not', () => {
    const c = chain({});
    expect(goneRefs([c], new Set([11, 12, 13]))).toEqual([]);
    expect(goneRefs([c], new Set([13])).sort()).toEqual([11, 12]);
    expect(goneRefs([chain({ applied: [{ ref: 11, fromId: 1, toId: 2, pledgeId: 5, at: 1, value: 1 }] })], new Set([13]))).toEqual([12]);
    expect(goneRefs([chain({ done: { at: 1, pledgeId: 5, spent: 0 } })], new Set())).toEqual([]);
  });

  it('every CCU applied, the last one reaching the target: the chain is done and holds nothing', () => {
    const list = [chain({})];
    const out = reconcileApplied(list, new Map([[11, hit(500, 10, 1000)], [12, hit(500, 20, 2000)], [13, hit(500, 30, 3000)]]));
    expect(out[0]!.done).toEqual({ at: 30, pledgeId: 500, spent: 6000 });
    expect(out[0]!.steps).toEqual([]);
    expect(out[0]!.applied!.map((a) => a.ref)).toEqual([11, 12, 13]);
    expect(out[0]!.opt.include).toEqual([]); // the forced CCU is used up
    expect(reconcileApplied(out, new Map())).toBe(out);
  });

  it('applied part-way: the chain carries on from the hull the pledge became, not from the start', () => {
    const auto = chain({ auto: true });
    const out = reconcileApplied([auto], new Map([[11, hit(500, 10, 1000)], [12, hit(500, 20, 2000)]]));
    expect(out[0]).toMatchObject({ startId: 3, auto: false });
    expect(out[0]!.done).toBeUndefined();
    // planned again: one step left, from the hull reached, with the CCU still in the hangar
    const ships = [ship(1, 1000), ship(2, 2000), ship(3, 3000), ship(4, 4000)];
    const f = planChains(ships, [{ fromId: 3, toId: 4, ref: 13, source: 'hangar', value: 0, gifted: true }], out, { hulls: [{ id: 3, count: 1 }] });
    expect(f.legs[0]!.plan!.steps.map((s) => [s.fromId, s.toId, s.kind])).toEqual([[3, 4, 'owned']]);
    // then the last one: done, with everything it used
    const end = reconcileApplied([{ ...out[0]!, steps: f.legs[0]!.plan!.steps }], new Map([[13, hit(500, 30, 3000)]]));
    expect(end[0]!.done).toMatchObject({ pledgeId: 500, spent: 6000 });
  });

  it('a CCU that is gone but was not applied (melted, gifted) changes nothing', () => {
    const list = [chain({})];
    expect(reconcileApplied(list, new Map())).toBe(list);
    expect(reconcileApplied(list, new Map([[999, hit(1, 1, 1)]]))).toBe(list);
  });

  it('Check hangar log: a chain whose CCUs were never recorded is closed by an upgrade to its target, with everything applied on that pledge', () => {
    const up = (id: number, fromId: number, toId: number, at: number, value: number, pledgeId = 500): AppliedUpgrade => ({ id, fromId, toId, pledgeId, at, value });
    const DAY = 86_400_000;
    const c = chain({ at: 10 * DAY, steps: [], opt: { ...DEFAULT_PLAN_OPTIONS, include: [], exclude: [] } });
    const log = [up(13, 3, 4, 10 * DAY + 30, 3000), up(12, 2, 3, 10 * DAY + 20, 2000), up(11, 1, 2, 10 * DAY + 10, 1000), up(5, 1, 2, 2 * DAY, 900), up(8, 3, 4, 10 * DAY + 5, 1, 777)];
    const out = reconcileByTarget([c], log);
    expect(out[0]!.done).toEqual({ at: 10 * DAY + 30, pledgeId: 500, spent: 6000 }); // the newest upgrade to the target; the old one on the pledge is not counted
    expect(out[0]!.applied!.map((a) => a.ref)).toEqual([11, 12, 13]);
    // two chains to the same ship: one pledge each, in list order
    const two = reconcileByTarget([c, { ...c, id: 'd' }], log);
    expect(two.map((x) => x.done?.pledgeId)).toEqual([500, 777]);
    // nothing to that ship since the chain was added, or a chain with its own record: untouched
    const none = [chain({ at: 20 * DAY, steps: [] })];
    expect(reconcileByTarget(none, log)).toBe(none);
    const rec = [chain({ at: 10 * DAY, applied: [{ ref: 11, fromId: 1, toId: 2, pledgeId: 500, at: 1, value: 1 }] })];
    expect(reconcileByTarget(rec, log)).toBe(rec);
  });
});
