/**
 * Every locale-dependent format in one place, so a UI language setting later has a single switch (`UI_LOCALE`) and no
 * call site hard-codes a locale. Pure (no storage, no DOM): safe in content scripts and the background.
 *
 * Two locales, on purpose:
 * - `UI_LOCALE` (undefined = the browser's): dates, times and plain counts ("1,234 members" / "1.234 members").
 * - `MONEY_LOCALE` (`en-US`): USD amounts and anything shown beside them, the way RSI prints them (`$1,234.50`).
 *   Prices are RSI's, in USD, so they keep one look in every language; `lib/countup.svelte.ts` also parses this
 *   grouping back, so a KPI number must use it. Other display currencies are formatted in `lib/currency.ts`.
 */
export const UI_LOCALE: string | undefined = undefined;
export const MONEY_LOCALE = 'en-US';

// `toLocaleString` builds a formatter per call (it showed up in profiles of 500-row tables): keep them.
const nf = new Map<string, Intl.NumberFormat>();
const df = new Map<string, Intl.DateTimeFormat>();
const numFmt = (locale: string | undefined, o?: Intl.NumberFormatOptions) => {
  const k = `${locale ?? ''}|${o ? JSON.stringify(o) : ''}`;
  let f = nf.get(k);
  if (!f) nf.set(k, (f = new Intl.NumberFormat(locale, o)));
  return f;
};
const dateFmt = (o?: Intl.DateTimeFormatOptions) => {
  const k = o ? JSON.stringify(o) : '';
  let f = df.get(k);
  if (!f) df.set(k, (f = new Intl.DateTimeFormat(UI_LOCALE, o)));
  return f;
};

/** A plain count in the UI locale: members, characters, KB. Not for money or KPI tiles (`fmtGrouped`). */
export const fmtNum = (n: number, o?: Intl.NumberFormatOptions): string => numFmt(UI_LOCALE, o).format(n);
/** A number with `en-US` grouping (`1,234.5`): amounts shown beside USD prices, and numbers the count-up animates. */
export const fmtGrouped = (n: number, o?: Intl.NumberFormatOptions): string => numFmt(MONEY_LOCALE, o).format(n);

const DATE_TIME: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' };
/** Dates in tables: date only. */
export const fmtDate = (ms: number | Date): string => dateFmt().format(ms);
/** "loaded …" lines: date and time. */
export const fmtDateTime = (ms: number | Date): string => dateFmt(DATE_TIME).format(ms);
/** Any other shape (`{ hour: 'numeric', minute: '2-digit' }`, `{ month: 'short', year: '2-digit' }` …) in the UI locale. */
export const fmtWhen = (ms: number | Date, o: Intl.DateTimeFormatOptions): string => dateFmt(o).format(ms);
