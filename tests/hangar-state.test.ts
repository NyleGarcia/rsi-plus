import { describe, expect, it } from 'vitest';
import { hangarState, type Pledge } from '@/lib/hangar';

const p = { id: 1, name: 'Aurora' } as Pledge;

describe('hangarState', () => {
  it('none: nothing saved, or an empty list', () => {
    expect(hangarState(null)).toBe('none');
    expect(hangarState(undefined)).toBe('none');
    expect(hangarState({ pledges: [], complete: true })).toBe('none');
    expect(hangarState({ pledges: [], complete: false, page: 0 })).toBe('none');
  });
  it('partial: a load stopped part-way (Stop, error, refresh) is not the whole hangar', () => {
    expect(hangarState({ pledges: [p], complete: false, page: 3 })).toBe('partial');
  });
  it('complete: a finished read; saves from before the flag existed count as complete', () => {
    expect(hangarState({ pledges: [p], complete: true })).toBe('complete');
    expect(hangarState({ pledges: [p] })).toBe('complete');
  });
});
