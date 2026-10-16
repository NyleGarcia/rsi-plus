/**
 * Account switcher: park one RSI login's cookies (and RSI+'s data for that account) under a name, and swap them in
 * later without typing a password. RSI's session is a handful of cookies on robertsspaceindustries.com —
 * `Rsi-Token` (session), `Rsi-Account-Auth` (remember-me), `_rsi_device` (device trust, so no new 2FA), `Rsi-XSRF`.
 * The `cookies` permission reads and writes them, httpOnly included.
 *
 * Switching never calls RSI's logout (that voids the token server-side); it just replaces the jar. Profiles live in
 * `storage.local` as plain text — same exposure as the browser's own cookie file, never synced.
 *
 * Account data (feed, reads, friends, hangar, …) is keyed for one account, so a switch parks the current account's
 * values under its profile (`local:profileData.<id>`) and restores the target's. Keys stay static (no refactor).
 */
import { identify } from './api';
import { ACCOUNT_ITEMS, profileDataKey, profilesItem } from './settings';
import { SPECTRUM_ORIGIN } from './types';
import { storage } from '#imports';
import type { Browser } from 'wxt/browser';

export interface SavedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  hostOnly: boolean;
  sameSite: 'no_restriction' | 'lax' | 'strict' | 'unspecified';
  /** Seconds since epoch; missing = session cookie. */
  expirationDate?: number;
  /** CHIPS-partitioned cookie (browsers that partition even first-party cookies, e.g. Edge's tracking prevention). */
  partitionKey?: { topLevelSite?: string };
}

export interface Profile {
  id: string;
  /** RSI handle (unique, lower-case). */
  handle: string;
  displayname: string;
  avatar: string | null;
  savedAt: number;
  cookies: SavedCookie[];
  /** Last switch found another (or no) login behind these cookies — log in and save again. */
  stale?: boolean;
}

export interface Profiles {
  /** Profile id the current jar + data belong to; null = unknown (fresh install, or logged in manually since). */
  active: string | null;
  list: Profile[];
}

const DOMAIN = 'robertsspaceindustries.com';
const cookies = () => browser.cookies;

type RawCookie = Browser.cookies.Cookie;

export const toSaved = (c: RawCookie): SavedCookie => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path,
  secure: c.secure,
  httpOnly: c.httpOnly,
  hostOnly: c.hostOnly,
  sameSite: (c.sameSite as SavedCookie['sameSite']) ?? 'unspecified',
  ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
  ...(partitionOf(c) ? { partitionKey: partitionOf(c) } : {}),
});
const partitionOf = (c: RawCookie) => (c as { partitionKey?: { topLevelSite?: string } }).partitionKey;

/** `cookies.set` details for a saved cookie: host-only cookies must omit `domain`; session cookies omit expiry. */
export function toSet(c: SavedCookie): Parameters<ReturnType<typeof cookies>['set']>[0] {
  return {
    url: `https://${c.domain.replace(/^\./, '')}${c.path}`,
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    ...(c.hostOnly ? {} : { domain: c.domain }),
    ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
    ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}),
  } as Parameters<ReturnType<typeof cookies>['set']>[0];
}

/**
 * Current jar for RSI (this context's cookie store: regular or incognito). Asked three ways and merged — by domain,
 * by URL, and by URL within RSI's own partition — because a browser that partitions cookies (Edge with tracking
 * prevention, CHIPS) leaves them out of a plain `getAll` while `get` by URL still finds them.
 */
async function readJar(): Promise<RawCookie[]> {
  const api = cookies();
  const lists = await Promise.all([
    api.getAll({ domain: DOMAIN }).catch(() => [] as RawCookie[]),
    api.getAll({ url: SPECTRUM_ORIGIN }).catch(() => [] as RawCookie[]),
    api.getAll({ url: SPECTRUM_ORIGIN, partitionKey: { topLevelSite: SPECTRUM_ORIGIN } } as Parameters<typeof api.getAll>[0]).catch(() => [] as RawCookie[]),
  ]);
  const seen = new Map<string, RawCookie>();
  for (const c of lists.flat()) seen.set(`${c.storeId}|${c.domain}|${c.path}|${c.name}`, c);
  if (![...seen.values()].some((c) => c.name === 'Rsi-Token')) {
    const one = await api.get({ url: SPECTRUM_ORIGIN, name: 'Rsi-Token' }).catch(() => null);
    if (one) seen.set(`${one.storeId}|${one.domain}|${one.path}|${one.name}`, one);
  }
  return [...seen.values()];
}

async function clearJar() {
  for (const c of await readJar()) {
    await cookies().remove({ url: `https://${c.domain.replace(/^\./, '')}${c.path}`, name: c.name, storeId: c.storeId });
  }
}

async function writeJar(list: SavedCookie[]) {
  for (const c of list) await cookies().set(toSet(c));
}

/** Who the current cookies log in as, or null when logged out / expired. */
export async function whoAmI(): Promise<{ handle: string; displayname: string; avatar: string | null } | null> {
  try {
    const id = await identify();
    const m = id.member;
    return m ? { handle: m.nickname.toLowerCase(), displayname: m.displayname, avatar: m.avatar } : null;
  } catch {
    return null;
  }
}

const now = () => Date.now();

/**
 * Save the current login as a profile (replacing one with the same handle) and mark it active.
 * Throws when not logged in or when the jar has no session token.
 */
export async function captureProfile(): Promise<Profile> {
  const me = await whoAmI();
  if (!me) throw new Error('Not logged in on robertsspaceindustries.com — log in there first, then save.');
  const jar = (await readJar()).map(toSaved);
  if (!jar.some((c) => c.name === 'Rsi-Token'))
    throw new Error(`No Rsi-Token cookie found — open robertsspaceindustries.com once, then save. (cookies seen: ${jar.map((c) => c.name).join(', ') || 'none'})`);
  const ps = await profilesItem.getValue();
  const prev = ps.list.find((p) => p.handle === me.handle);
  const profile: Profile = { id: prev?.id ?? `${me.handle}-${now().toString(36)}`, ...me, savedAt: now(), cookies: jar };
  const list = prev ? ps.list.map((p) => (p.id === prev.id ? profile : p)) : [...ps.list, profile];
  // Logged in by hand as someone else while profile X was active: the data in storage is still X's. Park it under
  // X and start this account clean (or restore what it had parked earlier), otherwise X's reads/hangar become ours.
  const active = ps.list.find((p) => p.id === ps.active);
  if (active && active.handle !== me.handle) {
    await parkData(active.id);
    await restoreData(profile.id);
  }
  await profilesItem.setValue({ active: profile.id, list });
  return profile;
}

type Snapshot = Record<string, unknown>;

/** Park every account item under the profile's data key. */
async function parkData(id: string) {
  const snap: Snapshot = {};
  for (const item of ACCOUNT_ITEMS) snap[item.key] = await storage.getItem(item.key);
  await storage.setItem(profileDataKey(id), snap);
}

/** Restore a profile's parked data; items it never had go back to their fallback (removed). */
async function restoreData(id: string) {
  const snap = (await storage.getItem<Snapshot>(profileDataKey(id))) ?? {};
  for (const item of ACCOUNT_ITEMS) {
    const v = snap[item.key];
    if (v == null) await storage.removeItem(item.key);
    else await storage.setItem(item.key, v);
  }
}

export interface SwitchResult {
  profile: Profile;
  /** Handle RSI reports after the swap; null = the saved cookies no longer log in (profile marked stale). */
  loggedInAs: string | null;
}

/**
 * Swap to a saved profile: park the current account's data (under the active profile — or, when none is active but
 * someone is logged in, under a profile captured on the spot so nothing is lost), replace the cookie jar, restore
 * the target's data, then ask RSI who we are. Reloads every RSI tab; the caller reloads its own page.
 */
export async function switchTo(id: string): Promise<SwitchResult> {
  let ps = await profilesItem.getValue();
  const target = ps.list.find((p) => p.id === id);
  if (!target) throw new Error('Profile not found');
  if (!ps.active) {
    // Unknown current login: keep its cookies + data by saving it first (if it is logged in at all).
    const me = await whoAmI();
    if (me && me.handle !== target.handle) {
      await captureProfile();
      ps = await profilesItem.getValue();
    }
  }
  if (ps.active && ps.active !== id) await parkData(ps.active);
  await clearJar();
  await writeJar(target.cookies);
  if (ps.active !== id) await restoreData(id);
  const me = await whoAmI();
  const ok = me?.handle === target.handle;
  const list = ps.list.map((p) => (p.id === id ? { ...p, stale: !ok } : p));
  await profilesItem.setValue({ active: id, list });
  await reloadRsiTabs();
  return { profile: { ...target, stale: !ok }, loggedInAs: me?.handle ?? null };
}

export async function forgetProfile(id: string) {
  const ps = await profilesItem.getValue();
  await storage.removeItem(profileDataKey(id));
  await profilesItem.setValue({ active: ps.active === id ? null : ps.active, list: ps.list.filter((p) => p.id !== id) });
}

/** Wipe RSI cookies only (log out locally, server session untouched). Account data stays parked / in place. */
export async function logoutLocal() {
  await clearJar();
  const ps = await profilesItem.getValue();
  await profilesItem.setValue({ ...ps, active: null });
  await reloadRsiTabs();
}

async function reloadRsiTabs() {
  const tabs = await browser.tabs.query({ url: `${SPECTRUM_ORIGIN}/*` }).catch(() => []);
  for (const t of tabs) if (t.id != null) browser.tabs.reload(t.id).catch(() => {});
}
