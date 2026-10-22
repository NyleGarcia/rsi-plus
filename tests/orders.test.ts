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
