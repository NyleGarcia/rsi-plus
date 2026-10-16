import { describe, expect, it } from 'vitest';
import { shipCode, shipLines, stripMaker, xplorCsv, xplorRows } from '@/lib/export';
import type { Pledge } from '@/lib/hangar';
import type { CatalogShip } from '@/lib/store';

const ship = (id: number, name: string, manufacturer: string): CatalogShip => ({ id, name, manufacturer, focus: '', msrp: 0, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
const ships = [ship(1, 'Avenger Titan', 'Aegis Dynamics'), ship(2, 'Constellation Mk IV Andromeda', 'Roberts Space Industries'), ship(3, 'Cutlass Black', 'Drake Interplanetary'), ship(4, 'L-21 Wolf', 'Kruger Intergalactic')];
const pledge = (id: number, shipsIn: string[], extra: Partial<Pledge> = {}): Pledge => ({
  id, name: `Pledge ${id}`, value: 45, date: 'October 01, 2026', type: 'ship', items: shipsIn.map((title) => ({ title, kind: 'Ship' })), ships: shipsIn, upgrade: null,
  lti: false, insurance: '', warbond: false, giftable: false, meltable: true, hasGame: false, upgraded: false, nickname: '', ...extra,
});

describe('fleet export (HangarXPLOR shape)', () => {
  it('writes one row per hull with the pledge fields HangarXPLOR writes', () => {
    const [row] = xplorRows([pledge(7, ['Aegis Avenger Titan'], { lti: true, nickname: 'Bessie', name: 'Avenger Titan - Warbond', warbond: true })], ships);
    expect(row).toEqual({
      ship_code: 'AEGS_Avenger_Titan', ship_name: 'Bessie', manufacturer_code: 'AEGS', manufacturer_name: 'Aegis Dynamics', name: 'Avenger Titan',
      lti: true, warbond: true, entity_type: 'ship', pledge_id: '7', pledge_name: 'Avenger Titan - Warbond', pledge_date: 'October 01, 2026', pledge_cost: '$45.00 USD',
    });
  });
  it('a pack lists each ship, a CCU none, sorted by maker then ship', () => {
    const rows = xplorRows([pledge(1, ['Cutlass Black', 'Avenger Titan']), pledge(2, [], { type: 'upgrade', upgrade: { fromId: 1, fromName: 'a', toId: 2, toName: 'b' } })], ships);
    expect(rows.map((r) => [r.name, r.pledge_id])).toEqual([['Avenger Titan', '1'], ['Cutlass Black', '1']]);
  });
  it('codes: table hit, Mk-less fallback, synthesized for unknown ships', () => {
    expect(shipCode('Constellation Mk IV Andromeda', 'Roberts Space Industries').ship_code).toBe('RSI_Constellation_Andromeda');
    expect(shipCode('L-21 Wolf', 'Kruger Intergalactic')).toEqual({ ship_code: 'KRIG_L_21_Wolf', manufacturer_code: 'KRIG', manufacturer_name: 'Kruger Intergalactic' });
    expect(shipCode('Brand New Ship', 'Mirai')).toMatchObject({ ship_code: 'MRAI_Brand_New_Ship', manufacturer_code: 'MRAI' });
    expect(shipCode('Mystery', 'Totally New Maker')).toMatchObject({ ship_code: 'TOTALLY_Mystery', manufacturer_code: 'TOTALLY' });
  });
  it('a hull the catalog does not know keeps its listed name, maker prefix stripped', () => {
    expect(stripMaker('RSI Aurora MR')).toBe('Aurora MR');
    expect(stripMaker("Xi'an Khartu-al")).toBe('Khartu-al');
    expect(stripMaker('Carrack')).toBe('Carrack');
    const [row] = xplorRows([pledge(3, ['Drake Unknown Hauler'])], ships);
    expect(row).toMatchObject({ name: 'Unknown Hauler', ship_name: 'Unknown Hauler', ship_code: 'Unknown_Hauler', manufacturer_code: '', manufacturer_name: '' });
  });
  it('CSV quotes text fields and doubles quotes; lines list maker + ship', () => {
    const rows = xplorRows([pledge(9, ['Cutlass Black'], { name: 'Cutlass "Pirate" Pack' })], ships);
    expect(xplorCsv(rows)).toBe('Manufacturer,Ship,Lti,Warbond,ID,Pledge,Cost,Date\n"Drake Interplanetary","Cutlass Black",false,false,9,"Cutlass ""Pirate"" Pack","$45.00 USD","October 01, 2026"\n');
    expect(shipLines(rows)).toBe('Drake Interplanetary Cutlass Black');
  });
});
