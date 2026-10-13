import { describe, expect, it } from 'vitest';
import { classify, normThread } from '@/lib/capture';
import { parsePath } from '@/lib/types';

describe('capture', () => {
  it('v1 list payload', () => {
    const c = classify('/api/spectrum/forum/channel/threads', {
      success: 1,
      data: { threads: [{ id: '5', slug: 's', subject: 'Hi', channel_id: '3', replies_count: 2, time_created: 10, member: { id: '1', nickname: 'n', displayname: 'N' } }] },
    });
    expect(c?.kind).toBe('list');
    if (c?.kind === 'list') expect(c.threads[0]).toMatchObject({ id: '5', replies_count: 2, member: { nickname: 'n' } });
  });

  it('v2 camelCase thread with ISO times and nested replies', () => {
    const c = classify('/api/spectrum/v2/forum/thread/get', {
      success: 1,
      data: {
        id: 9,
        slug: 'x',
        subject: 'S',
        channelId: 3,
        repliesCount: 4,
        createdAt: '2026-10-01T00:00:00Z',
        replies: [{ id: 1, createdAt: 1791000000000, replies: [{ id: 2, timeCreated: 1791000001 }] }],
      },
    });
    expect(c?.kind).toBe('thread');
    if (c?.kind === 'thread') {
      expect(c.thread).toMatchObject({ id: '9', channel_id: '3', replies_count: 4, time_created: 1790812800 });
      expect(c.thread.replies?.map((r) => [r.id, r.time_created])).toEqual([
        ['1', 1791000000],
        ['2', 1791000001],
      ]);
    }
  });

  it('ignores non-thread objects', () => {
    expect(normThread({ id: 1 })).toBeNull();
    expect(classify('/api/spectrum/forum/channel/threads', { success: 1 })).toBeNull();
  });

  it('parsePath', () => {
    expect(parsePath('/spectrum/community/SC/forum/3/thread/my-slug/123')).toEqual({ channelId: '3', slug: 'my-slug', replyId: '123' });
    expect(parsePath('/spectrum/community/SC/forum/3')).toEqual({ channelId: '3', slug: null, replyId: null });
    expect(parsePath('/spectrum/community/SC')).toEqual({ channelId: null, slug: null, replyId: null });
  });
});
