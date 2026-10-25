import { describe, expect, it } from 'vitest';
import { cents, dollars, parseMoney, r2 } from '@/lib/money';
import { monthKey, monthKeys, monthsSince, parseRsiDate } from '@/lib/dates';

describe('money', () => {
  it('parses RSI money strings with either sign placement', () => {
    expect(parseMoney('$1,234.56 USD')).toBe(1234.56);
    expect(parseMoney(' 812 . 17 ')).toBe(812.17);
    expect(parseMoney('-$5.00 USD')).toBe(-5);
    expect(parseMoney('$-5.00')).toBe(-5);
    expect(parseMoney('¤45,000 UEC')).toBe(45000);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney('free')).toBe(0);
  });
  it('rounds and converts', () => {
    expect(r2(0.1 + 0.2)).toBe(0.3);
    expect(cents(12.5)).toBe(1250);
    expect(dollars(1250)).toBe(12.5);
  });
});

describe('dates', () => {
  it('parses RSI human dates locally', () => {
    const d = new Date(parseRsiDate('Order Placed: October 22, 2026 02:10'));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 22, 2, 10]);
    expect(new Date(parseRsiDate(' March 3 2024 ')).getDate()).toBe(3);
    const iso = new Date(parseRsiDate('2024-07-21, 01:05'));
    expect([iso.getMonth(), iso.getDate(), iso.getHours()]).toEqual([6, 21, 1]);
    expect(parseRsiDate('Smarch 1, 2024')).toBeNaN();
    expect(parseRsiDate('')).toBeNaN();
  });
  it('builds month windows', () => {
    const now = new Date(2026, 0, 15);
    expect(monthKeys(3, now)).toEqual([
      { key: '2025-11', label: 'Nov' },
      { key: '2025-12', label: 'Dec' },
      { key: '2026-01', label: 'Jan' },
    ]);
    expect(monthKey(now)).toBe('2026-01');
    expect(monthsSince(new Date(2025, 10, 2).getTime(), now)).toBe(3);
    expect(monthsSince(now.getTime(), now)).toBe(2);
  });
});
