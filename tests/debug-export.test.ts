import { describe, expect, it, vi } from 'vitest';

vi.mock('#imports', () => ({ browser: { runtime: { getManifest: () => ({ version: '0.0.0' }) } }, storage: {} }));
const { redact } = await import('@/lib/debug-export');

describe('debug export redaction', () => {
  const data = {
    starorg: { accessToken: 'abc', refresh_token: 'def', host: 'starorg.example' },
    cookie: 'Rsi-Token=x',
    blob: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    hangar: { pledges: [{ id: 1, value: 0, uec: 15000, nickname: 'Rusty', items: [{ title: 'Greycat PTV', customName: 'Rusty' }], reservedNames: ['Rusty'], raw: { value: '¤15,000 UEC' } }] },
    friends: [{ handle: 'someone', displayName: 'Some One' }],
    empty: { apiKey: '' },
  };

  it('always drops secrets, masks personal names by default', () => {
    const r = redact(data) as typeof data;
    expect(r.starorg).toEqual({ accessToken: '[redacted]', refresh_token: '[redacted]', host: 'starorg.example' });
    expect(r.cookie).toBe('[redacted]');
    expect(r.blob).toBe('[redacted]');
    expect(r.empty.apiKey).toBe('');
    const p = r.hangar.pledges[0]!;
    expect(p).toMatchObject({ id: 1, uec: 15000, nickname: '[masked]', reservedNames: ['[masked]'], raw: { value: '¤15,000 UEC' } });
    expect(p.items[0]).toEqual({ title: 'Greycat PTV', customName: '[masked]' });
    expect(r.friends[0]).toEqual({ handle: '[masked]', displayName: '[masked]' });
  });

  it('masks people used as map keys, saved-login ids, muted authors; summarizes store data', () => {
    const r = redact({
      orgs: { someone: { orgs: [{ sid: 'ORG' }] } },
      presence: { '123': 'online', '456': 'offline' },
      friendNotes: { '456': { note: 'hi', tags: [] } },
      profiles: { active: 'me-1a2b', list: [{ id: 'me-1a2b', avatar: 'https://x/a.png', cookies: 'c' }] },
      'profileData.me-1a2b': { hangar: null },
      settings: { mutes: { authors: ['troll'], threads: [5] } },
      catalog: { at: 7, ships: [1, 2, 3] },
    }) as Record<string, any>;
    expect(r.orgs).toEqual({ '#1': { orgs: [{ sid: 'ORG' }] } });
    expect(r.presence).toEqual({ '#2': 'online', '#3': 'offline' });
    expect(r.friendNotes).toEqual({ '#3': { note: '[masked]', tags: [] } }); // same person, same alias
    expect(r.profiles).toEqual({ active: '[masked]', list: [{ id: '[masked]', avatar: '[masked]', cookies: '[redacted]' }] });
    expect(Object.keys(r).filter((k) => k.startsWith('profileData.'))).toEqual(['profileData.#4']);
    expect(r.settings.mutes).toEqual({ authors: ['[masked]'], threads: [5] });
    expect(r.catalog).toMatchObject({ at: 7, count: 3 });
    expect((redact({ catalog: { at: 7, ships: [1] } }, false, true) as Record<string, unknown>).catalog).toEqual({ at: 7, ships: [1] });
  });

  it('keeps names when asked, never secrets', () => {
    const r = redact(data, true) as typeof data;
    expect(r.friends[0]).toEqual({ handle: 'someone', displayName: 'Some One' });
    expect(r.hangar.pledges[0]!.nickname).toBe('Rusty');
    expect(r.starorg.accessToken).toBe('[redacted]');
  });
});
