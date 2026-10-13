/** Local read tracking: what you had seen of each thread the last time you opened it. Pure helpers. */
import type { Reply, ThreadSummary } from './types';

export interface ReadMark {
  /** replies_count when last opened. */
  replies: number;
  /** Unix seconds of the newest activity you'd seen (latest reply time). */
  seenAt: number;
  /** When you opened it (ms). */
  at: number;
}

/** thread id -> mark. Capped to the most recently opened MAX_MARKS threads. */
export type ReadState = Record<string, ReadMark>;
export const MAX_MARKS = 5000;

export type ReadStatus = { kind: 'unseen' } | { kind: 'read' } | { kind: 'new'; count: number };

export function status(t: Pick<ThreadSummary, 'id' | 'replies_count'>, state: ReadState): ReadStatus {
  const m = state[t.id];
  if (!m) return { kind: 'unseen' };
  const n = t.replies_count - m.replies;
  return n > 0 ? { kind: 'new', count: n } : { kind: 'read' };
}

export function latestTime(t: Pick<ThreadSummary, 'time_created' | 'latest_activity'>): number {
  return Math.max(t.time_created, t.latest_activity?.time_created ?? 0);
}

export function markRead(state: ReadState, t: Pick<ThreadSummary, 'id' | 'replies_count' | 'time_created' | 'latest_activity'>, now = Date.now()): ReadState {
  const prev = state[t.id];
  const next: ReadState = {
    ...state,
    // Never move backwards (a stale cached payload must not resurrect "new" replies).
    [t.id]: { replies: Math.max(t.replies_count, prev?.replies ?? 0), seenAt: Math.max(latestTime(t), prev?.seenAt ?? 0), at: now },
  };
  return prune(next);
}

/** "Mark unread": forget the thread so it shows as unseen again. */
export function markUnread(state: ReadState, id: string): ReadState {
  const { [id]: _drop, ...rest } = state;
  return rest;
}

export function prune(state: ReadState, max = MAX_MARKS): ReadState {
  const keys = Object.keys(state);
  if (keys.length <= max) return state;
  const keep = keys.sort((a, b) => state[b]!.at - state[a]!.at).slice(0, max);
  return Object.fromEntries(keep.map((k) => [k, state[k]!]));
}

/** The first reply posted after you last saw the thread (by time), for "jump to first new". */
export function firstNewReply(replies: Reply[] | undefined, mark: ReadMark | undefined): Reply | null {
  if (!mark || !replies?.length) return null;
  let best: Reply | null = null;
  for (const r of replies) if (r.time_created > mark.seenAt && (!best || r.time_created < best.time_created)) best = r;
  return best;
}
