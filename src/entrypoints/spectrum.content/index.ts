import { mount, unmount } from 'svelte';
import ThreadBar from '@/components/ThreadBar.svelte';
import { classify } from '@/lib/capture';
import { HOOK_CONFIG_KEY, HOOK_TAG, type HookConfig } from '@/lib/hook-config';
import { trackPath } from '@/lib/page-path.svelte';
import { firstNewReply, markRead, markUnread, type ReadState } from '@/lib/read';
import { getSettings, getWatches, icIssuesItem, icLinksItem, icMentionsItem, intelItem, intelSuspectsItem, orgCacheItem, patchSettings, readItem, settingsItem, watchesItem, type Settings } from '@/lib/settings';
import { addLink, addMentions, linksOfThread, normalizeCode, pickIssues, removeLink, toggleWatch as toggleIcWatch, type IcIssues, type IcLinks, type IcMentions } from '@/lib/issue-council';
import { toast, ui } from '@/lib/state.svelte';
import { parsePath, threadUrl, type ThreadSummary } from '@/lib/types';
import { NO_WATCHES, type Watches } from '@/lib/watch';
import { threatOf, type Intel, type Suspects } from '@/lib/intel';
import { mainOrgFromBadges, type OrgCache } from '@/lib/orgs';
import type { Member } from '@/lib/types';
import { decorate, pageCodes, setDecorState, undecorate } from './decorate';
import { startKeys } from './keys';
import themeCss from './theme.css?inline';

/** slug -> latest thread data seen in any payload. */
export const threads = new Map<string, ThreadSummary>();
/** Slugs that came from a channel/search list payload (only these rows get painted). */
export const listed = new Set<string>();
let read: ReadState = {};
let watches: Watches = NO_WATCHES;
let ic: IcIssues = {};
let icMentions: IcMentions = {};
let icLinks: IcLinks = {};
let intel: Intel = {};
let suspects: Suspects = {};
let orgCache: OrgCache = {};
/** Main org per author (lower-case nickname), from the member badges in Spectrum's own payloads. */
const mainOrgs = new Map<string, { sid: string; name: string }>();
function noteMember(m: Member | null | undefined) {
  const o = m?.nickname ? mainOrgFromBadges(m) : null;
  if (o) mainOrgs.set(m!.nickname.toLowerCase(), o);
}
/** Org lookup tags for an author: their full org list when cached (Friends / lookups), else their main org. */
function intelOf(nickname: string) {
  if (!Object.keys(intel).length) return null;
  const key = nickname.toLowerCase();
  const main = mainOrgs.get(key);
  const orgs = orgCache[key]?.orgs ?? (main ? [{ ...main, main: true, redacted: false }] : []);
  const t = threatOf(nickname, orgs, intel, suspects);
  return t.tag ? t : null;
}

// Thread opens save the read marks debounced: the state is up to MAX_MARKS entries (~300 KB a write) and one open
// marks twice (route + payload). Explicit actions flush at once; so does leaving the page.
let saveTimer = 0;
/** Marks set here and not written yet (kept when another tab writes meanwhile). */
const pendingRead = new Set<string>();
function saveReadSoon(id: string) {
  pendingRead.add(id);
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushRead, 1500);
}
function flushRead(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = 0;
  pendingRead.clear();
  return readItem.setValue(read);
}

export default defineContentScript({
  matches: ['https://robertsspaceindustries.com/spectrum/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  async main(ctx) {
    injectStyle();
    applySettings(await getSettings());
    settingsItem.watch(async () => applySettings(await getSettings()));
    read = await readItem.getValue();
    readItem.watch((v) => {
      const mine = read;
      read = v ?? {};
      for (const id of pendingRead) if (mine[id]) read = { ...read, [id]: mine[id] };
      refresh();
    });
    const flushPending = () => void (saveTimer && flushRead());
    ctx.addEventListener(window, 'pagehide', flushPending);
    ctx.onInvalidated(flushPending);
    ic = await icIssuesItem.getValue();
    icIssuesItem.watch((v) => {
      ic = v ?? {};
      refresh();
    });
    icMentions = await icMentionsItem.getValue();
    icMentionsItem.watch((v) => (icMentions = v ?? {}));
    intel = await intelItem.getValue();
    orgCache = await orgCacheItem.getValue();
    intelItem.watch((v) => ((intel = v ?? {}), refresh()));
    suspects = await intelSuspectsItem.getValue();
    intelSuspectsItem.watch((v) => ((suspects = v ?? {}), refresh()));
    orgCacheItem.watch((v) => ((orgCache = v ?? {}), refresh()));
    icLinks = await icLinksItem.getValue();
    syncLinked();
    icLinksItem.watch((v) => {
      icLinks = v ?? {};
      syncLinked();
      refresh();
    });
    watches = await getWatches();
    watchesItem.watch(async () => {
      watches = await getWatches();
      syncWatched();
      refresh();
    });

    window.addEventListener('message', (e) => {
      if (e.source !== window || e.data?.[HOOK_TAG] !== 'api') return;
      onCaptured(e.data.payload.path, e.data.payload.json);
    });

    trackPath(ctx);
    ctx.addEventListener(window, 'wxt:locationchange', (e) => onRoute(e.newUrl.pathname));
    await domReady();
    onRoute();
    let pending = 0;
    const observer = new MutationObserver((muts) => {
      // Ignore our own badge/button insertions.
      if (muts.every((m) => [...m.addedNodes].every((n) => n instanceof HTMLElement && n.closest('.sp-ui')))) return;
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = 0;
        refresh();
      }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Sticky footers can move as the thread scrolls (they unstick at the end): re-measure once a frame at most.
    let liftQueued = false;
    const liftSoon = () => {
      if (liftQueued) return;
      liftQueued = true;
      requestAnimationFrame(() => ((liftQueued = false), liftBar()));
    };
    ctx.addEventListener(window, 'resize', liftSoon);
    ctx.addEventListener(document, 'scroll', liftSoon, { capture: true, passive: true });
    ctx.onInvalidated(() => observer.disconnect());
    startKeys(ctx, actions);

    const bar = await createShadowRootUi(ctx, {
      name: 'spectrum-plus',
      position: 'overlay',
      zIndex: 2147483000, // no effect: WXT resets the host with `:host { all: initial !important }`; see site-bar.css
      anchor: 'html',
      onMount: (root) => mount(ThreadBar, { target: root, props: { actions } }),
      onRemove: (app) => app && unmount(app),
    });
    bar.mount();
    console.info('%c[RSI+]', 'color:#3cc8ff', 'content script ready');
  },
});

function domReady() {
  return document.readyState === 'loading' ? new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true })) : Promise.resolve();
}

function injectStyle() {
  const style = document.createElement('style');
  style.id = 'spectrum-plus-style';
  style.textContent = themeCss;
  (document.head ?? document.documentElement).append(style);
}

function applySettings(s: Settings) {
  ui.settings = s;
  /** Settings → Spectrum tools: off leaves the page as Spectrum draws it (no classes, no hook filtering, no paint). */
  const on = s.spectrumTools;
  const root = document.documentElement.classList;
  root.toggle('sp-theme', on && s.theme);
  root.toggle('sp-wide', on && s.wide);
  root.toggle('sp-compact', on && s.compact);
  root.toggle('sp-dev', on && s.devHighlight);
  root.toggle('sp-hide-read', on && s.readTracking && s.hideRead);
  root.toggle('sp-mute-hide', on && s.muteMode === 'hide');
  const cfg: HookConfig = { dropMuted: on && s.muteMode === 'hide', mutes: s.mutes };
  try {
    localStorage.setItem(HOOK_CONFIG_KEY, JSON.stringify(cfg));
  } catch {}
  window.postMessage({ [HOOK_TAG]: 'config', config: cfg }, location.origin);
  refresh();
}

function refresh() {
  if (!document.body) return;
  if (!ui.settings.spectrumTools) return void undecorate();
  liftBar();
  setDecorState({ settings: ui.settings, read, watches, threads, listed, ic, icMentions, icLinks, intelOf });
  decorate(actions);
  recordMentions();
}

/** Issue Council codes in this thread's replies → `icMentions` (the issue page lists the threads). Once per thread + code set. */
let mentionKey = '';
function recordMentions() {
  const { slug, channelId } = parsePath(location.pathname);
  if (!slug || !channelId || !pageCodes.length) return;
  // The subject arrives with the thread payload, possibly after the replies render: record again once it is known.
  const subject = threads.get(slug)?.subject ?? ui.view?.thread.subject ?? slug;
  const key = `${slug}|${subject}|${pageCodes.join(',')}`;
  if (key === mentionKey) return;
  mentionKey = key;
  const codes = pageCodes;
  icMentionsItem
    .getValue()
    .then((m) => icMentionsItem.setValue(addMentions(m, codes, { slug, channelId, subject }, Date.now())))
    .catch(() => {});
}

/**
 * Spectrum pins its own controls to the bottom right of a thread (reply pager "1 / 6", Reply) — right where the bar
 * sits. Lift the bar above whatever is pinned there. Spectrum is an app layout: the replies scroll inside their own
 * container and the footer is a plain element under it, so "pinned" isn't `position: fixed`; it is "not inside
 * anything that scrolls" (or fixed / sticky). Only on forum pages (the only pages with a bar); runs with `refresh`
 * (throttled by the DOM observer), on resize and on scroll.
 */
function liftBar() {
  if (!parsePath(location.pathname).channelId) return void (ui.barLift = 0);
  const host = document.querySelector('spectrum-plus');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const docScrolls = (document.scrollingElement?.scrollHeight ?? 0) > vh + 1;
  let lift = 0;
  const done = new Set<Element>();
  // Sample the strip the bar occupies (right ~500 px, bottom ~60 px): Spectrum's footer (`.list-navigator`: pager,
  // Reply) is narrower than the bar and may stop short of the window edge.
  for (const x of [vw - 30, vw - 120, vw - 220, vw - 380, vw - 500])
    for (const y of [vh - 6, vh - 24, vh - 44]) {
      if (x < 0 || y < 0) continue;
      for (const hit of document.elementsFromPoint(x, y)) {
        if (done.has(hit) || host?.contains(hit) || hit === document.body || hit === document.documentElement) continue;
        done.add(hit);
        const top = pinnedStripTop(hit, vh, docScrolls);
        if (top !== null) lift = Math.max(lift, vh - top);
      }
    }
  lift = Math.round(Math.min(lift, vh / 3));
  if (lift !== ui.barLift) {
    ui.barLift = lift;
    console.debug('[RSI+] bar lifted', lift, 'px');
  }
}

/**
 * Top of the strip `hit` belongs to (its outermost ancestor shorter than a third of the window that reaches the
 * bottom ~60 px), when that strip stays put while the page scrolls: it, or an ancestor, is fixed / sticky, or nothing
 * between it and the page scrolls (and the page itself doesn't). Else null.
 */
function pinnedStripTop(hit: Element, vh: number, docScrolls: boolean): number | null {
  let strip: Element | null = null;
  let pinned = !docScrolls;
  // An absolutely positioned element moves with its containing block (offsetParent), not with the elements between:
  // a footer placed against the page sits inside the reply scroller in the DOM but doesn't scroll with it.
  const up = (n: Element, cs: CSSStyleDeclaration): Element | null =>
    cs.position === 'absolute' && n instanceof HTMLElement ? n.offsetParent : n.parentElement;
  for (let n: Element | null = hit, cs: CSSStyleDeclaration; n && n !== document.body && n !== document.documentElement; n = up(n, cs)) {
    cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || cs.display === 'contents') continue;
    const r = n.getBoundingClientRect();
    if (r.height > 0 && r.height < vh / 3 && r.bottom >= vh - 60 && r.top < vh) strip = n;
    if (cs.position === 'fixed' || cs.position === 'sticky') {
      pinned = true;
      break;
    }
    if (/(auto|scroll|overlay)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return null; // scrolls with the content
  }
  return strip && pinned ? strip.getBoundingClientRect().top : null;
}

function onCaptured(path: string, json: any) {
  const c = classify(path, json);
  if (!c) return;
  if (c.kind === 'list') {
    for (const t of c.threads) {
      threads.set(t.slug, t);
      listed.add(t.slug);
      noteMember(t.member);
    }
    refresh();
  } else if (c.kind === 'thread') {
    threads.set(c.thread.slug, c.thread);
    noteMember(c.thread.member);
    for (const r of c.thread.replies ?? []) noteMember(r.member);
    if (parsePath(location.pathname).slug === c.thread.slug) openThread(c.thread, c.thread.replies);
  }
}

/** `pathname`: the page being entered (on a route change `location` may still hold the old one — see `page-path`). */
function onRoute(pathname = location.pathname) {
  const { slug } = parsePath(pathname);
  if (!slug) ui.view = null;
  else if (ui.view?.thread.slug !== slug) {
    ui.view = null;
    const t = threads.get(slug);
    if (t) openThread(t, undefined); // payload may have been cached by the app; mark from list data
  }
  syncWatched();
  refresh();
}

function openThread(t: ThreadSummary, replies: import('@/lib/types').Reply[] | undefined) {
  const prev = read[t.id];
  const same = ui.view?.thread.id === t.id;
  const first = same ? null : firstNewReply(replies, prev);
  ui.view = same
    ? { ...ui.view!, thread: t }
    : {
        thread: t,
        firstVisit: !prev,
        newCount: prev ? Math.max(0, t.replies_count - prev.replies) : 0,
        firstNewUrl: first ? threadUrl(t.channel_id, t.slug, first.id) : null,
      };
  syncWatched();
  if (!ui.settings.spectrumTools) return;
  if (ui.settings.readTracking) {
    read = markRead(read, t);
    saveReadSoon(t.id);
  }
  // Seen it: a watched thread shouldn't notify about replies you just read.
  if (watches.threads.some((w) => w.id === t.id && w.replies < t.replies_count))
    watchesItem.setValue({ ...watches, threads: watches.threads.map((w) => (w.id === t.id ? { ...w, replies: t.replies_count } : w)) });
}

function syncWatched() {
  const v = ui.view;
  ui.watched = !!v && watches.threads.some((w) => w.id === v.thread.id);
  syncLinked();
}
/** Issue Council issues linked to the open thread (thread bar chips). */
function syncLinked() {
  const slug = ui.view?.thread.slug;
  const codes = slug ? linksOfThread(icLinks, slug) : [];
  if (codes.join(',') !== ui.linked.join(',')) ui.linked = codes;
}

/** Actions shared by the thread bar, row buttons, and keyboard shortcuts. */
export const actions = {
  async toggleWatch(t: ThreadSummary) {
    const w = await getWatches();
    const on = w.threads.some((x) => x.id === t.id);
    await watchesItem.setValue({
      ...w,
      threads: on
        ? w.threads.filter((x) => x.id !== t.id)
        : [...w.threads, { id: t.id, slug: t.slug, channelId: t.channel_id, subject: t.subject, replies: t.replies_count, addedAt: Date.now() }],
    });
    toast(on ? `Stopped watching "${t.subject}"` : `Watching "${t.subject}" — you'll be notified of new replies`);
  },
  async toggleWatchChannel(id: string, name: string) {
    const w = await getWatches();
    const on = w.channels.some((c) => c.id === id);
    await watchesItem.setValue({
      ...w,
      channels: on ? w.channels.filter((c) => c.id !== id) : [...w.channels, { id, name, lastThreadId: null, allThreads: false }],
    });
    toast(on ? `Stopped watching ${name}` : `Watching ${name} — dev posts and watched authors notify (change in the hub)`);
  },
  isWatched: (id: string) => watches.threads.some((w) => w.id === id),
  isChannelWatched: (id: string) => watches.channels.some((c) => c.id === id),
  async markRead(t: ThreadSummary) {
    read = markRead(read, t);
    await flushRead();
  },
  async markUnread(t: ThreadSummary) {
    read = markUnread(read, t.id);
    await flushRead();
    toast(`Marked "${t.subject}" unread`);
  },
  async markAllListedRead() {
    const { channelId } = parsePath(location.pathname);
    let n = 0;
    for (const slug of listed) {
      const t = threads.get(slug);
      if (!t || (channelId && t.channel_id !== channelId)) continue;
      read = markRead(read, t);
      n++;
    }
    await flushRead();
    toast(`Marked ${n} thread${n === 1 ? '' : 's'} read`);
  },
  async mute(nickname: string) {
    const s = await getSettings();
    const nick = nickname.toLowerCase();
    if (s.mutes.authors.includes(nick)) return;
    await patchSettings({ mutes: { ...s.mutes, authors: [...s.mutes.authors, nick] } });
    toast(`Muted @${nickname}`, async () => {
      const cur = await getSettings();
      await patchSettings({ mutes: { ...cur.mutes, authors: cur.mutes.authors.filter((a) => a !== nick) } });
    });
  },
  /** Reply's Watch author button: watch, or stop watching when already watched. */
  async toggleAuthor(nickname: string, displayname: string) {
    const w = await getWatches();
    const nick = nickname.toLowerCase();
    if (w.authors.some((a) => a.nickname.toLowerCase() === nick)) {
      await watchesItem.setValue({ ...w, authors: w.authors.filter((a) => a.nickname.toLowerCase() !== nick) });
      return toast(`Stopped watching @${nickname}`);
    }
    await watchesItem.setValue({ ...w, authors: [...w.authors, { nickname, displayname }] });
    toast(
      w.channels.length
        ? `Watching @${nickname} in your ${w.channels.length} watched channel${w.channels.length === 1 ? '' : 's'}`
        : `Watching @${nickname} — also watch a channel so there's somewhere to look`,
    );
  },
  thread: (slug: string) => threads.get(slug),
  /** Open the hub's Org lookup on a player. */
  lookUp: (nickname: string) => browser.runtime.sendMessage({ type: 'hub:open', tab: 'intel', params: { player: nickname } }),
  /** Issue Council (when RSI+ has seen any): watch from a STARC chip's card, link the open thread to an issue. */
  icIssue: (code: string) => ic[code],
  icPick: (q: string) => pickIssues(ic, q),
  icThreads: (code: string) => ({ mentions: icMentions[code] ?? [], links: icLinks[code] ?? [] }),
  async toggleIcWatch(code: string) {
    const cur = await icIssuesItem.getValue();
    const snap = cur[code] ?? { code, title: '', status: '', contributions: null };
    const on = toggleIcWatch(cur, snap, Date.now());
    await icIssuesItem.setValue(cur);
    toast(on ? `Watching ${code} in RSI+: changes reach the Feed when an Issue Council page shows them` : `Stopped watching ${code}`);
    return on;
  },
  /** Link the open thread to an issue: a code, "123456", or an issue URL. false when it isn't one. */
  async linkIssue(input: string) {
    const code = normalizeCode(input);
    const t = ui.view?.thread;
    if (!code || !t) return false;
    await icLinksItem.setValue(addLink(await icLinksItem.getValue(), code, { slug: t.slug, channelId: t.channel_id, subject: t.subject }, Date.now()));
    toast(`Linked ${code} to this thread`);
    return true;
  },
  async unlinkIssue(code: string, slug = ui.view?.thread.slug) {
    if (!slug) return;
    await icLinksItem.setValue(removeLink(await icLinksItem.getValue(), code, slug));
    toast(`Unlinked ${code}`);
  },
  openHub: (tab?: import('@/lib/messages').HubTab) => browser.runtime.sendMessage({ type: 'hub:open', tab }),
};
export type Actions = typeof actions;
