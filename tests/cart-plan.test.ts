import { describe, expect, it } from 'vitest';
import { cartLineStatus, cartQtys, cartShortfall } from '@/lib/cart';

// Paint rebuy re-adding a plan after a tab switch doubled every line on RSI (its `add` stacks): the cart read back decides.
describe('cart plan vs RSI cart', () => {
  const plan = [
    { skuId: 1, qty: 1 },
    { skuId: 2, qty: 2 },
    { skuId: 3, qty: 1 },
  ];

  it('adds nothing when the cart already holds the plan', () => {
    expect(
      cartShortfall(plan, [
        { skuId: 1, qty: 1 },
        { skuId: 2, qty: 2 },
        { skuId: 3, qty: 1 },
      ]),
    ).toEqual([]);
  });

  it('adds only what is short per SKU', () => {
    expect(
      cartShortfall(plan, [
        { skuId: 2, qty: 1 },
        { skuId: 3, qty: 4 },
        { skuId: 9, qty: 1 },
      ]),
    ).toEqual([
      { skuId: 1, qty: 1 },
      { skuId: 2, qty: 1 },
    ]);
  });

  it('adds the whole plan to an empty cart', () => {
    expect(cartShortfall(plan, [])).toEqual(plan);
  });

  it('sums a SKU spread over several lines', () => {
    expect(
      cartQtys([
        { skuId: 2, qty: 1 },
        { skuId: 2, qty: 1 },
      ]).get(2),
    ).toBe(2);
    expect(
      cartShortfall(plan, [
        { skuId: 2, qty: 1 },
        { skuId: 2, qty: 1 },
        { skuId: 1, qty: 1 },
        { skuId: 3, qty: 1 },
      ]),
    ).toEqual([]);
  });

  it('flags more copies than planned instead of passing them', () => {
    expect(cartLineStatus(1, 2)).toBe('over');
    expect(cartLineStatus(2, 1)).toBe('missing');
    expect(cartLineStatus(2, 2)).toBe('ok');
  });
});
