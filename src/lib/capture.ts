/**
 * Normalize thread JSON the page hook captured. Spectrum serves v1 (snake_case, verified) and v2 (camelCase,
 * from the bundle — unverified) shapes; everything downstream uses the v1 `ThreadSummary` fields.
 */
import type { Activity, Member, Reply, ThreadFull, ThreadSummary } from './types';

type Obj = Record<string, any>;
const pick = (o: Obj, ...keys: string[]) => {
  for (const k of keys) if (o?.[k] !== undefined) return o[k];
  return undefined;
};
/** Unix seconds from seconds, ms, or an ISO string. */
const secs = (v: unknown): number => {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return secs(n);
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
  }
  return 0;
};

export function normMember(o: Obj | null | undefined): Member | null {
  if (!o || typeof o !== 'object') return null;
  const nickname = pick(o, 'nickname', 'handle');
  if (!nickname) return null;
  return {
    id: String(pick(o, 'id', 'memberId') ?? ''),
    displayname: pick(o, 'displayname', 'displayName') ?? nickname,
    nickname,
    avatar: pick(o, 'avatar') ?? null,
    isGM: !!pick(o, 'isGM', 'is_gm'),
    presence: o.presence,
    roles: o.roles,
    meta: o.meta,
  };
}

function normActivity(o: Obj | null | undefined): Activity | null {
  if (!o) return null;
  return {
    time_created: secs(pick(o, 'time_created', 'timeCreated', 'createdAt')),
    member: normMember(o.member),
    highlight_role_id: pick(o, 'highlight_role_id', 'highlightRoleId') ?? null,
  };
}

export function normThread(o: Obj): ThreadSummary | null {
  if (!o || typeof o !== 'object' || !o.slug || o.subject == null || o.id == null) return null;
  const label = o.label ?? null;
  return {
    id: String(o.id),
    time_created: secs(pick(o, 'time_created', 'timeCreated', 'createdAt')),
    time_modified: secs(pick(o, 'time_modified', 'timeModified', 'updatedAt')),
    channel_id: String(pick(o, 'channel_id', 'channelId') ?? ''),
    type: o.type ?? 'discussion',
    slug: o.slug,
    subject: String(o.subject),
    is_locked: !!pick(o, 'is_locked', 'isLocked'),
    is_pinned: !!pick(o, 'is_pinned', 'isPinned'),
    is_sinked: !!pick(o, 'is_sinked', 'isSinked'),
    is_erased: !!pick(o, 'is_erased', 'isErased'),
    tracked_post_role_id: pick(o, 'tracked_post_role_id', 'trackedPostRoleId') ?? null,
    highlight_role_id: pick(o, 'highlight_role_id', 'highlightRoleId') ?? null,
    label: label && label.name ? { id: String(label.id), name: label.name } : null,
    member: normMember(o.member),
    replies_count: Number(pick(o, 'replies_count', 'repliesCount') ?? 0),
    views_count: Number(pick(o, 'views_count', 'viewsCount') ?? 0),
    votes: o.votes,
    latest_activity: normActivity(pick(o, 'latest_activity', 'latestActivity')),
  };
}

function normReply(o: Obj): Reply | null {
  if (!o || o.id == null) return null;
  return {
    id: String(o.id),
    time_created: secs(pick(o, 'time_created', 'timeCreated', 'createdAt')),
    thread_id: String(pick(o, 'thread_id', 'threadId') ?? ''),
    is_erased: !!pick(o, 'is_erased', 'isErased'),
    member: normMember(o.member),
    highlight_role_id: pick(o, 'highlight_role_id', 'highlightRoleId') ?? null,
  };
}

/** Flatten nested replies (v1 nested view: `replies[].replies[]`/`children`). */
function flatReplies(list: unknown, out: Reply[] = []): Reply[] {
  if (!Array.isArray(list)) return out;
  for (const o of list) {
    const r = normReply(o);
    if (r) out.push(r);
    flatReplies(o?.replies ?? o?.children, out);
  }
  return out;
}

export type Captured =
  | { kind: 'list'; threads: ThreadSummary[] }
  | { kind: 'thread'; thread: ThreadFull }
  | { kind: 'replies'; replies: Reply[] }
  | { kind: 'identify'; data: Obj }
  | null;

export function classify(path: string, json: Obj): Captured {
  const data = json?.data;
  if (!data) return null;
  if (/\/auth\/identify$/.test(path)) return { kind: 'identify', data };
  if (/\/channel\/threads$/.test(path)) {
    const raw = Array.isArray(data) ? data : (data.threads ?? data.items ?? []);
    return { kind: 'list', threads: (raw as Obj[]).map(normThread).filter((t): t is ThreadSummary => !!t) };
  }
  if (/\/thread\/(nested|classic|get)$/.test(path)) {
    const t = normThread(data.thread ?? data);
    if (!t) return null;
    return { kind: 'thread', thread: { ...t, community_id: String(data.community_id ?? data.communityId ?? ''), replies: flatReplies(data.replies) } };
  }
  if (/\/replies(\/list)?(\/\d+)?$/.test(path) || /\/thread\/replies\//.test(path)) {
    const raw = Array.isArray(data) ? data : (data.replies ?? data.items ?? []);
    return { kind: 'replies', replies: flatReplies(raw) };
  }
  return null;
}
