import { describe, expect, it } from 'vitest';
import { MONEY_LOCALE, UI_LOCALE, fmtDate, fmtDateTime, fmtGrouped, fmtNum, fmtWhen } from '@/lib/fmt';
import { fmtDate as viaDates } from '@/lib/dates';
import { fmtUsd } from '@/lib/currency';

describe('fmt: one place for locale formats', () => {
  const at = new Date(2026, 10, 9, 14, 5, 7);
  it('UI formats follow the browser locale, exactly as toLocale*String did', () => {
    expect(UI_LOCALE).toBeUndefined();
    expect(fmtDate(at)).toBe(at.toLocaleDateString());
    expect(fmtDate(at.getTime())).toBe(at.toLocaleDateString());
    expect(fmtDateTime(at)).toBe(at.toLocaleString());
    expect(fmtWhen(at, { hour: 'numeric', minute: '2-digit' })).toBe(at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    expect(fmtWhen(at, { month: 'short', year: '2-digit' })).toBe(at.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }));
    expect(fmtWhen(at, { dateStyle: 'medium', timeStyle: 'short' })).toBe(at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    expect(fmtNum(1234567)).toBe((1234567).toLocaleString());
    expect(viaDates(at)).toBe(fmtDate(at));
  });
  it('money grouping is en-US whatever the UI locale', () => {
    expect(MONEY_LOCALE).toBe('en-US');
    expect(fmtGrouped(1234567.5)).toBe('1,234,567.5');
    expect(fmtGrouped(12.345, { maximumFractionDigits: 1 })).toBe('12.3');
    expect(fmtGrouped(5, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe('5.00');
    expect(fmtUsd(1234.5)).toBe('$1,234.50');
    expect(fmtUsd(1234)).toBe('$1,234');
  });
});
