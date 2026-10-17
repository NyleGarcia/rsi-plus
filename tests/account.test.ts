// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHangar, pageCount, updateHangar } from '@/lib/account';

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

describe('updateHangar', () => {
  const saved = async (byPage: Record<number, number[]>) => {
    mockPages(Object.fromEntries(Object.entries(byPage).map(([k, v]) => [k, page(v)])));
    return loadHangar(() => {});
  };

  it('reads only until a page matches the saved list, keeps the rest', async () => {
    const old = await saved({ 1: ids(100, 10), 2: ids(110, 10), 3: ids(120, 10), 4: ids(130, 3) });
    // 3 new pledges on top push everything down 3 places.
    const calls = mockPages({ 1: page([...ids(1, 3), ...ids(100, 7)]), 2: page(ids(107, 10)), 3: page(ids(117, 10)), 4: page(ids(127, 6)) });
    const u = await updateHangar(old);
    expect(calls).toEqual([1, 2]);
    expect(u).toMatchObject({ pages: 2, added: 3, removed: 0, changed: 0 });
    expect(u.pledges.map((p) => p.id)).toEqual([...ids(1, 3), ...ids(100, 33)]);
    // Kept pledges get their new page: 130 is now the 34th row → page 4.
    expect(u.pledges.find((p) => p.id === 130)?.page).toBe(4);
  });

  it('nothing new costs one page', async () => {
    const old = await saved({ 1: ids(1, 10), 2: ids(11, 10), 3: ids(21, 2) });
    const calls = mockPages({ 1: page(ids(1, 10)), 2: page(ids(11, 10)), 3: page(ids(21, 2)) });
    const u = await updateHangar(old);
    expect(calls).toEqual([1]);
    expect(u.pledges).toHaveLength(22);
  });

  it('a melt near the top is dropped (page 1 has a gap, page 2 anchors)', async () => {
    const old = await saved({ 1: ids(1, 10), 2: ids(11, 10), 3: ids(21, 10), 4: ids(31, 1) });
    const after = ids(1, 31).filter((i) => i !== 4);
    const calls = mockPages({ 1: page(after.slice(0, 10)), 2: page(after.slice(10, 20)), 3: page(after.slice(20, 30)) });
    const u = await updateHangar(old);
    expect(calls).toEqual([1, 2]);
    expect(u).toMatchObject({ added: 0, removed: 1 });
    expect(u.pledges.map((p) => p.id)).toEqual(after);
  });

  it('a changed pledge does not anchor and counts as changed', async () => {
    const old = await saved({ 1: ids(1, 10), 2: ids(11, 10), 3: ids(21, 1) });
    const p1 = page(ids(1, 10)).replace('Pledge 2"', 'Pledge 2 (upgraded)"');
    const calls = mockPages({ 1: p1, 2: page(ids(11, 10)), 3: page(ids(21, 1)) });
    const u = await updateHangar(old);
    expect(calls).toEqual([1, 2]);
    expect(u).toMatchObject({ changed: 1, added: 0, removed: 0 });
    expect(u.pledges.find((p) => p.id === 2)?.name).toBe('Pledge 2 (upgraded)');
  });

  it('a failing page throws and returns nothing (the saved hangar stays)', async () => {
    const old = await saved({ 1: ids(1, 10), 2: ids(11, 1) });
    mockPages({ 1: page(ids(50, 10)), 2: 'fail' });
    await expect(updateHangar(old)).rejects.toThrow(/HTTP 500/);
  });
});
