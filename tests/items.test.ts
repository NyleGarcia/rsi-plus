import { describe, expect, it } from 'vitest';
import type { Pledge } from '@/lib/hangar';
import { paintCopiesNeeded, seriesOf, categorize, family, familyLabel, fitsLabel, line, lineCounts, inventory, itemsCsv, ownedShipsWithPaints, paintGroups, paintStatus, shipGroups, shipsFor, upgradedFrom } from '@/lib/items';
import { matchShip, type CatalogShip } from '@/lib/store';

const ship = (id: number, name: string): CatalogShip => ({ id, name, manufacturer: '', focus: '', msrp: id * 1000, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
const ships = [ship(1, 'Cutlass Black'), ship(2, 'Cutlass Red'), ship(3, 'Constellation Andromeda'), ship(4, 'F7C Hornet Mk II'), ship(5, 'Carrack'), ship(6, '100i'), ship(7, '125a')];

const pledge = (id: number, items: [string, string][], extra: Partial<Pledge> = {}): Pledge => ({
  id, name: `Pledge ${id}`, value: 10, date: '', type: 'ship', items: items.map(([title, kind]) => ({ title, kind })), ships: [], upgrade: null,
  lti: false, insurance: '', warbond: false, giftable: false, meltable: true, hasGame: false, upgraded: false, nickname: '', ...extra,
});

describe('items', () => {
  it('fitsLabel: whole line → "All …", else names; lineCounts cached per catalog', () => {
    const row = (fits: CatalogShip[], s: CatalogShip | null = null) => ({ ...inventory([pledge(1, [['X Paint', 'Skin']])], [])[0]!, fits, ship: s });
    expect(lineCounts(ships).get('cutlass')).toBe(2);
    expect(lineCounts(ships)).toBe(lineCounts(ships));
    expect(fitsLabel(row([]), ships)).toBe('');
    expect(fitsLabel(row([ships[0]!]), ships)).toBe('Cutlass Black');
    expect(fitsLabel(row([ships[0]!, ships[1]!]), ships)).toBe('All Cutlass');
    expect(fitsLabel(row([ships[0]!, ships[4]!]), ships)).toBe('Cutlass Black · Carrack');
    expect(fitsLabel(row([], ships[4]!), ships)).toBe('Carrack');
  });

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
    // one group per model line, like the store's "100 series - Flame Paint"
    expect(family('100i')).toBe('100 series');
    expect(family('125a')).toBe('100 series');
    expect(family('325a')).toBe('300 series');
    expect(family('MTC')).toBe('m-series');
    expect(family('MDC')).toBe('m-series');
    // the mark splits a line: Mk IV Connie paints don't fit the Mk V
    expect(line('Constellation Mk IV Aquila')).toBe('constellation mk iv');
    expect(line('Constellation Mk V Centaurus')).toBe('constellation mk v');
    expect(line('Constellation Andromeda')).toBe('constellation');
    expect(line('Cutlass Red')).toBe('cutlass');
    expect(familyLabel('constellation mk iv', [ship(1, 'Constellation Mk IV Aquila')])).toBe('Constellation Mk IV');
    expect(familyLabel('cutlass', ships)).toBe('Cutlass');
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
        pledge(3, [['Cutlass - Black and White Livery', 'Skin']], { giftable: true, items: [{ title: 'Cutlass - Black and White Livery', kind: 'Skin', image: 'https://media.robertsspaceindustries.com/x/thumb.jpg' }] }),
        pledge(4, [['Carrack Paint - Ghoulish Green', 'Skin']], { image: 'https://media.robertsspaceindustries.com/p4/pledge_small.jpg' }),
        pledge(5, [], { type: 'upgrade', name: 'Upgrade - A to B' }),
      ],
      ships,
    );
    const cut = rows.find((r) => r.title === 'Cutlass Black')!;
    expect(cut).toMatchObject({ count: 2, lti: true, category: 'ship' });
    expect(cut.ship?.id).toBe(1);
    expect(rows.find((r) => r.title === 'Cutlass - Black and White Livery')?.image).toBe('https://media.robertsspaceindustries.com/x/thumb.jpg');
    expect(cut.image).toBeNull();
    // one-paint pledge: the pledge's own picture is the paint's
    expect(rows.find((r) => r.title === 'Carrack Paint - Ghoulish Green')?.image).toBe('https://media.robertsspaceindustries.com/p4/pledge_small.jpg');
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
    expect(paintGroups(rows, fleet, true).map((g) => g.label)).toContain('Hornet Mk II');
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

  it('in-game ships (aUEC / earned) count as hulls: paints attach, no-ship turns owned, keep-counts grow', () => {
    const rows = inventory([pledge(1, [['Cutlass Black', 'Ship']]), pledge(2, [['Carrack Paint - Ghoulish Green', 'Skin'], ['Cutlass - Frost Livery', 'Skin']])], ships);
    const game = [
      { id: 5, name: 'Carrack', how: 'bought' as const, count: 1 },
      { id: 1, name: 'Cutlass Black', how: 'earned' as const, count: 1 },
      { id: 99, name: 'Gone ship', how: 'bought' as const, count: 1 }, // not in the catalog → skipped
      { id: 6, name: '100i', how: 'earned' as const, count: 0 }, // empty line → skipped
    ];
    const fleet = ownedShipsWithPaints(rows, game, ships);
    expect(fleet.map((f) => [f.ship.name, f.count, f.game, f.gameHow, f.paints.map((p) => p.title)])).toEqual([
      ['Carrack', 1, 1, ['bought'], ['Carrack Paint - Ghoulish Green']],
      ['Cutlass Black', 2, 1, ['earned'], ['Cutlass - Frost Livery']],
    ]);
    const owned = new Set(fleet.map((f) => f.ship.id));
    expect(paintStatus(rows.find((r) => r.title === 'Carrack Paint - Ghoulish Green')!, owned)).toBe('owned-ship');
    expect(paintCopiesNeeded(rows, fleet).get('cutlass - frost livery')).toBe(2);
    // without the catalog, only hulls already in a pledge pick up in-game copies
    expect(ownedShipsWithPaints(rows, game).map((f) => [f.ship.name, f.count])).toEqual([['Cutlass Black', 2]]);
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

  it('shipGroups: hull, fitting paints, CCUs to it; family paints under every hull; the rest last', () => {
    const list = [
      pledge(1, [['Cutlass Black', 'Ship'], ['Lifetime Insurance', 'Insurance']], { lti: true }),
      pledge(2, [['Cutlass - Frost Livery', 'Skin']], { type: 'paint' }),
      pledge(3, [], { type: 'upgrade', upgrade: { fromName: 'Cutlass Black', toName: 'Carrack' } as Pledge['upgrade'] }),
      pledge(4, [['Pembroke Helmet Sunburst', 'FPS Equipment']], { type: 'gear' }),
      pledge(5, [['Cutlass Black', 'Ship'], ['Cutlass - Frost Livery', 'Skin']]),
    ];
    const g = shipGroups(list, ships);
    expect(g.map((x) => [x.key, x.owned, x.pledges.map((p) => p.id)])).toEqual([
      ['s:1', true, [1, 5, 2]], // hulls first, then the paint pledge
      ['s:5', false, [3]], // Carrack: only a CCU to it
      ['s:2', false, [2, 5]], // Cutlass Red: the family paint (pack 5 counts as a paint here, its hull is a Black)
      ['~', false, [4]],
    ]);
    expect(g[0]!.hulls).toBe(2);
    expect(g[0]!.role.get(2)).toBe('paint');
    expect(g[1]!.role.get(3)).toBe('ccu');
    expect(g[2]!.role.get(5)).toBe('paint');
  });

  it('shipGroups: a hangar ship the catalog does not list is still an owned ship (Odin), not "not related"', () => {
    const list = [pledge(1, [['Odin', 'Ship'], ['Odin - Blockade Paint', 'Skin']], { lti: true }), pledge(2, [['Pembroke Helmet Sunburst', 'FPS Equipment']], { type: 'gear' })];
    const g = shipGroups(list, ships);
    expect(g.map((x) => [x.key.split(':')[0], x.label, x.owned, x.hulls, x.pledges.map((p) => p.id)])).toEqual([
      ['n', 'Odin', true, 1, [1]],
      ['~', 'Not related to a ship', false, 0, [2]],
    ]);
  });

  it('Greycat M-series: MXC paints fit the MTC and MDC; a many-ship pack does not say which hull a nameless paint fits', () => {
    const cat = [ship(1, 'MTC'), ship(2, 'MDC'), ship(3, 'Spartan'), ship(4, 'Orion'), ship(5, 'Galaxy')];
    expect(shipsFor('MXC - Icefront Camo Paint', cat).map((s) => s.id)).toEqual([1, 2]);
    const rows = inventory([pledge(1, [['Spartan', 'Ship'], ['Orion', 'Ship'], ['Galaxy', 'Ship'], ['Mystery Camo Paint', 'Skin']]), pledge(2, [['Orion', 'Ship'], ['Nameless Paint', 'Skin']])], cat);
    expect(rows.find((r) => r.title === 'Mystery Camo Paint')?.fits).toEqual([]);
    expect(rows.find((r) => r.title === 'Nameless Paint')?.fits.map((s) => s.id)).toEqual([4]);
  });

  it('family with the catalog: Alpha Wolf is a Wolf, Super Hornet a Hornet; Mk II paints skip Mk I hulls; F7A falls back to the F7C', () => {
    const cat = [
      ship(10, 'L-21 Wolf'), ship(11, 'L-22 Alpha Wolf'), ship(12, 'Mustang Alpha'), ship(13, 'Mustang Alpha Vindicator'),
      ship(14, 'F7C Hornet Mk I'), ship(15, 'F7C Hornet Mk II'), ship(16, 'F7C-M Super Hornet Mk II'), ship(17, 'F7C-R Hornet Tracker Mk II'),
      ship(18, 'Ballista'), ship(19, 'Anvil Ballista Snowblind'), ship(20, 'C8 Pisces'), ship(21, 'C8X Pisces Expedition'), ship(22, 'Constellation Andromeda'),
    ];
    expect(family('L-22 Alpha Wolf', cat)).toBe('wolf');
    expect(family('Mustang Alpha', cat)).toBe('mustang');
    expect(family('F7C-M Super Hornet Mk II', cat)).toBe('hornet');
    expect(family('Anvil Ballista Snowblind', cat)).toBe('ballista');
    expect(family('C8X Pisces Expedition', cat)).toBe('pisces');
    expect(family('Constellation Andromeda', cat)).toBe('constellation');
    expect(family('L-22 Alpha Wolf')).toBe('alpha'); // no catalog → first word, as before
    expect(shipsFor('Wolf - Rosso Paint', cat).map((s) => s.id)).toEqual([10, 11]);
    expect(shipsFor('Hornet Mk II - Tigerveil Paint', cat).map((s) => s.id)).toEqual([15, 16, 17]);
    expect(shipsFor('F7 Hornet Mk II - Ironscale Paint', cat).map((s) => s.id)).toEqual([15, 16, 17]);
    expect(matchShip('F7A Hornet Mk II', cat)?.id).toBe(15);
    expect(matchShip('F7A Hornet Mk I', cat)?.id).toBe(14);
    const herc = [ship(30, 'C2 Hercules'), ship(31, 'M2 Hercules'), ship(32, 'A2 Hercules'), ship(33, 'Carrack')];
    expect(matchShip('Hercules Starlifter C2', herc)?.id).toBe(30); // "Starlifter" is in no catalog name
    expect(matchShip('Hercules Starlifter A2', herc)?.id).toBe(32);
    expect(matchShip('C2 Hercules Starlifter', herc)?.id).toBe(30);
    expect(matchShip('Starlifter', herc)).toBeNull();
  });

  it('upgradedFrom: the original hull from the pledge name, the new one from the ship item', () => {
    const cat = [ship(40, 'S-65 Stingray'), ship(41, 'A2 Hercules'), ship(42, 'Aurora MR'), ship(43, 'Cutlass Black')];
    const up = pledge(1, [['Stingray - Marina Paint', 'Skin'], ['Lifetime Insurance', 'Insurance'], ['Hercules Starlifter A2', 'Ship'], ['Virgil Tailwind Helmet', 'FPS Equipment']], { name: 'S-65 Stingray plus Marina Paint', upgraded: true });
    expect(upgradedFrom(up, cat)).toEqual({ from: 'S-65 Stingray', to: 'A2 Hercules' });
    expect(upgradedFrom(pledge(2, [['Cutlass Black', 'Ship']], { name: 'Aurora MR Starter Package', upgraded: true }), cat)).toEqual({ from: 'Aurora MR', to: 'Cutlass Black' });
    expect(upgradedFrom(pledge(3, [['Cutlass Black', 'Ship']], { name: 'Cutlass Black', upgraded: true }), cat)).toBeNull(); // same hull
    expect(upgradedFrom(pledge(4, [['Cutlass Black', 'Ship']], { name: 'Aurora MR Starter Package' }), cat)).toBeNull(); // not flagged
  });
});
