import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const who = vi.hoisted(() => ({ handle: 'zedwil' as string | null }));
vi.mock('@/lib/accounts', () => ({ whoAmI: async () => (who.handle ? { handle: who.handle, displayname: who.handle, avatar: null } : null) }));

import {
  buildPayload,
  changeHash,
  connect,
  currentAuth,
  DATA_COLLECTION,
  disconnect,
  disconnectAll,
  FINANCIAL,
  MAX_SYNC_ROWS,
  MISMATCH,
  mismatchMessage,
  pkcePair,
  push,
  s256,
  sendHangar,
  hostsOf,
  STARORG_HOSTS,
  SYNC_FORMAT,
  type SyncPayload,
} from '@/lib/starorg';
import { storage } from '#imports';
import { DEFAULTS, gameShipsItem, getSettings, hangarItem, patchSettings, starorgItem, starorgSyncItem } from '@/lib/settings';
import { SETTING_TOGGLES, STARORG_TOGGLES, toggleOf } from '@/lib/settings-ui';
import type { Pledge } from '@/lib/hangar';
import type { GameShip } from '@/lib/items';
import type { CatalogShip } from '@/lib/store';

const ship = (id: number, name: string, manufacturer: string): CatalogShip => ({ id, name, manufacturer, focus: '', msrp: 0, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
const ships = [ship(1, 'Avenger Titan', 'Aegis Dynamics'), ship(3, 'Cutlass Black', 'Drake Interplanetary')];
const pledge = (id: number, shipsIn: string[], extra: Partial<Pledge> = {}): Pledge => ({
  id, name: `Pledge ${id}`, value: 45, date: 'October 01, 2026', type: 'ship', items: shipsIn.map((title) => ({ title, kind: 'Ship' })), ships: shipsIn, upgrade: null,
  lti: false, insurance: '', warbond: false, giftable: false, meltable: true, hasGame: false, upgraded: false, nickname: '', ...extra,
});
const game: GameShip[] = [{ id: 3, name: 'Cutlass Black', how: 'bought', count: 1 }];
const pledges = [pledge(7, ['Aegis Avenger Titan'], { lti: true, insurance: 'LTI', nickname: 'Bessie' }), pledge(8, ['Cutlass Black'], { value: 110 })];
const NOW = new Date('2026-10-29T18:04:00.123Z');
const payload = (sendCost = false): SyncPayload => buildPayload(pledges, game, ships, { sendCost, rsiHandle: 'zedwil', client: 'rsi-plus/0.6.0', now: NOW });
const STARORG_ORIGIN = 'https://starorg.tools';
const DEV_ORIGIN = 'https://dev.starorg.tools';
const AUTH = { token: 'tok-123', origin: STARORG_ORIGIN, expiresAt: Date.now() + 86_400_000, user: { discord_id: '1', username: 'zed', rsi_handle: 'zedwil', rsi_verified: true } };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fakeBrowser.reset();
  who.handle = 'zedwil';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await patchSettings({ starorg: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('payload builder', () => {
  it('wraps the StarOrg preset rows in the sync envelope', () => {
    const p = payload();
    expect(p).toMatchObject({ format: SYNC_FORMAT, client: 'rsi-plus/0.6.0', rsi_handle: 'zedwil', exported_at: '2026-10-29T18:04:00Z' });
    expect(p.rows.map((r) => [r.name, r.acquired, r.pledge_id])).toEqual([
      ['Avenger Titan', 'pledge', '7'],
      ['Cutlass Black', 'game', ''],
      ['Cutlass Black', 'pledge', '8'],
    ]);
    expect(p.rows.find((r) => r.pledge_id === '7')).toMatchObject({ ship_name: 'Bessie', lti: true, insurance: 'LTI' });
    expect(p.rows.every((r) => !('pledge_date' in r))).toBe(true);
  });
  it('blanks pledge_cost on every row unless Send pledge values is on', () => {
    expect(payload(false).rows.map((r) => r.pledge_cost)).toEqual(['', '', '']);
    expect(payload(true).rows.map((r) => r.pledge_cost)).toEqual(['$45.00 USD', '$0.00 USD', '$110.00 USD']);
  });
});

describe('changeHash', () => {
  it('is stable and order-insensitive', () => {
    const rows = payload().rows;
    expect(changeHash(rows)).toBe(changeHash([...rows].reverse()));
    expect(changeHash(rows)).toBe(changeHash(payload().rows));
    expect(changeHash(rows)).toMatch(/^[0-9a-f]{14}$/);
  });
  it('changes with a nickname, a flag, a removed row or sending values', () => {
    const rows = payload().rows;
    const base = changeHash(rows);
    expect(changeHash(rows.map((r, i) => (i ? r : { ...r, ship_name: 'Old Faithful' })))).not.toBe(base);
    expect(changeHash(rows.map((r, i) => (i ? r : { ...r, warbond: true })))).not.toBe(base);
    expect(changeHash(rows.slice(1))).not.toBe(base);
    expect(changeHash(payload(true).rows)).not.toBe(base);
  });
});

describe('PKCE', () => {
  it('RFC 7636 appendix B vector', async () => {
    expect(await s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('makes a 43-char verifier in the allowed alphabet and its challenge', async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43}$/);
    expect(challenge).toBe(await s256(verifier));
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('push', () => {
  it('sends nothing when disconnected', async () => {
    const r = await push(payload());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, disconnected: true });
  });
  it('forgets an expired token without a request', async () => {
    await starorgItem.setValue({ ...AUTH, expiresAt: Date.now() - 1 });
    expect(await currentAuth()).toBeNull();
    expect(await starorgItem.getValue()).toBeNull();
    await push(payload());
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('PUTs with the bearer and credentials omitted, records the hash', async () => {
    await starorgItem.setValue(AUTH);
    fetchMock.mockResolvedValue(json(200, { status: 'success', imported_count: 3, updated: 0, removed: 0 }));
    const p = payload();
    const r = await push(p);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${STARORG_ORIGIN}/api/fleet/hangar/sync`);
    expect(init).toMatchObject({ method: 'PUT', credentials: 'omit' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(init.body as string)).toEqual(p);
    expect(r).toMatchObject({ ok: true, rows: 3, hash: changeHash(p.rows), handle: 'zedwil' });
    expect((await starorgSyncItem.getValue())?.hash).toBe(changeHash(p.rows));
  });
  it('401 → disconnected: the token is forgotten', async () => {
    await starorgItem.setValue(AUTH);
    fetchMock.mockResolvedValue(json(401, { detail: 'Session revoked' }));
    const r = await push(payload());
    expect(r).toMatchObject({ ok: false, disconnected: true });
    expect(await starorgItem.getValue()).toBeNull();
  });
  it('409 RSI_HANDLE_MISMATCH names the verified handles and keeps the last good hash', async () => {
    await starorgItem.setValue(AUTH);
    await starorgSyncItem.setValue({ at: 1, ok: true, message: 'Sent', hash: 'abc' });
    fetchMock.mockResolvedValue(json(409, { detail: { code: MISMATCH, message: 'not yours', verified_handles: ['MainGuy', 'altguy'] } }));
    const r = await push(payload());
    expect(r).toMatchObject({ ok: false, verifiedHandles: ['MainGuy', 'altguy'], message: mismatchMessage(['MainGuy', 'altguy']), hash: 'abc' });
    expect(r.message).toContain('StarOrg knows you as MainGuy or altguy');
    expect(await starorgItem.getValue()).not.toBeNull();
  });
  it('keeps the hulls StarOrg did not know (capped) and says so instead of a plain "Sent N"', async () => {
    await starorgItem.setValue(AUTH);
    const names = Array.from({ length: 25 }, (_, i) => `Mystery ${i}`);
    fetchMock.mockResolvedValue(json(200, { status: 'success', imported_count: 1, updated: 0, removed: 0, kept_unmatched: 25, not_found: names }));
    const r = await push(payload());
    expect(r).toMatchObject({ ok: true, unmatched: 25 });
    expect(r.notFound).toEqual(names.slice(0, 20));
    expect(r.message).toContain("25 hulls StarOrg Tools doesn't know yet");
    expect((await starorgSyncItem.getValue())?.notFound).toHaveLength(20);
  });
  it('summarises a 422 validation list instead of "HTTP 422"', async () => {
    await starorgItem.setValue(AUTH);
    fetchMock.mockResolvedValue(json(422, { detail: [{ loc: ['body', 'rows'], msg: 'List should have at most 500 items', type: 'too_long' }, { loc: ['body', 'format'], msg: 'x' }] }));
    const r = await push(payload());
    expect(r.message).toBe('StarOrg Tools refused the hangar: List should have at most 500 items at rows (+1 more)');
  });
  it('another 409 is a plain refusal', async () => {
    await starorgItem.setValue(AUTH);
    fetchMock.mockResolvedValue(json(409, { detail: 'A sync for this RSI handle is already running; try again.' }));
    const r = await push(payload());
    expect(r).toMatchObject({ ok: false, message: 'StarOrg Tools refused the hangar: A sync for this RSI handle is already running; try again.' });
    expect(r.verifiedHandles).toBeUndefined();
  });
});

describe('sendHangar', () => {
  const catalog = async () => ships;
  beforeEach(async () => {
    await hangarItem.setValue({ at: 1, pledges, complete: true, handle: 'zedwil' });
    await gameShipsItem.setValue(game);
  });
  it("refuses to send a hangar read as another RSI login (no request)", async () => {
    await starorgItem.setValue(AUTH);
    fetchMock.mockImplementation(async () => json(200, {}));
    who.handle = 'altguy'; // logged out of zedwil and into altguy on the website, no profile switch
    const r = await sendHangar(catalog);
    expect(r).toMatchObject({ ok: false, message: 'Saved hangar belongs to zedwil; load your hangar again (Hangar → Pledges).' });
    expect(await sendHangar(catalog, { onlyIfChanged: true })).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses a saved hangar with no recorded handle (saved before handles were kept)', async () => {
    await starorgItem.setValue(AUTH);
    await hangarItem.setValue({ at: 1, pledges, complete: true });
    expect(await sendHangar(catalog)).toMatchObject({ ok: false, message: expect.stringContaining('load your hangar again') });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it(`refuses more than ${MAX_SYNC_ROWS} rows before sending`, async () => {
    await starorgItem.setValue(AUTH);
    await gameShipsItem.setValue([{ id: 3, name: 'Cutlass Black', how: 'bought', count: MAX_SYNC_ROWS }]);
    const r = await sendHangar(catalog);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining(`at most ${MAX_SYNC_ROWS}`) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does nothing (no fetch, no read) when disconnected', async () => {
    expect(await sendHangar(catalog)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends the logged-in handle and honours Send pledge values', async () => {
    await starorgItem.setValue(AUTH);
    fetchMock.mockImplementation(async () => json(200, {}));
    await sendHangar(catalog);
    let body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as SyncPayload;
    expect(body.rsi_handle).toBe('zedwil');
    expect(body.rows.every((r) => r.pledge_cost === '')).toBe(true);
    await patchSettings({ starorgSendCost: true });
    await sendHangar(catalog);
    body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as SyncPayload;
    expect(body.rows.some((r) => r.pledge_cost === '$110.00 USD')).toBe(true);
  });
  it('weekly (onlyIfChanged) skips an unchanged hangar and sends a changed one', async () => {
    await starorgItem.setValue(AUTH);
    fetchMock.mockImplementation(async () => json(200, {}));
    await sendHangar(catalog);
    expect(await sendHangar(catalog, { onlyIfChanged: true })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await gameShipsItem.setValue([...game, { id: 1, name: 'Avenger Titan', how: 'earned', count: 1 }]);
    expect(await sendHangar(catalog, { onlyIfChanged: true })).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('refuses a partial hangar and a logged-out RSI session without a request', async () => {
    await starorgItem.setValue(AUTH);
    await hangarItem.setValue({ at: 2, pledges, complete: false, page: 1 });
    expect(await sendHangar(catalog)).toMatchObject({ ok: false });
    await hangarItem.setValue({ at: 3, pledges, complete: true, handle: 'zedwil' });
    who.handle = null;
    expect(await sendHangar(catalog)).toMatchObject({ ok: false, message: expect.stringContaining('Not logged in') });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('connect / disconnect', () => {
  const REDIRECT = 'https://abcdef.chromiumapp.org/';
  let request: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let flow: ReturnType<typeof vi.fn>;
  const order: string[] = [];
  beforeEach(() => {
    order.length = 0;
    request = vi.fn(async () => (order.push('request'), true));
    remove = vi.fn(async () => (order.push('remove'), true));
    flow = vi.fn(async () => (order.push('flow'), `${REDIRECT}?code=C0DE`));
    Object.assign(fakeBrowser.permissions, { request, remove });
    Object.assign(fakeBrowser.identity, { getRedirectURL: () => REDIRECT, launchWebAuthFlow: flow });
  });
  afterEach(() => vi.unstubAllEnvs());
  const user = { discord_id: '1', username: 'zed', rsi_handle: 'zedwil', rsi_verified: true };

  it('asks for the host first, runs PKCE S256 on the identity redirect, exchanges code + verifier without cookies', async () => {
    fetchMock.mockImplementation(async () => (order.push('exchange'), json(200, { access_token: 'tok', expires_in: 3600, user })));
    const before = Date.now();
    const auth = await connect('prod');
    expect(order).toEqual(['request', 'flow', 'exchange']);
    expect(request).toHaveBeenCalledWith({ origins: hostsOf(STARORG_ORIGIN) });
    const { url, interactive } = flow.mock.calls[0]![0] as { url: string; interactive: boolean };
    expect(interactive).toBe(true);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${STARORG_ORIGIN}/api/auth/extension/login`);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT);
    const [xurl, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(xurl).toBe(`${STARORG_ORIGIN}/api/auth/extension/exchange`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    const body = JSON.parse(init.body as string) as { code: string; code_verifier: string };
    expect(body.code).toBe('C0DE');
    expect(await s256(body.code_verifier)).toBe(u.searchParams.get('code_challenge'));
    expect(auth).toMatchObject({ token: 'tok', user });
    expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(await starorgItem.getValue()).toEqual(auth);
    expect(remove).not.toHaveBeenCalled();
  });
  it('a denied permission stops before the sign-in', async () => {
    request.mockResolvedValue(false);
    await expect(connect('prod')).rejects.toThrow(/needs permission/);
    expect(flow).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a cancelled sign-in gives the host permission back', async () => {
    flow.mockRejectedValue(new Error('The user did not approve access.'));
    await expect(connect('prod')).rejects.toThrow(/did not finish/);
    expect(remove).toHaveBeenCalledWith({ origins: STARORG_HOSTS });
    expect(await starorgItem.getValue()).toBeNull();
  });
  it('a redirect with ?error= names it, and a missing code is reported; both release the permission', async () => {
    flow.mockResolvedValue(`${REDIRECT}?error=access_denied`);
    await expect(connect('prod')).rejects.toThrow('StarOrg Tools sign-in failed: access_denied.');
    flow.mockResolvedValue(REDIRECT);
    await expect(connect('prod')).rejects.toThrow('returned no code');
    flow.mockResolvedValue('not a url');
    await expect(connect('prod')).rejects.toThrow('returned no code');
    expect(remove).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a refused exchange (400) or a malformed answer stores nothing and releases the permission', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { detail: 'Invalid or expired code' }));
    await expect(connect('prod')).rejects.toThrow('StarOrg Tools refused the sign-in: Invalid or expired code');
    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'tok', user })); // no expires_in → would never expire
    await expect(connect('prod')).rejects.toThrow('unexpected sign-in answer');
    expect(await starorgItem.getValue()).toBeNull();
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it('a failed connect keeps the permission while the incognito context is still connected', async () => {
    await storage.setItem('local:incognito.starorg', AUTH);
    flow.mockRejectedValue(new Error('closed'));
    await expect(connect('prod')).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });
  it('disconnect: logout with the bearer (no cookies), then forget the token, then drop the permission', async () => {
    await starorgItem.setValue(AUTH);
    await starorgSyncItem.setValue({ at: 1, ok: true, message: 'Sent' });
    fetchMock.mockImplementation(async () => {
      order.push(`logout:${(await starorgItem.getValue()) ? 'token-kept' : 'token-gone'}`);
      return json(200, {});
    });
    remove.mockImplementation(async () => (order.push(`remove:${(await starorgItem.getValue()) ? 'token-kept' : 'token-gone'}`), true));
    await disconnect();
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${STARORG_ORIGIN}/api/auth/logout`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(order).toEqual(['logout:token-kept', 'remove:token-gone']);
    expect(remove).toHaveBeenCalledWith({ origins: STARORG_HOSTS });
    expect(await starorgSyncItem.getValue()).toBeNull();
  });
  it('disconnect keeps the shared host permission while the other (incognito) context holds a live token', async () => {
    await starorgItem.setValue(AUTH);
    await storage.setItem('local:incognito.starorg', AUTH);
    fetchMock.mockResolvedValue(json(200, {}));
    await disconnect();
    expect(await starorgItem.getValue()).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    // An expired token in the other context does not hold it.
    await storage.setItem('local:incognito.starorg', { ...AUTH, expiresAt: Date.now() - 1 });
    await disconnect();
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('Firefox: Connect asks for the data categories, Disconnect removes them with the host', async () => {
    vi.stubEnv('FIREFOX', 'true' as never);
    fetchMock.mockResolvedValue(json(200, { access_token: 'tok', expires_in: 3600, user }));
    await connect('prod');
    expect(request).toHaveBeenCalledWith({ origins: hostsOf(STARORG_ORIGIN), data_collection: DATA_COLLECTION });
    await disconnect();
    expect(remove).toHaveBeenCalledWith({ origins: STARORG_HOSTS, data_collection: [...DATA_COLLECTION, FINANCIAL] });
  });
  it('Firefox: pledge values go only while the financial category is granted', async () => {
    vi.stubEnv('FIREFOX', 'true' as never);
    const contains = vi.fn(async () => false);
    Object.assign(fakeBrowser.permissions, { contains });
    await starorgItem.setValue(AUTH);
    await hangarItem.setValue({ at: 1, pledges, complete: true, handle: 'zedwil' });
    await patchSettings({ starorgSendCost: true });
    fetchMock.mockImplementation(async () => json(200, {}));
    await sendHangar(async () => ships);
    let body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as SyncPayload;
    expect(body.rows.every((r) => r.pledge_cost === '')).toBe(true);
    expect(contains).toHaveBeenCalledWith({ data_collection: [FINANCIAL] });
    contains.mockResolvedValue(true);
    await sendHangar(async () => ships);
    body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as SyncPayload;
    expect(body.rows.some((r) => r.pledge_cost === '$110.00 USD')).toBe(true);
  });
});

describe('StarOrg settings', () => {
  it('the integration is opt-in, on production, and Auto-sync and Send pledge values default off', async () => {
    expect(DEFAULTS.starorg).toBe(false);
    expect(DEFAULTS.starorgTarget).toBe('prod');
    expect(DEFAULTS.starorgAutoSync).toBe(false);
    expect(DEFAULTS.starorgSendCost).toBe(false);
    expect(await getSettings()).toMatchObject({ starorgAutoSync: false, starorgSendCost: false });
  });
  it('their switches live on the StarOrg card, not in the Spectrum / site list', () => {
    expect(STARORG_TOGGLES.map((t) => t.key)).toEqual(['starorgAutoSync', 'starorgSendCost']);
    expect(SETTING_TOGGLES.some((t) => t.key.startsWith('starorg'))).toBe(false);
    expect(toggleOf('starorg').label).toBe('StarOrg Tools');
    expect(toggleOf('starorgSendCost').label).toBe('Send pledge values');
  });
});

describe('StarOrg site (production / dev)', () => {
  const user = { discord_id: '1', username: 'zed', rsi_handle: 'zedwil', rsi_verified: true };
  it('declares both sites as optional hosts', () => {
    expect(STARORG_HOSTS).toEqual([`${STARORG_ORIGIN}/*`, `${DEV_ORIGIN}/*`]);
  });
  it('connects to the chosen site only, and the token remembers it', async () => {
    const request = vi.fn(async () => true);
    const flow = vi.fn(async (_details: { url: string }) => 'https://ext.chromiumapp.org/?code=abc');
    fakeBrowser.permissions.request = request as never;
    fakeBrowser.identity.launchWebAuthFlow = flow as never;
    fakeBrowser.identity.getRedirectURL = (() => 'https://ext.chromiumapp.org/') as never;
    fetchMock.mockResolvedValue(json(200, { access_token: 'tok', expires_in: 3600, user }));
    const auth = await connect('dev');
    expect(request).toHaveBeenCalledWith({ origins: hostsOf(DEV_ORIGIN) });
    expect(new URL(flow.mock.calls[0]![0].url).origin).toBe(DEV_ORIGIN);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${DEV_ORIGIN}/api/auth/extension/exchange`);
    expect(auth.origin).toBe(DEV_ORIGIN);
    expect((await starorgItem.getValue())?.origin).toBe(DEV_ORIGIN);
  });
  it('sends with a token to the site that issued it, whatever the setting says now', async () => {
    await starorgItem.setValue({ ...AUTH, origin: DEV_ORIGIN });
    await patchSettings({ starorgTarget: 'prod' });
    fetchMock.mockResolvedValue(json(200, { status: 'success' }));
    await push(payload());
    expect(fetchMock.mock.calls[0]![0]).toBe(`${DEV_ORIGIN}/api/fleet/hangar/sync`);
  });
  it('forgets a token without a known site', async () => {
    await starorgItem.setValue({ ...AUTH, origin: 'https://evil.example' });
    expect(await currentAuth()).toBeNull();
    expect(await starorgItem.getValue()).toBeNull();
  });
});

describe('StarOrg integration switch', () => {
  it('off: nothing is read or sent, even with a token', async () => {
    await starorgItem.setValue(AUTH);
    await hangarItem.setValue({ at: 1, pledges, complete: true, handle: 'zedwil' } as never);
    await patchSettings({ starorg: false });
    expect(await sendHangar(async () => ships)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('StarOrg switched off', () => {
  const user = { discord_id: '1', username: 'zed', rsi_handle: 'zedwil', rsi_verified: true };
  it('a sign-in that finishes after the switch went off keeps no token and gives the permission back', async () => {
    const remove = vi.fn(async () => true);
    fakeBrowser.permissions.request = (async () => true) as never;
    fakeBrowser.permissions.remove = remove as never;
    fakeBrowser.identity.getRedirectURL = (() => 'https://ext.chromiumapp.org/') as never;
    fakeBrowser.identity.launchWebAuthFlow = (async () => {
      await patchSettings({ starorg: false });
      return 'https://ext.chromiumapp.org/?code=abc';
    }) as never;
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/exchange') ? json(200, { access_token: 'tok', expires_in: 3600, user }) : json(200, {})));
    await expect(connect('prod')).rejects.toThrow(/switched off/);
    expect(await starorgItem.getValue()).toBeNull();
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(`${STARORG_ORIGIN}/api/auth/logout`);
    expect(remove).toHaveBeenCalled();
  });
  it('disconnectAll signs out both contexts and drops the hosts even while the other context is connected', async () => {
    const remove = vi.fn(async () => true);
    fakeBrowser.permissions.remove = remove as never;
    fetchMock.mockResolvedValue(json(200, {}));
    await starorgItem.setValue(AUTH);
    await storage.setItem('local:incognito.starorg', { ...AUTH, token: 'tok-incog', origin: DEV_ORIGIN });
    await storage.setItem('local:incognito.starorgSync', { at: 1, ok: true, message: 'x' });
    await disconnectAll();
    expect(await starorgItem.getValue()).toBeNull();
    expect(await storage.getItem('local:incognito.starorg')).toBeNull();
    expect(await storage.getItem('local:incognito.starorgSync')).toBeNull();
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([`${DEV_ORIGIN}/api/auth/logout`, `${STARORG_ORIGIN}/api/auth/logout`]);
    expect(remove).toHaveBeenCalledWith({ origins: STARORG_HOSTS });
  });
});
