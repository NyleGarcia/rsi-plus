/** Friends manager helpers: local notes/tags, filter, sort, group, CSV. Pure. */
import { isOnline, type FeedEvent } from './watch';
import type { FriendRequest, Member, PresenceStatus } from './types';

export interface FriendNote {
  note: string;
  tags: string[];
  /**
   * ms — when this person became your friend, as observed by RSI+ (Spectrum's API has no "friends since").
   * 0 = already a friend when RSI+ took its first snapshot (date unknown).
   */
  firstSeen: number;
  /** ms — last time seen online by RSI+ (polls + page visits). */
  lastOnline: number | null;
  /** Temporary friend (e.g. added for a party) — listed under "Party" for quick cleanup. */
  party?: boolean;
  /** ms — when marked as party (reminder clock for friends whose add time is unknown). */
  partyAt?: number;
  /** ms — no longer in the friend list (unfriended). Re-adding starts a fresh "added" time. */
  removedAt?: number;
}

export const blankNote = (now = Date.now()): FriendNote => ({ note: '', tags: [], firstSeen: now, lastOnline: null });

/** member id -> note */
export type FriendNotes = Record<string, FriendNote>;

export type FriendSort = 'status' | 'name' | 'lastOnline' | 'added';
export type StatusFilter = 'all' | 'online' | 'offline';

export const STATUS_ORDER: Record<PresenceStatus, number> = {
  playing: 0,
  online: 1,
  do_not_disturb: 2,
  away: 3,
  invisible: 4,
  offline: 5,
};

export const statusOf = (m: Member): PresenceStatus => m.presence?.status ?? 'offline';

export interface FriendRow {
  member: Member;
  note: FriendNote | undefined;
}

export function rows(friends: Member[], notes: FriendNotes): FriendRow[] {
  return friends.map((member) => ({ member, note: notes[member.id] }));
}

/** `addedSince`: ms cutoff (friends RSI+ saw being added after it); 'party' = party-flagged only. */
export function filterRows(list: FriendRow[], q: string, st: StatusFilter, tag: string | null, addedSince: number | 'party' | null = null): FriendRow[] {
  const query = q.trim().toLowerCase();
  return list.filter(({ member: m, note }) => {
    if (addedSince === 'party' && !note?.party) return false;
    if (typeof addedSince === 'number' && !(note && note.firstSeen > 0 && note.firstSeen >= addedSince)) return false;
    if (st === 'online' && !isOnline(statusOf(m))) return false;
    if (st === 'offline' && isOnline(statusOf(m))) return false;
    if (tag && !note?.tags.includes(tag)) return false;
    if (!query) return true;
    return [m.displayname, m.nickname, note?.note ?? '', ...(note?.tags ?? [])].some((s) => s.toLowerCase().includes(query));
  });
}

export function sortRows(list: FriendRow[], by: FriendSort): FriendRow[] {
  const name = (r: FriendRow) => r.member.displayname.toLowerCase();
  return [...list].sort((a, b) => {
    switch (by) {
      case 'status':
        return STATUS_ORDER[statusOf(a.member)] - STATUS_ORDER[statusOf(b.member)] || name(a).localeCompare(name(b));
      case 'lastOnline':
        return lastOnline(b) - lastOnline(a) || name(a).localeCompare(name(b));
      case 'added':
        return (b.note?.firstSeen ?? 0) - (a.note?.firstSeen ?? 0) || name(a).localeCompare(name(b));
      default:
        return name(a).localeCompare(name(b));
    }
  });
}

function lastOnline(r: FriendRow): number {
  if (isOnline(statusOf(r.member))) return Number.MAX_SAFE_INTEGER;
  return Math.max(r.note?.lastOnline ?? 0, (r.member.presence?.since ?? 0) * 1000);
}

export function allTags(notes: FriendNotes): string[] {
  return [...new Set(Object.values(notes).flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b));
}

export function parseTags(s: string): string[] {
  return [...new Set(s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Record added time / last-online for the current friend list. The very first snapshot (no notes yet) is the
 * baseline: those friends get firstSeen 0 ("before RSI+"); anyone appearing later was added since.
 * `complete` = the list is known to be the full friend list (a trustworthy fetch): notes of people missing from
 * it get `removedAt`, and if they come back later they're treated as newly added (fresh time, party cleared).
 * Returns null when nothing changed.
 */
export function touchNotes(notes: FriendNotes, friends: Member[], now = Date.now(), complete = friends.length > 0): FriendNotes | null {
  let changed = false;
  const baseline = Object.keys(notes).length === 0;
  const out = { ...notes };
  const present = new Set<string>();
  for (const f of friends) {
    present.add(f.id);
    const n = out[f.id];
    const online = isOnline(statusOf(f));
    if (!n) {
      out[f.id] = { note: '', tags: [], firstSeen: baseline ? 0 : now, lastOnline: online ? now : null };
      changed = true;
    } else if (n.removedAt) {
      // Re-added (e.g. the same people for another party): new friendship, keep tags/note.
      const { removedAt: _r, partyAt: _p, ...rest } = n;
      out[f.id] = { ...rest, firstSeen: now, party: false, lastOnline: online ? now : n.lastOnline };
      changed = true;
    } else if (online) {
      out[f.id] = { ...n, lastOnline: now };
      changed = true;
    }
  }
  if (complete)
    for (const [id, n] of Object.entries(out))
      if (!present.has(id) && !n.removedAt) {
        out[id] = { ...n, removedAt: now };
        changed = true;
      }
  return changed ? out : null;
}

/** Notes for people just unfriended (so a re-add is detected even between polls). */
/** Friends added or gone between two note snapshots (what `touchNotes` just recorded): one feed event per person. */
export function noteEvents(before: FriendNotes, after: FriendNotes, friends: Member[], now: number): FeedEvent[] {
  if (!Object.keys(before).length) return []; // first snapshot = baseline, nobody is "new"
  const by = new Map(friends.map((m) => [m.id, m]));
  const out: FeedEvent[] = [];
  for (const [id, n] of Object.entries(after)) {
    const prev = before[id];
    const m = by.get(id);
    if (n.firstSeen === now && prev?.firstSeen !== now && !n.removedAt) {
      out.push({ key: `friend-added:${id}:${now}`, kind: 'friend', title: `${m?.displayname ?? `Member ${id}`} is now your friend`, body: m ? `@${m.nickname}` : 'Friend request accepted', url: 'hub.html#friends', at: now, seen: false });
    } else if (n.removedAt === now && !prev?.removedAt) {
      out.push({ key: `friend-gone:${id}:${now}`, kind: 'friend', title: `${m?.displayname ?? `Member ${id}`} is no longer on your friends list`, body: 'Unfriended, or they removed you', url: 'hub.html#friends', at: now, seen: false });
    }
  }
  return out;
}

export function markRemoved(notes: FriendNotes, ids: string[], now = Date.now()): FriendNotes {
  const out = { ...notes };
  for (const id of ids) if (out[id]) out[id] = { ...out[id]!, removedAt: now };
  return out;
}

/** Pending incoming / outgoing requests with the other member resolved. */
export function splitRequests(reqs: FriendRequest[], me: string | null, members: Map<string, Member>) {
  const incoming: { req: FriendRequest; member: Member | null }[] = [];
  const outgoing: { req: FriendRequest; member: Member | null }[] = [];
  for (const req of reqs) {
    if (req.status && req.status !== 'pending') continue;
    const mine = req.requesting_member_id === me;
    const otherId = mine ? req.target_member_id : req.requesting_member_id;
    const member = members.get(otherId) ?? req.members?.find((m) => m.id === otherId) ?? null;
    (mine ? outgoing : incoming).push({ req, member });
  }
  return { incoming, outgoing };
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(list: FriendRow[], orgsOf: (m: Member) => { sid: string }[] = () => []): string {
  const head = ['displayname', 'nickname', 'id', 'status', 'orgs', 'added', 'tags', 'note'];
  const lines = list.map(({ member: m, note }) =>
    [m.displayname, m.nickname, m.id, statusOf(m), orgsOf(m).map((o) => o.sid).filter(Boolean).join(';'), note?.firstSeen ? new Date(note.firstSeen).toISOString() : '', (note?.tags ?? []).join(';'), note?.note ?? '']
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}

/**
 * One "party cleanup" reminder once party friends (still your friends) are older than `hours`.
 * Keyed by the set of due friends, so it fires again only when that set changes.
 */
export function partyEvent(notes: FriendNotes, current: Set<string>, hours: number, now: number): FeedEvent | null {
  if (!hours) return null;
  const due = Object.entries(notes)
    .filter(([id, n]) => {
      const since = n.firstSeen > 0 ? n.firstSeen : (n.partyAt ?? 0);
      return n.party && current.has(id) && since > 0 && now - since >= hours * 3600_000;
    })
    .map(([id]) => id)
    .sort();
  if (!due.length) return null;
  return {
    key: `party:${due.join(',')}`,
    kind: 'party',
    title: `${due.length} party friend${due.length === 1 ? '' : 's'} ready to remove`,
    body: `Added over ${hours} h ago — open Friends → Party to unfriend them.`,
    url: 'hub.html#friends',
    at: now,
    seen: false,
  };
}

/** New incoming friend requests since the last poll. `prev` null = first run (baseline, no events). */
export function requestEvents(prev: string[] | null, reqs: FriendRequest[], me: string, now: number): FeedEvent[] {
  const incoming = reqs.filter((r) => (!r.status || r.status === 'pending') && r.target_member_id === me);
  if (!prev) return [];
  const old = new Set(prev);
  return incoming
    .filter((r) => !old.has(r.id))
    .map((r) => {
      const m = r.members?.find((x) => x.id === r.requesting_member_id);
      return {
        key: `request:${r.id}`,
        kind: 'request' as const,
        title: `Friend request from ${m?.displayname ?? 'someone'}`,
        body: m ? `@${m.nickname} — accept or decline in Friends` : 'Accept or decline in Friends',
        url: 'hub.html#friends',
        at: now,
        seen: false,
      };
    });
}

// ---- Party mode: auto-accept incoming requests while on ----

export interface PartyMode {
  on: boolean;
  /** ms when it switches itself off (null = until turned off). */
  until: number | null;
  startedAt: number;
}

export interface PartyLogEntry {
  /** ms */
  at: number;
  requestId: string;
  memberId: string;
  nickname: string;
  displayname: string;
  ok: boolean;
  error?: string;
}

export const MAX_PARTY_LOG = 200;
export const MAX_ATTEMPTS = 3;

export const partyActive = (m: PartyMode | null, now: number) => !!m?.on && (m.until == null || now < m.until);

/** Incoming pending requests to auto-accept: not yet accepted, and failed fewer than MAX_ATTEMPTS times. */
export function partyTargets(reqs: FriendRequest[], me: string, log: PartyLogEntry[]): FriendRequest[] {
  const okIds = new Set(log.filter((l) => l.ok).map((l) => l.requestId));
  const fails = new Map<string, number>();
  for (const l of log) if (!l.ok) fails.set(l.requestId, (fails.get(l.requestId) ?? 0) + 1);
  return reqs.filter(
    (r) => (!r.status || r.status === 'pending') && r.target_member_id === me && !okIds.has(r.id) && (fails.get(r.id) ?? 0) < MAX_ATTEMPTS,
  );
}

/** Newest first, capped. */
export function appendLog(log: PartyLogEntry[], entries: PartyLogEntry[]): PartyLogEntry[] {
  return [...[...entries].reverse(), ...log].slice(0, MAX_PARTY_LOG);
}
