/**
 * Refresh buttons that re-read RSI's store: one press per minute each. A double press (or three refreshes in a row)
 * is what trips RSI's rate limit, which then also blocks RSI's own pages for a few minutes.
 */
export const REFRESH_COOLDOWN = 60_000;
const last = new Map<string, number>();

/** Seconds left before `key` may run again; 0 = go (and the clock restarts). */
export function cooldownLeft(key: string, ms = REFRESH_COOLDOWN, now = Date.now()): number {
  const left = (last.get(key) ?? -Infinity) + ms - now;
  if (left > 0) return Math.ceil(left / 1000);
  last.set(key, now);
  return 0;
}
/** A failed refresh should not lock the button. */
export const cooldownReset = (key: string) => void last.delete(key);
export const cooldownMsg = (secs: number) => `Just refreshed. RSI limits how often its store can be read: try again in ${secs} s.`;
