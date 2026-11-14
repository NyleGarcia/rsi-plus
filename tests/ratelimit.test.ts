import { afterEach, describe, expect, it, vi } from 'vitest';
import { cooldownLeft, cooldownReset } from '../src/lib/cooldown';
import { RateLimited, retryAfterMs, rsiFetch } from '../src/lib/store';

const res = (status: number, headers: Record<string, string> = {}) => new Response('[]', { status, headers });

describe('retryAfterMs', () => {
  it('uses Retry-After seconds, capped at 30 s', () => {
    expect(retryAfterMs('2', 0)).toBe(2000);
    expect(retryAfterMs('600', 0)).toBe(30_000);
  });
  it('backs off 5 s, 10 s, 15 s without a usable header', () => {
    expect(retryAfterMs(null, 0)).toBe(5000);
    expect(retryAfterMs('soon', 1)).toBe(10_000);
    expect(retryAfterMs('0', 2)).toBe(15_000);
  });
});

describe('rsiFetch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('passes other answers through untouched', async () => {
    const f = vi.fn().mockResolvedValue(res(500));
    vi.stubGlobal('fetch', f);
    expect((await rsiFetch('https://x/', {})).status).toBe(500);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('waits and retries on 429, then answers', async () => {
    vi.useFakeTimers();
    const f = vi.fn().mockResolvedValueOnce(res(429, { 'Retry-After': '1' })).mockResolvedValueOnce(res(200));
    vi.stubGlobal('fetch', f);
    const p = rsiFetch('https://x/', {});
    await vi.advanceTimersByTimeAsync(999);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('gives up after 3 retries with a plain message', async () => {
    vi.useFakeTimers();
    const f = vi.fn().mockImplementation(async () => res(429));
    vi.stubGlobal('fetch', f);
    const p = rsiFetch('https://x/', {}).catch((e) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const e = await p;
    expect(e).toBeInstanceOf(RateLimited);
    expect(e.message).toMatch(/limiting requests/);
    expect(f).toHaveBeenCalledTimes(4);
  });
});

describe('cooldownLeft', () => {
  it('lets the first press through, holds the next for a minute', () => {
    expect(cooldownLeft('t1', 60_000, 1000)).toBe(0);
    expect(cooldownLeft('t1', 60_000, 1500)).toBe(60);
    expect(cooldownLeft('t1', 60_000, 60_999)).toBe(1);
    expect(cooldownLeft('t1', 60_000, 61_000)).toBe(0);
  });
  it('is per button, and a failed refresh unlocks it', () => {
    expect(cooldownLeft('t2', 60_000, 0)).toBe(0);
    expect(cooldownLeft('t3', 60_000, 1)).toBe(0);
    cooldownReset('t2');
    expect(cooldownLeft('t2', 60_000, 2)).toBe(0);
  });
});
