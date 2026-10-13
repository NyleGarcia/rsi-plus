// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHangar, pageCount } from '@/lib/account';

const li = (id: number) => `<li><input class="js-pledge-id" value="${id}"><input class="js-pledge-name" value="Pledge ${id}"><input class="js-pledge-value" value="$10.00 USD"></li>`;
const page = (ids: number[], pages = 0) => `<html><body><ul class="list-items">${ids.map(li).join('')}</ul>${pages ? `<div class="pager">${Array.from({ length: pages }, (_, i) => `<a href="/account/pledges?page=${i + 1}&pagesize=50">${i + 1}</a>`).join('')}</div>` : ''}</body></html>`;
const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

function mockPages(pages: Record<number, string | 'fail'>) {
  const calls: number[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const n = Number(new URL(url).searchParams.get('page'));
    calls.push(n);
    const body = pages[n] ?? pages[Math.max(...Object.keys(pages).map(Number))]; // RSI repeats the last page
    if (body === 'fail') return new Response('nope', { status: 500 });
    return Object.assign(new Response(body, { status: 200 }), { url });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('loadAll', () => {
  it('reports everything so far after every page; stops on a repeated page', async () => {
    mockPages({ 1: page(ids(1, 10)), 2: page(ids(11, 10)) });
    const seen: [number, number][] = [];
    const all = await loadHangar(({ page, items }) => void seen.push([page, items.length]));
    expect(all).toHaveLength(20);
    expect(seen).toEqual([
      [1, 10],
      [2, 20],
    ]);
  });

  it('a failing page keeps progress; resume continues after the saved page', async () => {
    mockPages({ 1: page(ids(1, 10)), 2: 'fail' });
    let saved = { page: 0, items: [] as Awaited<ReturnType<typeof loadHangar>> };
    await expect(loadHangar((p) => void (saved = p))).rejects.toThrow(/HTTP 500/);
    expect(saved.page).toBe(1);
    expect(saved.items).toHaveLength(10);

    const calls = mockPages({ 2: page(ids(11, 5)) });
    const all = await loadHangar(() => {}, undefined, saved);
    expect(calls[0]).toBe(2);
    expect(all.map((p) => p.id)).toEqual(ids(1, 15));
  });

  it('reports the total page count from the pagination links', async () => {
    mockPages({ 1: page(ids(1, 10), 3), 2: page(ids(11, 10), 3), 3: page(ids(21, 4), 3) });
    const seen: (number | undefined)[] = [];
    await loadHangar(({ pages }) => void seen.push(pages));
    expect(seen).toEqual([3, 3, 3]);
    expect(pageCount(new DOMParser().parseFromString(page(ids(1, 2)), 'text/html'))).toBeNull();
  });
});
