/**
 * What the hangar holds, counted the way the store pages (Ship catalog, Browse, Store changes) show "owned ×n".
 * Pure — input is the cached `Pledge[]` + catalog (+ in-game ships).
 */
import type { Pledge } from './hangar';
import { inventory, ownedShipsWithPaints, type GameShip, type OwnedShip } from './items';
import { paintKey, type CatalogShip } from './store';

/**
 * Normalized title (`paintKey`) → pledges holding it: the pledge name and every item inside it, each pledge counted
 * once per title (a pack that names itself after its paint is one copy, not two).
 */
export function ownedTitleCounts(pledges: Pick<Pledge, 'name' | 'items'>[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pledges ?? []) for (const t of new Set([p.name, ...p.items.map((i) => i.title)].map(paintKey))) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Hulls you own (pledged + in-game) → copies + insurance, keyed by catalog id; empty until the catalog is read. */
export function ownedHulls(pledges: Pledge[] | null | undefined, game: GameShip[], ships: CatalogShip[]): Map<number, OwnedShip> {
  if (!ships.length) return new Map();
  return new Map(ownedShipsWithPaints(inventory(pledges ?? [], ships), game, ships).map((o) => [o.ship.id, o]));
}
