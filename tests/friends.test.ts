import { describe, expect, it } from 'vitest';
import { appendLog, filterRows, markRemoved, partyActive, partyEvent, partyTargets, requestEvents, rows, sortRows, splitRequests, toCsv, touchNotes } from '@/lib/friends';
import { member } from './fixtures';

const online = (n: string) => member(n, { presence: { status: 'online', info: null, since: null } });
const playing = (n: string) => member(n, { presence: { status: 'playing', info: 'Star Citizen', since: null } });

describe('friends', () => {
  it('first snapshot is the baseline (added unknown), later friends are timestamped', () => {
    const base = touchNotes({}, [member('a')], 100)!;
    expect(base['id-a']!.firstSeen).toBe(0);
    const next = touchNotes(base, [member('a'), member('b')], 200)!;
    expect(next['id-b']!.firstSeen).toBe(200);
    expect(next['id-a']!.firstSeen).toBe(0);
    expect(touchNotes(next, [member('a')], 300)!['id-b']!.removedAt).toBe(300); // b unfriended
    expect(touchNotes(next, [member('a'), member('b')], 300)).toBeNull(); // nothing new, nobody online
  });

  it('filters by added-since and party flag', () => {
    const notes = {
      'id-a': { note: '', tags: [], firstSeen: 0, lastOnline: null },
      'id-b': { note: '', tags: [], firstSeen: 500, lastOnline: null, party: true },
      'id-c': { note: '', tags: ['org'], firstSeen: 100, lastOnline: null },
    };
    const r = rows([member('a'), member('b'), member('c')], notes);
    expect(filterRows(r, '', 'all', null, 400).map((x) => x.member.nickname)).toEqual(['b']);
    expect(filterRows(r, '', 'all', null, 'party').map((x) => x.member.nickname)).toEqual(['b']);
    expect(filterRows(r, 'org', 'all', null).map((x) => x.member.nickname)).toEqual(['c']);
    expect(filterRows(r, '', 'all', 'org').map((x) => x.member.nickname)).toEqual(['c']);
  });

  it('sorts by status then name', () => {
    const r = rows([member('zed'), online('bob'), playing('amy'), online('al')], {});
    expect(sortRows(r, 'status').map((x) => x.member.nickname)).toEqual(['amy', 'al', 'bob', 'zed']);
    expect(filterRows(r, '', 'online', null)).toHaveLength(3);
  });

  it('party reminder only for due, still-friends; key changes with the set', () => {
    const notes = {
      a: { note: '', tags: [], firstSeen: 1000, lastOnline: null, party: true },
      b: { note: '', tags: [], firstSeen: 0, lastOnline: null, party: true },
      c: { note: '', tags: [], firstSeen: 1000, lastOnline: null, party: true },
    };
    const h = 3600_000;
    expect(partyEvent(notes, new Set(['a', 'b']), 1, 1000 + h / 2)).toBeNull();
    expect(partyEvent(notes, new Set(['a', 'b']), 1, 1000 + h)?.key).toBe('party:a');
    expect(partyEvent(notes, new Set(['a', 'c']), 1, 1000 + h)?.key).toBe('party:a,c');
    expect(partyEvent(notes, new Set(['a']), 0, 1e12)).toBeNull();
  });

  it('splits requests by direction', () => {
    const reqs = [
      { id: '1', requesting_member_id: 'me', target_member_id: 'x', status: 'pending' },
      { id: '2', requesting_member_id: 'y', target_member_id: 'me', status: 'pending' },
      { id: '3', requesting_member_id: 'z', target_member_id: 'me', status: 'accepted' },
    ];
    const r = splitRequests(reqs, 'me', new Map([['y', member('y')]]));
    expect(r.outgoing.map((x) => x.req.id)).toEqual(['1']);
    expect(r.incoming.map((x) => [x.req.id, x.member?.nickname])).toEqual([['2', 'y']]);
  });

  it('csv escapes', () => {
    const csv = toCsv(rows([member('a', { displayname: 'A, "x"' })], { 'id-a': { note: 'hi\nthere', tags: ['t'], firstSeen: 0, lastOnline: null } }), () => [{ sid: 'ORG' }]);
    expect(csv.split('\n')[1]).toBe('"A, ""x""",a,id-a,offline,ORG,,t,"hi');
  });
});

describe('re-add (party) cycle', () => {
  it('unfriended then re-added → fresh added time, party cleared, tags kept', () => {
    let n = touchNotes({}, [member('a'), member('b')], 100)!; // baseline
    n = { ...n, 'id-b': { ...n['id-b']!, party: true, partyAt: 150, tags: ['crew'] } };
    n = touchNotes(n, [member('a')], 200)!; // b unfriended
    expect(n['id-b']!.removedAt).toBe(200);
    n = touchNotes(n, [member('a'), member('b')], 300)!; // b re-added
    expect(n['id-b']).toMatchObject({ firstSeen: 300, party: false, tags: ['crew'] });
    expect(n['id-b']!.removedAt).toBeUndefined();
  });

  it('empty list never marks everyone removed', () => {
    const n = touchNotes({}, [member('a')], 100)!;
    expect(touchNotes(n, [], 200)).toBeNull();
  });

  it('markRemoved', () => {
    const n = touchNotes({}, [member('a')], 100)!;
    expect(markRemoved(n, ['id-a', 'id-x'], 5)['id-a']!.removedAt).toBe(5);
  });

  it('party reminder falls back to partyAt when the add time is unknown', () => {
    const notes = { a: { note: '', tags: [], firstSeen: 0, lastOnline: null, party: true, partyAt: 1000 } };
    expect(partyEvent(notes, new Set(['a']), 1, 1000 + 3600_000)?.key).toBe('party:a');
  });
});

describe('request events', () => {
  const req = (id: string, from: string) => ({ id, requesting_member_id: from, target_member_id: 'me', status: 'pending', members: [member(from, { id: from })] });
  it('baseline on first poll, then only new incoming', () => {
    expect(requestEvents(null, [req('1', 'a')], 'me', 0)).toEqual([]);
    const ev = requestEvents(['1'], [req('1', 'a'), req('2', 'b'), { ...req('3', 'me'), target_member_id: 'x' }], 'me', 0);
    expect(ev.map((e) => [e.key, e.title])).toEqual([['request:2', 'Friend request from b']]);
  });
});

describe('party mode', () => {
  const req = (id: string, from: string, to = 'me') => ({ id, requesting_member_id: from, target_member_id: to, status: 'pending' });
  const entry = (requestId: string, ok: boolean, at = 0) => ({ at, requestId, memberId: 'x', nickname: 'x', displayname: 'x', ok });

  it('active window', () => {
    expect(partyActive({ on: true, until: null, startedAt: 0 }, 5)).toBe(true);
    expect(partyActive({ on: true, until: 10, startedAt: 0 }, 10)).toBe(false);
    expect(partyActive({ on: false, until: null, startedAt: 0 }, 5)).toBe(false);
    expect(partyActive(null, 5)).toBe(false);
  });

  it('targets: incoming only, skip accepted, give up after 3 failures', () => {
    const reqs = [req('1', 'a'), req('2', 'b'), req('3', 'c'), req('4', 'me', 'z')];
    const log = [entry('1', true), entry('2', false), entry('2', false), entry('2', false), entry('3', false)];
    expect(partyTargets(reqs, 'me', log).map((r) => r.id)).toEqual(['3']);
  });

  it('log newest first, capped', () => {
    const log = appendLog([entry('old', true, 1)], [entry('a', true, 2), entry('b', true, 3)]);
    expect(log.map((l) => l.requestId)).toEqual(['b', 'a', 'old']);
  });
});

import { noteEvents } from '../src/lib/friends';
describe('noteEvents', () => {
  const m = (id: string) => ({ id, nickname: `n${id}`, displayname: `D${id}` }) as never;
  it('skips the baseline and reports added / gone friends', () => {
    expect(noteEvents({}, { a: { note: '', tags: [], firstSeen: 5, lastOnline: null } }, [m('a')], 5)).toEqual([]);
    const before = { a: { note: '', tags: [], firstSeen: 0, lastOnline: null }, b: { note: '', tags: [], firstSeen: 0, lastOnline: null } };
    const after = { ...before, b: { ...before.b, removedAt: 9 }, c: { note: '', tags: [], firstSeen: 9, lastOnline: null } };
    const ev = noteEvents(before, after, [m('a'), m('c')], 9);
    expect(ev.map((e) => e.title).sort()).toEqual(['Dc is now your friend', 'Member b is no longer on your friends list']);
    expect(ev.every((e) => e.kind === 'friend')).toBe(true);
  });
});
