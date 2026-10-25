import { mount, unmount } from 'svelte';
import ThreadBar from '@/components/ThreadBar.svelte';
import { classify } from '@/lib/capture';
import { HOOK_CONFIG_KEY, HOOK_TAG, type HookConfig } from '@/lib/hook-config';
import { firstNewReply, markRead, markUnread, type ReadState } from '@/lib/read';
import { getSettings, getWatches, patchSettings, readItem, settingsItem, watchesItem, type Settings } from '@/lib/settings';
import { toast, ui } from '@/lib/state.svelte';
import { parsePath, threadUrl, type ThreadSummary } from '@/lib/types';
import { NO_WATCHES, type Watches } from '@/lib/watch';
import { decorate, setDecorState } from './decorate';
import { startKeys } from './keys';
import themeCss from './theme.css?inline';

/** slug -> latest thread data seen in any payload. */
export const threads = new Map<string, ThreadSummary>();
/** Slugs that came from a channel/search list payload (only these rows get painted). */
export const listed = new Set<string>();
let read: ReadState = {};
let watches: Watches = NO_WATCHES;

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

    ctx.addEventListener(window, 'wxt:locationchange', () => onRoute());
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
    ctx.onInvalidated(() => observer.disconnect());
    startKeys(ctx, actions);

    const bar = await createShadowRootUi(ctx, {
      name: 'spectrum-plus',
      position: 'overlay',
      zIndex: 2147483000,
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
  const root = document.documentElement.classList;
  root.toggle('sp-theme', s.theme);
  root.toggle('sp-wide', s.wide);
  root.toggle('sp-compact', s.compact);
  root.toggle('sp-dev', s.devHighlight);
  root.toggle('sp-hide-read', s.readTracking && s.hideRead);
  root.toggle('sp-mute-hide', s.muteMode === 'hide');
  const cfg: HookConfig = { dropMuted: s.muteMode === 'hide', mutes: s.mutes };
  try {
    localStorage.setItem(HOOK_CONFIG_KEY, JSON.stringify(cfg));
  } catch {}
  window.postMessage({ [HOOK_TAG]: 'config', config: cfg }, location.origin);
  refresh();
}

function refresh() {
  if (!document.body) return;
  setDecorState({ settings: ui.settings, read, watches, threads, listed });
  decorate(actions);
}

function onCaptured(path: string, json: any) {
  const c = classify(path, json);
  if (!c) return;
  if (c.kind === 'list') {
    for (const t of c.threads) {
      threads.set(t.slug, t);
      listed.add(t.slug);
    }
    refresh();
  } else if (c.kind === 'thread') {
    threads.set(c.thread.slug, c.thread);
    if (parsePath(location.pathname).slug === c.thread.slug) openThread(c.thread, c.thread.replies);
  }
}

function onRoute() {
  const { slug } = parsePath(location.pathname);
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
  async watchAuthor(nickname: string, displayname: string) {
    const w = await getWatches();
    if (w.authors.some((a) => a.nickname.toLowerCase() === nickname.toLowerCase())) return toast(`Already watching @${nickname}`);
    await watchesItem.setValue({ ...w, authors: [...w.authors, { nickname, displayname }] });
    toast(
      w.channels.length
        ? `Watching @${nickname} in your ${w.channels.length} watched channel${w.channels.length === 1 ? '' : 's'}`
        : `Watching @${nickname} — also watch a channel so there's somewhere to look`,
    );
  },
  thread: (slug: string) => threads.get(slug),
  openHub: (tab?: import('@/lib/messages').HubTab) => browser.runtime.sendMessage({ type: 'hub:open', tab }),
};
export type Actions = typeof actions;
