import * as api from '@/lib/api';
import { normThread } from '@/lib/capture';
import { appendLog, blankNote, markRemoved, noteEvents, partyActive, partyEvent, partyTargets, requestEvents, touchNotes, type PartyLogEntry } from '@/lib/friends';
import { respond, type BgRequest, type BgResponses, type BulkResult, type HubTab } from '@/lib/messages';
import { citizenOrgsUrl, ORG_TTL, parseCitizenOrgs, type OrgCache } from '@/lib/orgs';
import {
  feedItem,
  friendNotesItem,
  getSettings,
  keepAccountSwitcher,
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
  storeItemsItem,
  wishlistItem,
  settingsItem,
  watchesItem,
  hangarLoadItem,
  starorgItem,
} from '@/lib/settings';
import { afterLoad, isNewLoad, scheduleStarOrg, STARORG_ALARM, weeklySync } from '@/lib/starorg-auto';
import { disconnectAll } from '@/lib/starorg';
import { loadHangar } from '@/lib/account';
import { readHangarOffscreen } from '@/lib/offscreen';
import { ding } from '@/lib/sound';
import { chainEvents } from '@/lib/ccu';
import { fetchCatalog, fetchPaints, fetchStoreItems, recordSales, wishlistEvents, type Catalog, type PaintCatalog } from '@/lib/store';
import { sleep } from '@/lib/utils';
import { catalogEntries, listingEntries } from '@/lib/storelog';
import { saveStoreCopy } from '@/lib/storelog-save';
import { threadUrl } from '@/lib/types';
import { channelEvents, friendEvents, keywordsFor, mergeEvents, threadEvents, type FeedEvent } from '@/lib/watch';

const ALARM = 'spectrumplus:poll';
const PARTY_ALARM = 'spectrumplus:party';

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
    // The offscreen document's progress pings (lib/offscreen.ts) only keep this worker awake: no answer.
    if ((msg as { type?: string })?.type?.startsWith('offscreen:')) return false;
    respond(handle(msg, sender.tab?.windowId)).then(sendResponse);
    return true; // async response
  });
  browser.runtime.onInstalled.addListener(({ reason }) => {
    schedule();
    // The account switcher is opt-in now: keep it on for anyone updating with saved logins.
    if (reason === 'update') keepAccountSwitcher().catch((e) => console.warn('[RSI+] account switcher', e));
  });
  browser.runtime.onStartup.addListener(() => schedule());
  settingsItem.watch((next, prev) => {
    schedule();
    // StarOrg Tools switched off (here, in the other context or on another synced device): disconnect everywhere.
    if (prev?.starorg && !next?.starorg) disconnectAll().catch((e) => console.warn('[RSI+] starorg disconnect', e));
  });
  // Connect / Disconnect / a 401 add or remove the weekly StarOrg check.
  starorgItem.watch(() => scheduleStarOrg().catch((e) => console.warn('[RSI+] starorg alarm', e)));
  feedItem.watch((f) => updateBadge(f ?? []));
  // StarOrg auto-sync: every completed full hangar load (Hangar tab load / update, refreshHangar from the CCU planner
  // or Paint rebuy) announces itself on hangarLoadItem (lib/hangar-refresh.ts). Watching hangarItem instead would
  // count a profile switch's restore as a load and push a parked snapshot (lib/starorg-auto.ts).
  hangarLoadItem.watch((next, prev) => {
    if (isNewLoad(next, prev)) afterLoad(starorgCatalog).catch((e) => console.warn('[RSI+] starorg', e));
  });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) poll().catch((e) => console.warn('[RSI+] poll', e));
    if (a.name === PARTY_ALARM) partyTick().catch((e) => console.warn('[RSI+] party', e));
    if (a.name === STARORG_ALARM) weeklySync(starorgCatalog, readHangarFresh).catch((e) => console.warn('[RSI+] starorg', e));
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
  // First, so passive mode (or Auto-sync off) clears the weekly StarOrg alarm too (lib/starorg-auto.ts).
  await scheduleStarOrg().catch((e) => console.warn('[RSI+] starorg alarm', e)); // never block the poll alarm
  const { pollMinutes, pollAuto } = await getSettings();
  if (!pollAuto) {
    await browser.alarms.clear(ALARM);
    return;
  }
  const period = Math.max(2, pollMinutes || 5);
  const cur = await browser.alarms.get(ALARM);
  if (cur?.periodInMinutes !== period) browser.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: 1 });
}

/** The ship catalog StarOrg rows are named from. */
const starorgCatalog = async () => ((await catalogItem.getValue()) ?? (await catalog(false))).ships;

/** Weekly StarOrg re-read: Firefox's background page parses RSI's pages itself; Chromium's worker asks the offscreen document. */
const readHangarFresh = () => (typeof DOMParser !== 'undefined' ? loadHangar(() => undefined) : readHangarOffscreen());

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
    events.push(...pendingFriendEvents.splice(0));
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
  // Store listing (paints, packs, gear …) hourly, for the store changes log on Browse.
  try {
    const listing = await storeItemsItem.getValue();
    if (!listing || now - listing.at > 60 * 60_000) {
      const v = await fetchStoreItems();
      await storeItemsItem.setValue(v);
      await saveStoreCopy('listing', listingEntries(v), v.at);
    }
  } catch (e) {
    errors.push(`store listing: ${(e as Error).message}`);
  }

  // Re-read before writing: the user may have edited watches while we polled. Unchanged → no write (sync storage
  // allows 120 writes/min, and every write repaints the hub's watchers).
  const cur = await getWatches();
  const nextWatches = {
    ...cur,
    threads: cur.threads.map((t) => (replies.has(t.id) ? { ...t, ...replies.get(t.id)! } : t)),
    channels: cur.channels.map((c) => (lastIds.has(c.id) ? { ...c, lastThreadId: lastIds.get(c.id)! } : c)),
  };
  if (JSON.stringify(nextWatches) !== JSON.stringify(cur)) await watchesItem.setValue(nextWatches);
  const before = await feedItem.getValue();
  const merged = mergeEvents(before, events);
  const added = merged.filter((e) => !before.some((b) => b.key === e.key));
  if (JSON.stringify(merged) !== JSON.stringify(before)) await feedItem.setValue(merged);
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
  if (touched) {
    await friendNotesItem.setValue(touched);
    // Friends added / gone become feed events; the next poll (or this one) merges them.
    pendingFriendEvents.push(...noteEvents(notes, touched, f.friends, now));
  }
  return touched ?? notes;
}
/** Feed events found while snapshotting the friend list outside a poll (hub reads); drained by the next poll. */
const pendingFriendEvents: FeedEvent[] = [];

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

/** The org cache keeps the newest entries only (one per nickname ever looked up, otherwise unbounded). */
const ORG_CACHE_MAX = 2000;
function capOrgs(c: OrgCache): OrgCache {
  const keys = Object.keys(c);
  if (keys.length <= ORG_CACHE_MAX) return c;
  const keep = keys.sort((a, b) => (c[b]?.at ?? 0) - (c[a]?.at ?? 0)).slice(0, ORG_CACHE_MAX);
  return Object.fromEntries(keep.map((k) => [k, c[k]!]));
}

/** Fetch citizen org pages for the given nicknames (stale/missing only unless forced), ~1 req/s. One cache write per call (the hub sends batches of 10). */
async function orgs(nicknames: string[], force: boolean): Promise<OrgCache> {
  const cache = await orgCacheItem.getValue();
  const fetched: OrgCache = {};
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
    fetched[key] = out[key]!;
  }
  // Re-read before writing: another batch may have landed meanwhile.
  if (Object.keys(fetched).length) await orgCacheItem.setValue(capOrgs({ ...(await orgCacheItem.getValue()), ...fetched }));
  return out;
}

let catalogPromise: Promise<Catalog> | null = null;
/** Public pledge-store catalog; cached 30 min unless `fresh`. */
async function catalog(fresh: boolean): Promise<Catalog> {
  const cached = await catalogItem.getValue();
  if (!fresh && cached && Date.now() - cached.at < 30 * 60_000) return cached; // fetchCatalog already applied withExtraShips
  catalogPromise ??= fetchCatalog()
    .then(async (c) => {
      await catalogItem.setValue(c);
      await saleHistoryItem.setValue(recordSales(await saleHistoryItem.getValue(), c.ships, c.at));
      await saveStoreCopy('catalog', catalogEntries(c), c.at).catch((e) => console.warn('[RSI+] store log', e));
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
      kind: 'party',
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
