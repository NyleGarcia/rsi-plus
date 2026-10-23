/** Calendar helpers shared by the spend charts (hangar melt value and order history bucket the same way). */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** The last `months` calendar months ending now, oldest first, as `YYYY-MM` keys with their short labels. */
export function monthKeys(months: number, now = new Date()): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: monthKey(d), label: MONTHS[d.getMonth()]! });
  }
  return out;
}
/** Months from the month of `from` to now, inclusive (at least 2). */
export const monthsSince = (from: number, now = new Date()): number => {
  const f = new Date(from);
  return Math.max(2, (now.getFullYear() - f.getFullYear()) * 12 + (now.getMonth() - f.getMonth()) + 1);
};
/**
 * RSI's human dates → ms, local time (the pages print no zone): "October 22, 2026 02:10", "March 3 2024",
 * "2024-07-21, 01:05". NaN when nothing matches. Explicit so it doesn't lean on V8's lenient `Date.parse`.
 */
export function parseRsiDate(s: string | null | undefined): number {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  let m = /([A-Za-z]+) (\d{1,2}),? (\d{4})(?:,? (\d{1,2}):(\d{2}))?/.exec(t);
  if (m) {
    const mo = MONTHS.findIndex((x) => m![1]!.toLowerCase().startsWith(x.toLowerCase()));
    if (mo < 0) return NaN;
    return new Date(Number(m[3]), mo, Number(m[2]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime();
  }
  m = /(\d{4})-(\d{2})-(\d{2})(?:,? (\d{1,2}):(\d{2}))?/.exec(t);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime();
  return NaN;
}
