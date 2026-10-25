/**
 * Small view helpers shared by the CCU planner (CcuPanel) and the fleet plan (CcuFleet): ship names by id, the
 * "last on sale …" note for hulls nobody sells a CCU to today, and ids for saved chains / goals.
 */
import { STORE_START } from './ccu';
import { lastSale, type CatalogShip, type SaleHistory } from './store';

/** Display name of a hull id: `Store` for the store start, `Auto` for no pick, `#id` when the catalog lacks it. */
export const shipName = (byId: Map<number, CatalogShip>, id: number | null): string =>
  id == null ? 'Auto' : id === STORE_START ? 'Store' : (byId.get(id)?.name ?? `#${id}`);

/** "last on sale …" for a hull with no CCU today (history since install; RSI has no sale calendar). */
export function lastSaleLabel(sales: SaleHistory, id: number): string {
  const t = lastSale(sales, id);
  return t ? `last on sale ${new Date(t).toLocaleDateString()}` : 'not seen on sale since RSI+ was installed';
}

/** Short unique id for saved chains and fleet goals (time base-36 + random tail). */
export const uid = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
