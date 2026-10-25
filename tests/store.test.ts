import { describe, expect, it } from 'vitest';
import { isLimitedSku, isLowStock, isWarbondSku, matchShip, paintKey, priceLabel, shipKey, usd, type CatalogShip } from '@/lib/store';

const ship = (id: number, name: string): CatalogShip => ({ id, name, manufacturer: '', focus: '', msrp: 1000, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });

describe('store helpers', () => {
  it('shipKey drops edition words and punctuation, same result when memoized', () => {
    expect(shipKey('Cutlass Black - Warbond Edition LTI')).toBe('cutlass black');
    expect(shipKey('F7C-M Super Hornet Mk II')).toBe('f7c m super hornet mk ii');
    expect(shipKey('Cutlass Black - Warbond Edition LTI')).toBe('cutlass black');
  });

  it('SKU kinds', () => {
    expect(isWarbondSku({ title: 'Warbond Edition' })).toBe(true);
    expect(isWarbondSku({ title: 'Standard Edition' })).toBe(false);
    expect(isLimitedSku({ title: 'Limited Edition' })).toBe(true);
    expect(isLimitedSku({ title: 'Standard Edition' })).toBe(false);
  });

  it('usd and priceLabel', () => {
    expect(usd(4500)).toBe('$45');
    expect(usd(4550)).toBe('$45.50');
    expect(usd(123456700)).toBe('$1,234,567');
    expect(priceLabel(4000, 5000)).toBe('$40 (was $50)');
    expect(priceLabel(5000, 5000)).toBe('$50');
  });

  it('isLowStock', () => {
    expect(isLowStock({ available: true, stockLevel: 'low' })).toBe(true);
    expect(isLowStock({ available: true, stockLevel: 'high' })).toBe(false);
    expect(isLowStock({ available: true })).toBe(false);
    expect(isLowStock({ available: false, stockLevel: 'low' })).toBe(false);
  });

  it('paintKey: same key for hangar / store spellings, memo returns the same value', () => {
    const titles = ['Drake Dragonfly - Coalfire Paint', 'Dragonfly - Coalfire Paint', "Cutlass: Mercy's Livery", 'Cutlass — Mercys Skin'];
    const first = titles.map(paintKey);
    expect(first[0]).toBe('dragonfly coalfire');
    expect(first[1]).toBe(first[0]);
    expect(first[2]).toBe('cutlass mercys');
    expect(first[3]).toBe(first[2]);
    expect(titles.map(paintKey)).toEqual(first);
    // past the memo bound it still answers correctly
    for (let i = 0; i < 5100; i++) paintKey(`Hull ${i} - Paint`);
    expect(paintKey('Dragonfly - Coalfire Paint')).toBe('dragonfly coalfire');
  });

  it('matchShip vocab fallback (memoized per catalog) drops words no catalog name uses', () => {
    const cat = [ship(1, 'C2 Hercules'), ship(2, 'M2 Hercules'), ship(3, 'L-21 Wolf'), ship(4, 'L-22 Alpha Wolf')];
    expect(matchShip('Hercules Starlifter C2', cat)?.id).toBe(1);
    expect(matchShip('Hercules Starlifter M2', cat)?.id).toBe(2);
    expect(matchShip('Wolf', cat)?.id).toBe(3);
    // a new catalog array gets its own vocabulary
    const other = [ship(9, 'Starlifter C2')];
    expect(matchShip('Hercules Starlifter C2', other)?.id).toBe(9);
    expect(matchShip('Zeus', cat)).toBeNull();
  });
});
