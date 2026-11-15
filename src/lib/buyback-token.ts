/**
 * Credit Buy-Back token: buying a reclaimed pledge back with store credit takes one. RSI's rules (Pledge Buy Back Tool
 * article, read 2026-11-15): a token is attributed every 3 months, "early in" January, April, July and October; tokens
 * do not stack (an unused one is not doubled); the buy-back queue shows a yellow notice while one is available. Cash
 * buy-backs need no token.
 *
 * RSI+ only knows what the buy-back pages said the last time it read them (`BuybackToken`), so the status is "as of
 * then": a token read as available may have been spent since, a "none" read before this quarter began is stale.
 */
export interface BuybackToken {
  /** When the buy-back pages were read, ms. */
  at: number;
  /** Tokens RSI showed (0 = the queue had no token notice). */
  tokens: number;
}

/** Months a new token arrives in (0-based). */
export const TOKEN_MONTHS = [0, 3, 6, 9] as const;

/** First day (local midnight) of the quarter `now` is in. */
export function quarterStart(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime();
}
/** First day of the next quarter: RSI says "early in" that month, no day given. */
export function nextQuarter(now: number): number {
  const d = new Date(quarterStart(now));
  return new Date(d.getFullYear(), d.getMonth() + 3, 1).getTime();
}

export type TokenState =
  /** never read */
  | 'unknown'
  /** RSI showed a token at the last read */
  | 'available'
  /** none at the last read, and that read was this quarter: the next one comes next quarter */
  | 'none'
  /** none at the last read, but a new quarter has begun since: one has probably arrived */
  | 'due';

export interface TokenStatus {
  state: TokenState;
  tokens: number;
  /** When the next token is due (first day of that month), ms. */
  next: number;
  /** The read this is based on (null when never read). */
  at: number | null;
}

export function tokenStatus(read: BuybackToken | null | undefined, now: number): TokenStatus {
  const next = nextQuarter(now);
  if (!read) return { state: 'unknown', tokens: 0, next, at: null };
  if (read.tokens > 0) return { state: 'available', tokens: read.tokens, next, at: read.at };
  return { state: read.at < quarterStart(now) ? 'due' : 'none', tokens: 0, next, at: read.at };
}
