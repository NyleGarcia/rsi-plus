// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { kindOf, orderTotals, parseOrders } from '@/lib/orders';
describe('orders', () => {
  it('classifies payment words', () => {
    expect(kindOf('Store Credit', 10)).toBe('credit');
    expect(kindOf('PayPal', 10)).toBe('cash');
    expect(kindOf('Gift', 0)).toBe('gift');
    expect(kindOf('Credit Card', -10)).toBe('refund');
    expect(kindOf('', 10)).toBe('unknown');
  });
  it('reads date + amount rows and totals them', () => {
    const doc = new DOMParser().parseFromString('<table><tr><td>Order #AB12345</td><td>March 3, 2026</td><td>$45.00</td><td>PayPal</td></tr><tr><td>Order #CD67890</td><td>2026-01-10</td><td>$10.00</td><td>Store Credit</td></tr><tr><td>header</td></tr></table>', 'text/html');
    const o = parseOrders(doc);
    expect(o.map((x) => [x.id, x.kind, x.total])).toEqual([['AB12345', 'cash', 45], ['CD67890', 'credit', 10]]);
    const t = orderTotals(o);
    expect(t.cash).toBe(45);
    expect(t.credit).toBe(10);
    expect(t.byYear[0]!.year).toBe(2026);
  });
});
