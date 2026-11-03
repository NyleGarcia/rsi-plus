// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  addMentions,
  codeFromUrl,
  findCodes,
  issueEvents,
  markSeen,
  newActivity,
  pageOf,
  parseCards,
  parseIssuePage,
  prune,
  readState,
  toggleWatch,
  upsert,
  type IcIssue,
  type IcIssues,
} from '@/lib/issue-council';

// Markup mirrors saved Issue Council pages (v2.87.2, 2026-11): an "All issues" card, a "My reports" card, an issue page.
const listCard = `
<div class="c-issue-card" tabindex="1"><a title="See issue" href="https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/STARC-223485" class="c-issue-card__link"></a>
<div class="c-issue-card__inner"><div class="c-issue-card-body"><div class="c-issue-card-content"><div class="c-group"><div class="c-stack">
  <div class="c-group"><div class="c-tag"><span class="t c-tag__label">Ships and Vehicles</span></div></div>
  <span class="t c-issue-card-title">You cannot fly with the prowler utility</span>
  <div class="c-group"><span class="t">#STARC-223485</span><div class="c-group"><span class="t">Last contribution</span><div class="c-relative-time"><div><div class="t">2 minutes ago</div></div></div></div></div>
  <div class="c-group"><div class="c-group"><span class="if-can-reproduce c-icon" data-testid="can-reproduce"></span><span class="t">3</span><span class="t">have this issue</span></div>
  <div class="c-group"><span class="if-cannot-reproduce c-icon" data-testid="cannot-reproduce"></span><span class="t">1</span><span class="t">don't have this issue</span></div></div>
</div></div></div>
<div class="c-issue-card-sub-content"><div class="c-announcement"><span class="t c-announcement__title">You contributed</span><span class="t c-announcement__text">to this issue</span></div></div></div>
<div class="c-issue-card-footer"><span class="if-open c-icon c-icon--xlarge" data-testid="open"></span><span class="t">open</span><span class="t t--word-break-break-word">30 days left</span></div></div></div>`;

const reportCard = `
<div class="c-issue-card c-issue-card--archived" tabindex="1"><a href="https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/STARC-210582" class="c-issue-card__link"></a>
<div class="c-issue-card__inner"><div class="c-issue-card-body"><div class="c-issue-card-content">
  <span class="t c-issue-card-title">Cannot Restock Missiles on Insured Ships</span>
  <span class="t">#STARC-210582</span>
  <div class="c-group"><span class="if-contribution c-icon" data-testid="contribution"></span><span class="t">67 contributions</span></div>
</div><div class="c-issue-card-sub-content"><div class="c-announcement"><span class="t c-announcement__title">You reported</span></div></div></div>
<div class="c-issue-card-footer"><span class="if-fixed c-icon" data-testid="fixed"></span><span class="t">fixed</span><span class="t">in 4.9.0-ptu.12170061</span></div></div></div>`;

const placeholder = `<div class="c-issue-card c-issue-card--placeholder"><a href="https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/create" class="c-issue-card__link"></a></div>`;

const issuePage = (status: string, have: number, activity: string[]) => `
<div class="c-page__issues--show"><div class="c-issue-report">
<header class="c-issue-report-header"><div class="c-issue-report-header-title"><h1 class="t">Zombie Ship / 10x Soft death HP protects components</h1></div>
  <span class="c-issue-report-meta-data__issue-code t">#STARC-222998</span>
  <div class="c-tag c-issue-report-meta-data__category"><span class="t c-tag__label">Ships and Vehicles</span></div></header>
<div class="c-community-overview"><div class="c-community-overview__body">
  <div class="c-community-overview-item"><span class="c-community-overview-item__title">Contributions</span><div class="c-community-overview-item__count">${have}</div></div>
  <div class="c-community-overview-item"><span class="c-community-overview-item__title">Have this issue</span><div class="c-community-overview-item__count">${have}</div></div>
  <div class="c-community-overview-item"><span class="c-community-overview-item__title">Don't have this issue</span><div class="c-community-overview-item__count">0</div></div>
  <div class="c-community-overview-item"><span class="c-community-overview-item__title">Severity</span><div class="c-community-overview-item__representation">Hardly Playable</div></div>
</div></div>
<div class="c-contribution-card-status"><div class="c-contribution-card-status__header"><span class="if-${status} c-icon" data-testid="${status}"></span>
  <div class="c-contribution-card-status__status-info"><div class="c-contribution-card-status__label">Status</div><div class="t">${status}</div></div></div></div>
<div class="c-activity-feed"><div class="c-activity-feed-content">${activity.map((id) => `<div id="${id}" class="c-activity-feed-content__item">entry</div>`).join('')}</div></div>
</div></div>`;

const docOf = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

describe('issue council: codes, urls, pages', () => {
  it('finds STARC codes once each, with or without #', () => {
    expect(findCodes('see #STARC-222998 and STARC-12345, also STARC-222998 again; not STARCX-1 or STARC-')).toEqual(['STARC-222998', 'STARC-12345']);
    expect(codeFromUrl('https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/STARC-223485')).toBe('STARC-223485');
    expect(codeFromUrl('/projects/STAR-CITIZEN/issues/create')).toBeNull();
  });
  it('tells the pages apart', () => {
    expect(pageOf('/projects/STAR-CITIZEN/issues/STARC-1')).toBe('issue');
    expect(pageOf('/projects/STAR-CITIZEN/issues/create')).toBe('create');
    expect(pageOf('/projects/STAR-CITIZEN/my-reports')).toBe('reported');
    expect(pageOf('/projects/STAR-CITIZEN/my-contributions/')).toBe('contributed');
    expect(pageOf('/projects/STAR-CITIZEN/followed-issues')).toBe('followed');
    expect(pageOf('/projects/STAR-CITIZEN/issues')).toBe('list');
    expect(pageOf('/projects/STAR-CITIZEN/')).toBe('list');
  });
});

describe('issue council: parsing', () => {
  it('reads list and my-reports cards, skips placeholders', () => {
    const cards = parseCards(docOf(listCard + reportCard + placeholder));
    expect(cards.map(({ el: _el, ...c }) => c)).toEqual([
      { code: 'STARC-223485', title: 'You cannot fly with the prowler utility', status: 'open', contributions: 4, category: 'Ships and Vehicles', rel: 'contributed' },
      { code: 'STARC-210582', title: 'Cannot Restock Missiles on Insured Ships', status: 'fixed', contributions: 67, category: undefined, rel: 'reported' },
    ]);
  });
  it('reads an issue page: counts, status, activity ids', () => {
    expect(parseIssuePage(docOf(issuePage('archived', 13, ['a3', 'a2', 'a1'])))).toEqual({
      code: 'STARC-222998',
      title: 'Zombie Ship / 10x Soft death HP protects components',
      status: 'archived',
      contributions: 13,
      category: 'Ships and Vehicles',
      activity: ['a3', 'a2', 'a1'],
    });
    expect(parseIssuePage(docOf('<div>loading</div>'))).toBeNull();
  });
});

describe('issue council: read state and events', () => {
  const now = 1_800_000_000_000;
  const page1 = parseIssuePage(docOf(issuePage('open', 13, ['a2', 'a1'])))!;
  const page2 = parseIssuePage(docOf(issuePage('confirmed', 16, ['a4', 'a3', 'a2', 'a1'])))!;

  it('first visit marks nothing new; the next visit sees what came since', () => {
    const issues: IcIssues = {};
    upsert(issues, page1, null, now);
    expect(newActivity(issues[page1.code], page1)).toEqual([]);
    issues[page1.code] = markSeen(issues[page1.code]!, page1, now);
    expect(readState(issues[page1.code], page2)).toEqual({ newContrib: 3, statusFrom: 'open' });
    expect(newActivity(issues[page1.code], page2)).toEqual(['a4', 'a3']);
    issues[page1.code] = markSeen(issues[page1.code]!, page2, now + 1);
    expect(readState(issues[page1.code], page2)).toEqual({ newContrib: 0, statusFrom: null });
    expect(newActivity(issues[page1.code], page2)).toEqual([]);
  });

  it('events only for tracked issues, on status change or more contributions', () => {
    const issues: IcIssues = {};
    const untracked = upsert(issues, page1, null, now);
    expect(issueEvents(untracked, page2, now)).toEqual([]);
    expect(issueEvents(undefined, page2, now)).toEqual([]);
    const watched: IcIssue = { ...untracked, rel: ['watched'] };
    const ev = issueEvents(watched, page2, now);
    expect(ev.map((e) => [e.key, e.kind, e.title])).toEqual([
      ['ic-status:STARC-222998:confirmed', 'issue', 'STARC-222998 is now confirmed'],
      ['ic-contrib:STARC-222998:16', 'issue', 'STARC-222998: +3 contributions'],
    ]);
    expect(issueEvents(watched, { ...page1, status: '', contributions: null }, now)).toEqual([]);
  });

  it('upsert keeps seen, adds relations once, keeps values a page did not show', () => {
    const issues: IcIssues = {};
    upsert(issues, page1, 'reported', now);
    issues[page1.code] = markSeen(issues[page1.code]!, page1, now);
    const up = upsert(issues, { code: page1.code, title: '', status: '', contributions: null }, 'reported', now + 5);
    expect(up).toMatchObject({ title: page1.title, status: 'open', contributions: 13, rel: ['reported'], updatedAt: now + 5 });
    expect(up.seen?.activity).toEqual(['a2', 'a1']);
  });

  it('toggles the RSI+ watch', () => {
    const issues: IcIssues = {};
    expect(toggleWatch(issues, page1, now)).toBe(true);
    expect(issues[page1.code]!.rel).toEqual(['watched']);
    expect(toggleWatch(issues, page1, now)).toBe(false);
    expect(issues[page1.code]!.rel).toEqual([]);
  });

  it('prunes untracked issues first, oldest first', () => {
    const issues: IcIssues = {};
    for (let i = 0; i < 6; i++) upsert(issues, { code: `STARC-${i}`, title: '', status: 'open', contributions: 1 }, i === 0 ? 'watched' : null, now + i);
    expect(Object.keys(prune(issues, 3)).sort()).toEqual(['STARC-0', 'STARC-4', 'STARC-5']);
  });

  it('records Spectrum mentions newest first, once per thread', () => {
    let m = addMentions({}, ['STARC-1', 'STARC-2'], { slug: 'a', channelId: '4', subject: 'A' }, now);
    m = addMentions(m, ['STARC-1'], { slug: 'b', channelId: '4', subject: 'B' }, now + 1);
    m = addMentions(m, ['STARC-1'], { slug: 'a', channelId: '4', subject: 'A' }, now + 2);
    expect(m['STARC-1']!.map((x) => x.slug)).toEqual(['a', 'b']);
    expect(m['STARC-2']!.map((x) => x.slug)).toEqual(['a']);
    expect(addMentions(m, [], { slug: 'c', channelId: '4', subject: 'C' }, now)).toBe(m);
  });
});
