import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_OPTIONS, STORE_START } from '@/lib/ccu';
import { decodeCcuLink, encodeCcuLink, linkToPlanner } from '@/lib/ccu-link';

describe('ccu link', () => {
  it('round-trips a route with its options', () => {
    const opt = { ...DEFAULT_PLAN_OPTIONS, objective: 'cash' as const, steps: 'more' as const, buyback: true, warbond: false, planAhead: true };
    const h = encodeCcuLink({ from: 12, to: 40, via: [20, 30], opt });
    expect(h).toBe('#ccu?from=12&to=40&via=20,30&obj=cash&steps=more&warbond=0&buyback=1&stock=1&credit=1&gifted=0&ahead=1');
    expect(decodeCcuLink(h)).toEqual({
      from: 12,
      to: 40,
      via: [20, 30],
      objective: 'cash',
      steps: 'more',
      flags: { warbond: false, buyback: true, inStockOnly: true, storeCredit: true, excludeGifted: false, planAhead: true },
    });
  });

  it('store start, no source, no stops', () => {
    expect(decodeCcuLink(encodeCcuLink({ from: STORE_START, to: 5, opt: DEFAULT_PLAN_OPTIONS }))).toMatchObject({ from: STORE_START, to: 5, steps: 'fewer' });
    const h = encodeCcuLink({ from: null, to: 5, via: [], opt: DEFAULT_PLAN_OPTIONS });
    expect(h).not.toContain('from=');
    expect(h).not.toContain('via=');
    expect(decodeCcuLink(h)!.from).toBeUndefined();
  });

  it('never carries per-account options', () => {
    const h = encodeCcuLink({ from: 1, to: 2, opt: { ...DEFAULT_PLAN_OPTIONS, include: [7], exclude: [8], skip: [9] } as never });
    expect(h).not.toMatch(/include|exclude|skip|=7|=8|=9/);
  });

  it('the old #ccu?to= links still work', () => {
    expect(decodeCcuLink('#ccu?to=42')).toEqual({ to: 42, flags: {} });
    expect(decodeCcuLink('#ccu?to=42&ahead=1')).toEqual({ to: 42, flags: { planAhead: true } });
    expect(decodeCcuLink('#ccu')).toEqual({ flags: {} });
  });

  it('is tolerant of garbage and ignores other pages', () => {
    expect(decodeCcuLink('#store?to=42')).toBeNull();
    expect(decodeCcuLink('')).toBeNull();
    expect(decodeCcuLink('#ccu?from=abc&to=-3&via=1,x,,2,1,0,1.5&obj=cheap&steps=lots&warbond=maybe&credit=true&%zz')).toEqual({ via: [1, 2], flags: { storeCredit: true } });
    expect(decodeCcuLink('#ccu?to=99999999999999999999')).toEqual({ flags: {} });
  });
});

describe('linkToPlanner', () => {
  const has = (id: number) => [1, 2, 3, 4].includes(id);
  const owns = (id: number) => id === 1;
  it('maps the link onto the planner, dropping unknown hulls', () => {
    expect(linkToPlanner(decodeCcuLink('#ccu?from=1&to=4&via=2,99&obj=longterm&steps=more&buyback=1')!, has, owns)).toEqual({
      mode: 'hangar',
      fromId: 1,
      toId: 4,
      opt: { via: [2], objective: 'longterm', steps: 'more', buyback: true },
    });
    expect(linkToPlanner(decodeCcuLink('#ccu?from=2&to=77')!, has, owns)).toEqual({ mode: 'any', fromId: 2, opt: {} });
    expect(linkToPlanner(decodeCcuLink('#ccu?from=store&to=3')!, has, owns)).toEqual({ mode: 'store', fromId: null, toId: 3, opt: {} });
    expect(linkToPlanner(decodeCcuLink('#ccu?from=55')!, has, owns)).toEqual({ opt: {} });
  });
});
