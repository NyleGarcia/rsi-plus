// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { hangarCsv, hangarUrl, parseBuybackPage, parseCredits, parseHangarPage, parseInsurance, parseMoney, stackPledges, totals, upgradeFromName, type Pledge } from '@/lib/hangar';

// Synthetic markup mirroring /account/pledges (structure per HangarXPLOR's parser).
const li = (id: number, name: string, value: string, items: [string, string, string?][], extra = '') => `
<li>
  <div class="image-col"><div class="image" style="background-image:url(https://media.robertsspaceindustries.com/p${id}/pledge_small.jpg)"></div></div>
  <input type="hidden" class="js-pledge-id" value="${id}">
  <input type="hidden" class="js-pledge-name" value="${name}">
  <input type="hidden" class="js-pledge-value" value="${value}">
  ${extra}
  <div class="wrapper-col">
    <div class="title-col"><h3>${name}</h3></div>
    <div class="date-col"><label>Created:</label> October 01, 2026</div>
  </div>
  <div class="items">
    ${items.map(([t, k, img]) => `<div class="item">${img ? `<div class="image" style="background-image:url('${img}');"></div>` : ''}<div class="title">${t}</div><div class="kind">${k}</div></div>`).join('')}
  </div>
</li>`;

const page = (body: string) => {
  document.body.innerHTML = `<div class="page-wrapper"><ul class="list-items">${body}</ul></div>`;
  return document;
};

describe('hangar parser', () => {
  it('parses ships, packages, upgrades and flags', () => {
    const doc = page(
      li(
        1,
        'Standalone Ships - Cutlass Black Warbond',
        '$110.00 USD',
        [['Cutlass Black', 'Ship', 'https://media.robertsspaceindustries.com/abc/product_thumb_medium_and_small.jpg'], ['Lifetime Insurance', 'Insurance']],
        '<a class="js-reclaim">x</a><span class="label">Gift</span><input type="hidden" class="js-pledge-currency" value="Store Credit"><input type="hidden" class="js-pledge-not-buybackable" value="0"><input type="hidden" class="js-pledge-configuration-value" value="$0.00 USD"><span class="availability  ">Attributed</span><script class="js-pledge-nameable-ships" type="application/json">["Cutlass Black"]</script><script class="js-pledge-name-reservations" type="application/json">[{"name":"Rusty"}]</script>',
      ) +
        li(2, 'Package - Mustang Alpha Starter Pack', '$1,045.00 USD', [['Mustang Alpha', 'Ship', 'https://media.robertsspaceindustries.com/same/thumb.jpg'], ['Star Citizen Digital Download', '', 'https://media.robertsspaceindustries.com/same/thumb.jpg']], '<input type="hidden" class="js-pledge-currency" value="USD"><input type="hidden" class="js-pledge-not-buybackable" value="1"><input type="hidden" class="js-pledge-configuration-value" value="$5.00 USD"><span class="availability  ">Pending</span><script class="js-pledge-nameable-ships" type="application/json">null</script>') +
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
    expect(p[1]).toMatchObject({ hasGame: true, lti: false, paidWith: 'cash', noBuyback: true, configValue: 5, availability: 'Pending' });
    expect(p[1]!.nameable).toBeUndefined();
    expect(p[0]).toMatchObject({ paidWith: 'credit', nameable: ['Cutlass Black'], reservedNames: ['Rusty'] });
    expect(p[0]!.noBuyback).toBeUndefined();
    expect(p[0]!.availability).toBeUndefined();
    expect(p[2]!.paidWith).toBeUndefined();
    // item thumbnails ride along (the only picture of a paint the store no longer sells); items without one carry no key
    expect(p[1]!.image).toBe('https://media.robertsspaceindustries.com/p2/pledge_small.jpg');
    // the same picture on every item is the pledge's art, not the items'
    expect(p[1]!.items.map((i) => i.image ?? null)).toEqual([null, null]);
    expect(p[0]!.items).toEqual([{ title: 'Cutlass Black', kind: 'Ship', image: 'https://media.robertsspaceindustries.com/abc/product_thumb_medium_and_small.jpg' }, { title: 'Lifetime Insurance', kind: 'Insurance' }]);
    expect(p[2]!.upgrade).toEqual({ fromId: 11, fromName: 'Aurora MR', toId: 42, toName: 'Cutlass Black' });
    expect(totals(p)).toMatchObject({ pledges: 3, value: 1240, ships: 2, upgrades: 1, lti: 1, giftable: 1 });
    expect(hangarCsv(p).split('\n')[1]).toBe('1,Cutlass Black Warbond,ship,110,"October 01, 2026",Cutlass Black,true,LTI,true,true,true,,,credit,,');
  });

  it('reads the name you gave each ship from inside its own item', () => {
    const named = (t: string, n: string) => `<div class="item"><div class="title">${t}</div><div class="kind">Ship</div><div class="custom-name"><span class="custom-name-text">${n}</span></div></div>`;
    const doc = page(
      li(4, 'Package - Exploration Pack', '$900.00 USD', []).replace(
        '<div class="items">',
        `<div class="items">${named('Perseus', 'Eldritch Singularity')}<div class="item"><div class="title">Polaris</div><div class="kind">Ship</div></div>${named('Polaris', 'Wayfinder')}`,
      ),
    );
    const [p] = parseHangarPage(doc);
    expect(p!.items).toEqual([
      { title: 'Perseus', kind: 'Ship', customName: 'Eldritch Singularity' },
      { title: 'Polaris', kind: 'Ship' },
      { title: 'Polaris', kind: 'Ship', customName: 'Wayfinder' },
    ]);
    expect(p!.nickname).toBe('Eldritch Singularity, Wayfinder');
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

describe('buyback detail page', () => {
  it('reads Also Contains items, ships, price / list price (cents), sku and tokens left (markup from a saved page, 2026-10-13)', async () => {
    const { parseBuybackDetail } = await import('@/lib/hangar');
    document.body.innerHTML = `
      <div class="wcontent"><h1>Paints - Meteor - 4 Paint Pack</h1>
        <div class="lcol"><div class="price price--has-promo"><strong class="final-price" data-value="2960" data-currency="USD">$29<span class="super">.60 <span class="currency">USD</span></span></strong><del class="original-price">$37<span class="super">.00 <span class="currency">USD</span></span></del><span class="discount">Save<strong>20%</strong></span></div>
          <a class="holosmallbtn add-cart js-buy-back" href="https://robertsspaceindustries.com/pledge" data-sku="18336"><span class="js-label">Add to cart</span></a>
          <p class="buy-back-warning"><span class="warn-icon"></span>You have <strong>2</strong> opportunity to buy back a pledge with store credits</p></div>
        <div class="rcol"><h2 class="buy-back-title">Paints - Meteor - 4 Paint Pack</h2>
          <div class="package-listing ship"><h4>ship in this pack:</h4><ul><div class="corner"></div></ul></div>
          <div class="package-listing item"><h4>Also Contains</h4><ul>
            <li class="trans-02s">Meteor - Disco Paint</li><li class="trans-02s">Meteor - Shimmer Paint</li><li class="trans-02s">Meteor - Bolide Paint</li><li class="trans-02s">Meteor - Skylark Paint</li>
            <div class="corner corner-top-left"></div><div class="clear"></div></ul></div></div></div>`;
    const d = parseBuybackDetail(document);
    expect(d.items.map((i) => [i.title, i.kind])).toEqual([['Meteor - Disco Paint', ''], ['Meteor - Shimmer Paint', ''], ['Meteor - Bolide Paint', ''], ['Meteor - Skylark Paint', '']]);
    expect([d.price, d.listPrice, d.sku, d.opportunities]).toEqual([2960, 3700, 18336, 2]);
    document.body.innerHTML = `<div class="package-listing ship"><ul><li>Aurora MR</li></ul></div><div class="package-listing item"><ul><li>Star Citizen Digital Download</li></ul></div><strong class="final-price" data-value="4500">$45</strong>`;
    const e = parseBuybackDetail(document);
    expect(e.items).toEqual([{ title: 'Aurora MR', kind: 'Ship' }, { title: 'Star Citizen Digital Download', kind: '' }]);
    expect([e.price, e.listPrice, e.sku]).toEqual([4500, null, null]);
    // Ship entries nest manufacturer / focus / a "ship page" link: keep the name only.
    document.body.innerHTML = `<div class="package-listing ship"><ul><li><span>ship:</span> Salvation <div>Manufacturer: Roberts Space Industries</div><div>Focus: Light Salvage</div><a href="/pledge/ships/salvation">ship page</a></li></ul></div>`;
    expect(parseBuybackDetail(document).items).toEqual([{ title: 'Salvation', kind: 'Ship' }]);
    document.body.innerHTML = `<div class="package-listing ship"><ul><li><h4 class="title">Carrack</h4><p>Manufacturer: Anvil</p></li></ul></div>`;
    expect(parseBuybackDetail(document).items).toEqual([{ title: 'Carrack', kind: 'Ship' }]);
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

  it('reads the "Also Contains" item list instead of the "5 items" summary (hangar-style .items and plain heading markup)', () => {
    document.body.innerHTML = `
      <article class="pledge"><div class="information"><h1>Paints - Meteor - 4 Paint Pack</h1>
        <dl><dt>Last Modified</dt><dd>October 14, 2026</dd><dt>Contained</dt><dd>4 items</dd></dl>
        <div class="items"><div class="item"><div class="title">Meteor - Disco Paint</div><div class="kind">Skin</div></div><div class="item"><div class="title">Meteor - Shimmer Paint</div><div class="kind">Skin</div></div></div></div>
        <a href="/pledge/buyback/700">Buy back</a></article>
      <article class="pledge"><div class="information"><h1>Paints - Perseus - 5 Paint Pack</h1>
        <dl><dt>Contained</dt><dd>5 items</dd></dl>
        <h3>Also Contains</h3><ul><li>Perseus - Hieron Paint</li><li>Perseus - Deadfire Paint</li></ul></div>
        <a href="/pledge/buyback/701">Buy back</a></article>
      <article class="pledge"><div class="information"><h1>Paints - Lone Paint</h1>
        <dl><dt>Contained</dt><dd>1 item</dd></dl></div>
        <a href="/pledge/buyback/702">Buy back</a></article>`;
    const b = parseBuybackPage(document);
    expect(b.map((x) => [x.id, x.contained, x.items?.map((i) => i.title) ?? null, x.type])).toEqual([
      [700, 'Meteor - Disco Paint, Meteor - Shimmer Paint', ['Meteor - Disco Paint', 'Meteor - Shimmer Paint'], 'paint'],
      [701, 'Perseus - Hieron Paint, Perseus - Deadfire Paint', ['Perseus - Hieron Paint', 'Perseus - Deadfire Paint'], 'paint'],
      [702, '1 item', null, 'paint'],
    ]);
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
    // melted since the load (still in the list): rows below move up, so #51 is now on page 1 and #120 still on 3
    expect(hangarUrl(all, 51, 'melt', new Set([2, 7]))).toContain('page=1&');
    expect(hangarUrl(all, 120, 'melt', new Set([2, 7]))).toContain('page=3&');
    expect(hangarUrl(all, 101, 'melt', new Set([2]))).toContain('page=2&');
    expect(hangarUrl(all, 1, 'melt', new Set([2]))).toContain('page=1&');
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
