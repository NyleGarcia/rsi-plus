import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const who = vi.hoisted(() => ({ member: null as { nickname: string; displayname: string; avatar: string | null } | null }));
vi.mock('@/lib/api', () => ({ identify: async () => ({ member: who.member }) }));

import { captureProfile, forgetProfile, logoutLocal, switchTo, toSaved, toSet, type SavedCookie } from '@/lib/accounts';
import { hangarItem, profilesItem, readItem } from '@/lib/settings';

const raw = (over: Partial<Parameters<typeof toSaved>[0]> = {}) =>
  ({
    name: 'Rsi-Token',
    value: 'abc',
    domain: '.robertsspaceindustries.com',
    path: '/',
    secure: true,
    httpOnly: true,
    hostOnly: false,
    session: false,
    sameSite: 'lax',
    expirationDate: 1_800_000_000,
    storeId: '0',
    ...over,
  }) as Parameters<typeof toSaved>[0];

describe('cookie mapping', () => {
  it('round-trips a domain cookie into set() details', () => {
    const s = toSaved(raw());
    expect(s).toEqual({ name: 'Rsi-Token', value: 'abc', domain: '.robertsspaceindustries.com', path: '/', secure: true, httpOnly: true, hostOnly: false, sameSite: 'lax', expirationDate: 1_800_000_000 });
    expect(toSet(s)).toEqual({ url: 'https://robertsspaceindustries.com/', name: 'Rsi-Token', value: 'abc', path: '/', secure: true, httpOnly: true, sameSite: 'lax', domain: '.robertsspaceindustries.com', expirationDate: 1_800_000_000 });
  });

  it('host-only cookies set no domain; session cookies no expiry', () => {
    const s: SavedCookie = toSaved(raw({ hostOnly: true, domain: 'robertsspaceindustries.com', expirationDate: undefined, session: true }));
    expect(s.expirationDate).toBeUndefined();
    const d = toSet(s);
    expect(d.domain).toBeUndefined();
    expect(d.expirationDate).toBeUndefined();
  });
});

describe('profiles', () => {
  /** fake-browser has no cookies API: a tiny in-memory jar keyed by name. */
  const jar = new Map<string, Record<string, unknown>>();
  beforeEach(() => {
    fakeBrowser.reset();
    jar.clear();
    who.member = null;
    const full = (d: Record<string, unknown>) => ({ domain: 'robertsspaceindustries.com', path: '/', secure: true, httpOnly: false, hostOnly: true, session: true, sameSite: 'unspecified', storeId: '0', ...d });
    (fakeBrowser as unknown as { cookies: unknown }).cookies = {
      getAll: async () => [...jar.values()],
      get: async ({ name }: { name: string }) => jar.get(name) ?? null,
      set: async (d: Record<string, unknown>) => (jar.set(d.name as string, full(d)), jar.get(d.name as string)),
      remove: async ({ name }: { name: string }) => jar.delete(name),
    };
  });

  it('refuses to save when logged out', async () => {
    await expect(captureProfile()).rejects.toThrow(/Not logged in/);
  });

  it('saves the current login, replaces a profile with the same handle, parks and restores data on switch', async () => {
    await fakeBrowser.cookies.set({ url: 'https://robertsspaceindustries.com/', name: 'Rsi-Token', value: 'tokA' });
    who.member = { nickname: 'Alice', displayname: 'Alice A', avatar: null };
    await readItem.setValue({ t1: { at: 1, replies: 3 } } as never);
    const a = await captureProfile();
    expect(a.handle).toBe('alice');
    expect((await profilesItem.getValue()).active).toBe(a.id);

    // Same handle again → replaced, not duplicated.
    await captureProfile();
    expect((await profilesItem.getValue()).list).toHaveLength(1);

    // Log in as Bob by hand, save; Bob's hangar is his own.
    await fakeBrowser.cookies.set({ url: 'https://robertsspaceindustries.com/', name: 'Rsi-Token', value: 'tokB' });
    who.member = { nickname: 'Bob', displayname: 'Bob B', avatar: null };
    const b = await captureProfile(); // drift: Alice is active but Bob is logged in → Alice's reads get parked
    expect(await readItem.getValue()).toEqual({});
    await hangarItem.setValue({ at: 1, pledges: [], complete: true });
    expect((await profilesItem.getValue()).list.map((p) => p.handle)).toEqual(['alice', 'bob']);

    // Switch to Alice: Bob's hangar parked, Alice's reads back, cookies swapped, identity confirmed.
    who.member = { nickname: 'Alice', displayname: 'Alice A', avatar: null };
    const r = await switchTo(a.id);
    expect(r.loggedInAs).toBe('alice');
    expect(r.profile.stale).toBe(false);
    expect((await fakeBrowser.cookies.get({ url: 'https://robertsspaceindustries.com/', name: 'Rsi-Token' }))?.value).toBe('tokA');
    expect(await hangarItem.getValue()).toBeNull();
    expect(await readItem.getValue()).toEqual({ t1: { at: 1, replies: 3 } });

    // Back to Bob: his hangar returns.
    who.member = { nickname: 'Bob', displayname: 'Bob B', avatar: null };
    await switchTo(b.id);
    expect((await hangarItem.getValue())?.complete).toBe(true);
    expect(await readItem.getValue()).toEqual({});

    // Stale: cookies no longer log in.
    who.member = null;
    const s = await switchTo(a.id);
    expect(s.loggedInAs).toBeNull();
    expect((await profilesItem.getValue()).list.find((p) => p.id === a.id)?.stale).toBe(true);

    await forgetProfile(a.id);
    expect((await profilesItem.getValue())).toEqual({ active: null, list: [expect.objectContaining({ handle: 'bob' })] });
  });

  /** Log in as `nick` (cookie + identity), save it, then give it a hangar marker (`at` = name length). */
  const loginAndSave = async (nick: string) => {
    await fakeBrowser.cookies.set({ url: 'https://robertsspaceindustries.com/', name: 'Rsi-Token', value: `tok${nick}` });
    who.member = { nickname: nick, displayname: nick, avatar: null };
    const p = await captureProfile();
    await hangarItem.setValue({ at: nick.length, pledges: [], complete: true });
    return p;
  };

  it('log out parks the active data: switching straight back restores it', async () => {
    const a = await loginAndSave('Alice');
    await logoutLocal();
    who.member = null;
    expect((await profilesItem.getValue()).active).toBeNull();
    expect(await hangarItem.getValue()).toBeNull(); // logged-out state starts clean

    who.member = { nickname: 'Alice', displayname: 'Alice', avatar: null };
    await switchTo(a.id);
    expect((await hangarItem.getValue())?.at).toBe(5);
  });

  it('log out, log in as someone else and save: both accounts keep their own data', async () => {
    const a = await loginAndSave('Alice');
    await logoutLocal();
    who.member = null;
    const b = await loginAndSave('Bob');
    expect((await hangarItem.getValue())?.at).toBe(3);

    who.member = { nickname: 'Alice', displayname: 'Alice', avatar: null };
    await switchTo(a.id);
    expect((await hangarItem.getValue())?.at).toBe(5);

    who.member = { nickname: 'Bob', displayname: 'Bob', avatar: null };
    await switchTo(b.id);
    expect((await hangarItem.getValue())?.at).toBe(3);
  });
});
