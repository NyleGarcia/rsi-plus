import { describe, expect, it } from 'vitest';
import { allLabels, cleanLabels, hasLabel, idsWith, setLabel } from '@/lib/labels';

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

  it('repairs label lists stored as objects (a reactive proxy saved to chrome.storage)', () => {
    const broken = { 1: { 0: 'Keep', 1: 'Main flyer' }, 2: ['Melt'], 3: {}, 4: null } as unknown as Record<string, string[]>;
    expect(cleanLabels(broken)).toEqual({ 1: ['Keep', 'Main flyer'], 2: ['Melt'] });
    expect(allLabels(broken).map((l) => l.name)).toEqual(['Keep', 'Melt', 'Main flyer']);
    expect(setLabel(broken, [1], 'Keep', false)).toEqual({ 1: ['Main flyer'], 2: ['Melt'] });
    expect([...idsWith(broken, 'keep')]).toEqual([1]);
  });
});
