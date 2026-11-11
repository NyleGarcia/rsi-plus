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
  /** Tracked issues only: each change a page showed (status / contributions), oldest first, last `MAX_HISTORY`. */
  history?: IcPoint[];
  /** Your private note (hub *Issue Council* tab; shown on the issue page). */
  note?: string;
}
export interface IcPoint {
  at: number;
  status: string;
  contributions: number | null;
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

/** Spectrum threads you linked to an issue yourself (thread bar → *Link issue*), apart from the automatic mentions. */
export type IcLinks = Record<string, IcMention[]>;

/** "STARC-123456", "starc 123456", "123456" or an issue URL → `STARC-123456`; null when it isn't one. */
export function normalizeCode(input: string): string | null {
  const t = input.trim();
  const fromUrl = codeFromUrl(t);
  if (fromUrl) return fromUrl;
  const m = /^(?:#?starc[\s-]*)?(\d{3,8})$/i.exec(t);
  return m ? `STARC-${m[1]}` : null;
}

/** Link a thread to an issue (newest first, once per thread). */
export function addLink(links: IcLinks, code: string, t: Omit<IcMention, 'at'>, now: number): IcLinks {
  return { ...links, [code]: [{ ...t, at: now }, ...(links[code] ?? []).filter((x) => x.slug !== t.slug)] };
}
export function removeLink(links: IcLinks, code: string, slug: string): IcLinks {
  const rest = (links[code] ?? []).filter((x) => x.slug !== slug);
  const next = { ...links };
  if (rest.length) next[code] = rest;
  else delete next[code];
  return next;
}
/** Issues a thread is linked to. */
export const linksOfThread = (links: IcLinks, slug: string): string[] => Object.keys(links).filter((c) => links[c]!.some((x) => x.slug === slug));

/** Spectrum threads for an issue: your links first (marked), then the threads RSI+ saw mention it. */
export function threadsFor(code: string, mentions: IcMentions, links: IcLinks): (IcMention & { linked: boolean })[] {
  const out = (links[code] ?? []).map((m) => ({ ...m, linked: true }));
  for (const m of mentions[code] ?? []) if (!out.some((o) => o.slug === m.slug)) out.push({ ...m, linked: false });
  return out;
}

/** Issues for the link picker: matching code / title, yours (reported, contributed, followed, watched) first. */
export function pickIssues(issues: IcIssues, q: string, n = 8): IcIssue[] {
  const t = q.trim().toLowerCase();
  const code = normalizeCode(q);
  return Object.values(issues)
    .filter((i) => !t || i.code.toLowerCase().includes(t) || (code != null && i.code === code) || i.title.toLowerCase().includes(t))
    .sort((a, b) => Number(!!b.rel.length) - Number(!!a.rel.length) || b.updatedAt - a.updatedAt)
    .slice(0, n);
}

/** Report form draft (Report new issue): field name → value, per tab session of the form. */
export interface IcDraft {
  at: number;
  fields: Record<string, string>;
}

export const MAX_ISSUES = 3000;
export const MAX_ACTIVITY = 200;
export const MAX_HISTORY = 30;
export const MAX_MENTIONS = 8;
export const MAX_MENTION_CODES = 1500;

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
    ...(prev?.note ? { note: prev.note } : {}),
  };
  const history = withPoint(prev?.history, next, now);
  if (history) next.history = history;
  issues[snap.code] = next;
  return next;
}

/**
 * History after a page showed `issue`: a point is added when the issue is tracked and its status or count differs
 * from the last point (or there is none yet). Untracked issues keep what they had (nothing new).
 */
export function withPoint(history: IcPoint[] | undefined, issue: Pick<IcIssue, 'rel' | 'status' | 'contributions'>, now: number): IcPoint[] | undefined {
  if (!issue.rel.length || (!issue.status && issue.contributions == null)) return history;
  const last = history?.at(-1);
  if (last && last.status === issue.status && last.contributions === issue.contributions) return history;
  return [...(history ?? []), { at: now, status: issue.status, contributions: issue.contributions }].slice(-MAX_HISTORY);
}

/** Set or clear your note on an issue (no-op for an issue RSI+ hasn't seen). */
export function setNote(issues: IcIssues, code: string, note: string): boolean {
  const cur = issues[code];
  if (!cur) return false;
  const t = note.trim();
  const { note: _old, ...rest } = cur;
  issues[code] = t ? { ...rest, note: t } : rest;
  return true;
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
  const rel: IcRelation[] = on ? [...cur.rel, 'watched'] : cur.rel.filter((r) => r !== 'watched');
  const history = withPoint(cur.history, { ...cur, rel }, now);
  issues[snap.code] = { ...cur, rel, ...(history ? { history } : {}) };
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

/* ---------------------------------------------------------------- hub tab ---------------------------------------------------------------- */

export interface IcFilter {
  /** Every issue RSI+ has seen, not only tracked ones. */
  all: boolean;
  /** Empty = any. */
  status: string[];
  rel: IcRelation[];
  category: string[];
  q: string;
}
export const NO_IC_FILTER: IcFilter = { all: false, status: [], rel: [], category: [], q: '' };

/** Issues for the hub table: tracked (or all), filtered, most recently seen first. */
export function filterIssues(issues: IcIssues, f: IcFilter): IcIssue[] {
  const q = f.q.trim().toLowerCase();
  return Object.values(issues)
    .filter((i) => (f.all || i.rel.length) && (!f.status.length || f.status.includes(i.status)) && (!f.rel.length || f.rel.some((r) => i.rel.includes(r))))
    .filter((i) => !f.category.length || (!!i.category && f.category.includes(i.category)))
    .filter((i) => !q || `${i.code} ${i.title} ${i.note ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Value → count over a list (facet counts: status, category). */
export function facetCounts(list: IcIssue[], key: (i: IcIssue) => string | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const i of list) {
    const k = key(i);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** CSV of the hub view: code, title, status, contributions, category, relations, last seen (ISO), url, note. */
export function issuesCsv(list: IcIssue[]): string {
  const head = ['code', 'title', 'status', 'contributions', 'category', 'relations', 'last_seen', 'url', 'note'];
  const rows = list.map((i) => [i.code, i.title, i.status, i.contributions == null ? '' : String(i.contributions), i.category ?? '', i.rel.join(' '), new Date(i.updatedAt).toISOString(), issueUrl(i.code), i.note ?? '']);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/* ---------------------------------------------------------------- similar issues ---------------------------------------------------------------- */

/** Words that say nothing about which bug it is. */
const STOP = new Set(
  'a an the and or but of in on at to for from with by is are was were be been it its this that these those not no when while after before during into out up down off over under again can cant cannot does doesnt dont do did will wont would should could i im my me you your we our they their there here bug bugs issue issues problem problems broken error errors working work works fix fixed sometimes always randomly random game star citizen sc ptu live evocati please still also just get gets getting got'.split(' '),
);
/** "Quantum drive doesn't spool on Hurston" → quantum, drive, spool, hurston (simple stems: trailing s / ing / ed). */
export function titleTokens(t: string): string[] {
  const out = new Set<string>();
  for (const raw of t.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    out.add(raw.replace(/(ing|ed|es|s)$/, '') || raw);
  }
  return [...out];
}
export interface Similar {
  issue: IcIssue;
  score: number;
  shared: string[];
}
/**
 * Issues RSI+ has seen whose titles share words with `title`: overlap ÷ smaller title (so a short title fully inside
 * a long one still scores), at least 2 shared words, best first. Fixed / archived are left out unless asked for.
 */
export function similarIssues(title: string, issues: IcIssues | IcIssue[], opts: { n?: number; min?: number; includeClosed?: boolean; category?: string } = {}): Similar[] {
  const want = titleTokens(title);
  if (want.length < 2) return [];
  const w = new Set(want);
  const out: Similar[] = [];
  for (const i of Array.isArray(issues) ? issues : Object.values(issues)) {
    if (!opts.includeClosed && /^(fixed|archived|closed|resolved)$/.test(i.status)) continue;
    const have = titleTokens(i.title);
    const shared = have.filter((t) => w.has(t));
    if (shared.length < 2) continue;
    let score = shared.length / Math.min(want.length, have.length);
    if (opts.category && i.category && i.category.toLowerCase() === opts.category.toLowerCase()) score += 0.1;
    if (score >= (opts.min ?? 0.5)) out.push({ issue: i, score, shared });
  }
  return out.sort((a, b) => b.score - a.score || (b.issue.contributions ?? 0) - (a.issue.contributions ?? 0)).slice(0, opts.n ?? 5);
}

/* ---------------------------------------------------------------- patch notes ---------------------------------------------------------------- */

export type NotesSection = 'known' | 'fixed' | 'other';
/** A heading in patch notes → which section starts: "Known Issues", "Bug Fixes" / "Fixes", anything else. */
export function notesSection(heading: string): NotesSection {
  if (/known\s+issues?/i.test(heading)) return 'known';
  if (/\b(bug\s*fix(es)?|fixes|fixed)\b/i.test(heading)) return 'fixed';
  return 'other';
}
export interface NotesMatch {
  /** Index of the line in the input. */
  line: number;
  code: string;
  how: 'code' | 'maybe';
  section: NotesSection;
}
/**
 * Lines of a patch-notes post that concern issues you track: a STARC code (any section), or — only under Known Issues
 * / Bug Fixes — a line whose words closely match a tracked issue's title (`maybe`: never certain).
 */
export function notesMatches(lines: { text: string; section: NotesSection }[], trackedIssues: IcIssue[], min = 0.6): NotesMatch[] {
  const mine = new Set(trackedIssues.map((i) => i.code));
  const out: NotesMatch[] = [];
  lines.forEach((l, line) => {
    const codes = findCodes(l.text).filter((c) => mine.has(c));
    for (const code of codes) out.push({ line, code, how: 'code', section: l.section });
    if (codes.length || l.section === 'other') return;
    const best = similarIssues(l.text, trackedIssues, { n: 1, min, includeClosed: true })[0];
    if (best) out.push({ line, code: best.issue.code, how: 'maybe', section: l.section });
  });
  return out;
}
/** Feed event: a tracked issue listed by code under Bug Fixes (Settings → *Notify when patch notes fix a tracked issue*). */
export function fixedEvent(issue: IcIssue, notes: { subject: string; url: string; version: string }, now: number): FeedEvent {
  return { key: `ic-fixed:${issue.code}:${notes.version}`, kind: 'issue', title: `${issue.code} possibly fixed in ${notes.version}`, body: `${issue.title || issue.code}: listed under Bug Fixes in "${notes.subject}"`, url: notes.url, at: now, seen: false };
}
