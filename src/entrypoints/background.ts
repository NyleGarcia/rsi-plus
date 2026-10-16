import * as api from '@/lib/api';
import { normThread } from '@/lib/capture';
import { appendLog, blankNote, markRemoved, partyActive, partyEvent, partyTargets, requestEvents, touchNotes, type PartyLogEntry } from '@/lib/friends';
import { respond, type BgRequest, type BgResponses, type BulkResult, type HubTab } from '@/lib/messages';
import { citizenOrgsUrl, ORG_TTL, parseCitizenOrgs, type OrgCache } from '@/lib/orgs';
import {
  feedItem,
  friendNotesItem,
  getSettings,
  getWatches,
  lastPollItem,
  orgCacheItem,
  presenceItem,
  seenRequestsItem,
  partyModeItem,
  partyLogItem,
  catalogItem,
  ccuChainsItem,
  paintCatalogItem,
  saleHistoryItem,
  wishlistItem,
  settingsItem,
  watchesItem,
} from '@/lib/settings';
import { ding } from '@/lib/sound';
import { chainEvents } from '@/lib/ccu';
import { fetchCatalog, fetchPaints, recordSales, wishlistEvents, type Catalog, type PaintCatalog } from '@/lib/store';
import { threadUrl } from '@/lib/types';
import { channelEvents, friendEvents, keywordsFor, mergeEvents, threadEvents, type FeedEvent } from '@/lib/watch';

const ALARM = 'spectrumplus:poll';
const PARTY_ALARM = 'spectrumplus:party';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default defineBackground(() => {
  // Dev only: WXT's hot reload registers content scripts from every background; under `incognito: split` the two
  // backgrounds race and the loser rejects with "Duplicate script ID". Registration is extension-wide, so the
  // first one did the job — keep the console clean.
  if (import.meta.env.DEV) {
    self.addEventListener('unhandledrejection', (e) => {
      if (/Duplicate script ID/.test(String((e as PromiseRejectionEvent).reason))) e.preventDefault();
    });
  }
  browser.runtime.onMessage.addListener((msg: BgRequest, sender, sendResponse) => {
    respond(handle(msg, sender.tab?.windowId)).then(sendResponse);
    return true; // async response
  });
  browser.runtime.onInstalled.addListener(() => schedule());
  browser.runtime.onStartup.addListener(() => schedule());
  settingsItem.watch(() => schedule());
  feedItem.watch((f) => updateBadge(f ?? []));
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) poll().catch((e) => console.warn('[RSI+] poll', e));
    if (a.name === PARTY_ALARM) partyTick().catch((e) => console.warn('[RSI+] party', e));
  });
  // Party mode: check every minute while on; turning it on checks right away.
  partyModeItem.watch(() => syncPartyAlarm(true));
  syncPartyAlarm(false);
  browser.notifications.onClicked.addListener(async (id) => {
    const ev = (await feedItem.getValue()).find((e) => e.key === id);
    if (ev) {
      // Hub links go through openHub (right window, reuse); others open in this context's last focused window —
      // under `incognito: split` that is an incognito window for the incognito background.
      const hub = /^hub\.html#(\w+)/.exec(ev.url);
      if (hub) await openHub(hub[1] as HubTab);
      else {
        const win = await browser.windows.getLastFocused().catch(() => null);
        await browser.tabs.create({ url: ev.url, ...(win?.id != null ? { windowId: win.id } : {}) });
      }
      await markSeen([id]);
    }
    browser.notifications.clear(id);
  });
});

async function handle(msg: BgRequest, senderWindow?: number): Promise<BgResponses[BgRequest['type']]> {
  switch (msg.type) {
    case 'poll:now':
      return poll();
    case 'hub:open':
      return openHub(msg.tab, msg.params, msg.windowId ?? senderWindow);
    case 'feed:seen':
      await markSeen(msg.keys);
      return { ok: true };
    case 'channels:list':
      return api.channels();
    case 'friends:get':
      return friends();
    case 'friends:remove': {
      const r = await bulk(msg.ids, (id) => api.removeFriend(id));
      if (r.done.length) await friendNotesItem.setValue(markRemoved(await friendNotesItem.getValue(), r.done));
      return r;
    }
    case 'friends:request': {
      const fn = { accept: api.acceptRequest, decline: api.declineRequest, cancel: api.cancelRequest }[msg.action];
      return bulk(msg.ids, fn);
    }
    case 'orgs:get':
      return orgs(msg.nicknames, !!msg.force);
    case 'catalog:get':
      return catalog(!!msg.fresh);
    case 'paints:get':
      return paints(!!msg.fresh);
    case 'sound:ding':
      await ding();
      return { ok: true };
  }
}

/** Poll alarm from settings: every `pollMinutes`, or none at all in passive mode (then only *Check now* polls). */
async function schedule() {
  const { pollMinutes, pollAuto } = await getSettings();
  if (!pollAuto) {
    await browser.alarms.clear(ALARM);
    return;
  }
  const period = Math.max(2, pollMinutes || 5);
  const cur = await browser.alarms.get(ALARM);
  if (cur?.periodInMinutes !== period) browser.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: 1 });
}

/**
 * Open (or focus) the hub in the window the request came from. Matters for incognito: a hub tab must stay in an
 * incognito window (split build: own login; dev/spanning build: otherwise it lands in the normal window), so an
 * existing hub tab is reused only when its incognito-ness matches.
 */
async function openHub(tab: HubTab = 'feed', params?: Record<string, string>, windowId?: number) {
  const q = params ? `?${new URLSearchParams(params)}` : '';
  const url = browser.runtime.getURL(`/hub.html#${tab}${q}` as '/hub.html');
  const win = await (windowId != null ? browser.windows.get(windowId) : browser.windows.getLastFocused()).catch(() => null);
  const existing = (await browser.tabs.query({ url: browser.runtime.getURL('/hub.html*') })).find((t) => !win || t.incognito === win.incognito);
  if (existing?.id != null) {
    await browser.tabs.update(existing.id, { active: true, url });
    if (existing.windowId != null) await browser.windows.update(existing.windowId, { focused: true });
  } else await browser.tabs.create({ url, ...(win?.id != null ? { windowId: win.id } : {}) });
  return { ok: true as const };
}

async function markSeen(keys?: string[]) {
  const set = keys ? new Set(keys) : null;
  await feedItem.setValue((await feedItem.getValue()).map((e) => (!set || set.has(e.key) ? { ...e, seen: true } : e)));
}

function updateBadge(feed: FeedEvent[]) {
  const n = feed.filter((e) => !e.seen).length;
  const action = browser.action ?? browser.browserAction; // MV3 `action`; Firefox MV2 still calls it `browserAction`
  action.setBadgeText({ text: n ? String(n > 99 ? '99+' : n) : '' });
  action.setBadgeBackgroundColor({ color: '#3cc8ff' });
}

let polling: Promise<BgResponses['poll:now']> | null = null;
function poll() {
  polling ??= doPoll().finally(() => (polling = null));
  return polling;
}

/** One pass over every watch. Errors are per item; the rest still runs. */
async function doPoll(): Promise<BgResponses['poll:now']> {
  const s = await getSettings();
  const w = await getWatches();
  const now = Date.now();
  const events: FeedEvent[] = [];
  const errors: string[] = [];
  const replies = new Map<string, { replies: number; subject: string }>();
  const lastIds = new Map<string, string | null>();

  for (const t of w.threads) {
    try {
      const fresh = normThread(await api.thread(t.slug));
      if (fresh) {
        events.push(...threadEvents(t, fresh, threadUrl(t.channelId, t.slug), now));
        replies.set(t.id, { replies: fresh.replies_count, subject: fresh.subject });
      }
    } catch (e) {
      errors.push(`${t.subject}: ${(e as Error).message}`);
    }
    await sleep(400);
  }
  for (const c of w.channels) {
    try {
      const list = await api.channelThreads(c.id);
      const threads = list.threads.map(normThread).filter((t) => !!t);
      const r = channelEvents(c, threads, w.authors.map((a) => a.nickname), (t) => threadUrl(c.id, t.slug), now, keywordsFor(w, c.id));
      events.push(...r.events);
      lastIds.set(c.id, r.lastThreadId);
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
    await sleep(400);
  }
  // Friends snapshot every poll: timestamps newly added / re-added friends, presence for "came online".
  try {
    const f = await api.friendsData();
    const prev = await presenceItem.getValue();
    events.push(...friendEvents(prev, f.friends, w.friendsOnline, s.notifyAllFriends, now));
    await presenceItem.setValue(Object.fromEntries(f.friends.map((m) => [m.id, m.presence?.status ?? 'offline'])));
    const notes = await snapshot(f, now);
    events.push(...requestEvents(await seenRequestsItem.getValue(), f.requests, f.me.id, now));
    await seenRequestsItem.setValue(f.requests.filter((r) => r.target_member_id === f.me.id).map((r) => r.id));
    const party = partyEvent(notes, new Set(f.friends.map((m) => m.id)), s.partyRemindHours, now);
    if (party) events.push(party);
  } catch (e) {
    if ((e as api.SpectrumError).code !== 'ErrNotLoggedIn') errors.push(`friends: ${(e as Error).message}`);
  }

  // Store: refresh the public catalog (every 30 min with a wishlist, else 6 h) and check wishlist prices.
  try {
    const wish = await wishlistItem.getValue();
    const cached = await catalogItem.getValue();
    if (!cached || now - cached.at > (wish.length ? 30 * 60_000 : 6 * 3600_000)) {
      const cat = await catalog(true);
      const r = wishlistEvents(wish, cat.ships, now);
      events.push(...r.events);
      const cur = await wishlistItem.getValue();
      await wishlistItem.setValue(cur.map((w) => (r.lowest.has(w.id) ? { ...w, lowest: r.lowest.get(w.id)! } : w)));
      // Long-term CCU goals: a saved chain's "wait for a sale" step whose CCU is in the store now.
      events.push(...chainEvents(await ccuChainsItem.getValue(), cat.ships, now));
    }
  } catch (e) {
    errors.push(`store: ${(e as Error).message}`);
  }

  // Re-read before writing: the user may have edited watches while we polled.
  const cur = await getWatches();
  await watchesItem.setValue({
    ...cur,
    threads: cur.threads.map((t) => (replies.has(t.id) ? { ...t, ...replies.get(t.id)! } : t)),
    channels: cur.channels.map((c) => (lastIds.has(c.id) ? { ...c, lastThreadId: lastIds.get(c.id)! } : c)),
  });
  const before = await feedItem.getValue();
  const merged = mergeEvents(before, events);
  const added = merged.filter((e) => !before.some((b) => b.key === e.key));
  await feedItem.setValue(merged);
  if (s.notify)
    for (const e of added.slice(0, 5))
      browser.notifications.create(e.key, { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: e.title, message: e.body });
  const error = errors.length ? errors.join('\n') : null;
  await lastPollItem.setValue({ at: now, error });
  return { events: added.length, error };
}

async function friends(): Promise<api.FriendsData> {
  const f = await api.friendsData();
  await snapshot(f, Date.now());
  return f;
}

/**
 * Record added / removed / last-online for the fetched list. An empty list never counts as complete (a payload
 * shape change must not mark everyone unfriended); hub unfriends are marked directly via markRemoved.
 */
async function snapshot(f: api.FriendsData, now: number) {
  const notes = await friendNotesItem.getValue();
  const touched = touchNotes(notes, f.friends, now, f.friends.length > 0);
  if (touched) await friendNotesItem.setValue(touched);
  return touched ?? notes;
}

async function bulk(ids: string[], fn: (id: string) => Promise<unknown>): Promise<BulkResult> {
  const out: BulkResult = { done: [], failed: [] };
  for (const id of ids) {
    try {
      await fn(id);
      out.done.push(id);
    } catch (e) {
      out.failed.push({ id, error: (e as Error).message });
    }
    await sleep(500);
  }
  return out;
}

/** Fetch citizen org pages for the given nicknames (stale/missing only unless forced), ~1 req/s. */
async function orgs(nicknames: string[], force: boolean): Promise<OrgCache> {
  let cache = await orgCacheItem.getValue();
  const now = Date.now();
  const out: OrgCache = {};
  let first = true;
  for (const nick of nicknames) {
    const key = nick.toLowerCase();
    const hit = cache[key];
    if (hit && !force && now - hit.at < ORG_TTL) {
      out[key] = hit;
      continue;
    }
    if (!first) await sleep(1000);
    first = false;
    try {
      const res = await fetch(citizenOrgsUrl(nick), { credentials: 'omit' });
      out[key] = res.ok ? { at: now, orgs: parseCitizenOrgs(await res.text()) } : { at: now, orgs: [], error: `HTTP ${res.status}` };
    } catch (e) {
      out[key] = { at: now, orgs: hit?.orgs ?? [], error: (e as Error).message };
    }
    cache = { ...(await orgCacheItem.getValue()), [key]: out[key]! };
    await orgCacheItem.setValue(cache);
  }
  return out;
}

let catalogPromise: Promise<Catalog> | null = null;
/** Public pledge-store catalog; cached 30 min unless `fresh`. */
async function catalog(fresh: boolean): Promise<Catalog> {
  const cached = await catalogItem.getValue();
  if (!fresh && cached && Date.now() - cached.at < 30 * 60_000) return cached;
  catalogPromise ??= fetchCatalog()
    .then(async (c) => {
      await catalogItem.setValue(c);
      await saleHistoryItem.setValue(recordSales(await saleHistoryItem.getValue(), c.ships, c.at));
      return c;
    })
    .finally(() => (catalogPromise = null));
  return catalogPromise;
}

let paintsPromise: Promise<PaintCatalog> | null = null;
/** Public store paint listing; cached 6 h unless `fresh`. */
async function paints(fresh: boolean): Promise<PaintCatalog> {
  const cached = await paintCatalogItem.getValue();
  if (!fresh && cached && Date.now() - cached.at < 6 * 60 * 60_000) return cached;
  paintsPromise ??= fetchPaints()
    .then(async (c) => (await paintCatalogItem.setValue(c), c))
    .finally(() => (paintsPromise = null));
  return paintsPromise;
}

async function syncPartyAlarm(runNow: boolean) {
  const mode = await partyModeItem.getValue();
  if (!partyActive(mode, Date.now())) {
    await browser.alarms.clear(PARTY_ALARM);
    return;
  }
  if (!(await browser.alarms.get(PARTY_ALARM))) browser.alarms.create(PARTY_ALARM, { periodInMinutes: 1 });
  if (runNow) partyTick().catch((e) => console.warn('[RSI+] party', e));
}

let partyRunning: Promise<void> | null = null;
function partyTick() {
  partyRunning ??= doPartyTick().finally(() => (partyRunning = null));
  return partyRunning;
}

/** Accept every new incoming friend request, flag as party friend, log it, notify. */
async function doPartyTick() {
  const now = Date.now();
  const mode = await partyModeItem.getValue();
  if (!partyActive(mode, now)) {
    if (mode?.on) await partyModeItem.setValue({ ...mode, on: false }); // expired → off (watch clears the alarm)
    return;
  }
  const f = await api.friendsData();
  const targets = partyTargets(f.requests, f.me.id, await partyLogItem.getValue());
  if (!targets.length) return;
  const entries: PartyLogEntry[] = [];
  for (const r of targets) {
    const m = r.members?.find((x) => x.id === r.requesting_member_id);
    const base = { at: Date.now(), requestId: r.id, memberId: r.requesting_member_id, nickname: m?.nickname ?? '', displayname: m?.displayname ?? m?.nickname ?? `Member ${r.requesting_member_id}` };
    try {
      await api.acceptRequest(r.id);
      entries.push({ ...base, ok: true });
    } catch (e) {
      entries.push({ ...base, ok: false, error: (e as Error).message });
    }
    await sleep(500);
  }
  await partyLogItem.setValue(appendLog(await partyLogItem.getValue(), entries));
  const accepted = entries.filter((e) => e.ok);
  if (accepted.length) {
    const notes = await friendNotesItem.getValue();
    const next = { ...notes };
    for (const e of accepted) next[e.memberId] = { ...(next[e.memberId] ?? blankNote(e.at)), firstSeen: e.at, party: true, partyAt: e.at, removedAt: undefined };
    await friendNotesItem.setValue(next);
    const ev: FeedEvent = {
      key: `party-accept:${accepted.map((e) => e.requestId).join(',')}`,
      kind: 'friend',
      title: `Party mode: accepted ${accepted.length} friend request${accepted.length === 1 ? '' : 's'}`,
      body: accepted.map((e) => e.displayname).join(', '),
      url: 'hub.html#friends',
      at: now,
      seen: false,
    };
    await feedItem.setValue(mergeEvents(await feedItem.getValue(), [ev]));
    const s = await getSettings();
    if (s.notify) browser.notifications.create(ev.key, { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: ev.title, message: ev.body });
    if (s.partySound) ding().catch((e) => console.warn('[RSI+] ding', e));
  }
}
