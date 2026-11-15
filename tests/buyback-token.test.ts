// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { nextQuarter, quarterStart, tokenStatus } from '@/lib/buyback-token';
import { parseBuybackTokens } from '@/lib/hangar';

const at = (s: string) => new Date(s).getTime();
const doc = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

describe('Credit Buy-Back token', () => {
  it('quarters start in January, April, July and October', () => {
    expect(new Date(quarterStart(at('2026-11-15T12:00'))).getMonth()).toBe(9);
    expect([new Date(nextQuarter(at('2026-11-15T12:00'))).getFullYear(), new Date(nextQuarter(at('2026-11-15T12:00'))).getMonth()]).toEqual([2027, 0]);
    expect(new Date(nextQuarter(at('2026-02-01T00:00'))).getMonth()).toBe(3);
  });
  it('status from the last read: available, none this quarter, due after a new quarter, unknown', () => {
    const now = at('2026-11-15T12:00');
    expect(tokenStatus(null, now).state).toBe('unknown');
    expect(tokenStatus({ at: at('2026-08-01T00:00'), tokens: 1 }, now)).toMatchObject({ state: 'available', tokens: 1 });
    expect(tokenStatus({ at: at('2026-10-20T00:00'), tokens: 0 }, now).state).toBe('none');
    expect(tokenStatus({ at: at('2026-09-20T00:00'), tokens: 0 }, now).state).toBe('due');
  });
  it('reads the notice from a page, by markup or by its words; null without one', () => {
    expect(parseBuybackTokens(doc('<p class="buy-back-warning">You have <strong>2</strong> opportunity to buy back a pledge with store credits</p>'))).toBe(2);
    expect(parseBuybackTokens(doc('<div class="notice">You have 1 opportunity to buy back a pledge with store credits</div>'))).toBe(1);
    expect(parseBuybackTokens(doc('<ul><li>Aurora MR</li></ul>'))).toBeNull();
  });
});
