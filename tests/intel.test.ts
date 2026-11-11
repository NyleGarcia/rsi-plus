import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { exportIntel, filterIntel, importIntel, intelKey, parseCitizen, parseDiscord, parseLookup, parseMembers, parseOrg, removeTag, setTag, threatOf, touchRecent, NO_INTEL_CACHE, type Intel } from '@/lib/intel';

const fx = (f: string) => fs.readFileSync(`tests/fixtures/${f}`, 'utf8');

describe('RSI pages (saved 2026-11)', () => {
  it('citizen profile', () => {
    expect(parseCitizen(fx('intel-citizen.html'))).toEqual({
      handle: 'Stamp-CIG',
      moniker: 'Stamp-CIG',
      record: '#6103986',
      enlisted: 'Feb 22, 2022',
      location: null,
      fluency: 'English, Chinese',
      title: 'Developer',
      avatar: 'https://robertsspaceindustries.com/media/xwieorwkut4w3r/heap_infobox/Stamp.png',
    });
    expect(parseCitizen('<html>no profile</html>')).toBeNull();
  });
  it('org page', () => {
    expect(parseOrg(fx('intel-org.html'))).toEqual({
      sid: 'BLKSYN',
      name: 'The Black Syndicate',
      members: 4,
      model: 'Syndicate',
      commitment: 'Hardcore',
      tags: ['Exclusive'],
      focus: { primary: 'Bounty Hunting', secondary: 'Transport' },
      logo: 'https://robertsspaceindustries.com/media/miiq8tndoohdcr/logo/BLKSYN-Logo.jpg',
    });
  });
  it('member list', () => {
    const m = parseMembers(JSON.parse(fx('intel-members.json')).data.html);
    expect(m).toHaveLength(4);
    expect(m[0]).toEqual({ handle: 'Crota_son_of_oryx', name: 'Crota', rank: 'Initiate', stars: 0, visibility: 'V', main: true });
  });
  it('Discord invites on an org page', () => {
    const page = (body: string, chrome = '') => `<header><a href="https://discord.gg/sitechrome">Discord</a></header>${fx('intel-org.html').replace('<p>Welcome', `${body}<p>Welcome`)}<footer>${chrome}</footer>`;
    expect(parseOrg(page(''))!.discord).toBeUndefined();
    expect(
      parseOrg(page('<p><a href="https://discord.gg/BlkSyn?x=1">Join</a> or discord.com/invite/abc-123, HTTPS://DISCORDAPP.COM/INVITE/abc-123 <a href="/redirect?u=https%3A%2F%2Fdiscord.gg%2Fwrapped">x</a> discord.com/channels/1/2</p>', '<a href="https://discord.gg/footer">RSI</a>'))!.discord,
    ).toEqual(['https://discord.gg/BlkSyn', 'https://discord.gg/abc-123', 'https://discord.gg/wrapped']);
    expect(parseDiscord('<p>discord.gg/"onclick=x</p>')).toEqual([]);
  });
});

describe('tags and threat', () => {
  let intel: Intel = {};
  intel = setTag(intel, { kind: 'org', id: 'blksyn', name: 'The Black Syndicate', tag: 'hostile', note: 'Pirates at Pyro\nmore' }, 1);
  intel = setTag(intel, { kind: 'org', id: 'TEST', tag: 'caution' }, 2);
  it('keys and normalizes', () => {
    expect(intel[intelKey('org', 'BLKSYN')]!.id).toBe('BLKSYN');
    expect(removeTag(intel, 'org', 'blksyn')[intelKey('org', 'BLKSYN')]).toBeUndefined();
  });
  it('worst org tag, player tag wins, hidden counted', () => {
    const orgs = [
      { sid: 'TEST', name: 'Test', main: true, redacted: false },
      { sid: 'BLKSYN', name: 'The Black Syndicate', main: false, redacted: false },
      { sid: '', name: 'Redacted', main: false, redacted: true },
    ];
    const t = threatOf('Someone', orgs, intel);
    expect(t.tag).toBe('hostile');
    expect(t.hidden).toBe(1);
    expect(t.reasons[0]!.text).toBe('Hostile: affiliate of The Black Syndicate [BLKSYN] (Pirates at Pyro)');
    const mine = setTag(intel, { kind: 'player', id: 'Someone', tag: 'friendly' }, 3);
    expect(threatOf('someone', orgs, mine).tag).toBe('friendly');
    expect(threatOf('x', [], intel).tag).toBeNull();
  });
  it('filter by text in notes / labels', () => {
    const l = setTag(intel, { kind: 'player', id: 'Bob', tag: 'caution', labels: ['griefer', ' '] }, 5);
    expect(filterIntel(l, { q: 'griefer' }).map((e) => e.id)).toEqual(['Bob']);
    expect(filterIntel(l, { kind: 'org', tags: ['hostile'] }).map((e) => e.id)).toEqual(['BLKSYN']);
  });
  it('export → import: adds, keeps yours unless overwrite, rejects junk', () => {
    const file = exportIntel(Object.values(intel), 10);
    const mine = setTag({}, { kind: 'org', id: 'BLKSYN', tag: 'neutral' }, 1);
    const keep = importIntel(mine, file, { overwrite: false, source: 'file.json', now: 20 });
    expect([keep.added, keep.updated, keep.skipped]).toEqual([1, 0, 1]);
    expect(keep.intel[intelKey('org', 'BLKSYN')]!.tag).toBe('neutral');
    expect(keep.intel[intelKey('org', 'TEST')]!.source).toBe('file.json');
    const over = importIntel(mine, file, { overwrite: true, source: 'f', now: 20 });
    expect(over.intel[intelKey('org', 'BLKSYN')]!.tag).toBe('hostile');
    expect(() => importIntel({}, '{"format":"x"}', { overwrite: false, source: '', now: 1 })).toThrow('Not an RSI+ intel export');
  });
});

describe('lookup input and cache', () => {
  it('parses handles, SIDs and URLs', () => {
    expect(parseLookup('https://robertsspaceindustries.com/en/orgs/BLKSYN/members')).toEqual({ kind: 'org', id: 'BLKSYN' });
    expect(parseLookup('robertsspaceindustries.com/citizens/Stamp-CIG')).toEqual({ kind: 'player', id: 'Stamp-CIG' });
    expect(parseLookup('@Stamp-CIG')).toEqual({ kind: 'player', id: 'Stamp-CIG' });
    expect(parseLookup('[BLKSYN]')).toEqual({ kind: 'org', id: 'BLKSYN' });
    expect(parseLookup('Stamp-CIG')).toEqual({ kind: null, id: 'Stamp-CIG' });
    expect(parseLookup('two words').id).toBe('');
  });
  it('recent list is deduped, newest first', () => {
    let c = touchRecent(NO_INTEL_CACHE, 'org:A');
    c = touchRecent(c, 'player:b');
    c = touchRecent(c, 'org:A');
    expect(c.recent).toEqual(['org:A', 'player:b']);
  });
});
