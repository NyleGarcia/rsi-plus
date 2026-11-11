import { describe, expect, it } from 'vitest';
import { MAX_HISTORY, NO_IC_FILTER, facetCounts, filterIssues, issuesCsv, setNote, toggleWatch, upsert, withPoint, type IcIssues } from '@/lib/issue-council';

const snap = (contributions: number | null, status = 'open') => ({ code: 'STARC-1', title: 'Ship explodes', status, contributions });

describe('history', () => {
  it('records only tracked issues, and only on a change', () => {
    const issues: IcIssues = {};
    upsert(issues, snap(5), null, 1);
    expect(issues['STARC-1']!.history).toBeUndefined();
    upsert(issues, snap(5), 'reported', 2);
    expect(issues['STARC-1']!.history).toEqual([{ at: 2, status: 'open', contributions: 5 }]);
    upsert(issues, snap(5), null, 3);
    expect(issues['STARC-1']!.history).toHaveLength(1);
    upsert(issues, snap(7, 'confirmed'), null, 4);
    expect(issues['STARC-1']!.history!.at(-1)).toEqual({ at: 4, status: 'confirmed', contributions: 7 });
  });
  it('starts a history when you watch', () => {
    const issues: IcIssues = {};
    upsert(issues, snap(3), null, 1);
    toggleWatch(issues, snap(3), 9);
    expect(issues['STARC-1']!.history).toEqual([{ at: 9, status: 'open', contributions: 3 }]);
  });
  it('is capped', () => {
    let h: ReturnType<typeof withPoint>;
    for (let n = 0; n < MAX_HISTORY + 10; n++) h = withPoint(h, { rel: ['watched'], status: 'open', contributions: n }, n);
    expect(h!).toHaveLength(MAX_HISTORY);
    expect(h![0]!.contributions).toBe(10);
  });
  it('keeps the note and history across upserts', () => {
    const issues: IcIssues = {};
    upsert(issues, snap(1), 'watched', 1);
    setNote(issues, 'STARC-1', '  repro on Hurston  ');
    upsert(issues, snap(2), null, 2);
    expect(issues['STARC-1']!.note).toBe('repro on Hurston');
    expect(issues['STARC-1']!.history).toHaveLength(2);
    setNote(issues, 'STARC-1', ' ');
    expect('note' in issues['STARC-1']!).toBe(false);
    expect(setNote(issues, 'STARC-9', 'x')).toBe(false);
  });
});

describe('hub filters', () => {
  const issues: IcIssues = {};
  upsert(issues, { code: 'STARC-1', title: 'Quantum drive stalls', status: 'open', contributions: 4, category: 'Ships' }, 'watched', 3);
  upsert(issues, { code: 'STARC-2', title: 'Elevator, "stuck"', status: 'confirmed', contributions: 9, category: 'Locations' }, 'reported', 2);
  upsert(issues, { code: 'STARC-3', title: 'Untracked one', status: 'open', contributions: 1 }, null, 1);
  setNote(issues, 'STARC-2', 'Area18');

  it('tracked only by default, all on request, newest first', () => {
    expect(filterIssues(issues, NO_IC_FILTER).map((i) => i.code)).toEqual(['STARC-1', 'STARC-2']);
    expect(filterIssues(issues, { ...NO_IC_FILTER, all: true }).map((i) => i.code)).toEqual(['STARC-1', 'STARC-2', 'STARC-3']);
  });
  it('status, relation, category and text (note included)', () => {
    expect(filterIssues(issues, { ...NO_IC_FILTER, status: ['confirmed'] }).map((i) => i.code)).toEqual(['STARC-2']);
    expect(filterIssues(issues, { ...NO_IC_FILTER, rel: ['watched'] }).map((i) => i.code)).toEqual(['STARC-1']);
    expect(filterIssues(issues, { ...NO_IC_FILTER, category: ['Ships'] }).map((i) => i.code)).toEqual(['STARC-1']);
    expect(filterIssues(issues, { ...NO_IC_FILTER, q: 'area18' }).map((i) => i.code)).toEqual(['STARC-2']);
  });
  it('facet counts', () => {
    expect(facetCounts(filterIssues(issues, { ...NO_IC_FILTER, all: true }), (i) => i.status)).toEqual([
      ['open', 2],
      ['confirmed', 1],
    ]);
  });
  it('CSV quotes commas and quotes', () => {
    const csv = issuesCsv(filterIssues(issues, NO_IC_FILTER)).split('\n');
    expect(csv[0]).toBe('code,title,status,contributions,category,relations,last_seen,url,note');
    expect(csv[2]).toContain('"Elevator, ""stuck"""');
    expect(csv[2]).toContain(',Area18');
  });
});

import { addLink, linksOfThread, normalizeCode, pickIssues, removeLink, threadsFor } from '@/lib/issue-council';

describe('thread links', () => {
  const t = { slug: 'ship-blows-up', channelId: '190048', subject: 'Ship blows up' };
  it('normalizes codes, numbers and URLs', () => {
    expect(normalizeCode('STARC-123456')).toBe('STARC-123456');
    expect(normalizeCode(' starc 123456 ')).toBe('STARC-123456');
    expect(normalizeCode('123456')).toBe('STARC-123456');
    expect(normalizeCode('https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/STARC-99999')).toBe('STARC-99999');
    expect(normalizeCode('quantum bug')).toBeNull();
  });
  it('link, list per thread, unlink', () => {
    let l = addLink({}, 'STARC-1', t, 1);
    l = addLink(l, 'STARC-1', t, 2);
    expect(l['STARC-1']).toHaveLength(1);
    expect(linksOfThread(l, t.slug)).toEqual(['STARC-1']);
    l = removeLink(l, 'STARC-1', t.slug);
    expect(l).toEqual({});
  });
  it('your links first, mentions after, no duplicates', () => {
    const m = { 'STARC-1': [{ ...t, at: 1 }, { slug: 'other', channelId: '1', subject: 'Other', at: 2 }] };
    const out = threadsFor('STARC-1', m, addLink({}, 'STARC-1', t, 3));
    expect(out.map((x) => [x.slug, x.linked])).toEqual([
      ['ship-blows-up', true],
      ['other', false],
    ]);
  });
  it('picker: yours first, by title or code', () => {
    const issues: IcIssues = {};
    upsert(issues, { code: 'STARC-5', title: 'Quantum stalls', status: 'open', contributions: 1 }, null, 9);
    upsert(issues, { code: 'STARC-6', title: 'Quantum drive spool', status: 'open', contributions: 1 }, 'reported', 1);
    expect(pickIssues(issues, 'quantum').map((i) => i.code)).toEqual(['STARC-6', 'STARC-5']);
    expect(pickIssues(issues, '5').map((i) => i.code)).toEqual(['STARC-5']);
  });
});

import { getSettings, settingsItem } from '@/lib/settings';
import { fakeBrowser } from 'wxt/testing/fake-browser';

describe('removed report template', () => {
  it('a stored icTemplate is dropped from settings', async () => {
    fakeBrowser.reset();
    await settingsItem.setValue({ icTemplate: 'Mine: {x}' } as never);
    expect('icTemplate' in (await getSettings())).toBe(false);
  });
});

import { notesMatches, notesSection, similarIssues, titleTokens } from '@/lib/issue-council';

describe('similar issues and patch notes', () => {
  const issues: IcIssues = {};
  upsert(issues, { code: 'STARC-100010', title: 'Quantum drive fails to spool after leaving Hurston', status: 'open', contributions: 40 }, 'watched', 1);
  upsert(issues, { code: 'STARC-100011', title: 'Elevators stuck at Area18', status: 'fixed', contributions: 9 }, 'reported', 1);
  upsert(issues, { code: 'STARC-100012', title: 'Hangar doors do not open', status: 'open', contributions: 3 }, null, 1);
  it('tokens drop filler words and stem', () => {
    expect(titleTokens("Quantum drive doesn't spool when leaving Hurston (bug)")).toEqual(['quantum', 'drive', 'doesnt', 'spool', 'leav', 'hurston'].filter((t) => t !== 'doesnt'));
  });
  it('finds look-alikes, skips fixed unless asked', () => {
    expect(similarIssues('Quantum drive will not spool at Hurston', issues).map((s) => s.issue.code)).toEqual(['STARC-100010']);
    expect(similarIssues('Elevator stuck in Area18', issues)).toEqual([]);
    expect(similarIssues('Elevator stuck in Area18', issues, { includeClosed: true }).map((s) => s.issue.code)).toEqual(['STARC-100011']);
    expect(similarIssues('hangar', issues)).toEqual([]);
  });
  it('sections', () => {
    expect(notesSection('Known Issues')).toBe('known');
    expect(notesSection('Bug Fixes')).toBe('fixed');
    expect(notesSection('Technical')).toBe('other');
  });
  it('patch notes: codes anywhere, title matches only in known / fixed, tracked only', () => {
    const mine = Object.values(issues).filter((i) => i.rel.length);
    const m = notesMatches(
      [
        { text: 'Fixed STARC-100010 for real', section: 'other' },
        { text: 'Quantum drive can fail to spool after leaving Hurston', section: 'fixed' },
        { text: 'Quantum drive can fail to spool after leaving Hurston', section: 'other' },
        { text: 'Hangar doors do not open', section: 'known' },
      ],
      mine,
    );
    expect(m).toEqual([
      { line: 0, code: 'STARC-100010', how: 'code', section: 'other' },
      { line: 1, code: 'STARC-100010', how: 'maybe', section: 'fixed' },
    ]);
  });
});
