import { describe, expect, it } from 'vitest';
import { legacyHash } from '../src/lib/hub-hash';

describe('legacyHash', () => {
  it('leaves current hashes alone', () => {
    for (const h of ['#feed', '#hangar', '#melt', '#fleet', '#paints', '#paint-rebuy', '#store', '#browse?who=concierge', '#ccu?to=42', '', '#']) expect(legacyHash(h)).toBeNull();
  });
  it('maps the old hangar / ships views', () => {
    expect(legacyHash('#hangar?view=melt')).toBe('#melt');
    expect(legacyHash('#hangar?view=pledges')).toBeNull();
    expect(legacyHash('#ships')).toBe('#paints');
    expect(legacyHash('#ships?view=paints')).toBe('#paints');
    expect(legacyHash('#ships?view=ships')).toBe('#fleet');
    expect(legacyHash('#ships?view=bundle')).toBe('#paint-rebuy');
  });
  it('maps the old store items tab and turns Concierge / Subscribers categories into audiences', () => {
    expect(legacyHash('#store?view=items')).toBe('#browse');
    expect(legacyHash('#store?view=items&cat=paints')).toBe('#browse?cat=paints');
    expect(legacyHash('#store?view=items&cat=concierge')).toBe('#browse?who=concierge');
    expect(legacyHash('#store?view=items&cat=subscribers')).toBe('#browse?who=subscribers');
    expect(legacyHash('#store')).toBeNull();
  });
});
