import { describe, expect, it } from 'vitest';
import type { Pledge } from '@/lib/hangar';
import type { CatalogShip } from '@/lib/store';
import { ccuOverview, fleetValue, fundingStats, parseFunding, periodElapsed, pointLabel, shareOfFunding, paymentOf, spendByPayment, spendByMonth, spendByType, spendByYear, spendSummary } from '@/lib/wallet';

const pledge = (id: number, value: number, date: string, type: Pledge['type'] = 'ship', warbond = false): Pledge => ({
  id,
  name: `P${id}`,
  value,
  date,
  type,
  items: [],
  ships: [],
  upgrade: null,
  lti: false,
  insurance: '',
  warbond,
  giftable: false,
  meltable: true,
  hasGame: false,
  upgraded: false,
  nickname: '',
});

const hangar = [
  pledge(1, 55, 'October 01, 2014', 'package'),
  pledge(2, 110, 'March 12, 2022'),
  pledge(3, 20.5, 'March 30, 2022', 'paint', true),
  pledge(4, 300, 'January 05, 2026'),
  pledge(5, 10, 'not a date', 'gear'),
];

describe('funding stats', () => {
  it('parses the crowdfund API body (cents → USD, sorted by key, labelled per range)', () => {
    const raw = {
      success: 1,
      data: {
        chart: { '2026-09': { gross: '815602371', axis: '09' }, '2026-03': { gross: '966380208', axis: '03' } },
        fans: 6733323,
        funds: 105089660982,
      },
    };
    const f = parseFunding(raw, 'month', 5);
    expect(f.at).toBe(5);
    expect(f.funds).toBe(1050896609.82);
    expect(f.fans).toBe(6733323);
    expect(f.points.map((p) => p.key)).toEqual(['2026-03', '2026-09']);
    expect(f.points[0]).toEqual({ key: '2026-03', label: 'Mar', usd: 9663802.08 });
  });

  it('labels days, weeks and months', () => {
    expect(pointLabel('2026-10-03', 'day')).toBe('03');
    expect(pointLabel('2026-40', 'week')).toBe('W40');
    expect(pointLabel('2026-10', 'month')).toBe('Oct');
  });

  it('throws on an API error body', () => {
    expect(() => parseFunding({ success: 0, msg: 'Invalid parameter' }, 'day')).toThrow(/Invalid parameter/);
  });

  it('share of funding is a tiny percentage', () => {
    expect(shareOfFunding(22053, 1050896609.82)).toBeCloseTo(0.0020985, 6);
    expect(shareOfFunding(100, 0)).toBe(0);
  });
});

describe('personal spend', () => {
  it('buckets melt value by year, unknown dates under "?"', () => {
    expect(spendByYear(hangar)).toEqual([
      { key: '2014', label: '2014', value: 55, count: 1 },
      { key: '2022', label: '2022', value: 130.5, count: 2 },
      { key: '2026', label: '2026', value: 300, count: 1 },
      { key: '?', label: '?', value: 10, count: 1 },
    ]);
  });

  it('buckets by month with every month present, newest last', () => {
    const m = spendByMonth(hangar, 3, new Date(2026, 1, 15)); // Dec 25, Jan 26, Feb 26
    expect(m.map((b) => b.key)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(m[1]).toEqual({ key: '2026-01', label: 'Jan', value: 300, count: 1 });
    expect(m[0]!.value).toBe(0);
  });

  it('buckets by type (largest first) and by warbond', () => {
    expect(spendByType(hangar).map((b) => [b.key, b.value])).toEqual([
      ['ship', 410],
      ['package', 55],
      ['paint', 20.5],
      ['gear', 10],
    ]);
    expect(spendByPayment(hangar)).toEqual([
      { key: 'warbond', label: 'Warbond', value: 20.5, count: 1 },
      { key: 'standard', label: 'Standard', value: 475, count: 4 },
    ]);
  });

  it('splits by what a pledge needed: warbond, standard, free — the melt currency is ignored', () => {
    const p = (value: number, paidWith?: 'cash' | 'credit', warbond = false): Pledge => ({ ...pledge(1, value, 'May 01, 2024', 'ship', warbond), ...(paidWith ? { paidWith } : {}) });
    expect([p(50, 'credit', true), p(50, 'credit'), p(50, 'cash'), p(0, 'credit'), p(50)].map(paymentOf)).toEqual(['warbond', 'standard', 'standard', 'free', 'standard']);
    expect(spendByPayment([p(0), p(30, 'credit'), p(10, 'credit', true)]).map((b) => [b.key, b.value, b.count])).toEqual([
      ['warbond', 10, 1],
      ['standard', 30, 1],
      ['free', 0, 1],
    ]);
  });

  it('summarises: total, warbond, since, years, per year', () => {
    const s = spendSummary(hangar, Date.parse('October 01, 2026'));
    expect(s.value).toBe(495.5);
    expect(s.pledges).toBe(5);
    expect(s.warbond).toBe(20.5);
    expect(new Date(s.since!).getFullYear()).toBe(2014);
    expect(s.years).toBe(12);
    expect(s.perYear).toBeCloseTo(41.29, 2);
    expect(spendSummary([]).since).toBeNull();
    expect(spendSummary([]).perYear).toBe(0);
  });
});

const ship = (id: number, name: string, msrp: number): CatalogShip => ({ id, name, manufacturer: '', focus: '', msrp, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
const cat = [ship(1, 'Aurora MR', 3000), ship(2, 'Cutlass Black', 12000), ship(3, 'Carrack', 60000)];

describe('fleet value', () => {
  it('matches single-ship pledges to today\'s MSRP, counts packs', () => {
    const f = fleetValue(
      [
        { ...pledge(1, 25, 'x'), ships: ['Aurora MR'] },
        { ...pledge(2, 100, 'x'), ships: ['Cutlass Black - LTI'] },
        { ...pledge(3, 500, 'x'), ships: ['Aurora MR', 'Carrack'] },
        { ...pledge(4, 10, 'x', 'paint'), ships: [] },
        { ...pledge(5, 10, 'x'), ships: ['Unknown Ship'] },
      ],
      cat,
    );
    expect(f.rows.map((r) => [r.ship, r.paid, r.msrp])).toEqual([
      ['Cutlass Black', 100, 120],
      ['Aurora MR', 25, 30],
    ]);
    expect(f).toMatchObject({ paid: 125, msrp: 150, packs: 1 });
  });
});

describe('ccu overview', () => {
  it('values hangar CCUs at today\'s msrp difference; gifted ones have no gain', () => {
    const o = ccuOverview(
      [
        { fromId: 1, toId: 2, ref: 1, source: 'hangar', value: 7000, gifted: false },
        { fromId: 2, toId: 3, ref: 2, source: 'hangar', value: 50000, gifted: false },
        { fromId: 1, toId: 3, ref: 3, source: 'hangar', value: 0, gifted: true },
        { fromId: 1, toId: 2, ref: 4, source: 'buyback', value: 0, gifted: false },
      ],
      cat,
    );
    expect(o.rows.map((r) => [r.ref, r.worth, r.gain])).toEqual([
      [1, 90, 20],
      [3, 570, 0],
      [2, 480, -20],
    ]);
    expect(o).toMatchObject({ count: 3, paid: 570, worth: 1140, gain: 0, winners: 1, gifted: 1 });
  });
});

describe('funding extras', () => {
  it('elapsed fraction of day / week / month', () => {
    const noon = new Date(2026, 9, 14, 12, 0); // Wed 14 Oct 2026
    expect(periodElapsed('day', noon)).toBeCloseTo(0.5);
    expect(periodElapsed('week', noon)).toBeCloseTo(2.5 / 7);
    expect(periodElapsed('month', noon)).toBeCloseTo(13.5 / 31);
  });
  it('average + best over completed periods, projection of the running one', () => {
    const f = parseFunding(
      { success: 1, data: { funds: 0, chart: { '2026-07': { gross: 100000 }, '2026-08': { gross: 300000 }, '2026-09': { gross: 200000 }, '2026-10': { gross: 100000 } } } },
      'month',
    );
    const s = fundingStats(f, new Date(2026, 9, 16, 12, 0)); // half of October
    expect(s.average).toBe(2000);
    expect(s.best?.key).toBe('2026-08');
    expect(s.projected).toBe(2000);
  });
});

import { spendLedger } from '@/lib/wallet';
describe('spendLedger', () => {
  const p = (o: Partial<Pledge>): Pledge => ({ id: 1, name: 'x', value: 0, date: '', type: 'ship', items: [], ships: [], upgrade: null, lti: false, insurance: '', warbond: false, giftable: false, meltable: false, hasGame: false, upgraded: false, nickname: '', ...o });
  it('splits new money, cash-or-credit, gifts, free and melted credit', () => {
    const l = spendLedger(
      [p({ value: 100, warbond: true }), p({ value: 50 }), p({ value: 25, configValue: 5 }), p({ value: 0 }), p({ value: 0, type: 'other' })],
      [{ price: 2000, type: 'ship' }, { type: 'ship' }],
    );
    expect(l.newMoney).toBe(100);
    expect(l.either).toBe(75);
    expect(l.custom).toBe(5);
    expect(l.gifted).toBe(1);
    expect(l.free).toBe(1);
    expect(l.melted).toBe(20);
    expect(l.meltedUnknown).toBe(1);
    expect(l.cashMin).toBe(160); // 100 + 5 + (75 − 20)
    expect(l.cashMax).toBe(180);
  });
});
