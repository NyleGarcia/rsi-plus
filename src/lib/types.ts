/** Shapes of Spectrum's `/api/spectrum` JSON (only the fields RSI+ reads). Verified anonymously 2026-10. */

export type PresenceStatus = 'online' | 'away' | 'do_not_disturb' | 'playing' | 'invisible' | 'offline';

export interface Presence {
  status: PresenceStatus;
  /** Activity text, e.g. the game being played. */
  info: string | null;
  /** Unix seconds of the last status change. */
  since: number | null;
}

export interface Member {
  id: string;
  displayname: string;
  nickname: string;
  avatar: string | null;
  isGM?: boolean;
  presence?: Presence;
  /** community id -> role ids */
  roles?: Record<string, string[]>;
  meta?: { badges?: { name: string; icon?: string; url?: string }[] };
  common_communities?: string[];
}

export interface Activity {
  /** Unix seconds. */
  time_created: number;
  member: Member | null;
  highlight_role_id: string | null;
}

export interface ThreadSummary {
  id: string;
  /** Unix seconds. */
  time_created: number;
  time_modified: number;
  channel_id: string;
  type: 'discussion' | 'question' | 'poll' | 'live' | string;
  slug: string;
  subject: string;
  is_locked: boolean;
  is_pinned: boolean;
  is_sinked: boolean;
  is_erased: boolean;
  /** Set when a tracked role (e.g. CIG staff, role "2") posted in the thread — the "dev tracker". */
  tracked_post_role_id: string | null;
  highlight_role_id: string | null;
  label: { id: string; name: string } | null;
  member: Member | null;
  replies_count: number;
  views_count: number;
  votes?: { count: number; voted: number };
  latest_activity: Activity | null;
}

export interface Reply {
  id: string;
  time_created: number;
  thread_id: string;
  is_erased: boolean;
  member: Member | null;
  highlight_role_id?: string | null;
}

export interface ThreadFull extends ThreadSummary {
  community_id: string;
  replies?: Reply[];
  tracked_replies_references?: { id: string; label?: string }[];
}

export interface ChannelThreads {
  threads: ThreadSummary[];
  threads_count: number;
}

export interface Channel {
  id: number;
  communityId: number;
  groupId: number;
  name: string;
  description: string;
  color: string;
  threadCount: number;
  labels: { id: number; channelId: number; name: string }[];
  url: string;
}

export interface FriendRequest {
  id: string;
  requesting_member_id: string;
  target_member_id: string;
  status: 'pending' | string;
  time_created?: number;
  members?: Member[];
}

export interface Identify {
  member: Member | null;
  friends: Member[] | null;
  friend_requests: FriendRequest[] | null;
  blocklist: unknown;
  communities: { id: string; slug: string; name: string; avatar: string | null }[];
  notifications_unread?: number;
}

export interface ApiEnvelope<T> {
  success: 0 | 1;
  code: string;
  msg: string;
  data: T;
}

export const SPECTRUM_ORIGIN = 'https://robertsspaceindustries.com';
export const SC_COMMUNITY_ID = '1';
export const SC_SLUG = 'SC';

export function threadUrl(channelId: string | number, slug: string, replyId?: string | null): string {
  const base = `${SPECTRUM_ORIGIN}/spectrum/community/${SC_SLUG}/forum/${channelId}/thread/${slug}`;
  return replyId ? `${base}/${replyId}` : base;
}

export function channelUrl(channelId: string | number): string {
  return `${SPECTRUM_ORIGIN}/spectrum/community/${SC_SLUG}/forum/${channelId}`;
}

export function memberUrl(nickname: string): string {
  return `${SPECTRUM_ORIGIN}/spectrum/messages/member/${encodeURIComponent(nickname)}`;
}

/** Parse a Spectrum URL path: `/spectrum/community/SC/forum/3/thread/my-slug/12345`. */
export function parsePath(pathname: string): { channelId: string | null; slug: string | null; replyId: string | null } {
  const m = pathname.match(/\/spectrum\/community\/[^/]+\/forum\/(\d+)(?:\/thread\/([^/?#]+)(?:\/(\d+))?)?/);
  return { channelId: m?.[1] ?? null, slug: m?.[2] ? decodeURIComponent(m[2]) : null, replyId: m?.[3] ?? null };
}
