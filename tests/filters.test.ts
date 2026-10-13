import { describe, expect, it } from 'vitest';
import { filterThreads, keywordMatcher, muteReason, NO_MUTES } from '@/lib/filters';
import { member, thread } from './fixtures';

describe('mutes', () => {
  it('matches authors by nickname, case-insensitive, ignoring @', () => {
    const rules = { ...NO_MUTES, authors: ['alice'] };
    expect(muteReason(thread('1', { member: member('Alice') }), rules)).toBe('author @Alice');
    expect(muteReason(thread('1', { member: member('bob') }), rules)).toBeNull();
  });

  it('bump muting is opt-in', () => {
    const t = thread('1', { member: member('bob'), latest_activity: { time_created: 2, member: member('alice'), highlight_role_id: null } });
    expect(muteReason(t, { ...NO_MUTES, authors: ['alice'] })).toBeNull();
    expect(muteReason(t, { ...NO_MUTES, authors: ['alice'], hideBumps: true })).toBe('bumped by @alice');
  });

  it('keywords: substring and /regex/, invalid regex never matches', () => {
    const m = keywordMatcher(['refund', '/\\bwipe\\b/', '/(/']);
    expect(m('Refund please')).toBe('refund');
    expect(m('Is there a WIPE?')).toBe('/\\bwipe\\b/');
    expect(m('wiped out')).toBeNull();
  });

  it('labels', () => {
    expect(muteReason(thread('1', { label: { id: '1', name: 'Concern' } }), { ...NO_MUTES, labels: ['concern'] })).toBe('label Concern');
  });

  it('filterThreads drops muted, keeps pinned, null when unchanged', () => {
    const json = {
      success: 1,
      data: {
        threads: [thread('1', { member: member('alice') }), thread('2', { member: member('alice'), is_pinned: true }), thread('3', { member: member('bob') })],
      },
    };
    const out = filterThreads(json, { ...NO_MUTES, authors: ['alice'] });
    expect(out?.data.threads.map((t) => t.id)).toEqual(['2', '3']);
    expect(filterThreads(json, NO_MUTES)).toBeNull();
  });
});
