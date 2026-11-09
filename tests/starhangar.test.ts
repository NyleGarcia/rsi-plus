// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { insCode, parseCard, strictShip, toListing } from '@/lib/starhangar';
import { parseSku, priceCtx, rowOf, type OwnCtx } from '@/lib/impound';
import type { CatalogShip } from '@/lib/store';

const ship = (id: number, name: string, msrp: number, manufacturer = ''): CatalogShip => ({ id, name, manufacturer, focus: '', msrp, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
const SHIPS = [ship(178, 'Corsair', 25000, 'Drake Interplanetary'), ship(93, 'Glaive', 35000), ship(285, 'F7C-S Hornet Ghost Mk II', 10000), ship(274, 'Ironclad', 45000), ship(13, 'F7C-S Hornet Ghost Mk I', 9000)];

/** A card as Star Hangar renders it (trimmed, 2026-11). */
const card = (title: string, price: number, attrs: string[], id = '1') => {
  document.body.innerHTML = `<li class="item product product-item"><div class="product-item-info" id="product-item-info_${id}"><div class="product-details-wrapper"><div class="seller-details"><span class="seller-name"><a href="#">stratosamu</a></span></div><strong class="product-item-name"><a class="product-item-link" href="https://star-hangar.com/42562-1.html"> ${title} </a></strong><div class="attributes-info"><span class="attributes-list">${attrs.map((a) => `<div class="attribute-item"><span class="attribute-value">${a}</span></div>`).join('')}</span></div></div><div class="price-box" data-product-id="${id}"><span data-price-amount="${price}" data-price-type="finalPrice" class="price-wrapper"><span class="price">$${price}</span></span></div></div></li>`;
  return parseCard(document.querySelector('.product-item-info')!)!;
};

describe('Star Hangar cards', () => {
  it('reads title, price, attributes, seller', () => {
    expect(card('Corsair - LTI', 189.95, ['Single item', 'LTI', "CCU'ed Product"], '7')).toEqual({ id: '7', title: 'Corsair - LTI', url: 'https://star-hangar.com/42562-1.html', price: 18995, attrs: ['Single item', 'LTI', "CCU'ed Product"], seller: 'stratosamu' });
  });
  it('ships strictly: a plushie is not the ship', () => {
    expect(strictShip('Corsair - LTI', SHIPS)?.id).toBe(178);
    expect(strictShip('Drake Corsair Standalone Ship', SHIPS)?.id).toBe(178);
    expect(strictShip('Corsair Plushie', SHIPS)).toBeNull();
  });
  it('insurance codes', () => {
    expect(insCode(['Single item', 'LTI'])).toBe('L');
    expect(insCode(['Upgrade', '10y ins.'])).toBe('120M');
    expect(insCode(['Single item', 'no ins.'])).toBe('0M');
  });
  it('listings get Impound-style SKUs', () => {
    expect(toListing(card('Corsair - LTI', 189.95, ['Single item', 'LTI']), SHIPS).variants[0]!.sku).toBe('0-178.L.S');
    expect(toListing(card('F7C-S Hornet Ghost Mk II to Ironclad - Warbond Upgrade', 492.27, ['Upgrade', '10y ins.', 'Hornet Ghost, F7C-S MK2', 'Ironclad Base']), SHIPS).variants[0]!.sku).toBe('285-274.0M.N');
    expect(parseSku(toListing(card('Corsair Plushie', 5, ['Single item', 'no ins.']), SHIPS).variants[0]!.sku).kind).toBe('other');
    const paint = toListing(card('Paints - 400i - Meridian Paint', 50, ['Add-On', 'no ins.']), SHIPS);
    expect([paint.title, paint.type]).toEqual(['400i - Meridian Paint', 'Paint']);
  });
  it('priced and owned like The Impound', () => {
    const own: OwnCtx = { hulls: new Map(), ccus: [], titles: { exact: new Map(), cut: new Map() } };
    const r = rowOf(toListing(card('Corsair to Glaive', 199.99, ['Upgrade', 'no ins.', 'Corsair', 'Glaive']), SHIPS), priceCtx(SHIPS, []), own)!;
    expect(r.rsi.cents).toBe(10000);
    expect(r.markup).toEqual({ cents: 9999, pct: 0.9999 });
    expect(r.product.tags).toContain('stratosamu');
  });
});
