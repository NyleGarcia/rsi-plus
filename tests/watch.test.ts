import { describe, expect, it } from 'vitest';
import { channelEvents, friendEvents, mergeEvents, threadEvents, type WatchedChannel } from '@/lib/watch';
import { member, thread } from './fixtures';

const url = () => 'u';

describe('watch diff', () => {
  it('thread: only when replies grew', () => {
    const w = { id: '1', slug: 's', channelId: '3', subject: 'S', replies: 4, addedAt: 0 };
    expect(threadEvents(w, thread('1', { replies_count: 4 }), 'u', 0)).toEqual([]);
    const [e] = threadEvents(w, thread('1', { replies_count: 6 }), 'u', 0);
    expect(e).toMatchObject({ kind: 'replies', key: 'replies:1:6', body: '2 new replies' });
  });

  it('channel: first poll is a silent baseline', () => {
    const c: WatchedChannel = { id: '3', name: 'General', lastThreadId: null, allThreads: true };
    const r = channelEvents(c, [thread('10'), thread('12')], [], url, 0);
    expect(r).toEqual({ events: [], lastThreadId: '12' });
  });

  it('channel: new dev/author threads, all-threads mode, bumps by devs', () => {
    const c: WatchedChannel = { id: '3', name: 'General', lastThreadId: '12', allThreads: false };
    const list = [
      thread('13', { tracked_post_role_id: '2' }),
      thread('14', { member: member('Watched') }),
      thread('15'),
      thread('11', { latest_activity: { time_created: 77, member: member('cig'), highlight_role_id: '2' } }),
    ];
    const r = channelEvents(c, list, ['watched'], url, 0);
    expect(r.lastThreadId).toBe('15');
    expect(r.events.map((e) => [e.kind, e.key])).toEqual([
      ['dev', 'thread:13'],
      ['author', 'thread:14'],
      ['dev', 'reply:11:77'],
    ]);
    expect(channelEvents({ ...c, allThreads: true }, list, [], url, 0).events.map((e) => e.key)).toContain('thread:15');
  });

  it('friends: offline → online for watched ids only, not on first sight', () => {
    const on = (n: string) => member(n, { presence: { status: 'online', info: null, since: 5 } });
    const prev = { 'id-a': 'offline', 'id-b': 'offline', 'id-c': 'online' };
    const ev = friendEvents(prev, [on('a'), on('b'), on('c'), on('d')], ['id-a'], false, 0);
    expect(ev.map((e) => e.key)).toEqual(['friend:id-a:5']);
    expect(friendEvents(prev, [on('a'), on('b'), on('c'), on('d')], [], true, 0)).toHaveLength(2);
  });

  it('mergeEvents dedupes by key and caps', () => {
    const e = (key: string) => ({ key, kind: 'thread' as const, title: '', body: '', url: '', at: 0, seen: false });
    expect(mergeEvents([e('a')], [e('a'), e('b'), e('c')]).map((x) => x.key)).toEqual(['c', 'b', 'a']);
    expect(mergeEvents([e('a')], [e('b')], 1).map((x) => x.key)).toEqual(['b']);
  });
});
