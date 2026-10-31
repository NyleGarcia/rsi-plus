import { describe, expect, it } from 'vitest';
import { cutKey, paintKey } from '../src/lib/store';

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
  it('cutKey: the prefix of a title the hangar page cut short, null for a whole one', () => {
    expect(cutKey("Lightning Bolt Co. Atzkav 'Starwalker' Sniper R...")).toBe('lightning bolt co atzkav starwalker sniper r');
    expect(cutKey('Constellation Mk IV Andromeda - Blackthorn P…')).toBe('constellation mk iv andromeda blackthorn p');
    expect(cutKey("Gemini S71 'Infrared' Rifle")).toBeNull();
    expect(cutKey('...')).toBeNull();
  });
});
