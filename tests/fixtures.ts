import type { Member, ThreadSummary } from '@/lib/types';

export const member = (nickname: string, extra: Partial<Member> = {}): Member => ({
  id: `id-${nickname}`,
  displayname: nickname,
  nickname,
  avatar: null,
  ...extra,
});

export const thread = (id: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  time_created: 1000,
  time_modified: 1000,
  channel_id: '3',
  type: 'discussion',
  slug: `slug-${id}`,
  subject: `Thread ${id}`,
  is_locked: false,
  is_pinned: false,
  is_sinked: false,
  is_erased: false,
  tracked_post_role_id: null,
  highlight_role_id: null,
  label: null,
  member: member('alice'),
  replies_count: 0,
  views_count: 0,
  latest_activity: null,
  ...extra,
});
