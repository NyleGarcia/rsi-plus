import { afterEach, describe, expect, it } from 'vitest';
import { fmtUsd, fmtUsdCompact, moneySymbol, setDisplayCurrency } from '@/lib/currency';
import { parseAmount, parseMoney, usd0 } from '@/lib/money';
import { usd } from '@/lib/store';

describe('parseAmount', () => {
  it.each([
    ['$1,234.56 USD', 1234.56, 'USD'],
    ['$110.00 USD', 110, 'USD'],
    ['$ 812 . 17', 812.17, 'USD'],
    ['-$5.00', -5, 'USD'],
    ['$15,000', 15000, 'USD'],
    ['¤15,000 UEC', 15000, 'UEC'],
    ['15,000 aUEC', 15000, 'UEC'],
    ['1.234,56 €', 1234.56, 'EUR'],
    ['1 234,5 EUR', 1234.5, 'EUR'],
    ['CA$45.00', 45, 'CAD'],
    ['£12.99', 12.99, 'GBP'],
    ['', 0, 'USD'],
    ['n/a', 0, 'USD'],
  ])('%s', (s, amount, currency) => {
    expect(parseAmount(s)).toEqual({ amount, currency });
  });

  it('parseMoney is the amount', () => {
    expect(parseMoney('1.234,56 €')).toBe(1234.56);
    expect(parseMoney('$1,045.00 USD')).toBe(1045);
  });
});

describe('display currency', () => {
  afterEach(() => setDisplayCurrency('USD', 1));

  it('USD prints as before', () => {
    expect([usd(4000), usd(4050), usd(123456), usd0(2300.4), fmtUsd(12.5), fmtUsd(-5), moneySymbol()]).toEqual(['$40', '$40.50', '$1,234.56', '$2,300', '$12.50', '$-5', '$']);
  });

  it('converts with the typed rate and formats in the locale', () => {
    setDisplayCurrency('CAD', 1.4, 'en-CA');
    expect(usd(1000)).toBe('$14');
    expect(fmtUsd(10.25)).toBe('$14.35');
    expect(usd0(1000)).toBe('$1,400');
    setDisplayCurrency('EUR', 0.9, 'de-DE');
    // de-DE puts a no-break space before the €
    expect(fmtUsd(1000)).toMatch(/^900\s€$/);
    expect(fmtUsd(10)).toMatch(/^9\s€$/);
    expect(moneySymbol()).toBe('€');
    expect(fmtUsdCompact(2_000_000)).toMatch(/1,8\s*Mio\.\s*€/);
  });

  it('unknown code or bad rate falls back safely', () => {
    setDisplayCurrency('XYZ', 2);
    expect(usd(4000)).toBe('$40');
    setDisplayCurrency('GBP', NaN, 'en-GB');
    expect(fmtUsd(10)).toBe('£10');
  });
});
