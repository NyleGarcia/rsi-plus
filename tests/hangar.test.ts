// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { hangarCsv, hangarUrl, parseBuybackPage, parseCredits, parseHangarPage, parseInsurance, parseMoney, stackPledges, totals, upgradeFromName, type Pledge } from '@/lib/hangar';

// Synthetic markup mirroring /account/pledges (structure per HangarXPLOR's parser).
const li = (id: number, name: string, value: string, items: [string, string][], extra = '') => `
<li>
  <input type="hidden" class="js-pledge-id" value="${id}">
  <input type="hidden" class="js-pledge-name" value="${name}">
  <input type="hidden" class="js-pledge-value" value="${value}">
  ${extra}
  <div class="wrapper-col">
    <div class="title-col"><h3>${name}</h3></div>
    <div class="date-col"><label>Created:</label> October 01, 2026</div>
  </div>
  <div class="items">
    ${items.map(([t, k]) => `<div class="item"><div class="title">${t}</div><div class="kind">${k}</div></div>`).join('')}
  </div>
</li>`;

const page = (body: string) => {
  document.body.innerHTML = `<div class="page-wrapper"><ul class="list-items">${body}</ul></div>`;
  return document;
};

describe('hangar parser', () => {
  it('parses ships, packages, upgrades and flags', () => {
    const doc = page(
      li(1, 'Standalone Ships - Cutlass Black Warbond', '$110.00 USD', [['Cutlass Black', 'Ship'], ['Lifetime Insurance', 'Insurance']], '<a class="js-reclaim">x</a><span class="label">Gift</span>') +
        li(2, 'Package - Mustang Alpha Starter Pack', '$1,045.00 USD', [['Mustang Alpha', 'Ship'], ['Star Citizen Digital Download', '']]) +
        li(
          3,
          'Ship Upgrades - Upgrade - Aurora MR to Cutlass Black',
          '$85.00 USD',
          [],
          `<input type="hidden" class="js-upgrade-data" value='{"match_items":[{"id":11,"name":"Aurora MR"}],"target_items":[{"id":42,"name":"Cutlass Black"}]}'>`,
        ),
    );
    const p = parseHangarPage(doc);
    expect(p.map((x) => [x.id, x.type, x.value])).toEqual([
      [1, 'ship', 110],
      [2, 'package', 1045],
      [3, 'upgrade', 85],
    ]);
    expect(p[0]).toMatchObject({ name: 'Cutlass Black Warbond', lti: true, warbond: true, giftable: true, meltable: true, ships: ['Cutlass Black'], date: 'October 01, 2026' });
    expect(p[1]).toMatchObject({ hasGame: true, lti: false });
    expect(p[2]!.upgrade).toEqual({ fromId: 11, fromName: 'Aurora MR', toId: 42, toName: 'Cutlass Black' });
    expect(totals(p)).toMatchObject({ pledges: 3, value: 1240, ships: 2, upgrades: 1, lti: 1, giftable: 1 });
    expect(hangarCsv(p).split('\n')[1]).toBe('1,Cutlass Black Warbond,ship,110,"October 01, 2026",Cutlass Black,true,LTI,true,true,true,,');
  });

  it('empty page', () => {
    expect(parseHangarPage(page('<li><div class="empty-list">No pledges</div></li>'))).toEqual([]);
  });

  it('helpers', () => {
    expect(parseMoney('$1,234.50 USD')).toBe(1234.5);
    expect(parseMoney('')).toBe(0);
    expect(upgradeFromName('Upgrade - Cutlass Black to Constellation Andromeda Warbond Edition')).toMatchObject({ fromName: 'Cutlass Black', toName: 'Constellation Andromeda' });
  });
});

describe('buyback parser (defensive)', () => {
  it('reads article.pledge blocks with data ids and dt/dd fields', () => {
    document.body.innerHTML = `
      <article class="pledge"><div class="information"><h1>Upgrade - Avenger Titan to Cutlass Black</h1>
        <dl><dt>Last Modified</dt><dd>September 1, 2026</dd><dt>Contained</dt><dd>Upgrade</dd></dl></div>
        <a class="holosmallbtn" href="/pledge/buyback/555" data-pledgeid="555" data-fromshipid="2" data-toshipid="3">Buy back</a></article>
      <article class="pledge"><div class="information"><h1>Package - Aurora Starter</h1>
        <dl><dt>Last Modified</dt><dd>August 1, 2026</dd><dt>Contained</dt><dd>Aurora MR, Star Citizen Digital Download</dd></dl></div>
        <a href="/pledge/buyback/556">Buy back</a></article>`;
    const b = parseBuybackPage(document);
    expect(b.map((x) => [x.id, x.type, x.date])).toEqual([
      [555, 'upgrade', 'September 1, 2026'],
      [556, 'package', 'August 1, 2026'],
    ]);
    expect(b[0]!.upgrade).toMatchObject({ fromId: 2, toId: 3, fromName: 'Avenger Titan', toName: 'Cutlass Black' });
    expect(b[1]!.url).toBe('https://robertsspaceindustries.com/pledge/buyback/556');
  });

  it('stacks identical pledges, keeps order, splits on value / LTI / contents', () => {
    const base: Pledge = { id: 1, name: 'Cutlass Black', value: 100, date: 'a', type: 'ship', items: [{ title: 'Cutlass Black', kind: 'Ship' }], ships: ['Cutlass Black'], upgrade: null, lti: false, insurance: '', warbond: false, giftable: true, meltable: true, hasGame: false, upgraded: false, nickname: '' };
    const list: Pledge[] = [
      base,
      { ...base, id: 2, date: 'b', giftable: false, nickname: 'Betty' }, // same stack: gift / nickname / date don't split
      { ...base, id: 3, lti: true }, // LTI → own stack
      { ...base, id: 4, value: 110 }, // value → own stack
      { ...base, id: 5, items: [...base.items, { title: 'Paint', kind: 'Skin' }] }, // contents → own stack
      { ...base, id: 6 },
    ];
    const st = stackPledges(list);
    expect(st.map((s) => s.entries.map((p) => p.id))).toEqual([[1, 2, 6], [3], [4], [5]]);
    expect(st[0]!.rep.id).toBe(1);
  });

  it('hangar link: recorded page, else position in the list; carries the pledge id', () => {
    const base: Pledge = { id: 0, name: 'x', value: 1, date: '', type: 'ship', items: [], ships: [], upgrade: null, lti: false, insurance: '', warbond: false, giftable: false, meltable: true, hasGame: false, upgraded: false, nickname: '' };
    const all = Array.from({ length: 120 }, (_, i) => ({ ...base, id: i + 1 }));
    expect(hangarUrl(all, 1)).toBe('https://robertsspaceindustries.com/account/pledges?page=1&pagesize=50&rsiplus=1');
    expect(hangarUrl(all, 51)).toContain('page=2&');
    expect(hangarUrl(all, 120)).toContain('page=3&');
    expect(hangarUrl([{ ...base, id: 7, page: 4 }], 7)).toContain('page=4&');
    expect(hangarUrl(all, 999)).toContain('page=1&');
    expect(hangarUrl(all, 3, 'melt')).toMatch(/&rsiplus=3&rsiplus_do=melt$/);
  });

  it('insurance + credits', () => {
    expect(parseInsurance('Cutlass Black | Lifetime Insurance')).toBe('LTI');
    expect(parseInsurance('Carrack | 120 Month Insurance')).toBe('120 mo');
    expect(parseInsurance('Aurora | 10 Year Insurance')).toBe('120 mo');
    expect(parseInsurance('6-Month Insurance | 72 month insurance')).toBe('72 mo');
    expect(parseInsurance('Cutlass Black')).toBe('');
    const doc = new DOMParser().parseFromString(
      '<html><body><div class="credits"><h3>CREDITS</h3><p>STORE CREDIT</p><strong>$812.17</strong> <span>USD</span><p>UEC</p><strong>¤45,000</strong> <span>UEC</span><p>REC</p><strong>¤1,440,000</strong> <span>REC</span></div><ul class="list-items"></ul></body></html>',
      'text/html',
    );
    expect(parseCredits(doc)).toEqual({ usd: 812.17, uec: 45000, rec: 1440000 });
    expect(parseCredits(new DOMParser().parseFromString('<html><body>Sign in</body></html>', 'text/html'))).toBeNull();
    // Split over elements, lower-case labels, no currency signs.
    const split = new DOMParser().parseFromString(
      '<html><body><dl><dt>Store credit</dt><dd><span>$</span><span>1,234</span><span>.</span><span>50</span> <em>USD</em></dd><dt>UEC</dt><dd><span>45</span><span>,000</span></dd><dt>REC</dt><dd>0</dd></dl></body></html>',
      'text/html',
    );
    expect(parseCredits(split)).toEqual({ usd: 1234.5, uec: 45000, rec: 0 });
    // Real /account/billing layout: amount before label.
    const billing = new DOMParser().parseFromString(
      '<html><body><p>…subscriptions and credits.</p><h2>CREDITS</h2><div class="credits"><a class="credit-log js-credit-log">Credit Log</a><div class="credit-line"><strong>$812.17</strong> <span>USD</span><em>STORE CREDITS</em></div></div><div class="credits"><a class="js-uec-log">UEC Log</a><div class="credit-line uec"><strong>¤45,000</strong> <span>UEC</span><em>United Earth Credits</em></div></div><div class="credits"><a class="js-rec-log">REC Log</a><div class="credit-line rec"><strong>¤1,440,000</strong> <span>REC</span><em>Rental Equipment Credits</em></div></div><h2>SUBSCRIPTIONS</h2></body></html>',
      'text/html',
    );
    expect(parseCredits(billing)).toEqual({ usd: 812.17, uec: 45000, rec: 1440000 });
  });
});
