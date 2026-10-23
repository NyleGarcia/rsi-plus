/**
 * Money, in one place. Two unit systems live in the app: RSI's hangar / billing / Chairman's Club print USD
 * (`Usd` floats, two decimals), the store GraphQL and buyback details give cents (`Cents` ints). Convert with
 * `cents` / `dollars`; round USD sums with `r2` (floats drift: 0.1 + 0.2).
 */
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
  if (!s) return 0;
  const neg = /-\s*\$|\$\s*-|^\s*-/.test(s);
  const n = parseFloat(s.replace(/[^0-9.,]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}
