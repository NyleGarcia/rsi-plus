import { describe, expect, it } from 'vitest';
import { own, ownMoney, ownUsd, privacy, setPrivacy, togglePrivacy } from '@/lib/privacy.svelte';

describe('screenshare mode', () => {
  it('passes values through while off and masks them while on', () => {
    setPrivacy(false);
    expect(privacy.on).toBe(false);
    expect(own('zedwil')).toBe('zedwil');
    expect(ownMoney('$1,234')).toBe('$1,234');
    expect(ownUsd(12_345)).toBe('$123.45');
    togglePrivacy();
    expect(privacy.on).toBe(true);
    expect(own('zedwil')).toBe('•••');
    expect(own(3.2)).toBe('•••');
    expect(ownMoney('$1,234')).toBe('$•••');
    expect(ownUsd(12_345)).toBe('$•••');
    setPrivacy(false);
  });
});
