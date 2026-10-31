/**
 * Display currency (Settings → Appearance → Currency). RSI's numbers are USD; with another currency chosen, amounts on
 * screen are converted with the rate the user typed (no rate is fetched — RSI+ talks to nothing but RSI) and formatted
 * in the browser's locale. Exports and anything sent elsewhere stay USD. USD (the default) prints exactly as before:
 * `$1,234` / `$12.50`, en-US grouping.
 *
 * Plain module state, set once per page by `initCurrency` (hub, popup); the page reloads when the setting changes,
 * so the 500-row tables need no reactive formatter.
 */
export const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY', 'BRL', 'MXN'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

interface Display {
  code: CurrencyCode;
  /** Units of `code` per 1 USD. */
  rate: number;
  whole: Intl.NumberFormat;
  cents: Intl.NumberFormat;
  symbol: string;
}

const make = (code: CurrencyCode, rate: number, locale?: string): Display => {
  if (code === 'USD') {
    // Built once: `toLocaleString` makes a new formatter per call, which showed up in profiles of 500-row tables.
    return { code, rate: 1, whole: new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }), cents: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), symbol: '$' };
  }
  const opts = { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' } as const;
  const whole = new Intl.NumberFormat(locale, { ...opts, minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const cents = new Intl.NumberFormat(locale, { ...opts, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = cents.formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;
  return { code, rate: rate > 0 && Number.isFinite(rate) ? rate : 1, whole, cents, symbol };
};

let display = make('USD', 1);

export function setDisplayCurrency(code: string, rate: number, locale?: string) {
  display = make((CURRENCIES as readonly string[]).includes(code) ? (code as CurrencyCode) : 'USD', rate, locale);
}
export const displayCurrency = () => display.code;
/** The symbol amounts start with (`$`, `CA$`/`$`, `€` …): kept on masked values so columns still read as money. */
export const moneySymbol = () => display.symbol;

/** USD amount → display string. `round`: whole units only (bars, facets, totals where cents are noise). */
export function fmtUsd(usd: number, round = false): string {
  if (display.code === 'USD') {
    if (round) return `$${display.whole.format(Math.round(usd))}`;
    return `$${(Math.round(usd * 100) % 100 ? display.cents : display.whole).format(usd)}`;
  }
  const v = usd * display.rate;
  return (round || Math.round(v * 100) % 100 === 0 ? display.whole : display.cents).format(round ? Math.round(v) : v);
}

let compact: [string, Intl.NumberFormat] | null = null;
/** Narrow columns in a non-USD display currency: `1,2 k €`, `CA$16K`. (USD keeps the callers' own `$2.3k` / `$1.20B`.) */
export function fmtUsdCompact(usd: number): string {
  if (compact?.[0] !== display.code)
    compact = [display.code, new Intl.NumberFormat(display.cents.resolvedOptions().locale, { style: 'currency', currency: display.code, currencyDisplay: 'narrowSymbol', notation: 'compact', maximumFractionDigits: 1 })];
  return compact[1].format(usd * display.rate);
}
