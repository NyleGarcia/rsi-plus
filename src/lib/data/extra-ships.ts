/**
 * Hulls RSI's upgrade catalog (`initShipUpgrade`) never lists — sold only as rare standalone / event packages, never
 * as a CCU target — so the planner and catalog would not know them. MSRPs are their pledge cost on starcitizen.tools
 * (checked 2026-10-16; the Star Citizen Wiki API agrees for Javelin and Idris-M and has no price for the Kraken).
 * Ids are negative so they never collide with RSI's; `fetchCatalog` adds one only when RSI doesn't list that name.
 */
import type { CatalogShip } from '../store';

const extra = (id: number, name: string, manufacturer: string, focus: string, usd: number, flyable: string): CatalogShip => ({
  id,
  name,
  manufacturer,
  focus,
  msrp: usd * 100,
  flyable,
  link: `https://starcitizen.tools/${name.replace(/ /g, '_')}`,
  thumb: null,
  standalone: [],
  ccu: [],
  msrpSource: 'wiki',
});

export const EXTRA_SHIPS: CatalogShip[] = [
  extra(-9001, 'Kraken', 'Drake Interplanetary', 'Light Carrier', 1650, 'Concept'),
  extra(-9002, 'Kraken Privateer', 'Drake Interplanetary', 'Light Carrier', 2420, 'Concept'),
  extra(-9003, 'Javelin', 'Aegis Dynamics', 'Destroyer', 3000, 'Concept'),
  extra(-9004, 'Idris-M', 'Aegis Dynamics', 'Frigate', 1000, 'Flight Ready'),
];
