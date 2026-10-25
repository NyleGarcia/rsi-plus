import { describe, expect, it } from 'vitest';
import { hangarEvents } from '../src/lib/hangar-events';
import type { Pledge } from '../src/lib/hangar';

const p = (id: number, name: string): Pledge => ({ id, name, value: 0, date: '', type: 'ship', items: [], ships: [], upgrade: null, lti: false, insurance: '', warbond: false, giftable: false, meltable: false, hasGame: false, upgraded: false, nickname: '' });

describe('hangarEvents', () => {
  it('is silent on the first load', () => {
    expect(hangarEvents([], [p(1, 'Aurora')], 1)).toEqual([]);
  });
  it('reports added and gone pledges by name', () => {
    const ev = hangarEvents([p(1, 'Aurora'), p(2, 'Mustang')], [p(1, 'Aurora'), p(3, 'Cutlass Black')], 5);
    expect(ev.map((e) => e.kind)).toEqual(['hangar', 'hangar']);
    expect(ev[0]!.title).toBe('1 new pledge in your hangar');
    expect(ev[0]!.body).toBe('Cutlass Black');
    expect(ev[1]!.body).toContain('Mustang');
    expect(ev[1]!.url).toBe('hub.html#buyback');
  });
  it('truncates long lists', () => {
    const many = Array.from({ length: 6 }, (_, i) => p(10 + i, `Ship ${i}`));
    expect(hangarEvents([p(1, 'x')], [p(1, 'x'), ...many], 1)[0]!.body).toMatch(/\+2 more$/);
  });
});
