import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const who = vi.hoisted(() => ({ handle: 'zedwil' as string | null }));
vi.mock('@/lib/accounts', () => ({ whoAmI: async () => (who.handle ? { handle: who.handle, displayname: who.handle, avatar: null } : null) }));
const reader = vi.hoisted(() => ({ pledges: [] as unknown[] }));
vi.mock('@/lib/account', () => ({
  loadHangar: async (onProgress: (p: { page: number; items: unknown[] }) => Promise<void>) => {
    await onProgress({ page: 1, items: reader.pledges.slice(0, 1) });
    return reader.pledges;
  },
}));

import { afterLoad, isNewLoad, scheduleStarOrg, STARORG_ALARM, STARORG_PERIOD, weeklySync, weeklyWanted } from '@/lib/starorg-auto';
import { refreshHangar, saveCompleteLoad } from '@/lib/hangar-refresh';
import { ACCOUNT_ITEMS, gameShipsItem, hangarItem, hangarLoadItem, patchSettings, starorgItem } from '@/lib/settings';
import type { Pledge } from '@/lib/hangar';
import type { CatalogShip } from '@/lib/store';

const ship = (id: number, name: string, manufacturer: string): CatalogShip => ({ id, name, manufacturer, focus: '', msrp: 0, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
const ships = [ship(1, 'Avenger Titan', 'Aegis Dynamics'), ship(3, 'Cutlass Black', 'Drake Interplanetary')];
const catalog = async () => ships;
const pledge = (id: number, shipsIn: string[]): Pledge => ({
  id, name: `Pledge ${id}`, value: 45, date: 'October 01, 2026', type: 'ship', items: shipsIn.map((title) => ({ title, kind: 'Ship' })), ships: shipsIn, upgrade: null,
  lti: false, insurance: '', warbond: false, giftable: false, meltable: true, hasGame: false, upgraded: false, nickname: '',
});
const A = [pledge(7, ['Aegis Avenger Titan'])];
const B = [pledge(7, ['Aegis Avenger Titan']), pledge(8, ['Cutlass Black'])];
const AUTH = { token: 'tok-123', origin: 'https://starorg.tools', expiresAt: Date.now() + 86_400_000, user: { discord_id: '1', username: 'zed', rsi_handle: 'zedwil', rsi_verified: true } };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fakeBrowser.reset();
  who.handle = 'zedwil';
  reader.pledges = B;
  fetchMock = vi.fn(async () => json(200, {}));
  vi.stubGlobal('fetch', fetchMock);
  await gameShipsItem.setValue([]);
  await patchSettings({ starorg: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('weekly alarm', () => {
  it('is wanted only while connected, with Auto-sync on and outside passive mode', () => {
    const on = { starorg: true, pollAuto: true, starorgAutoSync: true };
    expect(weeklyWanted(on, true)).toBe(true);
    expect(weeklyWanted({ ...on, pollAuto: false }, true)).toBe(false);
    expect(weeklyWanted({ ...on, starorgAutoSync: false }, true)).toBe(false);
    expect(weeklyWanted(on, false)).toBe(false);
    expect(weeklyWanted({ ...on, starorg: false }, true)).toBe(false);
  });
  it('is created weekly when wanted and cleared on passive mode, Auto-sync off or disconnect', async () => {
    await starorgItem.setValue(AUTH);
    await patchSettings({ pollAuto: true, starorgAutoSync: true });
    await scheduleStarOrg();
    expect(await fakeBrowser.alarms.get(STARORG_ALARM)).toMatchObject({ periodInMinutes: STARORG_PERIOD });

    await patchSettings({ pollAuto: false });
    await scheduleStarOrg();
    expect(await fakeBrowser.alarms.get(STARORG_ALARM)).toBeFalsy();

    await patchSettings({ pollAuto: true });
    await scheduleStarOrg();
    await patchSettings({ starorgAutoSync: false });
    await scheduleStarOrg();
    expect(await fakeBrowser.alarms.get(STARORG_ALARM)).toBeFalsy();

    await patchSettings({ starorgAutoSync: true });
    await scheduleStarOrg();
    await starorgItem.setValue(null);
    await scheduleStarOrg();
    expect(await fakeBrowser.alarms.get(STARORG_ALARM)).toBeFalsy();
  });
});

describe('push after a load', () => {
  it('a new completed load (with a handle) triggers; a repeat, a clear or a handle-less load does not', () => {
    expect(isNewLoad({ at: 2, handle: 'zedwil' }, { at: 1, handle: 'zedwil' })).toBe(true);
    expect(isNewLoad({ at: 2, handle: 'zedwil' }, null)).toBe(true);
    expect(isNewLoad({ at: 2, handle: 'zedwil' }, { at: 2, handle: 'zedwil' })).toBe(false);
    expect(isNewLoad(null, { at: 2, handle: 'zedwil' })).toBe(false);
    expect(isNewLoad({ at: 3, handle: null }, { at: 2, handle: 'zedwil' })).toBe(false);
  });
  it('a profile restore is not a load: the trigger is never part of the swapped account data', async () => {
    // accounts.ts restoreData writes every ACCOUNT_ITEMS key (hangarItem included, complete: true, another `at`).
    expect(ACCOUNT_ITEMS.map((i) => i.key)).toContain(hangarItem.key);
    expect(ACCOUNT_ITEMS.map((i) => i.key)).not.toContain(hangarLoadItem.key);
    const signals: unknown[] = [];
    const off = hangarLoadItem.watch((v) => signals.push(v));
    await hangarItem.setValue({ at: 99, pledges: A, complete: true, handle: 'altguy' }); // what a restore writes
    await new Promise((r) => setTimeout(r, 0));
    off();
    expect(signals).toEqual([]);
  });
  it('refreshHangar records the handle the load read as and announces the completed load', async () => {
    await refreshHangar();
    const saved = await hangarItem.getValue();
    expect(saved).toMatchObject({ complete: true, handle: 'zedwil', pledges: B });
    expect(await hangarLoadItem.getValue()).toEqual({ at: saved!.at, handle: 'zedwil' });
  });
  it('afterLoad sends only with the integration and Auto-sync on', async () => {
    await starorgItem.setValue(AUTH);
    await saveCompleteLoad({ at: 5, pledges: B, complete: true, handle: 'zedwil' });
    expect(await afterLoad(catalog)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await patchSettings({ starorg: false, starorgAutoSync: true });
    expect(await afterLoad(catalog)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await patchSettings({ starorg: true });
    expect(await afterLoad(catalog)).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('weekly sync', () => {
  const read = vi.fn(async () => B);
  beforeEach(async () => {
    read.mockClear();
    await starorgItem.setValue(AUTH);
    await patchSettings({ pollAuto: true, starorgAutoSync: true });
    await hangarItem.setValue({ at: 1, pledges: A, complete: true, handle: 'zedwil' });
  });
  it('re-reads the hangar from RSI, saves it, and sends only when the rows changed', async () => {
    expect(await weeklySync(catalog, read)).toMatchObject({ ok: true, rows: 2 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(await hangarItem.getValue()).toMatchObject({ pledges: B, complete: true, handle: 'zedwil' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Same ships next week: read again, nothing sent.
    expect(await weeklySync(catalog, read)).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('never reads (or overwrites) another login’s saved hangar', async () => {
    who.handle = 'altguy';
    expect(await weeklySync(catalog, read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(await hangarItem.getValue()).toMatchObject({ pledges: A, handle: 'zedwil' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('drops a read during which the RSI login changed', async () => {
    const switching = vi.fn(async () => {
      who.handle = 'altguy';
      return B;
    });
    expect(await weeklySync(catalog, switching)).toBeNull();
    expect(switching).toHaveBeenCalledTimes(1);
    expect(await hangarItem.getValue()).toMatchObject({ pledges: A, handle: 'zedwil' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does nothing in passive mode, with Auto-sync off or when disconnected', async () => {
    await patchSettings({ pollAuto: false });
    expect(await weeklySync(catalog, read)).toBeNull();
    await patchSettings({ pollAuto: true, starorgAutoSync: false });
    expect(await weeklySync(catalog, read)).toBeNull();
    await patchSettings({ starorgAutoSync: true });
    await starorgItem.setValue(null);
    expect(await weeklySync(catalog, read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
