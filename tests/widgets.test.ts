import { describe, expect, it } from 'vitest';
import { mergeLayout, placeWidgets, type WidgetItem } from '@/lib/widgets';

const W = (id: string, size: WidgetItem['size']): WidgetItem => ({ id, size });
const LAYOUT = [W('year', 'wide'), W('month', 'wide'), W('payment', 'wide'), W('type', 'wide'), W('time', 'wide'), W('facts', 'sm'), W('actions', 'sm')];
/** Every cell of the bounding rectangle covered exactly once. */
const gapless = (items: WidgetItem[], cols: number) => {
  const ps = placeWidgets(items, cols);
  const rows = Math.max(...ps.map((p) => p.row + p.h));
  const seen = new Map<string, number>();
  for (const p of ps) for (let r = p.row; r < p.row + p.h; r++) for (let c = p.col; c < p.col + p.w; c++) seen.set(`${r},${c}`, (seen.get(`${r},${c}`) ?? 0) + 1);
  return seen.size === rows * cols && [...seen.values()].every((n) => n === 1) && ps.every((p) => p.col + p.w <= cols);
};

describe('widget grid', () => {
  it('places densely in order and leaves no holes at any width', () => {
    expect(placeWidgets(LAYOUT, 4).slice(0, 2)).toEqual([
      { id: 'year', col: 0, row: 0, w: 2, h: 1 },
      { id: 'month', col: 2, row: 0, w: 2, h: 1 },
    ]);
    for (const cols of [1, 2, 3, 4, 5]) expect(gapless(LAYOUT, cols)).toBe(true);
    expect(gapless([W('a', 'lg'), W('b', 'sm'), W('c', 'tall'), W('d', 'wide')], 3)).toBe(true);
    // One column: wide widgets clamp to one cell.
    expect(placeWidgets([W('a', 'lg')], 1)).toEqual([{ id: 'a', col: 0, row: 0, w: 1, h: 2 }]);
  });

  it('merges a saved layout onto the defaults', () => {
    expect(mergeLayout([{ id: 'facts', size: 'lg' }, { id: 'gone', size: 'sm' }, { id: 'year', size: 'bogus' }], LAYOUT).slice(0, 3)).toEqual([W('facts', 'lg'), W('year', 'wide'), W('month', 'wide')]);
    expect(mergeLayout(null, LAYOUT)).toEqual(LAYOUT);
    expect(mergeLayout({ 0: 'x' }, LAYOUT)).toHaveLength(LAYOUT.length);
  });
});
