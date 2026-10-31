/**
 * Money, in one place. Two unit systems live in the app: RSI's hangar / billing / Chairman's Club print USD
 * (`Usd` floats, two decimals), the store GraphQL and buyback details give cents (`Cents` ints). Convert with
 * `cents` / `dollars`; round USD sums with `r2` (floats drift: 0.1 + 0.2).
 */
import { fmtUsd } from './currency';

/** USD with cents as decimals (12.5 = $12.50). */
export type Usd = number;
/** Whole cents (1250 = $12.50). */
export type Cents = number;

export const r2 = (n: number): Usd => Math.round(n * 100) / 100;
export const cents = (usd: Usd): Cents => Math.round(usd * 100);
export const dollars = (c: Cents): Usd => c / 100;

/**
 * "$1,234.56 USD" / "1,234.56" / "-$5.00" / "$ 812 . 17" → USD; 0 when there is no number. Keeps the sign whether
 * it sits before or after the "$". Use `Number.isFinite` on the caller side only when "no number" must differ from 0.
 */
export function parseMoney(s: string | null | undefined): Usd {
  return parseAmount(s).amount;
}

/** What a price is in: an ISO code, or UEC for RSI's in-game currency (`¤`). */
export type AmountCurrency = 'USD' | 'CAD' | 'AUD' | 'EUR' | 'GBP' | 'UEC' | (string & {});
const SYMBOLS: [RegExp, AmountCurrency][] = [
  [/¤|\ba?uec\b/i, 'UEC'],
  [/\bCA\$|\bC\$|\bCAD\b/i, 'CAD'],
  [/\bA\$|\bAUD\b/i, 'AUD'],
  [/€|\bEUR\b/i, 'EUR'],
  [/£|\bGBP\b/i, 'GBP'],
];

/**
 * "$1,234.56 USD" → 1234.56 USD, "1.234,56 €" → 1234.56 EUR, "¤15,000 UEC" → 15000 UEC, "CA$45.00" → 45 CAD.
 * The decimal mark is the last `.` or `,` followed by one or two digits; every other `.` `,` space is grouping.
 * Amount 0 when there is no number. USD when nothing names another currency.
 */
export function parseAmount(s: string | null | undefined): { amount: number; currency: AmountCurrency } {
  if (!s) return { amount: 0, currency: 'USD' };
  let currency: AmountCurrency = 'USD';
  for (const [re, code] of SYMBOLS)
    if (re.test(s)) {
      currency = code;
      break;
    }
  const neg = /-\s*[$€£¤]|[$€£¤]\s*-|^\s*-/.test(s);
  const digits = s.replace(/[^0-9.,]/g, '');
  const dec = /[.,](\d{1,2})$/.exec(digits);
  const int = (dec ? digits.slice(0, dec.index) : digits).replace(/[.,]/g, '');
  const n = parseFloat(`${int || '0'}${dec ? `.${dec[1]}` : ''}`);
  return { amount: Number.isFinite(n) && (int || dec) ? (neg ? -n : n) : 0, currency };
}

/** Whole dollars with thousands separators: $55, $2,300 (or the display currency). For bars, facts and ranges where cents are noise. */
export const usd0 = (usd: Usd): string => fmtUsd(usd, true);
