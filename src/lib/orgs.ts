/**
 * Which orgs a member is in.
 * - Main org: free — Spectrum member objects carry it as a badge (`meta.badges[].url` = `…/orgs/<SID>`).
 * - All orgs (main + affiliations, rank): the public RSI page `/citizens/<nickname>/organizations` (server-rendered
 *   HTML, parsed with regexes so it also works in the service worker, which has no DOMParser).
 *   Redacted/hidden affiliations show up as `redacted`.
 */
import type { Member } from './types';

export interface Org {
  sid: string;
  name: string;
  rank: string | null;
  main: boolean;
  members: number | null;
  /** Membership hidden by the member (RSI shows "REDACTED"). */
  redacted: boolean;
}

export interface OrgCacheEntry {
  /** ms */
  at: number;
  orgs: Org[];
  /** Citizen page missing/failed (e.g. renamed handle). */
  error?: string;
}

/** nickname (lower-case) -> orgs */
export type OrgCache = Record<string, OrgCacheEntry>;
/** Org membership changes rarely; *Load all orgs* re-reads anything older, lazy loads skip anything younger. */
export const ORG_TTL = 7 * 24 * 60 * 60 * 1000;

export function mainOrgFromBadges(m: Pick<Member, 'meta'> | null | undefined): Pick<Org, 'sid' | 'name'> | null {
  for (const b of m?.meta?.badges ?? []) {
    const sid = b.url?.match(/\/orgs\/([A-Za-z0-9_-]+)/)?.[1];
    if (sid) return { sid: sid.toUpperCase(), name: b.name };
  }
  return null;
}

const codePoint = (n: number) => (Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
/** Invisible characters people pad names with: no-break space, zero-width space / joiners, word joiner, BOM. */
const INVISIBLE = /[\u00a0\u200b-\u200d\u2060\ufeff]/g;
export const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    // `&amp;` last: unescaping it first would decode `&amp;lt;` twice
    .replace(/&amp;/g, '&')
    .replace(INVISIBLE, ' ')
    .trim();

/**
 * A display name fit to show. Some players name themselves with `&nbsp;` (as text) or invisible characters so the
 * name looks blank on RSI: those become spaces, runs of spaces collapse, a cut-off entity at the end goes, and a name
 * left with no letter or digit falls back to `fallback` (the handle), so nobody shows up as a row of `&nbsp;`.
 */
export function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const s = raw
    .replace(/&(?:amp;)?nbsp;/gi, ' ')
    .replace(/&(?:amp;?|n(?:b(?:s(?:p)?)?)?)?$/i, '')
    .replace(INVISIBLE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(s) ? s : fallback;
}

export function parseCitizenOrgs(html: string): Org[] {
  const out: Org[] = [];
  const blocks = html.split(/<div class="box-content org /).slice(1);
  for (const b of blocks) {
    const main = /^main\b/.test(b);
    const redacted = /visibility-[RH]\b/.test(b.slice(0, 80)) || !/href="\/orgs\//.test(b);
    const sid = b.match(/href="\/orgs\/([^"/?#]+)"/)?.[1] ?? null;
    const name = b.match(/<a href="\/orgs\/[^"]+" class="value[^"]*">([^<]*)</)?.[1];
    const rank = b.match(/Organization rank<\/span>\s*<strong class="value[^"]*">([^<]*)</)?.[1];
    const members = b.match(/class="members">\s*([\d,]+)\s+member/)?.[1];
    if (redacted || !sid) {
      out.push({ sid: '', name: 'Redacted', rank: null, main, members: null, redacted: true });
      continue;
    }
    out.push({
      sid: decodeEntities(sid).toUpperCase(),
      name: name ? decodeEntities(name) : decodeEntities(sid),
      rank: rank ? decodeEntities(rank) || null : null,
      main,
      members: members ? Number(members.replace(/,/g, '')) : null,
      redacted: false,
    });
  }
  return out;
}

export function citizenOrgsUrl(nickname: string) {
  return `https://robertsspaceindustries.com/citizens/${encodeURIComponent(nickname)}/organizations`;
}

/** Orgs → friends in them, biggest shared org first. Friends with no known org go under "". */
export function groupByOrg<T>(items: T[], orgsOf: (t: T) => Pick<Org, 'sid' | 'name' | 'redacted'>[]): { sid: string; name: string; items: T[] }[] {
  const groups = new Map<string, { sid: string; name: string; items: T[] }>();
  for (const it of items) {
    // Unique SIDs per member: an item must appear at most once per group (keyed lists in the UI).
    const orgs = [...new Map(orgsOf(it).filter((o) => !o.redacted && o.sid).map((o) => [o.sid, o])).values()];
    for (const o of orgs.length ? orgs : [{ sid: '', name: 'No known org' }]) {
      const g = groups.get(o.sid) ?? { sid: o.sid, name: o.name, items: [] };
      g.items.push(it);
      groups.set(o.sid, g);
    }
  }
  return [...groups.values()].sort((a, b) => Number(!a.sid) - Number(!b.sid) || b.items.length - a.items.length || a.name.localeCompare(b.name));
}
