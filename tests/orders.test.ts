// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kindOf, lastPage, orderTotals, parseOrderDate, parseOrders } from '@/lib/orders';

const doc = () => new DOMParser().parseFromString(readFileSync('tests/fixtures/billing.html', 'utf8'), 'text/html');

describe('orders', () => {
  it('classifies by what was charged', () => {
    const base = { status: 'CLOSED', payment: 'PAID', items: 10 };
    expect(kindOf({ ...base, total: 10, credits: 0 })).toBe('cash');
    expect(kindOf({ ...base, total: 0, credits: 10 })).toBe('credit');
    expect(kindOf({ ...base, total: 4, credits: 6 })).toBe('mixed');
    expect(kindOf({ ...base, items: 0, total: 0, credits: 0 })).toBe('free');
    expect(kindOf({ ...base, status: 'REFUNDED', total: 10, credits: 0 })).toBe('refund');
    expect(kindOf({ ...base, status: 'CANCELLED', total: 0, credits: 0 })).toBe('cancelled');
  });
  it('parses RSI dates', () => {
    expect(new Date(parseOrderDate('Order Placed: October 22, 2026 02:10')).getMonth()).toBe(9);
    expect(new Date(parseOrderDate(' March 3, 2024 10:00 ')).getFullYear()).toBe(2024);
    expect(parseOrderDate('nope')).toBeNaN();
  });
  it('reads the orders list: ids, totals, credits, lines, storefront', () => {
    const o = parseOrders(doc());
    expect(o.map((x) => x.id)).toEqual(['PSM8D0S8R9VJI', 'E3T3FALMBTZGG', 'GIFT00000001']);
    const paints = o[0]!;
    expect(paints).toMatchObject({ items: 33.15, credits: 33.15, total: 0, discount: 0, status: 'CLOSED', payment: 'PAID', fulfillment: 'DONE', storefront: 'pledge', kind: 'credit' });
    expect(paints.lines).toEqual([
      { title: 'Paints - Polaris - Black Magic Paint', price: 22, qty: 2, discount: 15.4, total: 28.6 },
      { title: 'Paints - Wolf - Lycan Paint', price: 7, qty: 1, discount: 2.45, total: 4.55 },
    ]);
    expect(o[1]).toMatchObject({ items: 200, credits: 50, total: 150, kind: 'mixed' });
    expect(o[1]!.lines[0]!.discount).toBe(0);
    expect(o[2]!.kind).toBe('free');
  });
  it('never keeps the bill-to block', () => {
    expect(JSON.stringify(parseOrders(doc()))).not.toMatch(/Someone|Street/);
  });
  it('finds the last page from the pager', () => {
    expect(lastPage(doc())).toBe(16);
    expect(lastPage(new DOMParser().parseFromString('<ul class="orders-item"></ul>', 'text/html'))).toBe(1);
  });
  it('totals cash, credit, discounts and years', () => {
    const t = orderTotals(parseOrders(doc()));
    expect(t.cash).toBe(150);
    expect(t.credits).toBeCloseTo(83.15);
    expect(t.discounts).toBeCloseTo(17.85);
    expect(t.items).toBeCloseTo(233.15);
    expect(t.free).toBe(1);
    expect(t.count).toBe(3);
    expect(t.byYear.map((y) => [y.year, y.cash, y.orders])).toEqual([[2026, 0, 1], [2025, 150, 1], [2024, 0, 1]]);
  });
});

import { orderSlices, ordersByMonth, ordersByYear, ordersCumulative } from '@/lib/orders';
describe('order charts', () => {
  const o = parseOrders(doc());
  it('buckets by year and month', () => {
    expect(ordersByYear(o).map((b) => [b.key, b.cash, b.credits, b.count])).toEqual([['2024', 0, 0, 1], ['2025', 150, 50, 1], ['2026', 0, 33.15, 1]]);
    const m = ordersByMonth(o, 3, new Date(2026, 9, 30));
    expect(m.map((b) => b.key)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(m[2]).toMatchObject({ label: 'Oct', cash: 0, credits: 33.15, count: 1 });
  });
  it('runs the cash total up from the first order', () => {
    const c = ordersCumulative(o, new Date(2026, 9, 30));
    expect(c[0]!.key).toBe('2024-03');
    expect(c.at(-1)).toMatchObject({ key: '2026-10', value: 150 });
  });
  it('slices cash vs credit', () => {
    expect(orderSlices(o)).toEqual([
      { key: 'cash', label: 'cash', value: 150, count: 1 },
      { key: 'credit', label: 'store credit', value: 83.15, count: 2 },
    ]);
  });
});

import { clubSpend, parseSubPayments } from '@/lib/orders';
import { clubFromSpend } from '@/lib/concierge';
describe("Chairman's Club from the order history", () => {
  it('reads subscription payments', () => {
    const subs = parseSubPayments(doc());
    expect(subs.map((x) => [new Date(x.at).getFullYear(), x.amount, x.status])).toEqual([[2024, 220, 'Paid'], [2025, 220, 'Paid'], [2026, 220, 'Failed']]);
  });
  it('counts cash on orders plus paid subscriptions', () => {
    const s = clubSpend(parseOrders(doc()), parseSubPayments(doc()));
    expect(s).toEqual({ orders: 150, subs: 440, refunds: 0, total: 590 });
  });
  it('places a spend on the ladder', () => {
    expect(clubFromSpend(590)).toEqual({ level: null, next: 'High Admiral', toGo: 410, pct: 59 });
    expect(clubFromSpend(16_234.5)).toEqual({ level: 'Praetorian', next: 'Legatus Navium', toGo: 8765.5, pct: 12.3 });
    expect(clubFromSpend(30_000)).toEqual({ level: 'Legatus Navium', next: null, toGo: null, pct: null });
  });
});

import { warbondInOrders } from '@/lib/orders';
it('sums warbond lines', () => {
  expect(warbondInOrders(parseOrders(doc()))).toEqual({ usd: 200, lines: 1 });
});

describe('order rows that are not the happy path', () => {
  const row = (inner: string) => new DOMParser().parseFromString(`<ul class="orders-item"><li><div class="row dark pledge">${inner}</div></li></ul>`, 'text/html');
  const infos = (amount: string, status = 'CLOSED') =>
    `<div class="basic-infos"><div class="col date"><span>Order Placed:</span> May 1, 2025 10:00</div><div class="col amount"><span>Amount:</span> ${amount}</div><div class="col"><span>Order Id:</span> X1</div><div class="col"><span>Status:</span> ${status}</div><div class="col"><span>Payment:</span> PAID</div></div>`;
  it('falls back to the Amount column when the totals block is missing', () => {
    const o = parseOrders(row(infos('$12.00 USD')))[0]!;
    expect(o).toMatchObject({ id: 'X1', total: 12, credits: 0, items: 0, lines: [], kind: 'cash', fulfillment: '' });
  });
  it('keeps the sign on refunds and classifies them', () => {
    const o = parseOrders(row(infos('-$12.00 USD', 'REFUNDED')))[0]!;
    expect(o.total).toBe(-12);
    expect(o.kind).toBe('refund');
  });
  it('tolerates a non-numeric qty and a line without a discount', () => {
    const o = parseOrders(row(infos('$0.00 USD') + '<table class="billing-summary"><tr><td>Thing</td><td>$3.00 USD</td><td>x</td><td></td><td>$3.00 USD</td></tr></table>'))[0]!;
    expect(o.lines).toEqual([{ title: 'Thing', price: 3, qty: 1, discount: 0, total: 3 }]);
    expect(o.items).toBe(3);
  });
  it('skips rows without an id or a date', () => {
    expect(parseOrders(row('<div class="basic-infos"><div class="col"><span>Order Id:</span> X2</div></div>'))).toEqual([]);
  });
});
