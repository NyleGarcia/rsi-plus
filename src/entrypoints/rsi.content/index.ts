/**
 * RSI site (everything except Spectrum): a small bar on store ship pages (MSRP, what's on sale, wishlist,
 * plan a CCU to this ship) and on hangar / buyback pages (jump to the full RSI+ views).
 */
import { mount, unmount } from 'svelte';
import SiteBar from '@/components/SiteBar.svelte';
import { pageCount } from '@/lib/account';
import { parseCredits } from '@/lib/hangar';
import { syncApplied } from '@/lib/hangar-sync';
import { hangarItem } from '@/lib/settings';
import { trackPath } from '@/lib/page-path.svelte';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

export default defineContentScript({
  matches: ['https://robertsspaceindustries.com/*'],
  excludeMatches: ['https://robertsspaceindustries.com/spectrum/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    trackPath(ctx);
    const ui = await createShadowRootUi(ctx, {
      name: 'rsi-plus',
      position: 'overlay',
      zIndex: 2147483000, // no effect: WXT resets the host with `:host { all: initial !important }`; see site-bar.css
      anchor: 'html',
      onMount: (root) => mount(SiteBar, { target: root }),
      onRemove: (app) => app && unmount(app),
    });
    ui.mount();
    highlightPledge();
    watchApply(ctx);
    captureCredits(ctx);
    // After the URL commits: WXT can fire this before `location` updates (see `page-path`).
    ctx.addEventListener(window, 'wxt:locationchange', () => setTimeout(highlightPledge));
  },
});

/**
 * Hangar page opened from RSI+ (`?rsiplus=<pledge id>`): scroll to that pledge and outline it for a few seconds.
 * `&rsiplus_do=melt|gift|apply` then clicks RSI's own Melt / Gift / Apply upgrade button in that row, so RSI's dialog
 * (which asks for the account password) opens for exactly that pledge. RSI+ never sees or sends the password. With
 * `apply` and `&rsiplus_on=<pledge id>`, the pledge the chain means is pointed out in RSI's list (`guideApply`).
 * Not on this page (stale page number, RSI reordered, different page size)? Walk the hangar pages here, in the
 * logged-in tab, until the id turns up, then go there.
 */
function highlightPledge() {
  if (!/^\/(?:[a-z]{2}\/)?account\/pledges/.test(location.pathname)) return;
  const params = new URLSearchParams(location.search);
  const id = params.get('rsiplus');
  const action = params.get('rsiplus_do');
  const onto = params.get('rsiplus_on');
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
    } else if (action === 'apply') {
      const btn = li.querySelector<HTMLElement>('.js-apply-upgrade');
      if (btn) {
        openDialog(btn, 'apply');
        if (onto) guideApply(onto);
      } else note('RSI+: no Apply upgrade button on this pledge (not an upgrade?)', 6000);
    }
    // One shot: a reload after RSI's dialog shouldn't re-open it.
    params.delete('rsiplus');
    params.delete('rsiplus_do');
    params.delete('rsiplus_on');
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
function openDialog(btn: HTMLElement, action: 'melt' | 'gift' | 'apply') {
  const dialogOpen = () =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="overlay"]')].some((el) => {
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0 && el.getBoundingClientRect().height > 40;
    });
  let tries = 0;
  const attempt = () => {
    if (dialogOpen()) return;
    if (tries++ >= 9) return void note(`RSI+: RSI's ${action} dialog didn't open — click the ${action === 'melt' ? 'Melt' : action === 'gift' ? 'Gift' : 'Apply upgrade'} button on the outlined pledge.`, 8000);
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    btn.click();
    setTimeout(attempt, 700);
  };
  setTimeout(attempt, 400);
}

/**
 * An upgrade applied on RSI → RSI+'s copy of the hangar is out of date the same second (the CCU is gone, a pledge
 * holds another ship), and a chain in *My chains* cannot know its step is done. So: remember when the *Apply upgrade*
 * dialog is submitted (session storage — RSI reloads the page on success), and on the reloaded hangar page bring the
 * saved hangar up to date, here, in the signed-in tab — without reading the whole hangar:
 *   1. RSI's hangar log (one request) says which upgrade was used up on which pledge since the submit;
 *   2. the used-up upgrades leave the saved hangar, and the pledges they went onto are read again — from this very
 *      page when they are on it, else from the page they were saved on and its neighbours (rows only move up).
 * Only when the log has nothing yet, or a pledge is not where it was, is the whole hangar read (as *Reload* does).
 * The planner sees the change and marks the step applied. A submit that failed (wrong password) leaves the mark to
 * expire. However the dialog was opened — from RSI+ or by hand.
 */
const APPLIED_MARK = 'rsiplus:upgrade-submitted';
function watchApply(ctx: ContentScriptContext) {
  if (!/^\/(?:[a-z]{2}\/)?account\/pledges/.test(location.pathname)) return;
  ctx.addEventListener(
    document,
    'click',
    (e) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('.js-submit');
      // the apply dialog is the one with the list of pledges to apply onto
      if (!btn || !btn.classList.contains('active') || !document.querySelector('.upgrade-pledge-rows')) return;
      try {
        sessionStorage.setItem(APPLIED_MARK, String(Date.now()));
      } catch {
        /* no session storage: the hangar is reloaded from RSI+ by hand, as before */
      }
    },
    true,
  );
  let at = 0;
  try {
    at = Number(sessionStorage.getItem(APPLIED_MARK)) || 0;
    sessionStorage.removeItem(APPLIED_MARK);
  } catch {
    return;
  }
  if (!at || Date.now() - at > 3 * 60_000) return;
  void afterApply(at);
}

async function afterApply(submittedAt: number) {
  const box = note('RSI+: an upgrade was applied. Updating your saved hangar…', 0);
  const done = (text: string, ms = 8000) => ((box.textContent = text), setTimeout(() => box.remove(), ms));
  try {
    const here = Number(new URLSearchParams(location.search).get('page') || 1);
    const r = await syncApplied({ since: submittedAt, here: { root: document, page: here }, onStep: (t) => (box.textContent = `RSI+: ${t}`), fullWhenUnknown: true });
    if (!r) return void done('RSI+: load your hangar in RSI+ → Pledges to keep your chains up to date.');
    if (r.full) return void done('RSI+: hangar updated. Your chain in RSI+ shows this step as applied (open the CCU planner).');
    const pledges = new Set(r.used.map((u) => u.pledgeId)).size;
    done(`RSI+: saved hangar updated (${r.used.length} upgrade${r.used.length === 1 ? '' : 's'} used, ${pledges} pledge${pledges === 1 ? '' : 's'} read again). Your chain in RSI+ shows the step as applied.`);
  } catch (err) {
    done(`RSI+: could not update your saved hangar (${(err as Error).message}). Reload it in RSI+ → Pledges.`, 10000);
  }
}

/**
 * RSI's *Apply upgrade* dialog lists the pledges the upgrade can go onto (radio rows, loaded a moment after it opens).
 * Point at the one the chain means: outline its row and tag it — nothing else on screen. Nothing is selected or
 * confirmed here; that stays with the user. A note appears only when another pledge is picked, or when RSI does not
 * list that pledge (the earlier steps of the chain are not applied yet, or this upgrade does not fit it).
 */
function guideApply(pledgeId: string) {
  const TAG = 'data-rsiplus-apply';
  const rows = () => [...document.querySelectorAll<HTMLElement>('.upgrade-pledge-rows .row')];
  let tries = 0;
  const look = () => {
    const list = rows();
    if (!list.length) {
      if (tries++ < 60) return void setTimeout(look, 250); // the list loads ~1.5 s after the dialog opens
      return void note("RSI+: RSI's list of pledges did not load. Pick the pledge your chain names in RSI+.", 8000);
    }
    const mine = list.find((r) => r.querySelector<HTMLInputElement>('input[type="radio"]')?.value === pledgeId);
    if (!mine) return void note(`RSI+: RSI does not offer pledge #${pledgeId} for this upgrade. Apply the earlier steps of the chain first, or check the chain in RSI+.`, 12000);
    if (mine.hasAttribute(TAG)) return;
    mine.setAttribute(TAG, '');
    mine.style.cssText += ';outline:2px solid #ffd166;outline-offset:2px;border-radius:6px';
    const tag = document.createElement('span');
    tag.textContent = 'RSI+: your chain';
    tag.style.cssText = 'display:inline-block;margin-left:8px;padding:1px 6px;border-radius:6px;background:#ffd166;color:#10202e;font:700 11px system-ui,sans-serif;vertical-align:middle';
    (mine.querySelector('label') ?? mine).appendChild(tag);
    mine.scrollIntoView({ block: 'nearest' });
    // Quiet unless another pledge is picked: then one warning, gone again when the outlined one is picked.
    let warning: HTMLDivElement | null = null;
    const warn = (e: Event) => {
      const r = (e.target as HTMLElement | null)?.closest<HTMLElement>('.upgrade-pledge-rows .row');
      if (!r) return;
      warning?.remove();
      warning = null;
      if (r !== mine) {
        warning = note(`RSI+: that is not the pledge your chain names (#${pledgeId}, outlined).`, 0);
        warning.style.borderColor = '#ff6b6b';
      }
    };
    document.addEventListener('click', warn, true);
    const gone = setInterval(() => {
      if (document.body.contains(mine)) return;
      clearInterval(gone);
      document.removeEventListener('click', warn, true);
      warning?.remove();
    }, 1000);
  };
  setTimeout(look, 1200);
}

/** Small fixed notice at the bottom of the page; `ms` 0 = until removed by the caller. */
function note(text: string, ms: number): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483001;background:#0f1a24;color:#e8eef5;border:1px solid #ffd166;border-radius:10px;padding:10px 14px;font:600 13px system-ui,sans-serif;box-shadow:0 8px 30px rgb(0 0 0/.5)';
  el.title = 'Click to dismiss';
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

/**
 * The credits box (store credit / UEC / REC) is JS-rendered — the account dropdown / sidebar — so it can appear on
 * any page, any time. Watch the DOM: whenever a node mentioning "store credit" shows up, parse it and keep the
 * numbers with the saved hangar. Also tried once on load for server-rendered account pages. Stops watching after a
 * capture; an SPA navigation re-arms it.
 */
function captureCredits(ctx: ContentScriptContext) {
  const seen = { usd: NaN, uec: NaN, rec: NaN };
  /** true when the page had credits (saved or unchanged). */
  const save = async (): Promise<boolean> => {
    const c = parseCredits(document);
    if (!c) return false;
    if (c.usd === seen.usd && c.uec === seen.uec && c.rec === seen.rec) return true;
    Object.assign(seen, c);
    console.debug('[RSI+] credits', c);
    const cur = await hangarItem.getValue();
    if (!cur) return true; // nothing to attach to yet — load the hangar in RSI+ first
    await hangarItem.setValue({ ...cur, credits: c, creditsAt: Date.now() });
    return true;
  };
  // Throttled: RSI's store app mutates the DOM constantly; scan at most once a second. A credit-ish element is the
  // cheap test; the whole page text only when there is none (≤ once a second).
  let timer: ReturnType<typeof setTimeout> | null = null;
  let mo: MutationObserver | null = null;
  const disarm = () => {
    mo?.disconnect();
    mo = null;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const scan = () => {
    if (!document.querySelector('[class*="credit" i]') && !/store credit/i.test(document.body?.textContent ?? '')) return;
    save()
      .then((ok) => ok && disarm())
      .catch(() => {});
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, 1000);
  };
  const arm = () => {
    if (mo) return;
    mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    schedule();
  };
  arm();
  ctx.addEventListener(window, 'wxt:locationchange', arm);
  ctx.onInvalidated(disarm);
}
