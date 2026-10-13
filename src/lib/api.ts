/**
 * Spectrum API client. Every call is `POST https://robertsspaceindustries.com/api/spectrum<endpoint>` with a JSON
 * body and the `X-Rsi-Token` header = the `Rsi-Token` cookie (anonymous visitors get one too, so public reads
 * work logged out). Works in the content script (same origin, cookie readable) and the background
 * (cookie via `browser.cookies`). All endpoints RSI+ uses live here.
 */
import { normFriendList, normRequestList } from './relationship';
import {
  SC_COMMUNITY_ID,
  SPECTRUM_ORIGIN,
  type ApiEnvelope,
  type Channel,
  type ChannelThreads,
  type FriendRequest,
  type Identify,
  type Member,
  type ThreadFull,
} from './types';

export class SpectrumError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function token(): Promise<string> {
  if (typeof document !== 'undefined' && location.hostname === 'robertsspaceindustries.com') {
    const m = document.cookie.match(/(?:^|;\s*)Rsi-Token=([^;]+)/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  const c = await browser.cookies?.get({ url: SPECTRUM_ORIGIN, name: 'Rsi-Token' }).catch(() => null);
  if (c?.value) return c.value;
  throw new SpectrumError('No Rsi-Token cookie — open robertsspaceindustries.com once.', 'ErrNoToken', 0);
}

export async function call<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${SPECTRUM_ORIGIN}/api/spectrum${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Rsi-Token': await token() },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new SpectrumError(`Spectrum ${endpoint}: HTTP ${res.status}`, 'ErrHttp', res.status);
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!body.success) throw new SpectrumError(`Spectrum ${endpoint}: ${body.msg || body.code}`, body.code, res.status);
  return body.data;
}

export const identify = () => call<Identify>('/auth/identify');

export const channels = (communityId = SC_COMMUNITY_ID) => call<Channel[]>('/v2/forum/channel/list', { community_id: communityId });

export const channelThreads = (channelId: string, page = 1, sort: 'newest' | 'hot' | 'top' = 'newest') =>
  call<ChannelThreads>('/forum/channel/threads', { channel_id: channelId, page, sort, label_id: null });

export const thread = (slug: string, sort: 'newest' | 'oldest' | 'votes' = 'newest') =>
  call<ThreadFull>('/forum/thread/nested', { slug, sort, target_reply_id: null });

// ---- friends (logged-in only) ----
// Spectrum's own friends sidebar uses the v2 relationship endpoints; `/auth/identify` friends are the legacy
// source and come back empty for some accounts. Reads try v2 then fall back; writes try v2 then v1.

export interface FriendsData {
  me: Member;
  friends: Member[];
  requests: FriendRequest[];
  /** Which endpoint the friend list came from (shown in the hub for diagnosis). */
  source: 'v2' | 'identify';
  /** Non-fatal problems (e.g. v2 failed, fell back). */
  warnings: string[];
}

export async function friendsData(): Promise<FriendsData> {
  const id = await identify();
  if (!id.member) throw new SpectrumError('Not logged in — sign in on robertsspaceindustries.com, then retry.', 'ErrNotLoggedIn', 0);
  const warnings: string[] = [];
  let friends: Member[] | null = null;
  let source: FriendsData['source'] = 'v2';
  try {
    friends = normFriendList(await call<unknown>('/v2/relationship/friend/list'));
  } catch (e) {
    warnings.push(`v2 friend list: ${(e as Error).message}`);
  }
  const legacy = normFriendList(id.friends);
  // v2 can legitimately be empty; only prefer identify when it actually has more.
  if (!friends || legacy.length > friends.length) {
    friends = legacy;
    source = 'identify';
  }
  // Requests: merge v2 + identify (either may be empty depending on the account's backend), deduped by id.
  let v2Requests: FriendRequest[] = [];
  try {
    v2Requests = normRequestList(await call<unknown>('/v2/relationship/friend-request/list'));
  } catch (e) {
    warnings.push(`v2 requests: ${(e as Error).message}`);
  }
  const seen = new Set<string>();
  const requests = [...v2Requests, ...normRequestList(id.friend_requests)].filter((r) => !seen.has(r.id) && (seen.add(r.id), true));
  return { me: id.member, friends, requests, source, warnings };
}

/** Try the v2 call; if Spectrum rejects it (unknown endpoint / error), try the v1 one. */
async function v2ThenV1(v2: [string, Record<string, unknown>], v1: [string, Record<string, unknown>]) {
  try {
    return await call<unknown>(...v2);
  } catch (e) {
    try {
      return await call<unknown>(...v1);
    } catch {
      throw e;
    }
  }
}
export const removeFriend = (memberId: string) => v2ThenV1(['/v2/relationship/friend/remove', { member_id: memberId }], ['/friend/remove', { member_id: memberId }]);
const request = (action: 'accept' | 'decline' | 'cancel') => (requestId: string) =>
  v2ThenV1([`/v2/relationship/friend-request/${action}`, { request_id: requestId }], [`/friend-request/${action}`, { request_id: requestId }]);
export const acceptRequest = request('accept');
export const declineRequest = request('decline');
export const cancelRequest = request('cancel');
