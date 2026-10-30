/**
 * Fleet export in the HangarXPLOR shape — the file format FleetYards (Hangar → Import), myfleet.gg (the StarShip42 FleetView
 * successor), Starjump / hangar.link and spreadsheets all read. One row per ship hull in a pledge (HangarXPLOR.Download.js,
 * MIT): `ship_code`, `ship_name` (the name you gave that ship, else the ship), `manufacturer_code/name`, `name` (ship as listed, maker
 * prefix stripped), `lti`, `warbond`, `entity_type: 'ship'`, `pledge_id/name/date/cost`. Pure; UI in ShipsPanel / HangarPanel.
 */
import type { Pledge } from './hangar';
import { matchShip, type CatalogShip } from './store';
import { SHIP_CODES } from './data/ship-codes';

export interface XplorRow {
  ship_code: string;
  ship_name: string;
  manufacturer_code: string;
  manufacturer_name: string;
  name: string;
  lti: boolean;
  warbond: boolean;
  entity_type: 'ship';
  pledge_id: string;
  pledge_name: string;
  pledge_date: string;
  pledge_cost: string;
}

const byName = new Map(SHIP_CODES.map((c) => [c[1].toLowerCase(), c]));
const makerCode = new Map(SHIP_CODES.map((c) => [c[3].toLowerCase(), c[2]]));
/** Maker names and codes that RSI prefixes ship titles with ("Aegis Avenger Titan", "RSI Aurora MR"). */
const MAKERS = [...new Set([...SHIP_CODES.flatMap((c) => [c[2], c[3]]), 'Aegis', 'Anvil', 'Crusader', 'Drake', 'Origin', 'Kruger', 'Greycat', 'CNOU', 'Vanduul', "Xi'an", 'Argo'])]
  .filter(Boolean)
  .sort((a, b) => b.length - a.length);
const makerRe = new RegExp(`^(?:${MAKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[^a-z0-9]+`, 'i');

/** "Aegis Avenger Titan" → "Avenger Titan" (HangarXPLOR strips the same prefixes). */
export const stripMaker = (title: string): string => title.replace(makerRe, '').trim();

const synthCode = (maker: string, name: string) =>
  `${maker}_${name}`
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '');

/** HangarXPLOR's code for a ship name: exact table hit, else the name without its "Mk N" (Constellation Mk IV Andromeda), else synthesized. */
export function shipCode(name: string, manufacturer: string): Pick<XplorRow, 'ship_code' | 'manufacturer_code' | 'manufacturer_name'> {
  const hit = byName.get(name.toLowerCase()) ?? byName.get(name.replace(/\s+Mk\s+[IVX\d]+\b/i, '').replace(/\s+/g, ' ').trim().toLowerCase());
  if (hit) return { ship_code: hit[0], manufacturer_code: hit[2], manufacturer_name: manufacturer || hit[3] };
  const code = makerCode.get(manufacturer.toLowerCase()) ?? (manufacturer ? manufacturer.split(/\s+/)[0]!.toUpperCase() : '');
  return { ship_code: synthCode(code, name), manufacturer_code: code, manufacturer_name: manufacturer };
}

/**
 * Each ship hull of a pledge with the name you gave it ('' = unnamed). RSI puts a ship's name inside that ship's item,
 * so a pack names only the hulls you named. A save from before items carried their name falls back to the pledge's
 * nickname only when the pledge holds one hull: a pack's names can't be pinned to its ships.
 */
export function pledgeHulls(p: Pick<Pledge, 'ships' | 'items' | 'nickname'>): { title: string; customName: string }[] {
  const items = p.items.filter((i) => i.kind.toLowerCase() === 'ship');
  const hulls = items.length ? items.map((i) => ({ title: i.title, customName: i.customName ?? '' })) : p.ships.map((title) => ({ title, customName: '' }));
  if (p.nickname && hulls.length === 1 && !items.some((i) => 'customName' in i)) hulls[0]!.customName = p.nickname;
  return hulls;
}

/** One HangarXPLOR row per ship hull listed in each pledge, sorted by maker then ship (CCU pledges hold no hulls). */
export function xplorRows(pledges: Pledge[], ships: CatalogShip[]): XplorRow[] {
  const out: XplorRow[] = [];
  for (const p of pledges) {
    for (const { title, customName } of pledgeHulls(p)) {
      const cat = matchShip(title, ships);
      const name = cat?.name ?? stripMaker(title);
      out.push({
        ...shipCode(name, cat?.manufacturer ?? ''),
        ship_name: customName || name,
        name,
        lti: p.lti,
        warbond: p.warbond,
        entity_type: 'ship',
        pledge_id: String(p.id),
        pledge_name: p.name,
        pledge_date: p.date,
        pledge_cost: `$${p.value.toFixed(2)} USD`,
      });
    }
  }
  return out.sort((a, b) => a.manufacturer_name.localeCompare(b.manufacturer_name) || a.name.localeCompare(b.name) || a.pledge_id.localeCompare(b.pledge_id));
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** HangarXPLOR's CSV: `Manufacturer, Ship, Lti, Warbond, ID, Pledge, Cost, Date` (quoted properly, unlike the original). */
export function xplorCsv(rows: XplorRow[]): string {
  const head = 'Manufacturer,Ship,Lti,Warbond,ID,Pledge,Cost,Date';
  return [head, ...rows.map((r) => [q(r.manufacturer_name), q(r.ship_name), r.lti, r.warbond, r.pledge_id, q(r.pledge_name), q(r.pledge_cost), q(r.pledge_date)].join(','))].join('\n') + '\n';
}

/** One line per hull, "Maker Ship", for pasting into tools that take a plain list. */
export const shipLines = (rows: XplorRow[]): string => rows.map((r) => (r.manufacturer_name ? `${r.manufacturer_name} ${r.name}` : r.name)).join('\n');
