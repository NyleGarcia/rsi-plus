/**
 * Load every page of the hangar / buyback list. Runs in an extension page (hub) — needs DOMParser, and the
 * request carries the user's RSI session cookies via the extension's host permission.
 * RSI quirk: a page number past the end returns the last page again → stop on a repeated first id.
 */
import { parseBuybackDetail, parseBuybackPage, parseHangarPage, type BuybackItem, type Pledge, HANGAR_PAGE, creditsDebug, parseCredits, type Credits } from './hangar';
import { SPECTRUM_ORIGIN } from './types';

export class NotLoggedIn extends Error {
  constructor() {
    super('Not logged in — sign in on robertsspaceindustries.com, then retry.');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getPage(path: string, page: number, tries = 0): Promise<Document> {
  const res = await fetch(`${SPECTRUM_ORIGIN}${path}?page=${page}&pagesize=${HANGAR_PAGE}`, { credentials: 'include' });
  if (res.status === 429 && tries < 5) {
    await sleep(5000 * (tries + 1));
    return getPage(path, page, tries + 1);
  }
  if (!res.ok) throw new Error(`${path} page ${page}: HTTP ${res.status}`);
  if (/\/(connect|login|sign-?in)\b/.test(new URL(res.url).pathname)) throw new NotLoggedIn();
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  // Logged-out account pages render the sign-in form instead of the list.
  if (!doc.querySelector('.list-items, article.pledge, .pledge') && doc.querySelector('form[action*="signin"], #signin, .sign-in')) throw new NotLoggedIn();
  return doc;
}

export interface Progress<T> {
  /** Last page fully read. */
  page: number;
  /** Total pages, when the page's pagination says (highest `page=N` link); undefined if unknown. */
  pages?: number;
  /** Everything read so far (a fresh array each call — safe to store). */
  items: T[];
}

/**
 * Read pages from `resume.page + 1` on. `onProgress` fires after every page with everything so far, so callers
 * can persist partial results — a refresh or a failing page never loses what was already read.
 */
async function loadAll<T extends { id: number; page?: number }>(
  path: string,
  parse: (d: ParentNode) => T[],
  onProgress: (p: Progress<T>) => void | Promise<void>,
  signal?: AbortSignal,
  resume: Progress<T> = { page: 0, items: [] },
): Promise<T[]> {
  const all: T[] = [...resume.items];
  const seen = new Set<number>(all.map((i) => i.id));
  let pages: number | undefined;
  for (let page = resume.page + 1; page < 500; page++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const doc = await getPage(path, page);
    pages = pageCount(doc) ?? pages;
    const items = parse(doc);
    const fresh = items.filter((i) => !seen.has(i.id) || i.id === 0);
    if (!items.length || !fresh.length) break; // empty, or RSI repeating the last page
    for (const i of fresh) {
      seen.add(i.id);
      i.page = page;
      all.push(i);
    }
    await onProgress({ page, pages, items: [...all] });
    if (items.length < 10) break;
    if (page > 20) await sleep(400); // be gentle with very large hangars
  }
  return all;
}

export const loadHangar = (onProgress: (p: Progress<Pledge>) => void | Promise<void>, signal?: AbortSignal, resume?: Progress<Pledge>): Promise<Pledge[]> =>
  loadAll('/account/pledges', parseHangarPage, onProgress, signal, resume);

export const loadBuyback = (onProgress: (p: Progress<BuybackItem>) => void | Promise<void>, signal?: AbortSignal, resume?: Progress<BuybackItem>): Promise<BuybackItem[]> =>
  loadAll('/account/buy-back-pledges', parseBuybackPage, onProgress, signal, resume);

export interface HangarUpdate {
  pledges: Pledge[];
  /** Pages read (vs the whole hangar on a full reload). */
  pages: number;
  added: number;
  removed: number;
  changed: number;
}

const same = (a: Pledge, b: Pledge) => JSON.stringify({ ...a, page: 0 }) === JSON.stringify({ ...b, page: 0 });

/**
 * Quick update against a saved hangar: RSI lists newest first, so read from page 1 until a page matches a stretch of
 * the saved list (same ids in the same order, same contents) and keep the saved rest after it. New pledges, and melts
 * / gifts / upgrades above that point, are picked up; a change further down needs a full reload. Nothing is saved on
 * the way (`onProgress` is for the progress bar only), so a stop or a failing page leaves the saved hangar as it was.
 * With no match it simply reads to the end, which is a full reload.
 */
export async function updateHangar(
  saved: Pledge[],
  onProgress?: (p: { page: number; pages?: number; count: number }) => void,
  signal?: AbortSignal,
): Promise<HangarUpdate> {
  const at = new Map(saved.map((p, i) => [p.id, i]));
  const read: Pledge[] = [];
  const seen = new Set<number>();
  let pages: number | undefined;
  let per = 0;
  let tail: Pledge[] = [];
  let fetched = 0;
  for (let page = 1; page < 500; page++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const doc = await getPage('/account/pledges', page);
    fetched++;
    pages = pageCount(doc) ?? pages;
    const items = parseHangarPage(doc);
    const fresh = items.filter((i) => !seen.has(i.id));
    if (!items.length || !fresh.length) break; // empty, or RSI repeating the last page
    per ||= items.length;
    for (const i of fresh) (seen.add(i.id), (i.page = page), read.push(i));
    onProgress?.({ page, pages, count: read.length });
    const idx = items.map((i) => at.get(i.id) ?? -1);
    const anchored = idx[0]! >= 0 && idx.every((n, k) => n === idx[0]! + k && same(items[k]!, saved[n]!));
    if (anchored) {
      tail = saved.slice(idx[idx.length - 1]! + 1).filter((p) => !seen.has(p.id));
      break;
    }
    if (items.length < 10) break;
    if (page > 20) await sleep(400);
  }
  const pledges = [...read, ...tail.map((p, i) => ({ ...p, page: Math.floor((read.length + i) / (per || 10)) + 1 }))];
  const kept = new Set(pledges.map((p) => p.id));
  return {
    pledges,
    pages: fetched,
    added: read.filter((p) => !at.has(p.id)).length,
    removed: saved.filter((p) => !kept.has(p.id)).length,
    changed: read.filter((p) => at.has(p.id) && !same(p, saved[at.get(p.id)!]!)).length,
  };
}

/**
 * Fill in each buyback entry's contents + price from its own page (the list page only says "5 items"). One request
 * per entry that has a `url` and no `items` yet (or all of them with `force`), ~350 ms apart, 429 → wait and retry.
 * `onProgress` gets the whole list after every entry so it can be saved as it goes; a Stop keeps what was read.
 */
export async function loadBuybackDetails(
  list: BuybackItem[],
  onProgress: (p: { done: number; total: number; items: BuybackItem[] }) => void | Promise<void>,
  signal?: AbortSignal,
  force = false,
): Promise<BuybackItem[]> {
  const items = list.map((b) => ({ ...b }));
  const todo = items.filter((b) => b.url && (force || !b.items));
  let done = 0;
  for (const b of todo) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let res: Response | null = null;
    for (let tries = 0; tries < 5; tries++) {
      res = await fetch(b.url!, { credentials: 'include', signal });
      if (res.status !== 429) break;
      await sleep(5000 * (tries + 1));
    }
    if (res?.ok) {
      if (/\/(connect|login|sign-?in)\b/.test(new URL(res.url).pathname)) throw new NotLoggedIn();
      const d = parseBuybackDetail(new DOMParser().parseFromString(await res.text(), 'text/html'));
      if (d.items.length) {
        b.items = d.items;
        b.contained = d.items.map((i) => i.title).join(', ');
      }
      if (d.price != null) b.price = d.price;
      if (d.listPrice != null) b.listPrice = d.listPrice;
      if (d.sku != null) b.sku = d.sku;
      b.detailAt = Date.now();
    }
    done++;
    await onProgress({ done, total: todo.length, items: items.map((x) => ({ ...x })) });
    await sleep(350);
  }
  return items;
}

/** Store credit / UEC / REC from the first hangar page (cheap: one request). null when logged out / not shown. */
/** Highest page number in the pagination links (`?page=N`), or null when the page shows none. */
export function pageCount(doc: ParentNode): number | null {
  let max = 0;
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="page="]')) {
    const n = Number(/[?&]page=(\d+)/.exec(a.getAttribute('href') ?? '')?.[1]);
    if (n > max) max = n;
  }
  return max || null;
}

/** Account pages that may carry the credits box (the hangar list itself doesn't). */
export const CREDIT_PAGES = ['/account/billing', '/account/dashboard', '/account/settings', '/account/pledges'];

export async function fetchCredits(): Promise<{ credits: Credits | null; debug: string; path: string }> {
  const debug: string[] = [];
  for (const path of CREDIT_PAGES) {
    const res = await fetch(`${SPECTRUM_ORIGIN}${path}`, { credentials: 'include' });
    if (!res.ok) {
      debug.push(`${path}: HTTP ${res.status}`);
      continue;
    }
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const credits = parseCredits(doc);
    if (credits) return { credits, debug: '', path };
    debug.push(`${path}: ${creditsDebug(doc)}`);
  }
  return { credits: null, debug: debug.join(' ‖ '), path: '' };
}
