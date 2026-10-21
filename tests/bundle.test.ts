import { describe, expect, it } from 'vitest';
import { bundleValue, contentKey, hasContents, insuranceOf, insuranceTag, isBundle, isExtra, priceIndex } from '@/lib/bundle';
import type { CatalogShip, StoreItem } from '@/lib/store';

const item = (o: Partial<StoreItem> & { id: number; name: string }): StoreItem => ({
  url: 'https://robertsspaceindustries.com/pledge/x',
  price: 1000,
  discounted: 1000,
  available: true,
  thumb: null,
  category: 'gear',
  subtitle: 'Gear',
  vip: false,
  warbond: false,
  ...o,
});
const ship = (id: number, name: string, msrp: number): CatalogShip => ({ id, name, manufacturer: '', focus: '', msrp, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
const c = (...names: string[]) => names.map((name) => ({ name }));

const SHIPS = [ship(1, 'ATLS', 4000), ship(2, 'ATLS GEO', 5000), ship(3, 'Aurora MR', 3000)];
const STORE: StoreItem[] = [
  item({ id: 10, name: 'MaxLift ‘Keystone’ Tractor Beam', price: 500, discounted: 500, contents: c("Greycat MaxLift 'Keystone' Tractor Beam") }),
  item({ id: 11, name: 'Monde ‘Keystone’ Armor Set', price: 1500, discounted: 1500, contents: c('Monde Helmet Keystone', 'Monde Core Keystone', 'Monde Arms Keystone', 'Monde Legs Keystone') }),
  item({ id: 12, name: 'Avenger - Ironweave Paint', category: 'paints', price: 300, discounted: 300, contents: c('Avenger - Ironweave Paint') }),
  item({ id: 13, name: 'Avenger - Shroud Paint', category: 'paints', price: 500, discounted: 500, contents: c('Avenger - Shroud Paint') }),
  item({ id: 14, name: 'Old copy without contents', price: 700, discounted: 700 }),
  item({ id: 15, name: 'Subscriber Tractor Beam', category: 'subscribers', price: 1, discounted: 1, contents: c("Greycat MaxLift 'Keystone' Tractor Beam") }),
  item({ id: 20, name: 'Keystone Gear Pack', price: 1700, discounted: 1700, contents: c('Monde Helmet Keystone', 'Monde Core Keystone', 'Monde Arms Keystone', 'Monde Legs Keystone', "Greycat MaxLift 'Keystone' Tractor Beam", 'Monde Backpack Keystone') }),
  item({ id: 21, name: 'ATLS Duo Pack', category: 'packs', price: 7500, discounted: 7500, contents: [{ name: 'ATLS', ship: true }, { name: 'ATLS GEO', ship: true }, { name: '24 Month Insurance' }] }),
  item({ id: 22, name: 'Avenger Paint Pack', category: 'paints', price: 1000, discounted: 600, contents: c('Avenger - Ironweave Paint', 'Avenger - Shroud Paint') }),
  item({ id: 23, name: 'Kruger Ballistic Weapons Kit', category: 'addons', price: 1250, discounted: 1250, contents: c('Relentless L-21 Gatling', 'Relentless L-21 Gatling') }),
  item({ id: 24, name: 'Relentless L-21 Gatling', category: 'addons', price: 700, discounted: 700, contents: c('Relentless L-21 Gatling') }),
  item({ id: 25, name: 'Aurora MR', category: 'ships', price: 3000, discounted: 3000, contents: [{ name: 'Aurora MR', ship: true }, { name: '6 Month Insurance' }, { name: 'Self-Land Hangar' }] }),
  item({ id: 26, name: 'Keystone Gear Pack - Twin', price: 1800, discounted: 1800, contents: c('Monde Helmet Keystone', 'Monde Core Keystone', 'Monde Arms Keystone', 'Monde Legs Keystone', "Greycat MaxLift 'Keystone' Tractor Beam", 'Monde Backpack Keystone') }),
  item({ id: 27, name: 'First Flight Pack', category: 'packages', price: 4500, discounted: 4500, contents: [{ name: 'Star Citizen Digital Download' }, { name: 'Aurora MR', ship: true }, { name: '10,000 UEC' }, { name: '6 Month Insurance' }] }),
];
const idx = priceIndex(STORE, SHIPS);
const by = (id: number) => STORE.find((i) => i.id === id)!;

describe('contentKey / isExtra', () => {
  it('ignores quote styles and separators', () => {
    expect(contentKey('Greycat Aril ‘Hazard’ Core')).toBe(contentKey("Greycat Aril 'Hazard' Core"));
    expect(contentKey('890 Jump - Penumbra Paint')).toBe('890 jump penumbra paint');
  });
  it('insurance, hangars, the download and UEC are extras', () => {
    for (const n of ['6 Month Insurance', 'Lifetime Insurance', 'Self-Land Hangar', 'Revel & York Hangar', 'Star Citizen Digital Download', '10,000 UEC']) expect(isExtra(n), n).toBe(true);
    expect(isExtra('Monde Helmet Keystone')).toBe(false);
  });
  it('insurance is a tag, not an item', () => {
    expect(insuranceTag('Lifetime Insurance')).toBe('LTI');
    expect(insuranceTag('6 Month Insurance')).toBe('6 mo');
    expect(insuranceTag('120 Month Insurance')).toBe('120 mo');
    expect(insuranceTag('Self-Land Hangar')).toBeNull();
    expect(insuranceOf(by(21))).toBe('24 mo');
    expect(insuranceOf({ name: 'Aurora MR - LTI', contents: undefined })).toBe('LTI');
    expect(insuranceOf(by(10))).toBeNull();
  });
});

describe('isBundle / hasContents', () => {
  it('a standalone ship with insurance and a hangar is not a bundle, but can be opened (hull + hangar)', () => {
    expect(isBundle(by(25))).toBe(false);
    expect(hasContents(by(25))).toBe(true);
    expect(hasContents({ contents: [{ name: 'Aurora MR', ship: true }, { name: 'Lifetime Insurance' }] })).toBe(false);
    expect(isBundle(by(21))).toBe(true);
    expect(isBundle(by(10))).toBe(false);
    expect(hasContents(by(14))).toBe(false);
  });
});

describe('bundleValue', () => {
  it('null for single items and copies saved without contents', () => {
    expect(bundleValue(by(10), idx)).toBeNull();
    expect(bundleValue(by(14), idx)).toBeNull();
  });
  it('prices armor as the set the store sells, singles alone, and leaves the rest unpriced', () => {
    const v = bundleValue(by(20), idx)!;
    expect(v.parts.map((p) => [p.name, p.price, p.pieces?.length ?? p.count])).toEqual([
      ['Monde ‘Keystone’ Armor Set', 1500, 4],
      ["Greycat MaxLift 'Keystone' Tractor Beam", 500, 1],
      ['Monde Backpack Keystone', null, 1],
    ]);
    expect(v.total).toBe(6);
    expect(v.priced).toBe(5);
    expect(v.separate).toBe(2000);
    expect(v.savings).toBe(300);
    expect(v.pct).toBe(15);
  });
  it('never prices a bundle with itself or a same-size twin', () => {
    const v = bundleValue(by(26), idx)!;
    expect(v.parts.some((p) => /Gear Pack/.test(p.name))).toBe(false);
    expect(v.separate).toBe(2000);
  });
  it('ship packs: hulls by MSRP, insurance a tag and not a part', () => {
    const v = bundleValue(by(21), idx)!;
    expect(v.separate).toBe(9000);
    expect(v.savings).toBe(1500);
    expect(v.pct).toBe(17);
    expect(v.priced).toBe(2);
    expect(v.priceable).toBe(2);
    expect(v.total).toBe(2);
    expect(v.insurance).toBe('24 mo');
    expect(v.parts.some((p) => /insurance/i.test(p.name))).toBe(false);
  });
  it('game packages: the hull by MSRP, UEC at $1 per 1,000, download included, insurance tagged', () => {
    const v = bundleValue(by(27), idx)!;
    expect(v.insurance).toBe('6 mo');
    expect(v.parts.map((p) => [p.name, p.price])).toEqual([
      ['Star Citizen Digital Download', null],
      ['Aurora MR', 3000],
      ['10,000 UEC', 1000],
    ]);
    expect(v.separate).toBe(4000);
    expect(v.savings).toBe(-500);
  });
  it('compares against the price paid now (sale price)', () => {
    const v = bundleValue(by(22), idx)!;
    expect(v.separate).toBe(800);
    expect(v.savings).toBe(200);
  });
  it('counts duplicate pieces', () => {
    const v = bundleValue(by(23), idx)!;
    expect(v.parts).toHaveLength(1);
    expect(v.parts[0]!.count).toBe(2);
    expect(v.total).toBe(2);
    expect(v.separate).toBe(1400);
    expect(v.savings).toBe(150);
  });
  it('subscriber listings never price anything', () => {
    const v = bundleValue(by(20), idx)!;
    expect(v.parts.find((p) => /Tractor/.test(p.name))?.price).toBe(500);
  });
});
