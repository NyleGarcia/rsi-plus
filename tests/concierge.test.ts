// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseConciergePage, usdToNext } from '@/lib/concierge';

const PAGE = `
<div class="l-status__rank"><p id="js-status-level" class="h-text"> Praetorian </p></div>
<div class="l-status__date"><p id="js-status-date"> Since May 24, 2026 </p></div>
<div id="js-level-descriptions">
  <div data-badge="Praetorian" class="js-level-description js-current-description"><img data-badge="BADGE_PRAETORIAN"></div>
  <div data-badge="Wing Commander" class="js-level-description"></div>
  <div data-badge="Space Marshal" class="js-level-description"></div>
</div>
<section class="l-section__next-level"><header><span class="c-next-level__intro">until your <strong>next Chairman's Club </strong> Level &amp; Rewards:</span><h2 class="c-next-level__title"> Legatus Navium </h2></header></section>
<div id="progress-gauge" data-spend-until-next-rank="84"><h1 id="gauge-counter">84 </h1><span>%</span></div>
<section id="c-section--store">
  <div class="product-item small"><a href="https://robertsspaceindustries.com/pledge/Standalone-Ships/Constellation-Mk-V-Centaurus-Plus-Magnitude-Paint-Warbond"><img></a>
    <div class="info"><div class="title"> Constellation Mk V Centaurus plus Magnitude Paint<span> - Standalone Ships</span> </div>
    <div class="price"><strong class="final-price" data-value="27500" data-currency="USD">$275<span class="super">.00</span></strong></div>
    <span class="state"> In stock </span><a class="more" href="https://robertsspaceindustries.com/pledge/Standalone-Ships/Constellation-Mk-V-Centaurus-Plus-Magnitude-Paint-Warbond">more info</a>
    <a class="add-cart" href="#" data-sku="19640" data-name="Constellation Mk V Centaurus plus Magnitude Paint">Add to cart</a></div></div>
  <div class="product-item small"><div class="info"><div class="title"> Legatus 2953<span> - Package</span> </div>
    <div class="price"><strong class="final-price" data-value="4800000">$48,000</strong></div><span class="state"> Out of stock </span>
    <a class="more" href="/pledge/Packages/Legatus-2953">more info</a><a class="add-cart" href="#" data-sku="777" data-name="Legatus 2953">Add to cart</a></div></div>
</section>`;

describe('concierge page', () => {
  it('reads level, since, next level, gauge, earned levels and the exclusive store', () => {
    const c = parseConciergePage(new DOMParser().parseFromString(PAGE, 'text/html'), 5)!;
    expect(c.level).toBe('Praetorian');
    expect(c.since).toBe('May 24, 2026');
    expect(c.next).toBe('Legatus Navium');
    expect(c.pct).toBe(84);
    expect(c.earned).toEqual(['Praetorian', 'Wing Commander', 'Space Marshal']);
    expect(c.store).toEqual([
      { sku: 19640, name: 'Constellation Mk V Centaurus plus Magnitude Paint', category: 'Standalone Ships', url: 'https://robertsspaceindustries.com/pledge/Standalone-Ships/Constellation-Mk-V-Centaurus-Plus-Magnitude-Paint-Warbond', price: 27500, inStock: true },
      { sku: 777, name: 'Legatus 2953', category: 'Package', url: 'https://robertsspaceindustries.com/pledge/Packages/Legatus-2953', price: 4800000, inStock: false },
    ]);
    expect(usdToNext(c)).toBe(1600); // 16 % of the $10,000 between Praetorian and Legatus Navium
  });
  it('is null for accounts without a status block', () => {
    expect(parseConciergePage(new DOMParser().parseFromString('<p>Concierge</p>', 'text/html'))).toBeNull();
    expect(usdToNext({ level: 'Praetorian', next: null, pct: 84 })).toBeNull();
  });
});
