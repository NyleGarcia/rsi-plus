/**
 * Issue Council (issue-council.robertsspaceindustries.com): what RSI+ reads off its pages, and the pure logic on top —
 * read state (new contributions / status since your last visit), change events for tracked issues, Spectrum mentions.
 *
 * Everything here comes from the pages you open: the content script parses Issue Council's own markup (BEM classes,
 * checked on saved pages 2026-11, Issue Council v2.87.2). RSI+ never calls Issue Council's API and never touches its
 * login (an OIDC bearer token in the page's own storage). So "notify" means "when an Issue Council page you open shows
 * a tracked issue changed" — nothing arrives while no Issue Council tab is open.
 */
import type { FeedEvent } from './watch';

export const IC_ORIGIN = 'https://issue-council.robertsspaceindustries.com';
/** The optional host asked for by Settings → Issue Council (wxt.config.ts `optional_host_permissions`). */
export const IC_HOSTS = [`${IC_ORIGIN}/*`];
export const IC_PROJECT = 'STAR-CITIZEN';
export const issueUrl = (code: string) => `${IC_ORIGIN}/projects/${IC_PROJECT}/issues/${code}`;
/** Star Citizen issue codes as written on Spectrum and in the Issue Council: `STARC-222998` (also `#STARC-…`). */
const CODE = /\bSTARC-(\d{3,8})\b/g;

/** Why an issue is tracked: the Issue Council pages it showed up on, or RSI+'s own Watch button. */
export type IcRelation = 'reported' | 'contributed' | 'followed' | 'watched';
export const IC_RELATIONS: { id: IcRelation; label: string }[] = [
  { id: 'watched', label: 'Watched in RSI+' },
  { id: 'reported', label: 'You reported' },
  { id: 'contributed', label: 'You contributed' },
  { id: 'followed', label: 'You follow' },
];

/** What a card or an issue page shows about an issue. */
export interface IcSnapshot {
  code: string;
  title: string;
  /** Lower case as Issue Council marks it (`data-testid`): open, confirmed, fixed, archived, need-more-info, … ('' when not shown). */
  status: string;
  /** Contributions (have + don't have this issue), null when the page doesn't show a count. */
  contributions: number | null;
  category?: string;
}

export interface IcIssue extends IcSnapshot {
  /** Last time an Issue Council page showed it (ms). */
  updatedAt: number;
  rel: IcRelation[];
  /** Your last visit to the issue's own page: what it showed then, and the Activity Feed entries (ids) you saw. */
  seen?: { at: number; status: string; contributions: number | null; activity: string[] };
}
export type IcIssues = Record<string, IcIssue>;

/** A Spectrum thread where RSI+ saw the code (Spectrum tools on, thread opened). */
export interface IcMention {
  slug: string;
  channelId: string;
  subject: string;
  at: number;
}
export type IcMentions = Record<string, IcMention[]>;

/** Report form draft (Report new issue): field name → value, per tab session of the form. */
export interface IcDraft {
  at: number;
  fields: Record<string, string>;
}

export const MAX_ISSUES = 3000;
export const MAX_ACTIVITY = 200;
export const MAX_MENTIONS = 8;
export const MAX_MENTION_CODES = 1500;

export const DEFAULT_TEMPLATE = `Game version / build:
Server region / shard:
Location (system, place):
Ship / vehicle (if any):

Steps:
1.
2.
3.

Frequency (always / sometimes / once):`;

/** Unique codes in a text, in order (`STARC-123`). */
export function findCodes(text: string): string[] {
  return [...new Set([...text.matchAll(CODE)].map((m) => `STARC-${m[1]}`))];
}

/** `/projects/STAR-CITIZEN/issues/STARC-1` → the code; null elsewhere. */
export function codeFromUrl(href: string): string | null {
  const m = /\/issues\/(STARC-\d+)(?:[/?#]|$)/.exec(href);
  return m ? m[1]! : null;
}

export type IcPage = 'issue' | 'create' | 'reported' | 'contributed' | 'followed' | 'list' | 'other';
/** Which Issue Council page a path is (`/projects/STAR-CITIZEN/my-reports` → reported). */
export function pageOf(pathname: string): IcPage {
  const p = pathname.replace(/\/+$/, '');
  if (/\/issues\/create$/.test(p)) return 'create';
  if (/\/issues\/STARC-\d+$/.test(p)) return 'issue';
  if (/\/my-reports$/.test(p)) return 'reported';
  if (/\/my-contributions$/.test(p)) return 'contributed';
  if (/\/followed-issues$/.test(p)) return 'followed';
  if (/\/projects\/[^/]+(\/issues|\/trending|\/need-more-info)?$/.test(p)) return 'list';
  return 'other';
}
/** The relation every card on a page implies (My reports → reported, …). */
export const pageRelation = (page: IcPage): IcRelation | null => (page === 'reported' || page === 'contributed' || page === 'followed' ? page : null);

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const num = (s: string) => {
  const m = /(\d[\d,.]*)/.exec(s);
  return m ? Number(m[1]!.replace(/[,.]/g, '')) : null;
};

/** The count printed next to an icon (`<span data-testid="can-reproduce"></span><span>13</span>`). */
function countAfter(root: Element, testid: string): number | null {
  const icon = root.querySelector(`[data-testid="${testid}"]`);
  return icon ? num(text(icon.nextElementSibling)) : null;
}

export interface IcCard extends IcSnapshot {
  el: HTMLElement;
  /** "You reported" / "You contributed" on the card. */
  rel: IcRelation | null;
}

/** Issue cards on a list page (dashboard, all issues, my reports, …). Placeholder cards (report form) are skipped. */
export function parseCards(root: ParentNode): IcCard[] {
  const out: IcCard[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('.c-issue-card:not(.c-issue-card--placeholder)')) {
    const code = codeFromUrl(el.querySelector<HTMLAnchorElement>('a.c-issue-card__link')?.href ?? '');
    if (!code) continue;
    const footer = el.querySelector('.c-issue-card-footer');
    const status = footer?.querySelector('[data-testid]')?.getAttribute('data-testid') ?? '';
    // "67 contributions" (my reports) or "13 have this issue" + "0 don't have this issue" (lists).
    const contribEl = [...el.querySelectorAll('.c-issue-card-content span')].find((s) => /\bcontributions?\b/i.test(text(s)) && /\d/.test(text(s)));
    const have = countAfter(el, 'can-reproduce');
    const dont = countAfter(el, 'cannot-reproduce');
    const contributions = contribEl ? num(text(contribEl)) : have != null || dont != null ? (have ?? 0) + (dont ?? 0) : null;
    const ann = text(el.querySelector('.c-announcement__title')).toLowerCase();
    out.push({
      el,
      code,
      title: text(el.querySelector('.c-issue-card-title')),
      status,
      contributions,
      category: text(el.querySelector('.c-tag__label')) || undefined,
      rel: ann.includes('reported') ? 'reported' : ann.includes('contributed') ? 'contributed' : null,
    });
  }
  return out;
}

export interface IcIssuePage extends IcSnapshot {
  /** Activity Feed entries on the page (their element ids), newest first as Issue Council lists them. */
  activity: string[];
}

/** An issue's own page (`/issues/STARC-…`). null until its header has rendered. */
export function parseIssuePage(root: ParentNode): IcIssuePage | null {
  const code = findCodes(text(root.querySelector('.c-issue-report-meta-data__issue-code')))[0];
  if (!code) return null;
  const overview = new Map<string, number | null>();
  for (const item of root.querySelectorAll('.c-community-overview-item'))
    overview.set(text(item.querySelector('.c-community-overview-item__title')).toLowerCase(), num(text(item.querySelector('.c-community-overview-item__count'))));
  const have = overview.get('have this issue');
  const dont = overview.get("don't have this issue");
  const contributions = overview.get('contributions') ?? (have != null || dont != null ? (have ?? 0) + (dont ?? 0) : null);
  const statusCard = root.querySelector('.c-contribution-card-status');
  const status = statusCard?.querySelector('[data-testid]')?.getAttribute('data-testid') || text(statusCard?.querySelector('.c-contribution-card-status__status-info > :last-child')).toLowerCase().replace(/\s+/g, '-');
  return {
    code,
    title: text(root.querySelector('.c-issue-report-header-title h1')),
    status,
    contributions,
    category: text(root.querySelector('.c-issue-report-meta-data__category .c-tag__label')) || undefined,
    activity: [...root.querySelectorAll<HTMLElement>('.c-activity-feed-content__item[id]')].map((e) => e.id),
  };
}

/** Status words for people: `need-more-info` → "need more info". */
export const statusLabel = (s: string) => s.replace(/-/g, ' ');

/** Read state against your last visit to the issue page: contributions added and a status change since. */
export function readState(issue: IcIssue | undefined, snap: Pick<IcSnapshot, 'status' | 'contributions'>): { newContrib: number; statusFrom: string | null } {
  const seen = issue?.seen;
  if (!seen) return { newContrib: 0, statusFrom: null };
  const newContrib = seen.contributions != null && snap.contributions != null ? Math.max(0, snap.contributions - seen.contributions) : 0;
  const statusFrom = seen.status && snap.status && seen.status !== snap.status ? seen.status : null;
  return { newContrib, statusFrom };
}

/**
 * Feed events for a tracked issue an Issue Council page just showed, against what RSI+ knew before: a status change,
 * or contributions that grew. Untracked issues, first sightings and missing values give nothing.
 */
export function issueEvents(prev: IcIssue | undefined, snap: IcSnapshot, now: number): FeedEvent[] {
  if (!prev || !prev.rel.length) return [];
  const url = issueUrl(snap.code);
  const name = snap.title || prev.title;
  const out: FeedEvent[] = [];
  if (prev.status && snap.status && prev.status !== snap.status)
    out.push({ key: `ic-status:${snap.code}:${snap.status}`, kind: 'issue', title: `${snap.code} is now ${statusLabel(snap.status)}`, body: `${name} (was ${statusLabel(prev.status)})`, url, at: now, seen: false });
  if (prev.contributions != null && snap.contributions != null && snap.contributions > prev.contributions) {
    const n = snap.contributions - prev.contributions;
    out.push({ key: `ic-contrib:${snap.code}:${snap.contributions}`, kind: 'issue', title: `${snap.code}: +${n} contribution${n === 1 ? '' : 's'}`, body: `${name} (${snap.contributions} now)`, url, at: now, seen: false });
  }
  return out;
}

/** Store what a page showed (keeps `seen`, adds `rel`); values a page didn't show keep their last known value. */
export function upsert(issues: IcIssues, snap: IcSnapshot, rel: IcRelation | null, now: number): IcIssue {
  const prev = issues[snap.code];
  const next: IcIssue = {
    code: snap.code,
    title: snap.title || prev?.title || '',
    status: snap.status || prev?.status || '',
    contributions: snap.contributions ?? prev?.contributions ?? null,
    category: snap.category ?? prev?.category,
    updatedAt: now,
    rel: rel && !prev?.rel.includes(rel) ? [...(prev?.rel ?? []), rel] : (prev?.rel ?? []),
    ...(prev?.seen ? { seen: prev.seen } : {}),
  };
  issues[snap.code] = next;
  return next;
}

/** You opened the issue page: what it shows now is read. Activity ids are kept (newest first, capped). */
export function markSeen(issue: IcIssue, page: IcIssuePage, now: number): IcIssue {
  const old = issue.seen?.activity ?? [];
  const activity = [...new Set([...page.activity, ...old])].slice(0, MAX_ACTIVITY);
  return { ...issue, seen: { at: now, status: page.status || issue.status, contributions: page.contributions ?? issue.contributions, activity } };
}

/** Activity Feed entries not there at your last visit (none on a first visit: everything would be "new"). */
export function newActivity(issue: IcIssue | undefined, page: IcIssuePage): string[] {
  if (!issue?.seen) return [];
  const seen = new Set(issue.seen.activity);
  return page.activity.filter((id) => !seen.has(id));
}

export function toggleWatch(issues: IcIssues, snap: IcSnapshot, now: number): boolean {
  const cur = issues[snap.code] ?? upsert(issues, snap, null, now);
  const on = !cur.rel.includes('watched');
  issues[snap.code] = { ...cur, rel: on ? [...cur.rel, 'watched'] : cur.rel.filter((r) => r !== 'watched') };
  return on;
}

/** Keep the store bounded: tracked issues always stay; the rest by most recently seen. */
export function prune(issues: IcIssues, max = MAX_ISSUES): IcIssues {
  const all = Object.values(issues);
  if (all.length <= max) return issues;
  const tracked = all.filter((i) => i.rel.length);
  const rest = all.filter((i) => !i.rel.length).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(0, max - tracked.length));
  return Object.fromEntries([...tracked, ...rest].map((i) => [i.code, i]));
}

/** Record that a Spectrum thread mentions these codes (newest first, deduped by thread, capped). */
export function addMentions(m: IcMentions, codes: string[], t: Omit<IcMention, 'at'>, now: number): IcMentions {
  if (!codes.length) return m;
  const next = { ...m };
  for (const code of codes) {
    const list = (next[code] ?? []).filter((x) => x.slug !== t.slug);
    next[code] = [{ ...t, at: now }, ...list].slice(0, MAX_MENTIONS);
  }
  const keys = Object.keys(next);
  if (keys.length > MAX_MENTION_CODES)
    for (const k of keys.sort((a, b) => (next[a]![0]?.at ?? 0) - (next[b]![0]?.at ?? 0)).slice(0, keys.length - MAX_MENTION_CODES)) delete next[k];
  return next;
}

/** Tracked issues for the hub: watched / reported / contributed / followed, most recently updated first. */
export const tracked = (issues: IcIssues): IcIssue[] =>
  Object.values(issues)
    .filter((i) => i.rel.length)
    .sort((a, b) => b.updatedAt - a.updatedAt);
