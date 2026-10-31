import { browser, storage } from '#imports';

/**
 * Settings → Debug: one JSON file with everything RSI+ keeps in this browser (local + sync storage), for bug reports.
 * Pledges carry RSI's raw hidden fields (`Pledge.raw`), so a wrong number can be traced to the text it was read from.
 * Secrets (integration tokens, cookies, keys) are always replaced; handles / nicknames / notes are masked unless
 * `names` is on. Nothing is sent anywhere — the file is saved and the user shares it themselves.
 */

/** Keys whose value is never written out (`auth` but not `author`). */
const SECRET = /token|secret|password|passwd|cookie|auth(?!or)|session|api[-_]?key|bearer|csrf|jwt|credential/i;
/** Keys holding who someone is (handles, ship names you gave, notes, muted authors, avatars): masked unless the user opts in. */
const PERSONAL = /handle|nick|email|moniker|display_?name|custom_?name|reserved_?names|note|author|avatar/i;
/**
 * Maps keyed by a person (org cache: handle → orgs; presence / friend notes: member id → …). Without names their keys
 * become `#1`, `#2` … — the same person gets the same alias in every map, so presence and notes still line up.
 */
const KEYED = /^(incognito\.)?(orgs|presence|friendNotes)$/;
/** Saved logins: `active` and each `id` are the handle plus a suffix. */
const PROFILES = /^(incognito\.)?profiles$/;
/** Parked account data per saved login (`profileData.<id>`): the key carries the handle. */
const PROFILE_DATA = /^((?:incognito\.)?profileData\.).+$/;
/** Public store data (catalog, paints, listings, store log): most of the file and nothing of yours — summarized unless asked for. */
const STORE = /^(incognito\.)?(catalog|paints|storeItems|storeSnapshot|storeLog|saleHistory|funding)$/;
/** A JWT-looking value is a token whatever its key. */
const JWT = /^eyJ[\w-]+\.[\w-]+\./;

interface Ctx {
  names: boolean;
  alias: Map<string, string>;
}
const aliasOf = (ctx: Ctx, k: string) => {
  let a = ctx.alias.get(k);
  if (!a) ctx.alias.set(k, (a = `#${ctx.alias.size + 1}`));
  return a;
};

function walk(v: unknown, ctx: Ctx, key: string, inProfiles: boolean, top = false): unknown {
  if (key && SECRET.test(key)) return v == null || v === '' ? v : '[redacted]';
  const personal = !ctx.names && !!key && (PERSONAL.test(key) || (inProfiles && /^(active|id)$/.test(key)));
  if (typeof v === 'string') return JWT.test(v) ? '[redacted]' : personal ? '[masked]' : v;
  if (Array.isArray(v)) return personal ? v.map(() => '[masked]') : v.map((x) => walk(x, ctx, key, inProfiles));
  if (v && typeof v === 'object') {
    // Storage items only: a friend's own `orgs` list inside the org cache is not keyed by people.
    const keyed = top && !ctx.names && KEYED.test(key);
    const profiles = inProfiles || PROFILES.test(key);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [keyed ? aliasOf(ctx, k) : k, walk(x, ctx, k, profiles)]));
  }
  return personal && v != null ? '[masked]' : v;
}

/** Secrets always out; with `names` off, people (handles, nicknames, notes, ids-by-handle) masked. `store` off: public store data summarized. */
export function redact(v: unknown, names = false, store = false): unknown {
  const ctx: Ctx = { names, alias: new Map() };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return walk(v, ctx, '', false);
  return Object.fromEntries(
    Object.entries(v).map(([k, x]) => {
      if (!store && STORE.test(k)) return [k, summarize(x)];
      const pd = PROFILE_DATA.exec(k);
      return [pd && !names ? `${pd[1]}${aliasOf(ctx, k)}` : k, walk(x, ctx, k, false, true)];
    }),
  );
}

/** `{ omitted, at, count }` in place of a public store blob. */
function summarize(x: unknown): unknown {
  if (!x || typeof x !== 'object') return x;
  const o = x as Record<string, unknown>;
  const list = Array.isArray(x) ? x : Object.values(o).find(Array.isArray);
  return { omitted: 'public store data (Include store data to keep it)', ...(typeof o.at === 'number' ? { at: o.at } : {}), count: Array.isArray(list) ? list.length : Object.keys(o).length };
}

export interface DebugFile {
  rsiplus: string;
  exportedAt: string;
  browser: string;
  locale: string;
  names: boolean;
  local: unknown;
  sync: unknown;
}

export async function buildDebugFile(names = false, store = false): Promise<DebugFile> {
  const [local, sync] = await Promise.all([storage.snapshot('local'), storage.snapshot('sync').catch(() => ({}))]);
  return {
    rsiplus: browser.runtime.getManifest().version_name ?? browser.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    locale: `${navigator.language} · ${Intl.NumberFormat().resolvedOptions().locale} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    names,
    local: redact(local, names, store),
    sync: redact(sync, names, store),
  };
}

/** Saves the file (`rsi-plus-debug-YYYY-MM-DD.json`); returns its size in bytes. */
export async function downloadDebugFile(names = false, store = false): Promise<number> {
  const blob = new Blob([JSON.stringify(await buildDebugFile(names, store), null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `rsi-plus-debug-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return blob.size;
}
