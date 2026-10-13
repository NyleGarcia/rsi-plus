import { describe, expect, it } from 'vitest';
import { normFriendList, normPresence, normRequestList } from '@/lib/relationship';

describe('relationship normalizers', () => {
  it('v2 friend list (bundle shape) incl. wrapped lists', () => {
    const v2 = [{ id: 7, accountId: 9, nickname: 'n', displayname: 'N', avatar: 'a.png', isGm: false, presence: { status: 'online', info: 'SC' } }];
    expect(normFriendList(v2)).toEqual([
      { id: '7', displayname: 'N', nickname: 'n', avatar: 'a.png', isGM: false, presence: { status: 'online', info: 'SC', since: null }, meta: undefined, common_communities: undefined },
    ]);
    expect(normFriendList({ friends: v2 })).toHaveLength(1);
    expect(normFriendList({ items: [{ member: { id: 1, nickname: 'x' } }] })[0]).toMatchObject({ id: '1', nickname: 'x', displayname: 'x' });
    expect(normFriendList(null)).toEqual([]);
  });

  it('presence: strings, codes, gRPC-style', () => {
    expect(normPresence({ status: 'do_not_disturb' })?.status).toBe('do_not_disturb');
    expect(normPresence({ status: 'dnd' })?.status).toBe('do_not_disturb');
    expect(normPresence(4)?.status).toBe('playing');
    expect(normPresence({ status: 'ACTIVITY', activity: { state: 'In game' } })).toMatchObject({ status: 'playing', info: 'In game' });
    expect(normPresence({ status: 'weird' })?.status).toBe('offline');
  });

  it('v2 requests → v1 shape; v1 passes through', () => {
    const [r] = normRequestList([{ id: 3, createdAt: 1791000000000, sender: { id: 1, nickname: 'a' }, receiver: { id: 2, nickname: 'me' } }]);
    expect(r).toMatchObject({ id: '3', requesting_member_id: '1', target_member_id: '2', status: 'pending', time_created: 1791000000 });
    expect(normRequestList([{ id: 4, requesting_member_id: '1', target_member_id: '2', status: 'pending' }])[0]?.id).toBe('4');
  });
});

describe('relationship dedupe', () => {
  it('drops repeated friend / request ids', () => {
    expect(normFriendList([{ id: 1, nickname: 'a' }, { id: 1, nickname: 'a' }])).toHaveLength(1);
    expect(normRequestList([{ id: 4, requesting_member_id: '1', target_member_id: '2' }, { id: 4, requesting_member_id: '1', target_member_id: '2' }])).toHaveLength(1);
  });
});
