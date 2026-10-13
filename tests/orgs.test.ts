import { describe, expect, it } from 'vitest';
import { groupByOrg, mainOrgFromBadges, parseCitizenOrgs } from '@/lib/orgs';

// Synthetic, trimmed copy of the RSI citizen organizations markup (structure as of 2026-10).
const block = (kind: string, vis: string, sid: string, name: string, rank: string, members: string) => `
<div class="box-content org ${kind} visibility-${vis}">
  <div class="inner-bg clearfix">
    <div class="thumb"><a href="/orgs/${sid}"><img src="x.png" /></a><span class="members">${members} members</span></div>
    <div class="info">
      <p class="entry"><a href="/orgs/${sid}" class="value data6">${name}</a></p>
      <p class="entry"><span class="label">Spectrum Identification (SID)</span><strong class="value">${sid}</strong></p>
      <p class="entry"><span class="label data11">Organization rank</span>
        <strong class="value data9">${rank}</strong></p>
    </div>
  </div>
</div>`;
const redacted = `
<div class="box-content org affiliation visibility-R">
  <div class="inner-bg clearfix"><div class="title">Affiliation</div><div class="member-visibility-restriction">REDACTED</div></div>
</div>`;
const html = `<div class="profile-content orgs-content clearfix">${block('main', 'V', 'ABC', 'Alpha &amp; Co', 'Colonel', '12')}${block(
  'affiliation ',
  'V',
  'TEST',
  'TEST Squadron',
  'Cadet',
  '24,590',
)}${redacted}</div>`;

describe('orgs', () => {
  it('parses main, affiliations and redacted entries', () => {
    expect(parseCitizenOrgs(html)).toEqual([
      { sid: 'ABC', name: 'Alpha & Co', rank: 'Colonel', main: true, members: 12, redacted: false },
      { sid: 'TEST', name: 'TEST Squadron', rank: 'Cadet', main: false, members: 24590, redacted: false },
      { sid: '', name: 'Redacted', rank: null, main: false, members: null, redacted: true },
    ]);
    expect(parseCitizenOrgs('<html>no orgs</html>')).toEqual([]);
  });

  it('main org from Spectrum badges', () => {
    const meta = { badges: [{ name: 'Veteran Backer', icon: 'x' }, { name: 'Asymmetric Logistics', url: 'https://robertsspaceindustries.com/orgs/aswf' }] };
    expect(mainOrgFromBadges({ meta })).toEqual({ sid: 'ASWF', name: 'Asymmetric Logistics' });
    expect(mainOrgFromBadges({ meta: { badges: [] } })).toBeNull();
  });

  it('groups by org, biggest first, unknown last', () => {
    const orgs: Record<string, { sid: string; name: string; redacted: boolean }[]> = {
      a: [{ sid: 'X', name: 'X', redacted: false }, { sid: 'Y', name: 'Y', redacted: false }],
      b: [{ sid: 'X', name: 'X', redacted: false }],
      c: [{ sid: '', name: 'Redacted', redacted: true }],
    };
    const g = groupByOrg(['a', 'b', 'c'], (k) => orgs[k]!);
    expect(g.map((x) => [x.sid, x.items])).toEqual([
      ['X', ['a', 'b']],
      ['Y', ['a']],
      ['', ['c']],
    ]);
  });
});

describe('orgs dedupe', () => {
  it('a member listing the same org twice appears once in that group', () => {
    const g = groupByOrg(['a'], () => [
      { sid: 'X', name: 'X', redacted: false },
      { sid: 'X', name: 'X', redacted: false },
      { sid: '', name: 'Redacted', redacted: true },
      { sid: '', name: 'Redacted', redacted: true },
    ]);
    expect(g).toEqual([{ sid: 'X', name: 'X', items: ['a'] }]);
  });
});
