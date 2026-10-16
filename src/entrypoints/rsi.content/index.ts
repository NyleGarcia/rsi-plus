/**
 * RSI site (everything except Spectrum): a small bar on store ship pages (MSRP, what's on sale, wishlist,
 * plan a CCU to this ship) and on hangar / buyback pages (jump to the full RSI+ views).
 */
import { mount, unmount } from 'svelte';
import SiteBar from '@/components/SiteBar.svelte';
import { pageCount } from '@/lib/account';
import { parseCredits } from '@/lib/hangar';
import { hangarItem } from '@/lib/settings';

export default defineContentScript({
  matches: ['https://robertsspaceindustries.com/*'],
  excludeMatches: ['https://robertsspaceindustries.com/spectrum/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'rsi-plus',
      position: 'overlay',
      zIndex: 2147483000,
      anchor: 'html',
      onMount: (root) => mount(SiteBar, { target: root }),
      onRemove: (app) => app && unmount(app),
    });
    ui.mount();
    highlightPledge();
    captureCredits();
    ctx.addEventListener(window, 'wxt:locationchange', highlightPledge);
  },
});

/**
 * Hangar page opened from RSI+ (`?rsiplus=<pledge id>`): scroll to that pledge and outline it for a few seconds.
 * `&rsiplus_do=melt|gift` then clicks RSI's own Melt / Gift button in that row, so RSI's dialog (which asks for the
 * account password) opens for exactly that pledge. RSI+ never sees or sends the password.
 * Not on this page (stale page number, RSI reordered, different page size)? Walk the hangar pages here, in the
 * logged-in tab, until the id turns up, then go there.
 */
function highlightPledge() {
  if (!/^\/(?:[a-z]{2}\/)?account\/pledges/.test(location.pathname)) return;
  const params = new URLSearchParams(location.search);
  const id = params.get('rsiplus');
  const action = params.get('rsiplus_do');
  if (!id) return;
  const rowFor = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>('input.js-pledge-id')].find((i) => i.value === id)?.closest('li') ?? null;
  let tries = 0;
  const find = () => {
    const li = rowFor(document);
    if (!li) {
      if (tries++ < 12) return void setTimeout(find, 250); // list renders after load
      return void locate();
    }
    li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = li.style.cssText;
    li.style.cssText += ';outline:3px solid #ffd166;outline-offset:4px;border-radius:8px;transition:outline-color 1s';
    setTimeout(() => (li.style.cssText = prev), 6000);
    if (action === 'melt' || action === 'gift') {
      const btn = li.querySelector<HTMLElement>(action === 'melt' ? '.js-reclaim' : '.js-gift, .js-gift-v2');
      if (btn) openDialog(btn, action);
      else note(`RSI+: no ${action} button on this pledge (not ${action === 'melt' ? 'meltable' : 'giftable'}?)`, 6000);
    }
    // One shot: a reload after RSI's dialog shouldn't re-open it.
    params.delete('rsiplus');
    params.delete('rsiplus_do');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  };
  /** Pledge isn't here: fetch hangar pages (same session) until it is, then open that page with the same marker. */
  const locate = async () => {
    const size = params.get('pagesize') || '50';
    const here = Number(params.get('page') || 1);
    const box = note(`RSI+: pledge #${id} isn't on this page — looking…`, 0);
    // RSI answers any page past the end with the last page again, so an empty page never comes: stop at the
    // pagination's last page (from this page's links, refined from each fetched page) and on a repeated first id.
    let last = pageCount(document) ?? 100;
    const firstIds = new Set<string>([document.querySelector<HTMLInputElement>('.list-items > li input.js-pledge-id')?.value ?? '']);
    try {
      // Rows only ever move up (melts, gifts), so the pledge is almost always on this page or the one before:
      // probe outwards from here — here-1, here+1, here-2, here+2 … — instead of walking from page 1.
      const seen = new Set<number>([here]);
      for (let d = 1; ; d++) {
        const lo = here - d, hi = here + d;
        const next = [lo, hi].filter((p) => p >= 1 && p <= last && !seen.has(p));
        if (!next.length) break;
        let found = false;
        for (const page of next) {
          seen.add(page);
          box.textContent = `RSI+: looking for pledge #${id}… page ${page} / ${last}`;
          const res = await fetch(`/account/pledges?page=${page}&pagesize=${size}`, { credentials: 'include' });
          if (!res.ok) continue;
          const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
          const rows = doc.querySelectorAll('.list-items > li');
          if (!rows.length) continue;
          const first = rows[0]!.querySelector<HTMLInputElement>('input.js-pledge-id')?.value ?? '';
          if (first && firstIds.has(first)) {
            last = Math.min(last, page - 1); // repeated page → past the end
            continue;
          }
          firstIds.add(first);
          last = Math.min(last, pageCount(doc) ?? last);
          if (rowFor(doc)) {
            params.set('page', String(page));
            params.set('pagesize', size);
            location.href = `${location.pathname}?${params}`;
            return;
          }
          found = true;
        }
        if (!found) break;
      }
      box.textContent = `RSI+: pledge #${id} not found in the hangar — melted, gifted or reordered? Reload the hangar in RSI+.`;
      setTimeout(() => box.remove(), 8000);
    } catch {
      box.remove();
    }
  };
  find();
}

/**
 * Click RSI's Melt / Gift button until its dialog shows. RSI binds the handler from a script that can land after the
 * list is on screen (Edge, slow loads), so one early click is simply lost: retry every 700 ms for ~6 s, with a full
 * mouse sequence, and say so if the dialog never opens — the row is outlined, the button is right there.
 */
function openDialog(btn: HTMLElement, action: 'melt' | 'gift') {
  const dialogOpen = () =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="overlay"]')].some((el) => {
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0 && el.getBoundingClientRect().height > 40;
    });
  let tries = 0;
  const attempt = () => {
    if (dialogOpen()) return;
    if (tries++ >= 9) return void note(`RSI+: RSI's ${action} dialog didn't open — click the ${action === 'melt' ? 'Melt' : 'Gift'} button on the outlined pledge.`, 8000);
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    btn.click();
    setTimeout(attempt, 700);
  };
  setTimeout(attempt, 400);
}

/** Small fixed notice at the bottom of the page; `ms` 0 = until removed by the caller. */
function note(text: string, ms: number): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483001;background:#0f1a24;color:#e8eef5;border:1px solid #ffd166;border-radius:10px;padding:10px 14px;font:600 13px system-ui,sans-serif;box-shadow:0 8px 30px rgb(0 0 0/.5)';
  document.body.appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

/**
 * The credits box (store credit / UEC / REC) is JS-rendered — the account dropdown / sidebar — so it can appear on
 * any page, any time. Watch the DOM: whenever a node mentioning "store credit" shows up, parse it and keep the
 * numbers with the saved hangar. Also tried once on load for server-rendered account pages.
 */
function captureCredits() {
  const seen = { usd: NaN, uec: NaN, rec: NaN };
  const save = async () => {
    const c = parseCredits(document);
    if (!c || (c.usd === seen.usd && c.uec === seen.uec && c.rec === seen.rec)) return;
    Object.assign(seen, c);
    console.debug('[RSI+] credits', c);
    const cur = await hangarItem.getValue();
    if (!cur) return; // nothing to attach to yet — load the hangar in RSI+ first
    await hangarItem.setValue({ ...cur, credits: c, creditsAt: Date.now() });
  };
  // Throttled: RSI's store app mutates the DOM constantly; scan at most once a second, and only when the page
  // mentions "store credit" at all (one cheap string test, no per-node work).
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (/store credit/i.test(document.body?.textContent ?? '')) save().catch(() => {});
    }, 1000);
  };
  schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
}
