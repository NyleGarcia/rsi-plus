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
export const ORG_TTL = 24 * 60 * 60 * 1000;

export function mainOrgFromBadges(m: Pick<Member, 'meta'> | null | undefined): Pick<Org, 'sid' | 'name'> | null {
  for (const b of m?.meta?.badges ?? []) {
    const sid = b.url?.match(/\/orgs\/([A-Za-z0-9_-]+)/)?.[1];
    if (sid) return { sid: sid.toUpperCase(), name: b.name };
  }
  return null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

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
      sid: decode(sid).toUpperCase(),
      name: name ? decode(name) : decode(sid),
      rank: rank ? decode(rank) || null : null,
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
