// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyView, market } from '@/lib/market-dom';
import type { ImpRow } from '@/lib/impound';
import { NO_IMP_FILTER } from '@/lib/impound';

/** Bare rows: only what filter + sort read. */
const row = (handle: string, price: number) =>
  ({ product: { handle, title: handle, type: '', vendor: '', tags: [], variants: [] }, variant: { price }, kind: 'ship', markup: null, rsi: { cents: null }, own: {}, info: {} }) as unknown as ImpRow;

function grid(prices: number[]) {
  document.body.innerHTML = '<ol></ol>';
  const ol = document.querySelector('ol')!;
  const rows = new Map<HTMLElement, ImpRow>();
  prices.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = String(p);
    ol.append(li);
    rows.set(li, row(`h${i}`, p));
  });
  return { ol, rows, order: () => [...ol.children].map((c) => Number(c.textContent)) };
}

describe('applyView ordering', () => {
  it('sorts every card, including the one that was first', () => {
    market.view = { f: { ...NO_IMP_FILTER }, sort: 'price', dimOwned: true };
    const g = grid([50, 10, 40, 20]);
    applyView(g.rows);
    expect(g.order()).toEqual([10, 20, 40, 50]);
    market.view.sort = 'price-desc';
    applyView(g.rows);
    expect(g.order()).toEqual([50, 40, 20, 10]);
  });
  it('Store order puts the cards back', () => {
    market.view = { f: { ...NO_IMP_FILTER }, sort: 'price', dimOwned: true };
    const g = grid([30, 10, 20]);
    applyView(g.rows);
    market.view.sort = 'store';
    applyView(g.rows);
    expect(g.order()).toEqual([30, 10, 20]);
  });
});
