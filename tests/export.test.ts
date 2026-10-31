import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pledgeHulls, shipCode, shipLines, starOrgRows, stripMaker, xplorCsv, xplorRows } from '@/lib/export';
import type { Pledge } from '@/lib/hangar';
import type { GameShip } from '@/lib/items';
import { withExtraShips, type CatalogShip } from '@/lib/store';

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
  it('a pack names only the ships you named, each with its own name', () => {
    const p = pledge(5, ['Cutlass Black', 'Avenger Titan'], {
      items: [{ title: 'Cutlass Black', kind: 'Ship', customName: 'Rusty' }, { title: 'Avenger Titan', kind: 'Ship' }],
      nickname: 'Rusty',
    });
    expect(xplorRows([p], ships).map((r) => [r.name, r.ship_name])).toEqual([['Avenger Titan', 'Avenger Titan'], ['Cutlass Black', 'Rusty']]);
  });
  it('a save from before per-ship names uses the pledge nickname for a one-ship pledge only', () => {
    expect(pledgeHulls(pledge(6, ['Cutlass Black'], { nickname: 'Rusty' }))).toEqual([{ title: 'Cutlass Black', customName: 'Rusty' }]);
    expect(pledgeHulls(pledge(6, ['Cutlass Black', 'Avenger Titan'], { nickname: 'Rusty, Bessie' })).map((h) => h.customName)).toEqual(['', '']);
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
  it('adds insurance only when the pledge lists one', () => {
    const rows = xplorRows([pledge(1, ['Cutlass Black'], { insurance: '120 mo' }), pledge(2, ['Avenger Titan'], { lti: true, insurance: 'LTI' }), pledge(3, ['L-21 Wolf'])], ships);
    expect(rows.map((r) => [r.name, r.insurance])).toEqual([['Avenger Titan', 'LTI'], ['Cutlass Black', '120 mo'], ['L-21 Wolf', undefined]]);
    expect('insurance' in rows[2]!).toBe(false);
    expect(rows.every((r) => !('acquired' in r))).toBe(true);
  });
});

describe('fleet export (StarOrg Tools preset)', () => {
  const game = (id: number, how: GameShip['how'], count: number, name = ''): GameShip => ({ id, name, how, count });
  it('marks pledged rows and adds one row per in-game copy', () => {
    const rows = starOrgRows([pledge(5, ['Cutlass Black'], { insurance: '6 mo' })], [game(3, 'bought', 2), game(1, 'earned', 1)], ships);
    expect(rows.map((r) => [r.name, r.pledge_id, r.acquired, r.pledge_name])).toEqual([
      ['Avenger Titan', '', 'game', 'In-game (earned)'],
      ['Cutlass Black', '', 'game', 'In-game (bought)'],
      ['Cutlass Black', '', 'game', 'In-game (bought)'],
      ['Cutlass Black', '5', 'pledge', 'Pledge 5'],
    ]);
    expect(rows[3]).toMatchObject({ insurance: '6 mo', pledge_cost: '$45.00 USD' });
    expect(rows[0]).toEqual({
      ship_code: 'AEGS_Avenger_Titan', ship_name: 'Avenger Titan', manufacturer_code: 'AEGS', manufacturer_name: 'Aegis Dynamics', name: 'Avenger Titan',
      lti: false, warbond: false, entity_type: 'ship', pledge_id: '', pledge_name: 'In-game (earned)', pledge_cost: '$0.00 USD', acquired: 'game',
    });
  });
  it('pledged rows match xplorRows apart from acquired and pledge_date', () => {
    const pledges = [pledge(1, ['Cutlass Black', 'Avenger Titan'], { insurance: 'LTI', lti: true }), pledge(2, ['L-21 Wolf'])];
    expect(starOrgRows(pledges, [], ships)).toEqual(xplorRows(pledges, ships).map(({ pledge_date: _drop, ...r }) => ({ ...r, acquired: 'pledge' })));
  });
  it('leaves pledge_date off every row', () => {
    const rows = starOrgRows([pledge(5, ['Cutlass Black']), pledge(6, ['Avenger Titan'])], [game(3, 'bought', 1)], ships);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !('pledge_date' in r))).toBe(true);
  });
  it('skips in-game ships the catalog no longer lists, and empty counts', () => {
    expect(starOrgRows([], [game(99, 'bought', 1, 'Gone Ship'), game(4, 'earned', 0)], ships)).toEqual([]);
  });
});

// Catalog-drift guard: RSI's real hull list (tests/fixtures/catalog.json, regenerate with `node scripts/dump-catalog.mjs`,
// then `npx vitest run -u tests/export.test.ts` to accept new codes). One synthetic pledge per hull must give one row
// per hull, each with a ship_code, in the same order however the input is ordered. StarOrg matches on these codes.
// The catalog goes through `withExtraShips` as `fetchCatalog()`'s does, so the concept hulls RSI never lists
// (Kraken, Javelin, Idris-M…) are covered too.
describe('fleet export (catalog-drift fixture)', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/catalog.json', import.meta.url), 'utf8')) as { id: number; name: string; manufacturer: string }[];
  const catalog = withExtraShips(fixture.map((c) => ship(c.id, c.name, c.manufacturer)));
  const pledges = catalog.map((c) => pledge(c.id, [c.name]));
  const rows = xplorRows(pledges, catalog);

  it('one row per catalog hull, each named after its own hull and carrying a ship_code', () => {
    expect(fixture.length).toBeGreaterThan(200);
    expect(rows).toHaveLength(catalog.length);
    const byId = new Map(catalog.map((c) => [String(c.id), c]));
    for (const r of rows) {
      const c = byId.get(r.pledge_id)!;
      expect(r.name, `pledge ${r.pledge_id}`).toBe(c.name);
      expect(r.manufacturer_name).toBe(c.manufacturer);
      expect(r.ship_code, c.name).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });
  it('no two catalog hulls share a ship_code', () => {
    const codes = rows.map((r) => r.ship_code);
    expect(new Set(codes).size, codes.filter((c, i) => codes.indexOf(c) !== i).join(', ')).toBe(codes.length);
  });
  it('is stable across runs and input order', () => {
    expect(xplorRows([...pledges].reverse(), [...catalog].reverse())).toEqual(rows);
    expect(rows.map((r) => `${r.ship_code}\t${r.manufacturer_code}\t${r.name}`)).toMatchSnapshot();
  });
  it('the StarOrg preset gives the same codes, for pledged and in-game hulls', () => {
    const pledged = starOrgRows(pledges, [], catalog);
    expect(pledged.map((r) => [r.pledge_id, r.ship_code])).toEqual(rows.map((r) => [r.pledge_id, r.ship_code]));
    const game = starOrgRows([], catalog.map((c) => ({ id: c.id, name: c.name, how: 'bought' as const, count: 1 })), catalog);
    expect(game).toHaveLength(catalog.length);
    expect(new Set(game.map((r) => `${r.name}\t${r.ship_code}`))).toEqual(new Set(rows.map((r) => `${r.name}\t${r.ship_code}`)));
  });
});
