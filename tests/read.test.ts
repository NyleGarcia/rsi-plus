import { describe, expect, it } from 'vitest';
import { firstNewReply, markRead, markUnread, prune, status } from '@/lib/read';
import { thread } from './fixtures';

describe('read tracking', () => {
  it('unseen → read → new', () => {
    const t = thread('1', { replies_count: 3 });
    expect(status(t, {})).toEqual({ kind: 'unseen' });
    const s = markRead({}, t, 1);
    expect(status(t, s)).toEqual({ kind: 'read' });
    expect(status({ ...t, replies_count: 5 }, s)).toEqual({ kind: 'new', count: 2 });
  });

  it('never moves backwards on a stale payload', () => {
    const s = markRead({}, thread('1', { replies_count: 5, time_created: 100 }), 1);
    const s2 = markRead(s, thread('1', { replies_count: 3, time_created: 50 }), 2);
    expect(s2['1']).toMatchObject({ replies: 5, seenAt: 100, at: 2 });
  });

  it('markUnread forgets the thread', () => {
    const s = markRead({}, thread('1'), 1);
    expect(status(thread('1'), markUnread(s, '1'))).toEqual({ kind: 'unseen' });
  });

  it('prune keeps the most recently opened', () => {
    const s = { a: { replies: 0, seenAt: 0, at: 1 }, b: { replies: 0, seenAt: 0, at: 3 }, c: { replies: 0, seenAt: 0, at: 2 } };
    expect(Object.keys(prune(s, 2)).sort()).toEqual(['b', 'c']);
  });

  it('firstNewReply = earliest reply after seenAt', () => {
    const r = (id: string, t: number) => ({ id, time_created: t, thread_id: '1', is_erased: false, member: null });
    const mark = { replies: 1, seenAt: 100, at: 0 };
    expect(firstNewReply([r('a', 300), r('b', 50), r('c', 200)], mark)?.id).toBe('c');
    expect(firstNewReply([r('b', 50)], mark)).toBeNull();
    expect(firstNewReply([r('c', 200)], undefined)).toBeNull();
  });
});
