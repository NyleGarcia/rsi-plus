/** Watch lists + the poll diff that turns fresh API data into feed events. Pure. */
import { norm } from './filters';
import type { Member, ThreadSummary } from './types';

export interface WatchedThread {
  id: string;
  slug: string;
  channelId: string;
  subject: string;
  /** replies_count at the last poll. */
  replies: number;
  addedAt: number;
}

export interface WatchedChannel {
  id: string;
  name: string;
  /** Newest thread id seen (ids are increasing). */
  lastThreadId: string | null;
  /** Notify for every new thread (true) or only dev / watched-author ones (false). */
  allThreads: boolean;
}

export interface WatchedAuthor {
  nickname: string;
  displayname: string;
}

export interface Watches {
  threads: WatchedThread[];
  channels: WatchedChannel[];
  authors: WatchedAuthor[];
  /** Friend member ids to notify about when they come online. */
  friendsOnline: string[];
}

export const NO_WATCHES: Watches = { threads: [], channels: [], authors: [], friendsOnline: [] };

export type EventKind = 'replies' | 'thread' | 'dev' | 'author' | 'friend' | 'store';

export interface FeedEvent {
  /** Stable id so re-polls don't duplicate (kind + entity + count/time). */
  key: string;
  kind: EventKind;
  title: string;
  body: string;
  url: string;
  /** ms */
  at: number;
  seen: boolean;
}

export const MAX_EVENTS = 300;

const idNum = (id: string | null) => (id ? Number(id) || 0 : 0);

/** Watched thread has more replies than at the last poll. */
export function threadEvents(w: WatchedThread, fresh: Pick<ThreadSummary, 'replies_count' | 'latest_activity' | 'subject'>, url: string, now: number): FeedEvent[] {
  const n = fresh.replies_count - w.replies;
  if (n <= 0) return [];
  const who = fresh.latest_activity?.member?.displayname;
  return [
    {
      key: `replies:${w.id}:${fresh.replies_count}`,
      kind: 'replies',
      title: fresh.subject,
      body: `${n} new repl${n === 1 ? 'y' : 'ies'}${who ? ` — latest by ${who}` : ''}`,
      url,
      at: now,
      seen: false,
    },
  ];
}

export function isDev(t: Pick<ThreadSummary, 'tracked_post_role_id' | 'member'>): boolean {
  return !!t.tracked_post_role_id || !!t.member?.isGM;
}

/**
 * New threads in a watched channel since `lastThreadId`. First poll (null) only records the baseline.
 * Emits: dev thread, watched-author thread, or (allThreads) any thread; plus dev/author *replies* on
 * any listed thread (latest_activity), deduped by thread + activity time.
 */
export function channelEvents(
  w: WatchedChannel,
  threads: ThreadSummary[],
  authors: string[],
  urlOf: (t: ThreadSummary) => string,
  now: number,
): { events: FeedEvent[]; lastThreadId: string | null } {
  const newest = threads.reduce((m, t) => (idNum(t.id) > idNum(m) ? t.id : m), w.lastThreadId ?? '0');
  if (w.lastThreadId == null) return { events: [], lastThreadId: newest === '0' ? null : newest };
  const watched = new Set(authors.map(norm));
  const byWatched = (m: Member | null | undefined) => !!m?.nickname && watched.has(norm(m.nickname));
  const events: FeedEvent[] = [];
  for (const t of threads) {
    if (t.is_pinned && idNum(t.id) <= idNum(w.lastThreadId)) continue;
    if (idNum(t.id) > idNum(w.lastThreadId)) {
      const dev = isDev(t);
      const author = byWatched(t.member);
      if (dev || author || w.allThreads)
        events.push({
          key: `thread:${t.id}`,
          kind: dev ? 'dev' : author ? 'author' : 'thread',
          title: t.subject,
          body: `New in ${w.name} by ${t.member?.displayname ?? 'unknown'}${dev ? ' (dev)' : ''}`,
          url: urlOf(t),
          at: now,
          seen: false,
        });
      continue;
    }
    // Older thread bumped by a dev or watched author.
    const a = t.latest_activity;
    if (a && (a.highlight_role_id || byWatched(a.member)))
      events.push({
        key: `reply:${t.id}:${a.time_created}`,
        kind: a.highlight_role_id ? 'dev' : 'author',
        title: t.subject,
        body: `${a.member?.displayname ?? 'Someone'} replied${a.highlight_role_id ? ' (dev)' : ''} in ${w.name}`,
        url: urlOf(t),
        at: now,
        seen: false,
      });
  }
  return { events, lastThreadId: newest };
}

/** Friends that went from not-online to online since the last poll (only those in `watch`, or all if `all`). */
export function friendEvents(prev: Record<string, string>, friends: Member[], watch: string[], all: boolean, now: number): FeedEvent[] {
  const ids = new Set(watch);
  const out: FeedEvent[] = [];
  for (const f of friends) {
    const was = prev[f.id];
    const is = f.presence?.status ?? 'offline';
    if (!(all || ids.has(f.id)) || was == null || !isOnline(is) || isOnline(was)) continue;
    out.push({
      key: `friend:${f.id}:${f.presence?.since ?? now}`,
      kind: 'friend',
      title: `${f.displayname} is ${is === 'playing' ? 'playing' : 'online'}`,
      body: f.presence?.info ?? `@${f.nickname}`,
      url: `https://robertsspaceindustries.com/spectrum/messages/member/${encodeURIComponent(f.nickname)}`,
      at: now,
      seen: false,
    });
  }
  return out;
}

export const isOnline = (s: string) => s === 'online' || s === 'playing' || s === 'away' || s === 'do_not_disturb';

/** Add events newest-first, skipping keys already present, capped. */
export function mergeEvents(existing: FeedEvent[], fresh: FeedEvent[], max = MAX_EVENTS): FeedEvent[] {
  const keys = new Set(existing.map((e) => e.key));
  const add = fresh.filter((e) => !keys.has(e.key) && (keys.add(e.key), true));
  return [...add.reverse(), ...existing].slice(0, max);
}
