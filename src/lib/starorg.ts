/**
 * StarOrg Tools hangar sync (Settings → Integrations). Opt-in twice: the *StarOrg Tools* switch (`starorg`, off by
 * default) shows the card and the export preset, and nothing is sent until the user presses *Connect*:
 *
 * - **Site**: `starorgTarget` picks production (`starorg.tools`) or the dev site (`dev.starorg.tools`). The token
 *   records the origin it came from (`StarOrgAuth.origin`) and every request goes there, so a token never reaches the
 *   other site; the card fixes the choice while connected.
 * - **Connect** asks for the chosen site's optional host, then signs in through StarOrg's extension
 *   flow (`/api/auth/extension/login` → Discord → a one-time `?code=` on `identity.getRedirectURL()`), with a PKCE
 *   verifier the server checks at `/api/auth/extension/exchange`. The `aud=rsiplus` token (90 days) is kept under
 *   `acct('local:starorg')` (`starorgItem`), never in sync storage.
 * - **Send** builds the StarOrg Tools preset rows (`starOrgRows`: pledged hulls + in-game ships) and `PUT`s them to
 *   `/api/fleet/hangar/sync` with the logged-in RSI handle. Requests carry `Authorization: Bearer` and
 *   `credentials: 'omit'`, so a starorg.tools session cookie in the same browser never stands in for the token.
 *   Pledge values go only when *Send pledge values* is on (and, on Firefox, its financial data-collection category is
 *   granted); otherwise `pledge_cost` is sent empty. Only a hangar read as the handle logged in now is sent
 *   (`hangarItem.handle`), and at most `MAX_SYNC_ROWS` rows. Hulls StarOrg doesn't know come back in `not_found` and
 *   are shown on the card. *Preview* (`previewPayload`) runs the same checks and builds the same body locally, with no token and no StarOrg request;
 *   `STARORG_FIELDS` describes every field of it.
 * - **Disconnect** logs the token out server-side (its `jti` is denylisted, so a copied token dies too), forgets it
 *   and drops the host permission (plus Firefox's data-collection categories). Under `incognito: split` each context
 *   has its own token but the host permission is shared: it is dropped only when the other context holds no live
 *   token. A cancelled or refused Connect gives the permission back the same way.
 *
 * Every StarOrg request needs a stored token: with none, nothing is sent. A 401 (expired, signed out elsewhere)
 * forgets the token, so the card shows *Connect* again. Screenshare mode masks the page only; it changes nothing sent.
 */
import { whoAmI } from './accounts';
import { starOrgRows, type StarOrgRow } from './export';
import type { Pledge } from './hangar';
import type { GameShip } from './items';
import { gameShipsItem, getSettings, hangarItem, INCOGNITO, starorgItem, starorgSyncItem, type Settings } from './settings';
import type { CatalogShip } from './store';
import { storage } from '#imports';

/** The StarOrg Tools sites RSI+ can connect to (Settings → Integrations → Site). */
export const STARORG_TARGETS = {
  prod: { label: 'Production', origin: 'https://starorg.tools' },
  dev: { label: 'Dev (dev.starorg.tools)', origin: 'https://dev.starorg.tools' },
} as const satisfies Record<Settings['starorgTarget'], { label: string; origin: string }>;
export type StarOrgTarget = Settings['starorgTarget'];
export const originOf = (target: StarOrgTarget): string => (STARORG_TARGETS[target] ?? STARORG_TARGETS.prod).origin;
/** One site's optional host permission. */
export const hostsOf = (origin: string): string[] => [`${origin}/*`];
/** Every StarOrg optional host (`wxt.config.ts` declares the same patterns; `scripts/manifest-check.mjs` allows them). */
export const STARORG_HOSTS = Object.values(STARORG_TARGETS).map((t) => `${t.origin}/*`);
const KNOWN_ORIGINS = new Set<string>(Object.values(STARORG_TARGETS).map((t) => t.origin));
export const SYNC_FORMAT = 'hangarxplor/1';
export const MISMATCH = 'RSI_HANDLE_MISMATCH';
/** StarOrg's `MAX_SYNC_ROWS`: a bigger push is refused with a 422, so it is caught before sending. */
export const MAX_SYNC_ROWS = 500;
/** How many unknown hull names the card keeps. */
export const NOT_FOUND_CAP = 20;

export interface StarOrgUser {
  discord_id: string;
  username: string;
  rsi_handle: string | null;
  rsi_verified: boolean;
}
export interface StarOrgAuth {
  token: string;
  /** The StarOrg site that issued the token (`STARORG_TARGETS`): every request with it goes there. */
  origin: string;
  /** ms since epoch. */
  expiresAt: number;
  user: StarOrgUser;
}
export interface StarOrgSync {
  at: number;
  ok: boolean;
  /** One line for the card: "Sent 42 ships" or what went wrong. */
  message: string;
  rows?: number;
  /** `changeHash` of the rows last accepted by StarOrg — the weekly check sends only when it differs. */
  hash?: string;
  handle?: string;
  /** Hulls StarOrg Tools doesn't know (`not_found`, at most `NOT_FOUND_CAP`): shown on the card, never dropped silently. */
  notFound?: string[];
  /** How many hulls StarOrg didn't know in all (`not_found` length before the cap, or `kept_unmatched` when larger). */
  unmatched?: number;
  /** 409 `RSI_HANDLE_MISMATCH`: the RSI handles this StarOrg member has verified. */
  verifiedHandles?: string[];
  /** The send found no (valid) token: the card shows *Connect*. */
  disconnected?: boolean;
}
export interface SyncPayload {
  format: typeof SYNC_FORMAT;
  client: string;
  rsi_handle: string;
  exported_at: string;
  rows: StarOrgRow[];
}

/** `rsi-plus/<manifest version>`, or `rsi-plus/unknown` outside an extension (tests). */
export function clientId(): string {
  try {
    return `rsi-plus/${browser.runtime.getManifest().version}`;
  } catch {
    return 'rsi-plus/unknown';
  }
}

/** The `PUT /api/fleet/hangar/sync` body. Pure: `pledge_cost` is blanked on every row unless `sendCost`. */
export function buildPayload(
  pledges: Pledge[],
  gameShips: GameShip[],
  catalog: CatalogShip[],
  opts: { sendCost: boolean; rsiHandle: string; client?: string; now?: Date },
): SyncPayload {
  const rows = starOrgRows(pledges, gameShips, catalog).map((r) => (opts.sendCost ? r : { ...r, pledge_cost: '' }));
  return {
    format: SYNC_FORMAT,
    client: opts.client ?? clientId(),
    rsi_handle: opts.rsiHandle,
    exported_at: (opts.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    rows,
  };
}

/**
 * Every field of the `PUT /api/fleet/hangar/sync` body in plain words, for the card's *What is sent* list (PRIVACY.md
 * says the same). `satisfies Record<…>` makes a field added to or dropped from `SyncPayload` / `StarOrgRow` a type error
 * until it is described here; `tests/starorg.test.ts` checks the keys against a real `buildPayload`.
 */
export const STARORG_FIELDS = {
  top: {
    format: 'The file format, always "hangarxplor/1"',
    client: '"rsi-plus/" and the RSI+ version',
    rsi_handle: 'Your RSI handle: the one logged in on RSI, which the saved hangar was read as',
    exported_at: 'When the list was built (UTC date and time)',
    rows: 'One row per ship, as below',
  } satisfies Record<keyof SyncPayload, string>,
  row: {
    ship_code: 'A code for the ship model, e.g. "AEGS_Avenger_Titan"',
    ship_name: 'The name you gave that ship in your hangar, else the ship model',
    name: 'The ship model, e.g. "Avenger Titan"',
    manufacturer_code: 'The maker’s short code, e.g. "AEGS" (empty if unknown)',
    manufacturer_name: 'The maker, e.g. "Aegis Dynamics" (empty if unknown)',
    lti: 'Whether the pledge has lifetime insurance (false for in-game ships)',
    warbond: 'Whether the pledge was a warbond (false for in-game ships)',
    entity_type: 'Always "ship"',
    pledge_id: 'The RSI pledge number the ship is in (empty for in-game ships)',
    pledge_name: 'The pledge’s title, or "In-game (bought)" / "In-game (earned)"',
    pledge_cost: 'The pledge’s value, e.g. "$45.00 USD" ("$0.00 USD" for in-game ships); empty unless Send pledge values is on',
    insurance: 'The insurance term the pledge lists, e.g. "LTI" or "120 mo"; left out when it lists none, and for in-game ships',
    acquired: '"pledge" for a hangar ship, "game" for one you added on My ships (bought or earned in the game)',
  } satisfies Record<keyof StarOrgRow, string>,
} as const;

/** cyrb53: a fast, stable 53-bit string hash (not cryptographic — it only detects change). */
function cyrb53(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Hash of the row set as StarOrg would store it: pledge id, hull, ship name, flags, insurance, source and the (possibly
 * blanked) value of every row, order-insensitive. Same rows → same hash, whatever order the hangar lists them in.
 */
export function changeHash(rows: StarOrgRow[]): string {
  const lines = rows.map((r) => [r.pledge_id, r.ship_code, r.name, r.ship_name, r.lti ? 1 : 0, r.warbond ? 1 : 0, r.insurance ?? '', r.acquired ?? '', r.pledge_cost].join('\u001f'));
  return cyrb53(lines.sort().join('\u001e'));
}

// ---------------------------------------------------------------------------------------------------------------
// Sign-in

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** RFC 7636 S256: base64url(sha256(verifier)), no padding. */
export async function s256(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** A fresh PKCE pair: a 43-character verifier (32 random bytes) and its S256 challenge. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: await s256(verifier) };
}

/** A token that can still be used: unexpired, and issued by one of the known sites. */
export const usableAuth = (auth: StarOrgAuth | null | undefined, now = Date.now()): auth is StarOrgAuth =>
  !!auth && auth.expiresAt > now && KNOWN_ORIGINS.has(auth.origin);

/** The stored token, or null when there is none, it has expired, or its site is unknown (those are forgotten). */
export async function currentAuth(now = Date.now()): Promise<StarOrgAuth | null> {
  const auth = await starorgItem.getValue();
  if (!auth) return null;
  if (!usableAuth(auth, now)) {
    await starorgItem.setValue(null);
    return null;
  }
  return auth;
}

/** FastAPI's `detail` as one line (a string, `{message}`, or a validation list). */
async function detailOf(res: Response): Promise<{ text: string; body: unknown }> {
  const body: unknown = await res.json().catch(() => null);
  const d = (body as { detail?: unknown } | null)?.detail;
  const text =
    typeof d === 'string'
      ? d
      : Array.isArray(d)
        ? validationLine(d) ?? `HTTP ${res.status}`
        : d && typeof d === 'object' && 'message' in d && typeof (d as { message: unknown }).message === 'string'
          ? (d as { message: string }).message
          : `HTTP ${res.status}`;
  return { text, body: d };
}

/** A FastAPI 422 list as one line: the first error's `msg` and where (`loc` minus `body`), plus how many more. */
function validationLine(list: unknown[]): string | null {
  const first = list[0] as { msg?: unknown; loc?: unknown } | undefined;
  if (!first || typeof first.msg !== 'string') return null;
  const loc = Array.isArray(first.loc) ? first.loc.filter((p) => p !== 'body').join('.') : '';
  const more = list.length > 1 ? ` (+${list.length - 1} more)` : '';
  return `${first.msg}${loc ? ` at ${loc}` : ''}${more}`;
}

/** Firefox 140+ data-collection categories asked for at Connect (wxt.config.ts `data_collection_permissions.optional`). */
export const DATA_COLLECTION = ['personallyIdentifyingInfo', 'websiteContent'];
/** Asked for by the *Send pledge values* switch on Firefox: pledge values are financial information. */
export const FINANCIAL = 'financialAndPaymentInfo';
/** Builds define `import.meta.env.FIREFOX` as a boolean; Vitest exposes it as the string `'false'` / `'true'`. */
const isFirefox = () => String(import.meta.env.FIREFOX) === 'true';

/**
 * Ask for the host permission (and, on Firefox, the optional data-collection categories). Must run first inside the
 * click handler: browsers grant it only during a user gesture, which an earlier `await` would end.
 */
function requestAccess(origin: string): Promise<boolean> {
  const origins = hostsOf(origin);
  if (isFirefox()) {
    try {
      // Firefox 140+: the categories declared under data_collection_permissions.optional (wxt.config.ts). Older
      // Firefox rejects the unknown key synchronously, so fall back to the host alone, still inside the gesture.
      return browser.permissions.request({ origins, data_collection: DATA_COLLECTION } as never);
    } catch {
      /* fall through */
    }
  }
  return browser.permissions.request({ origins });
}

/**
 * *Send pledge values* turned on (Firefox): ask for the financial data-collection category, inside the switch's
 * gesture. true elsewhere and on a Firefox without data-collection permissions (nothing to ask for).
 */
export function requestCostAccess(): Promise<boolean> {
  if (!isFirefox()) return Promise.resolve(true);
  try {
    return browser.permissions.request({ data_collection: [FINANCIAL] } as never).catch(() => false);
  } catch {
    return Promise.resolve(true); // pre-140 Firefox: no categories exist
  }
}

/** Whether pledge values may go out: the setting, and on Firefox the granted financial category. */
async function costAllowed(setting: boolean): Promise<boolean> {
  if (!setting || !isFirefox()) return setting;
  try {
    return await browser.permissions.contains({ data_collection: [FINANCIAL] } as never);
  } catch {
    return true; // pre-140 Firefox: no categories exist
  }
}

/**
 * The other context's token key. Under Chromium `incognito: split` the two contexts keep separate tokens (`acct()`),
 * but host permissions are extension-wide, so one context must not drop the host while the other still uses it.
 */
const OTHER_CONTEXT_KEY = INCOGNITO ? 'local:starorg' : 'local:incognito.starorg';
async function otherContextConnected(now = Date.now()): Promise<boolean> {
  const other = await storage.getItem<StarOrgAuth>(OTHER_CONTEXT_KEY).catch(() => null);
  return !!other && typeof other.expiresAt === 'number' && other.expiresAt > now;
}

/**
 * Drop the StarOrg host (and, on Firefox, every data-collection category RSI+ asks for) — unless the other context
 * (normal / incognito) still holds a live token, which keeps the shared host permission until it disconnects too.
 */
async function releaseAccess(force = false): Promise<void> {
  if (!force && (await otherContextConnected())) return;
  if (isFirefox()) {
    try {
      await browser.permissions.remove({ origins: STARORG_HOSTS, data_collection: [...DATA_COLLECTION, FINANCIAL] } as never);
      return;
    } catch {
      /* pre-140 Firefox: the host alone */
    }
  }
  await browser.permissions.remove({ origins: STARORG_HOSTS }).catch(() => false);
}

/** The redirect's `?code=`, or an error naming what StarOrg / the browser returned instead. */
function codeOf(back: string | undefined): string {
  let url: URL | null = null;
  try {
    url = back ? new URL(back) : null;
  } catch {
    /* not a URL */
  }
  const err = url?.searchParams.get('error_description') || url?.searchParams.get('error');
  if (err) throw new Error(`StarOrg Tools sign-in failed: ${err}.`);
  const code = url?.searchParams.get('code');
  if (!code) throw new Error('StarOrg Tools sign-in returned no code.');
  return code;
}

/** Connect to one StarOrg site: host permission → StarOrg / Discord sign-in in a browser popup → token. Call from a click handler. */
export async function connect(target: StarOrgTarget): Promise<StarOrgAuth> {
  const origin = originOf(target);
  if (!(await requestAccess(origin))) throw new Error('RSI+ needs permission to reach StarOrg Tools to connect.');
  try {
    const { verifier, challenge } = await pkcePair();
    const params = new URLSearchParams({ code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: browser.identity.getRedirectURL() });
    let back: string | undefined;
    try {
      back = await browser.identity.launchWebAuthFlow({ url: `${origin}/api/auth/extension/login?${params}`, interactive: true });
    } catch (e) {
      throw new Error(`StarOrg Tools sign-in did not finish (${(e as Error).message}).`);
    }
    const code = codeOf(back);
    const res = await fetch(`${origin}/api/auth/extension/exchange`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier }),
    });
    if (!res.ok) throw new Error(`StarOrg Tools refused the sign-in: ${(await detailOf(res)).text}`);
    const j = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; user?: unknown } | null;
    const user = j?.user as StarOrgUser | undefined;
    if (!j || typeof j.access_token !== 'string' || !j.access_token || typeof j.expires_in !== 'number' || !Number.isFinite(j.expires_in) || j.expires_in <= 0 || !user || typeof user !== 'object')
      throw new Error('StarOrg Tools sent an unexpected sign-in answer.');
    const auth: StarOrgAuth = { token: j.access_token, origin, expiresAt: Date.now() + j.expires_in * 1000, user };
    // The integration was switched off while the sign-in window was open: don't keep a token for it.
    if (!(await getSettings()).starorg) {
      await fetch(`${origin}/api/auth/logout`, { method: 'POST', credentials: 'omit', headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => undefined);
      throw new Error('StarOrg Tools was switched off; not connected.');
    }
    await starorgItem.setValue(auth);
    await starorgSyncItem.setValue(null);
    return auth;
  } catch (e) {
    // No token stored: give the permission back, so a cancelled or refused sign-in leaves RSI+ as before Connect.
    if (!(await starorgItem.getValue().catch(() => null))) await releaseAccess().catch(() => undefined);
    throw e;
  }
}

/**
 * Disconnect: sign this context's token out on StarOrg (best effort), forget it, drop the host permission (unless the
 * other incognito / normal context is still connected — `releaseAccess`).
 */
export async function disconnect(): Promise<void> {
  const auth = await starorgItem.getValue();
  if (auth)
    await fetch(`${auth.origin}/api/auth/logout`, { method: 'POST', credentials: 'omit', headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => undefined);
  await starorgItem.setValue(null);
  await starorgSyncItem.setValue(null);
  await releaseAccess();
}

/**
 * The *StarOrg Tools* switch turned off (background, on the synced setting, so every device and both contexts get
 * it): sign out and forget this context's and the other context's token, and drop the hosts unconditionally.
 */
export async function disconnectAll(): Promise<void> {
  const other = await storage.getItem<StarOrgAuth>(OTHER_CONTEXT_KEY).catch(() => null);
  if (other?.token && KNOWN_ORIGINS.has(other.origin))
    await fetch(`${other.origin}/api/auth/logout`, { method: 'POST', credentials: 'omit', headers: { Authorization: `Bearer ${other.token}` } }).catch(() => undefined);
  await storage.removeItem(OTHER_CONTEXT_KEY).catch(() => undefined);
  await storage.removeItem(OTHER_CONTEXT_KEY.replace('starorg', 'starorgSync') as typeof OTHER_CONTEXT_KEY).catch(() => undefined);
  const auth = await starorgItem.getValue();
  if (auth)
    await fetch(`${auth.origin}/api/auth/logout`, { method: 'POST', credentials: 'omit', headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => undefined);
  await starorgItem.setValue(null);
  await starorgSyncItem.setValue(null);
  await releaseAccess(true);
}

// ---------------------------------------------------------------------------------------------------------------
// Send

/** "StarOrg knows you as a or b; …" — the 409 line, naming the verified handles. */
export const mismatchMessage = (handles: string[]) =>
  `StarOrg knows you as ${handles.length ? handles.join(' or ') : 'another RSI account'}; switch accounts in RSI+ or verify this one on StarOrg Tools.`;

const DISCONNECTED: Omit<StarOrgSync, 'at'> = { ok: false, disconnected: true, message: 'Not connected to StarOrg Tools — connect again.' };

/**
 * `PUT` one payload. No token → nothing is sent. Records and returns the result: 401 forgets the token (disconnected),
 * 409 `RSI_HANDLE_MISMATCH` names the verified handles. The hash is kept from the last accepted send on failure.
 */
export async function push(payload: SyncPayload): Promise<StarOrgSync> {
  const prev = await starorgSyncItem.getValue();
  const record = async (r: Omit<StarOrgSync, 'at'>) => {
    const out: StarOrgSync = { at: Date.now(), ...r, hash: r.ok ? r.hash : prev?.hash, handle: payload.rsi_handle };
    await starorgSyncItem.setValue(out);
    return out;
  };
  const auth = await currentAuth();
  if (!auth) return record(DISCONNECTED);
  let res: Response;
  try {
    res = await fetch(`${auth.origin}/api/fleet/hangar/sync`, {
      method: 'PUT',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return record({ ok: false, message: `Could not reach StarOrg Tools (${(e as Error).message}).` });
  }
  if (res.status === 401) {
    await starorgItem.setValue(null);
    return record({ ...DISCONNECTED, message: 'StarOrg Tools signed RSI+ out — connect again.' });
  }
  if (!res.ok) {
    const { text, body } = await detailOf(res);
    const d = body as { code?: unknown; verified_handles?: unknown } | null;
    if (res.status === 409 && d && typeof d === 'object' && d.code === MISMATCH) {
      const handles = Array.isArray(d.verified_handles) ? d.verified_handles.filter((h): h is string => typeof h === 'string') : [];
      return record({ ok: false, message: mismatchMessage(handles), verifiedHandles: handles });
    }
    return record({ ok: false, message: `StarOrg Tools refused the hangar: ${text}` });
  }
  const j = ((await res.json().catch(() => null)) ?? {}) as { imported_count?: number; updated?: number; removed?: number; kept_unmatched?: unknown; not_found?: unknown };
  const n = payload.rows.length;
  const allNotFound = Array.isArray(j.not_found) ? j.not_found.filter((h): h is string => typeof h === 'string') : [];
  const kept = typeof j.kept_unmatched === 'number' && Number.isFinite(j.kept_unmatched) ? j.kept_unmatched : 0;
  const unmatched = Math.max(allNotFound.length, kept);
  const parts = [j.imported_count ? `${j.imported_count} new` : '', j.updated ? `${j.updated} updated` : '', j.removed ? `${j.removed} removed` : ''].filter(Boolean);
  const unknown = unmatched ? ` ${unmatched} hull${unmatched === 1 ? '' : 's'} StarOrg Tools doesn't know yet.` : '';
  return record({
    ok: true,
    rows: n,
    hash: changeHash(payload.rows),
    message: `Sent ${n} ship${n === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}.${unknown}`,
    ...(unmatched ? { notFound: allNotFound.slice(0, NOT_FOUND_CAP), unmatched } : {}),
  });
}

let sending: Promise<StarOrgSync | null> | null = null;

/**
 * Send the saved hangar (+ in-game ships) as the logged-in RSI handle. `onlyIfChanged`: skip (null) when the rows
 * hash to what StarOrg last accepted. Not connected → null without touching the hangar or the network. One send at a
 * time per context; a second call while one runs gets the same result.
 */
export function sendHangar(catalog: () => Promise<CatalogShip[]>, opts: { onlyIfChanged?: boolean } = {}): Promise<StarOrgSync | null> {
  sending ??= doSend(catalog, opts).finally(() => (sending = null));
  return sending;
}

async function doSend(catalog: () => Promise<CatalogShip[]>, { onlyIfChanged = false }: { onlyIfChanged?: boolean }): Promise<StarOrgSync | null> {
  // The integration switch is synced; another device turning it off stops this one sending too.
  if (!(await getSettings()).starorg || !(await currentAuth())) return null;
  const fail = async (message: string) => {
    const prev = await starorgSyncItem.getValue();
    const out: StarOrgSync = { at: Date.now(), ok: false, message, hash: prev?.hash };
    await starorgSyncItem.setValue(out);
    return out;
  };
  const r = await readyPayload(catalog);
  if ('error' in r) return fail(r.error);
  const { payload } = r;
  if (onlyIfChanged) {
    const prev = await starorgSyncItem.getValue();
    if (prev?.ok && prev.hash === changeHash(payload.rows) && prev.handle === payload.rsi_handle) return null;
  }
  return push(payload);
}

/**
 * Every pre-send check and the payload, shared by a send (`doSend`) and *Preview* (`previewPayload`) so the two can't
 * drift: a complete saved hangar, an RSI login (`whoAmI()`, a request to RSI), the saved hangar read as that same
 * handle (never account A's ships under account B's handle), and at most `MAX_SYNC_ROWS` rows. Needs no token.
 */
async function readyPayload(catalog: () => Promise<CatalogShip[]>): Promise<{ payload: SyncPayload } | { error: string }> {
  const hangar = await hangarItem.getValue();
  if (!hangar?.complete) return { error: 'Load your whole hangar first (Hangar → Pledges).' };
  const me = await whoAmI();
  if (!me) return { error: 'Not logged in on robertsspaceindustries.com — log in there, then send again.' };
  if (hangar.handle !== me.handle) return { error: `Saved hangar belongs to ${hangar.handle || 'another RSI login'}; load your hangar again (Hangar → Pledges).` };
  const [{ starorgSendCost }, game, ships] = await Promise.all([getSettings(), gameShipsItem.getValue(), catalog()]);
  const payload = buildPayload(hangar.pledges, game, ships, { sendCost: await costAllowed(starorgSendCost), rsiHandle: me.handle });
  if (payload.rows.length > MAX_SYNC_ROWS)
    return { error: `Your hangar has ${payload.rows.length} ships; StarOrg Tools takes at most ${MAX_SYNC_ROWS} per send. Nothing was sent.` };
  return { payload };
}

/**
 * The payload a send would carry now, for the card's *Preview*: the same checks and body as a send (`readyPayload`),
 * so Preview refuses exactly what Send refuses, with the same message. Needs no token and makes no StarOrg request
 * (it asks RSI who is logged in, as a send does).
 */
export const previewPayload = (catalog: () => Promise<CatalogShip[]>): Promise<{ payload: SyncPayload } | { error: string }> => readyPayload(catalog);

/** `GET /api/fleet/hangar/sync`: when StarOrg last received each of your RSI handles. null = not connected / failed. */
export async function status(): Promise<{ rsi_handle: string; last_sync_at: string | null; client: string | null; rows: number }[] | null> {
  const auth = await currentAuth();
  if (!auth) return null;
  try {
    const res = await fetch(`${auth.origin}/api/fleet/hangar/sync`, { credentials: 'omit', headers: { Authorization: `Bearer ${auth.token}` } });
    if (res.status === 401) {
      await starorgItem.setValue(null);
      return null;
    }
    if (!res.ok) return null;
    return ((await res.json()) as { syncs?: [] }).syncs ?? [];
  } catch {
    return null;
  }
}
