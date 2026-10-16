import { describe, expect, it } from 'vitest';
import { allLabels, hasLabel, idsWith, setLabel } from '@/lib/labels';

describe('labels', () => {
  it('adds, removes, matches case-insensitively and keeps the first spelling', () => {
    let l = setLabel({}, [1, 2], 'lti token', true);
    expect(l).toEqual({ 1: ['LTI token'], 2: ['LTI token'] }); // preset spelling wins
    l = setLabel(l, [3], 'My Flyer', true);
    l = setLabel(l, [1], 'my flyer', true);
    expect(l[1]).toEqual(['LTI token', 'My Flyer']);
    expect(hasLabel(l, 1, 'MY FLYER')).toBe(true);
    expect([...idsWith(l, ['ccu fodder', 'LTI Token'])].sort()).toEqual([1, 2]);
    expect(allLabels(l)).toEqual([{ name: 'LTI token', count: 2 }, { name: 'My Flyer', count: 2 }]);
    l = setLabel(l, [2], 'LTI TOKEN', false);
    expect(l[2]).toBeUndefined(); // empty list dropped
    expect(setLabel(l, [1], '   ', true)).toBe(l);
  });
});
