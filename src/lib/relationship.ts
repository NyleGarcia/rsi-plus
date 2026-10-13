/**
 * Normalize friend data from Spectrum's two sources into the v1 shapes the UI uses:
 * - v2 `/v2/relationship/friend/list` — what Spectrum's own friends sidebar loads (bundle 2026-10): members
 *   `{id, accountId, nickname, displayname, avatar, isGm, presence, commonCommunities}`; requests
 *   `{id, createdAt, sender, receiver}`.
 * - v1 `/auth/identify` `friends[]` / `friend_requests[]` (legacy; empty for some accounts).
 * Field names vary (camel/snake, wrapped lists), so everything is read defensively.
 */
import type { FriendRequest, Member, Presence, PresenceStatus } from './types';

type Obj = Record<string, any>;

const STATUS_BY_CODE: PresenceStatus[] = ['offline', 'online', 'away', 'do_not_disturb', 'playing', 'invisible'];
const STATUS_ALIAS: Record<string, PresenceStatus> = {
  dnd: 'do_not_disturb',
  donotdisturb: 'do_not_disturb',
  do_not_disturb: 'do_not_disturb',
  activity: 'playing',
  unspecified: 'offline',
};

export function normPresence(p: unknown): Presence | undefined {
  if (p == null) return undefined;
  if (typeof p === 'number' || typeof p === 'string') return { status: normStatus(p), info: null, since: null };
  const o = p as Obj;
  const info = o.info ?? o.activity?.state ?? null;
  const since = o.since ?? o.updatedAt ?? null;
  return { status: normStatus(o.status), info: typeof info === 'string' && info ? info : null, since: typeof since === 'number' ? since : null };
}

function normStatus(s: unknown): PresenceStatus {
  if (typeof s === 'number') return STATUS_BY_CODE[s] ?? 'offline';
  if (typeof s !== 'string') return 'offline';
  const k = s.toLowerCase().replace(/[\s-]/g, '_');
  if ((STATUS_BY_CODE as string[]).includes(k)) return k as PresenceStatus;
  return STATUS_ALIAS[k.replace(/_/g, '')] ?? STATUS_ALIAS[k] ?? 'offline';
}

export function normFriend(o: Obj | null | undefined): Member | null {
  if (!o || typeof o !== 'object') return null;
  // Some list shapes wrap the member: {member: {...}} / {friend: {...}} / {user: {...}}.
  const m = o.member ?? o.friend ?? o.user ?? o.account ?? o;
  const nickname = m.nickname ?? m.handle;
  const id = m.id ?? m.memberId ?? m.member_id;
  if (!nickname || id == null) return null;
  return {
    id: String(id),
    displayname: m.displayname ?? m.displayName ?? nickname,
    nickname,
    avatar: m.avatar ?? m.avatarUrl ?? null,
    isGM: !!(m.isGM ?? m.isGm),
    presence: normPresence(o.presence ?? m.presence),
    meta: m.meta,
    common_communities: m.common_communities ?? m.commonCommunities,
  };
}

/** Drop repeated ids (the UI keys rows by id; a duplicate would crash the list). */
const uniqueId = (x: { id: string }, i: number, all: { id: string }[]) => all.findIndex((y) => y.id === x.id) === i;

const listOf = (data: unknown, ...keys: string[]): Obj[] => {
  if (Array.isArray(data)) return data;
  for (const k of keys) if (Array.isArray((data as Obj)?.[k])) return (data as Obj)[k];
  return [];
};

export function normFriendList(data: unknown): Member[] {
  return listOf(data, 'friends', 'members', 'items', 'contacts')
    .map(normFriend)
    .filter((m): m is Member => !!m)
    .filter(uniqueId);
}

/** v2 `{id, createdAt, sender, receiver}` or v1 `{id, requesting_member_id, target_member_id, status}`. */
export function normRequest(o: Obj): FriendRequest | null {
  if (!o || o.id == null) return null;
  if (o.requesting_member_id != null) return { ...o, id: String(o.id) } as FriendRequest;
  const sender = normFriend(o.sender);
  const receiver = normFriend(o.receiver);
  if (!sender || !receiver) return null;
  const created = Number(o.createdAt ?? o.created_at);
  return {
    id: String(o.id),
    requesting_member_id: sender.id,
    target_member_id: receiver.id,
    status: 'pending',
    time_created: Number.isFinite(created) ? (created > 1e12 ? Math.floor(created / 1000) : created) : undefined,
    members: [sender, receiver],
  };
}

export function normRequestList(data: unknown): FriendRequest[] {
  return listOf(data, 'requests', 'friend_requests', 'items', 'pendingRequests')
    .map(normRequest)
    .filter((r): r is FriendRequest => !!r)
    .filter(uniqueId);
}
