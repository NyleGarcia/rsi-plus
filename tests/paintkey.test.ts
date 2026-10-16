import { describe, expect, it } from 'vitest';
import { paintKey } from '../src/lib/store';

describe('paintKey', () => {
  it('matches hangar and store titles that differ in suffix, dash or a leading manufacturer', () => {
    expect(paintKey('Cutlass - Black and White Livery')).toBe(paintKey('Cutlass Black and White Paint'));
    expect(paintKey('Drake Dragonfly - Coalfire Paint')).toBe(paintKey('Dragonfly - Coalfire Paint'));
    expect(paintKey('Anvil Carrack - Sandstone Paint')).toBe('carrack sandstone');
    expect(paintKey('Origin 400i - Stratus Paint')).toBe('400i stratus');
    expect(paintKey("Xi'an Khartu-al - Ember Paint")).toBe('khartu al ember');
  });
  it('keeps hull names that merely start like a maker word', () => {
    expect(paintKey('Dragonfly - Mistwalker Paint')).toBe('dragonfly mistwalker');
    expect(paintKey('Mirai Fury - Drakespine Paint')).toBe('fury drakespine');
  });
});
