import { describe, expect, it } from 'vitest';
import type { Pledge } from '@/lib/hangar';
import { paintCopiesNeeded, seriesOf, categorize, family, familyLabel, inventory, itemsCsv, ownedShipsWithPaints, paintGroups, paintStatus, shipsFor } from '@/lib/items';
import type { CatalogShip } from '@/lib/store';

const ship = (id: number, name: string): CatalogShip => ({ id, name, manufacturer: '', focus: '', msrp: id * 1000, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
const ships = [ship(1, 'Cutlass Black'), ship(2, 'Cutlass Red'), ship(3, 'Constellation Andromeda'), ship(4, 'F7C Hornet Mk II'), ship(5, 'Carrack'), ship(6, '100i'), ship(7, '125a')];

const pledge = (id: number, items: [string, string][], extra: Partial<Pledge> = {}): Pledge => ({
  id, name: `Pledge ${id}`, value: 10, date: '', type: 'ship', items: items.map(([title, kind]) => ({ title, kind })), ships: [], upgrade: null,
  lti: false, insurance: '', warbond: false, giftable: false, meltable: true, hasGame: false, upgraded: false, nickname: '', ...extra,
});

describe('items', () => {
  it('categorizes RSI kinds and titles', () => {
    expect(categorize('Cutlass Black', 'Ship')).toBe('ship');
    expect(categorize('Cutlass - Black and White Livery', 'Skin')).toBe('paint');
    expect(categorize('Carrack Paint - Ghoulish Green', '')).toBe('paint');
    expect(categorize('Pembroke Helmet Sunburst', 'FPS Equipment')).toBe('armor');
    expect(categorize('P4-AR Rifle', 'FPS Equipment')).toBe('weapon');
    expect(categorize('Star Citizen Digital Download', '')).toBe('game');
    expect(categorize('Lifetime Insurance', 'Insurance')).toBe('insurance');
    expect(categorize('Coffee Mug', 'Hangar decoration')).toBe('decoration');
  });

  it('ship families + paint fits', () => {
    expect(family('Cutlass Black')).toBe('cutlass');
    expect(family('F7C Hornet Mk II')).toBe('hornet');
    expect(shipsFor('Cutlass - Black and White Livery', ships).map((s) => s.id)).toEqual([1, 2]); // family paint
    expect(shipsFor('Cutlass Red Paint - Medivac', ships).map((s) => s.id)).toEqual([2]); // specific hull wins
    expect(shipsFor('Hornet Mk II Pyrotechnic Paint', ships).map((s) => s.id)).toEqual([4]);
    expect(shipsFor('Mystery Livery', ships)).toEqual([]);
    expect(shipsFor('100 Series - Frostbite Paint', ships).map((s) => s.id)).toEqual([6, 7]);
  });

  it('inventory merges items, links paints to owned ships, flags paints for ships you lack', () => {
    const rows = inventory(
      [
        pledge(1, [['Cutlass Black', 'Ship'], ['Lifetime Insurance', 'Insurance']], { lti: true }),
        pledge(2, [['Cutlass Black', 'Ship']]),
        pledge(3, [['Cutlass - Black and White Livery', 'Skin']], { giftable: true }),
        pledge(4, [['Carrack Paint - Ghoulish Green', 'Skin']]),
        pledge(5, [], { type: 'upgrade', name: 'Upgrade - A to B' }),
      ],
      ships,
    );
    const cut = rows.find((r) => r.title === 'Cutlass Black')!;
    expect(cut).toMatchObject({ count: 2, lti: true, category: 'ship' });
    expect(cut.ship?.id).toBe(1);
    expect(rows.some((r) => r.title.startsWith('Upgrade'))).toBe(false);

    const fleet = ownedShipsWithPaints(rows);
    expect(fleet.map((f) => [f.ship.name, f.count, f.paints.map((p) => p.title)])).toEqual([['Cutlass Black', 2, ['Cutlass - Black and White Livery']]]);

    const owned = new Set(fleet.map((f) => f.ship.id));
    const paint = (t: string) => rows.find((r) => r.title === t)!;
    expect(paintStatus(paint('Cutlass - Black and White Livery'), owned)).toBe('owned-ship');
    expect(paintStatus(paint('Carrack Paint - Ghoulish Green'), owned)).toBe('no-ship');
    expect(paint('Cutlass - Black and White Livery').giftable).toBe(true);
  });

  it('paint with no ship in its name fits the ships packed with it', () => {
    const rows = inventory([pledge(1, [['Carrack', 'Ship'], ['Ghoulish Green Paint', 'Skin']]), pledge(2, [['Mystery Livery', 'Skin']])], ships);
    const g = rows.find((r) => r.title === 'Ghoulish Green Paint')!;
    expect(g.fits.map((s) => s.id)).toEqual([5]);
    expect(g.fitsVia).toBe('pledge');
    expect(rows.find((r) => r.title === 'Mystery Livery')!.fitsVia).toBeNull();
  });

  it('paint groups: per family with owned hulls, unknown last, optional empty families', () => {
    const rows = inventory(
      [
        pledge(1, [['Cutlass Black', 'Ship'], ['F7C Hornet Mk II', 'Ship']]),
        pledge(2, [['Cutlass - Black and White Livery', 'Skin'], ['Carrack Paint - Ghoulish Green', 'Skin'], ['Mystery Livery', 'Skin']]),
      ],
      ships,
    );
    const fleet = ownedShipsWithPaints(rows);
    const gs = paintGroups(rows, fleet);
    expect(gs.map((g) => [g.label, g.owned.map((o) => o.ship.name), g.paints.length])).toEqual([
      ['Carrack', [], 1],
      ['Cutlass', ['Cutlass Black'], 1],
      ['Unknown ship', [], 1],
    ]);
    expect(paintGroups(rows, fleet, true).map((g) => g.label)).toContain('Hornet');
    expect(familyLabel('hornet', ships)).toBe('Hornet');
    expect(itemsCsv(rows).split('\n')[0]).toBe('item,category,qty,ship,fits_via,giftable,pledge_ids,pledges');
  });

  it('series: known events + shared name prefixes (RSI Disc., AA)', () => {
    const rows = inventory(
      [
        pledge(1, [['RSI Disc. Helmet', 'FPS Equipment'], ['RSI Disc. Arms', 'FPS Equipment'], ['AA Core', 'FPS Equipment'], ['AA Legs', 'FPS Equipment']]),
        pledge(2, [['Luminalia Gift Box', 'Hangar decoration'], ['RSI Mug', 'Hangar decoration'], ['RSI Poster', 'Hangar decoration']]),
        pledge(3, [['Cutlass - Frost Livery', 'Skin'], ['Carrack', 'Ship']], { name: 'Luminalia 2955 Pack' }),
      ],
      ships,
    );
    const s = seriesOf(rows);
    const of = (t: string) => s.get(rows.find((r) => r.title === t)!.key);
    expect(of('RSI Disc. Helmet')).toBe('RSI Disc.');
    expect(of('AA Legs')).toBe('AA');
    expect(of('Luminalia Gift Box')).toBe('Luminalia');
    expect(of('Cutlass - Frost Livery')).toBe('Luminalia'); // from pledge name
    expect(of('RSI Mug')).toBeUndefined(); // lone "RSI" isn't a series
    expect(of('Carrack')).toBeUndefined();
  });

  it('paint copies needed = owned hulls the paint fits', () => {
    const rows = inventory(
      [pledge(1, [['Cutlass Black', 'Ship']]), pledge(2, [['Cutlass Black', 'Ship']]), pledge(3, [['Cutlass Red', 'Ship']]), pledge(4, [['Cutlass - Frost Livery', 'Skin']]), pledge(5, [['Carrack Paint - Ghoulish Green', 'Skin']])],
      ships,
    );
    const need = paintCopiesNeeded(rows, ownedShipsWithPaints(rows));
    expect(need.get('cutlass - frost livery')).toBe(3); // 2 Blacks + 1 Red
    expect(need.has('carrack paint - ghoulish green')).toBe(false); // no hull → default 1
  });
});
