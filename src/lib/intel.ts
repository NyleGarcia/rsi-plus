/**
 * Org lookup / threat intel: look up a player or an org on RSI's public pages, tag players and orgs (hostile, caution,
 * neutral, friendly, ally) with a note, and see those tags where people show up (Spectrum replies, Friends).
 *
 * Everything here is public RSI data or your own tags, kept in this browser. Lookups are cached (`IntelCache`) so a
 * repeat lookup or a flag on Spectrum costs no request; *Refresh* re-reads. Tags can be exported / imported as a file
 * to share with your org — nothing is sent anywhere by RSI+.
 *
 * RSI markup (checked 2026-11, parsed with regexes so it also runs in the service worker, which has no DOMParser):
 * - `/citizens/<handle>`: `.profile .info` (moniker, "Handle name", title badge), `p.citizen-record .value`,
 *   "Enlisted", "Location", "Fluency" label/value pairs, `.main-org` (SID, name, rank, `visibility-[VRH]`).
 * - `/orgs/<SID>`: `h1` "Name / <span class=symbol>SID</span>", `.logo .count` "N members", `ul.tags li.model |
 *   .commitment | .roleplay | .exclusive | .recruiting`, `ul.focus li.primary|secondary img[alt]`.
 * - `POST /api/orgs/getOrgMembers {symbol, search, pagesize, page}` → `{data: {totalrows, html}}`; each
 *   `li.member-item.org-visibility-[VRH]`: `.name`, `.nick`, `.rank`, `.stars` width %.
 */
import { decodeEntities } from './orgs';
import type { Org } from './orgs';

export const RSI = 'https://robertsspaceindustries.com';

/* ---------------------------------------------------------------- tags ---------------------------------------------------------------- */

export type IntelTag = 'hostile' | 'caution' | 'neutral' | 'friendly' | 'ally';
export const INTEL_TAGS: { id: IntelTag; label: string; rank: number }[] = [
  { id: 'hostile', label: 'Hostile', rank: 4 },
  { id: 'caution', label: 'Caution', rank: 3 },
  { id: 'neutral', label: 'Neutral', rank: 1 },
  { id: 'friendly', label: 'Friendly', rank: 0 },
  { id: 'ally', label: 'Ally', rank: 0 },
];
const RANK = new Map(INTEL_TAGS.map((t) => [t.id, t.rank]));
export const tagLabel = (t: IntelTag) => INTEL_TAGS.find((x) => x.id === t)?.label ?? t;

export interface IntelEntry {
  kind: 'player' | 'org';
  /** Handle (as written) or org SID (upper case). */
  id: string;
  /** Moniker / org name, for lists. */
  name?: string;
  tag: IntelTag;
  note?: string;
  /** Free labels ("pirate", "griefer", "trade partner"): search and filter. */
  labels?: string[];
  updatedAt: number;
  /** Where the tag came from when imported ("BLKSYN intel 2026-11-08.json"). */
  source?: string;
}
/** `player:<handle lower>` / `org:<SID>` → entry. */
export type Intel = Record<string, IntelEntry>;
export const intelKey = (kind: IntelEntry['kind'], id: string) => `${kind}:${kind === 'org' ? id.toUpperCase() : id.toLowerCase()}`;

export function setTag(intel: Intel, e: Omit<IntelEntry, 'updatedAt'>, now: number): Intel {
  const k = intelKey(e.kind, e.id);
  const prev = intel[k];
  const labels = [...new Set((e.labels ?? prev?.labels ?? []).map((l) => l.trim()).filter(Boolean))];
  const note = (e.note ?? prev?.note ?? '').trim();
  return {
    ...intel,
    [k]: { kind: e.kind, id: e.kind === 'org' ? e.id.toUpperCase() : e.id, ...((e.name ?? prev?.name) ? { name: e.name ?? prev?.name } : {}), tag: e.tag, ...(note ? { note } : {}), ...(labels.length ? { labels } : {}), updatedAt: now, ...(e.source ? { source: e.source } : {}) },
  };
}
export function removeTag(intel: Intel, kind: IntelEntry['kind'], id: string): Intel {
  const next = { ...intel };
  delete next[intelKey(kind, id)];
  return next;
}

/* ---------------------------------------------------------------- suspected orgs ---------------------------------------------------------------- */

/**
 * An org you think a player is in (their membership is hidden on RSI, or not listed at all). Your guess, never
 * something RSI said: it is always shown as *suspected* and marked with `?`, and it only matters once you tag that org.
 */
export interface Suspect {
  /** Handle as written. */
  handle: string;
  /** Org SID (upper case). */
  sid: string;
  /** Org name when known, for lists. */
  name?: string;
  at: number;
  /** The file it was imported from. */
  source?: string;
}
/** `<handle lower>|<SID>` → suspected membership. */
export type Suspects = Record<string, Suspect>;
export const suspectKey = (handle: string, sid: string) => `${handle.toLowerCase()}|${sid.toUpperCase()}`;
const HANDLE_RE = /^[\w-]{1,60}$/;
const SID_RE = /^[A-Za-z0-9]{1,10}$/;
/** Add a suspected membership (once per player and org); a handle or SID that can't be one is left out. */
export function addSuspect(s: Suspects, e: { handle: string; sid: string; name?: string; source?: string }, now: number): Suspects {
  const handle = e.handle.trim().replace(/^@/, '');
  const sid = e.sid.trim().replace(/^\[|\]$/g, '').toUpperCase();
  if (!HANDLE_RE.test(handle) || !SID_RE.test(sid)) return s;
  const k = suspectKey(handle, sid);
  const name = e.name?.trim() || s[k]?.name;
  return { ...s, [k]: { handle, sid, ...(name ? { name } : {}), at: s[k]?.at ?? now, ...((e.source ?? s[k]?.source) ? { source: e.source ?? s[k]?.source } : {}) } };
}
export function removeSuspect(s: Suspects, handle: string, sid: string): Suspects {
  const next = { ...s };
  delete next[suspectKey(handle, sid)];
  return next;
}
/** Orgs you suspect a player is in, newest first. */
export const suspectedOrgs = (s: Suspects, handle: string): Suspect[] => Object.values(s).filter((x) => x.handle.toLowerCase() === handle.toLowerCase()).sort((a, b) => b.at - a.at);
/** Players you suspect are in an org, newest first. */
export const suspectedMembers = (s: Suspects, sid: string): Suspect[] => Object.values(s).filter((x) => x.sid === sid.toUpperCase()).sort((a, b) => b.at - a.at);

export interface Threat {
  /** The worst tag that applies, null when none. */
  tag: IntelTag | null;
  /**
   * Why, worst first: "Hostile: you tagged this player", "Caution: member of BLKSYN (affiliate)". `guess`: the
   * membership is one you suspect, not one RSI lists.
   */
  reasons: { tag: IntelTag; text: string; via: 'player' | 'org'; sid?: string; guess?: boolean }[];
  /** Hidden memberships (RSI "REDACTED"): unknown orgs. */
  hidden: number;
}
/**
 * What applies to a player: your tag on them, and your tags on every org they're in (main or affiliate). A player tag
 * wins over org tags (you know them better); otherwise the worst org tag. Orgs you only suspect them of (`suspects`)
 * count like memberships but are marked as a guess, and at the same tag a membership RSI lists comes first.
 */
export function threatOf(handle: string, orgs: Pick<Org, 'sid' | 'name' | 'main' | 'redacted'>[] | null | undefined, intel: Intel, suspects?: Suspects): Threat {
  const reasons: Threat['reasons'] = [];
  const p = intel[intelKey('player', handle)];
  if (p) reasons.push({ tag: p.tag, text: `${tagLabel(p.tag)}: you tagged this player${p.note ? ` (${p.note.split('\n')[0]})` : ''}`, via: 'player' });
  let hidden = 0;
  for (const o of orgs ?? []) {
    if (o.redacted) {
      hidden++;
      continue;
    }
    const e = intel[intelKey('org', o.sid)];
    if (e) reasons.push({ tag: e.tag, text: `${tagLabel(e.tag)}: ${o.main ? 'main org' : 'affiliate of'} ${o.name} [${o.sid}]${e.note ? ` (${e.note.split('\n')[0]})` : ''}`, via: 'org', sid: o.sid });
  }
  const listed = new Set((orgs ?? []).filter((o) => !o.redacted).map((o) => o.sid.toUpperCase()));
  for (const g of suspects ? suspectedOrgs(suspects, handle) : []) {
    if (listed.has(g.sid)) continue; // RSI lists it: no longer a guess
    const e = intel[intelKey('org', g.sid)];
    if (e) reasons.push({ tag: e.tag, text: `${tagLabel(e.tag)}: suspected member of ${g.name ?? e.name ?? g.sid} [${g.sid}], your guess${e.note ? ` (${e.note.split('\n')[0]})` : ''}`, via: 'org', sid: g.sid, guess: true });
  }
  const orgReasons = reasons.filter((r) => r.via === 'org').sort((a, b) => (RANK.get(b.tag) ?? 0) - (RANK.get(a.tag) ?? 0) || Number(!!a.guess) - Number(!!b.guess));
  const tag = p ? p.tag : (orgReasons[0]?.tag ?? null);
  return { tag, reasons: [...reasons.filter((r) => r.via === 'player'), ...orgReasons], hidden };
}
/** Tags worth flagging in Spectrum / Friends (friendly and ally only show in the lookup). */
export const isWarning = (t: IntelTag | null) => t === 'hostile' || t === 'caution';

/** Tagged entries for the list: filter by kind / tag / text (id, name, note, labels), most recently changed first. */
export function filterIntel(intel: Intel, f: { kind?: IntelEntry['kind'] | ''; tags?: IntelTag[]; q?: string }): IntelEntry[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return Object.values(intel)
    .filter((e) => (!f.kind || e.kind === f.kind) && (!f.tags?.length || f.tags.includes(e.tag)))
    .filter((e) => !q || `${e.id} ${e.name ?? ''} ${e.note ?? ''} ${(e.labels ?? []).join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ---------------------------------------------------------------- export / import ---------------------------------------------------------------- */

export const INTEL_FORMAT = 'rsi-plus-intel';
export function exportIntel(entries: IntelEntry[], now: number, suspects: Suspect[] = []): string {
  return JSON.stringify({ format: INTEL_FORMAT, version: 1, exportedAt: new Date(now).toISOString(), entries, ...(suspects.length ? { suspects } : {}) }, null, 1);
}
/** Suspected memberships of an exported file, merged into yours: ones you don't have are added (yours keep their date). */
export function importSuspects(s: Suspects, json: string, opts: { source: string; now: number }): { suspects: Suspects; added: number } {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    return { suspects: s, added: 0 };
  }
  if (data?.format !== INTEL_FORMAT || !Array.isArray(data.suspects)) return { suspects: s, added: 0 };
  let next = s;
  let added = 0;
  for (const e of (data.suspects as Partial<Suspect>[]).slice(0, 5000)) {
    if (typeof e?.handle !== 'string' || typeof e.sid !== 'string') continue;
    const probe = addSuspect({}, { handle: e.handle, sid: e.sid }, opts.now);
    const k = Object.keys(probe)[0];
    if (!k || next[k]) continue; // not a handle / SID, or you have it already
    next = addSuspect(next, { handle: e.handle, sid: e.sid, name: typeof e.name === 'string' ? e.name.slice(0, 120) : undefined, source: opts.source }, opts.now);
    added++;
  }
  return { suspects: next, added };
}
/**
 * Merge an exported file: entries you don't have are added; for ones you have, `overwrite` takes theirs, otherwise
 * yours stay. Returns the merged intel and counts; throws on a file that isn't an RSI+ intel export.
 */
export function importIntel(intel: Intel, json: string, opts: { overwrite: boolean; source: string; now: number }): { intel: Intel; added: number; updated: number; skipped: number } {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not a JSON file');
  }
  if (data?.format !== INTEL_FORMAT || !Array.isArray(data.entries)) throw new Error('Not an RSI+ intel export');
  let next = intel;
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const e of data.entries as Partial<IntelEntry>[]) {
    if ((e.kind !== 'player' && e.kind !== 'org') || typeof e.id !== 'string' || !e.id.trim() || !RANK.has(e.tag as IntelTag)) {
      skipped++;
      continue;
    }
    const k = intelKey(e.kind, e.id);
    if (next[k] && !opts.overwrite) {
      skipped++;
      continue;
    }
    if (next[k]) updated++;
    else added++;
    next = setTag(next, { kind: e.kind, id: e.id.trim(), name: typeof e.name === 'string' ? e.name : undefined, tag: e.tag as IntelTag, note: typeof e.note === 'string' ? e.note : '', labels: Array.isArray(e.labels) ? e.labels.filter((l): l is string => typeof l === 'string') : [], source: opts.source }, opts.now);
  }
  return { intel: next, added, updated, skipped };
}

/* ---------------------------------------------------------------- lookups ---------------------------------------------------------------- */

export interface Citizen {
  handle: string;
  moniker: string;
  /** UEE citizen record number ("#6103986"). */
  record: string | null;
  enlisted: string | null;
  location: string | null;
  fluency: string | null;
  /** Title badge ("Developer", "Grand Admiral"). */
  title: string | null;
  avatar: string | null;
}
export interface OrgInfo {
  sid: string;
  name: string;
  members: number | null;
  /** Archetype ("Syndicate", "Corporation", "PMC", …). */
  model: string | null;
  commitment: string | null;
  /** Other tags RSI shows: Roleplay, Exclusive, Recruiting … */
  tags: string[];
  focus: { primary: string | null; secondary: string | null };
  logo: string | null;
  /** Discord invites the org posted on its page, as `https://discord.gg/<code>` (left out when there are none). */
  discord?: string[];
}
export interface OrgMember {
  handle: string;
  name: string;
  rank: string | null;
  /** Star rating 0–5. */
  stars: number | null;
  /** RSI's membership visibility: V visible, R redacted, H hidden. */
  visibility: 'V' | 'R' | 'H';
  main: boolean;
}

const abs = (src: string | undefined | null) => (!src ? null : src.startsWith('http') ? src : `${RSI}${src.startsWith('/') ? '' : '/'}${src}`);
const field = (html: string, label: string) => {
  const m = new RegExp(`<span class="label[^"]*">\\s*${label}\\s*</span>\\s*<strong class="value[^"]*">([\\s\\S]*?)</strong>`, 'i').exec(html);
  const v = m ? decodeEntities(m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) : '';
  return v || null;
};

/** `/citizens/<handle>` page → profile; null when the page has no profile (unknown handle). */
export function parseCitizen(html: string): Citizen | null {
  const handle = field(html, 'Handle name');
  if (!handle) return null;
  const info = /<div class="profile left-col">[\s\S]*?<div class="info">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  const moniker = decodeEntities(/<p class="entry">\s*<strong class="value">([^<]*)<\/strong>/.exec(info)?.[1] ?? handle);
  const title = /<span class="icon">[\s\S]*?<\/span>\s*<span class="value">([^<]*)<\/span>/.exec(info)?.[1];
  return {
    handle,
    moniker: moniker || handle,
    record: /citizen-record">[\s\S]*?<strong class="value">([^<]*)</.exec(html)?.[1]?.trim() ?? null,
    enlisted: field(html, 'Enlisted'),
    location: field(html, 'Location'),
    fluency: field(html, 'Fluency'),
    title: title ? decodeEntities(title) || null : null,
    avatar: abs(/<div class="profile left-col">[\s\S]*?<div class="thumb">\s*<img src="([^"]+)"/.exec(html)?.[1]),
  };
}

/**
 * Discord invites in an org page (links or plain text: `discord.gg/<code>`, `discord.com/invite/<code>`,
 * `discordapp.com/invite/<code>`), each once, as `https://discord.gg/<code>`. Only the org's own part of the page is
 * read (`#organization` up to the footer), so a Discord link in RSI's site chrome is not taken for the org's. The URL
 * is rebuilt from the invite code alone, so nothing else from the page ends up in the link.
 */
export function parseDiscord(html: string): string[] {
  const from = html.indexOf('id="organization"');
  const end = html.search(/<footer\b|id="footer"/);
  const part = html.slice(Math.max(from, 0), end > from ? end : undefined).replace(/%2F/gi, '/');
  const seen = new Map<string, string>();
  for (const m of part.matchAll(/discord(?:\.gg|(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})/gi)) {
    const code = m[1]!;
    if (!seen.has(code.toLowerCase())) seen.set(code.toLowerCase(), `https://discord.gg/${code}`);
  }
  return [...seen.values()].slice(0, 5);
}

/** Text without tags: stripped until nothing changes (`<scr<b>ipt>` leaves no tag behind), then stray angle brackets. */
function stripTags(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, '');
  } while (s !== prev);
  return s.replace(/[<>]/g, '');
}

/** `/orgs/<SID>` page → org; null when it isn't an org page. */
export function parseOrg(html: string): OrgInfo | null {
  const h1 = /<h1>([\s\S]*?)\/\s*<span class="symbol">([^<]+)<\/span>\s*<\/h1>/.exec(html);
  if (!h1) return null;
  const discord = parseDiscord(html);
  const tags = [...html.matchAll(/<ul class="tags[^"]*">([\s\S]*?)<\/ul>/g)].flatMap((m) => [...m[1]!.matchAll(/<li class="([^"]+)">([^<]*)<\/li>/g)].map((x) => [x[1]!, decodeEntities(x[2]!)] as const));
  const of = (k: string) => tags.find(([c]) => c === k)?.[1] || null;
  const focus = (k: string) => decodeEntities(new RegExp(`<li class="${k}[^"]*">\\s*<img [^>]*alt="([^"]*)"`).exec(html)?.[1] ?? '') || null;
  const members = /<span class="count">\s*([\d,]+)\s+members?/.exec(html)?.[1];
  return {
    sid: decodeEntities(h1[2]!).toUpperCase(),
    name: decodeEntities(stripTags(h1[1]!)),
    members: members ? Number(members.replace(/,/g, '')) : null,
    model: of('model'),
    commitment: of('commitment'),
    tags: tags.filter(([c]) => c !== 'model' && c !== 'commitment').map(([, v]) => v).filter(Boolean),
    focus: { primary: focus('primary'), secondary: focus('secondary') },
    logo: abs(/<div class="logo[^"]*">\s*<img src="([^"]+)"/.exec(html)?.[1]),
    ...(discord.length ? { discord } : {}),
  };
}

/** `getOrgMembers` HTML → members (hidden / redacted ones keep only their visibility). */
export function parseMembers(html: string): OrgMember[] {
  return html
    .split(/<li class="member-item/)
    .slice(1)
    .map((b) => {
      const visibility = (/org-visibility-([VRH])/.exec(b.slice(0, 200))?.[1] ?? 'V') as OrgMember['visibility'];
      const cls = (c: string) => new RegExp(`class="(?:[^"]*\\s)?${c}(?:\\s[^"]*)?">([^<]*)<`).exec(b)?.[1]?.trim() ?? '';
      const handle = decodeEntities(cls('nick'));
      const stars = /class="stars" style="width:\s*([\d.]+)%/.exec(b)?.[1];
      return {
        handle,
        name: decodeEntities(cls('name')) || handle,
        rank: decodeEntities(/<span class="rank">([^<]*)</.exec(b)?.[1] ?? '') || null,
        stars: stars != null ? Math.round(Number(stars) / 20) : null,
        visibility,
        main: /\borg-main\b/.test(b.slice(0, 200)),
      };
    });
}

/* ---------------------------------------------------------------- cache ---------------------------------------------------------------- */

/** Lookups kept so repeat views and Spectrum flags cost nothing; *Refresh* or age past `INTEL_TTL` re-reads. */
export interface IntelCache {
  citizens: Record<string, { at: number; citizen: Citizen | null; error?: string }>;
  orgs: Record<string, { at: number; org: OrgInfo | null; error?: string }>;
  /** SID → members read so far (pages of 32), and the total RSI reports. */
  members: Record<string, { at: number; total: number; pages: number; list: OrgMember[] }>;
  /** Lookups in order, newest first (the *Recent* list): `player:<handle>` / `org:<SID>`. */
  recent: string[];
}
export const NO_INTEL_CACHE: IntelCache = { citizens: {}, orgs: {}, members: {}, recent: [] };
export const INTEL_TTL = 24 * 3600_000;
export const INTEL_MAX = 500;
export const MEMBERS_PAGE = 32;
export const isFresh = <T extends { at: number }>(e: T | undefined, now: number, ttl = INTEL_TTL): e is T => !!e && now - e.at < ttl;
/** Note a lookup in *Recent* (deduped, capped) and trim the cache to the most recent `INTEL_MAX` of each kind. */
export function touchRecent(c: IntelCache, key: string): IntelCache {
  const recent = [key, ...c.recent.filter((k) => k !== key)].slice(0, 50);
  const trim = <T extends { at: number }>(r: Record<string, T>) => {
    const keys = Object.keys(r);
    if (keys.length <= INTEL_MAX) return r;
    return Object.fromEntries(keys.sort((a, b) => r[b]!.at - r[a]!.at).slice(0, INTEL_MAX).map((k) => [k, r[k]!]));
  };
  return { citizens: trim(c.citizens), orgs: trim(c.orgs), members: trim(c.members), recent };
}

export interface PlayerLookup {
  at: number;
  citizen: Citizen | null;
  /** Main + affiliate orgs (the cached `orgs:get` read of `/citizens/<handle>/organizations`). */
  orgs: Org[];
  error?: string;
}
export interface OrgLookup {
  at: number;
  org: OrgInfo | null;
  error?: string;
}

/** Text typed into the lookup box → a handle or SID (URLs and "@handle" welcome). */
export function parseLookup(input: string): { kind: 'player' | 'org' | null; id: string } {
  const t = input.trim();
  const org = /\/orgs\/([A-Za-z0-9_-]+)/.exec(t);
  if (org) return { kind: 'org', id: org[1]!.toUpperCase() };
  const cit = /\/citizens\/([A-Za-z0-9_-]+)/.exec(t);
  if (cit) return { kind: 'player', id: cit[1]! };
  const bare = t.replace(/^@/, '').replace(/^\[|\]$/g, '');
  return { kind: t.startsWith('@') ? 'player' : t.startsWith('[') ? 'org' : null, id: /^[A-Za-z0-9_-]+$/.test(bare) ? bare : '' };
}
