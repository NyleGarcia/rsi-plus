/**
 * What the hangar holds, counted the way the store pages (Ship catalog, Browse, Store changes) show "owned ×n".
 * Pure — input is the cached `Pledge[]` + catalog (+ in-game ships).
 */
import type { Pledge } from './hangar';
import { inventory, ownedShipsWithPaints, type GameShip, type OwnedShip } from './items';
import { cutKey, paintKey, type CatalogShip } from './store';

/** What the hangar holds by normalized title: whole titles by `paintKey`, titles RSI cut short by their prefix. */
export interface OwnedTitles {
  exact: Map<string, number>;
  /** Titles the hangar page cut short ("… Sniper R...") → copies; a store title matches when its key starts with the prefix. */
  cut: Map<string, number>;
}

/**
 * Normalized title (`paintKey`) → pledges holding it: the pledge name and every item inside it, each pledge counted
 * once per title (a pack that names itself after its paint is one copy, not two). Titles the hangar page cut short
 * with "..." go in `cut` under what is left of them, so `ownedTitleCount` can still match the whole store title.
 */
export function ownedTitleCounts(pledges: Pick<Pledge, 'name' | 'items'>[] | null | undefined): OwnedTitles {
  const exact = new Map<string, number>();
  const cut = new Map<string, number>();
  for (const p of pledges ?? []) {
    const whole = new Set<string>();
    const short = new Set<string>();
    for (const t of [p.name, ...p.items.map((i) => i.title)]) {
      const c = cutKey(t);
      if (c) short.add(c);
      else whole.add(paintKey(t));
    }
    for (const t of whole) exact.set(t, (exact.get(t) ?? 0) + 1);
    for (const t of short) cut.set(t, (cut.get(t) ?? 0) + 1);
  }
  return { exact, cut };
}

/** Copies of a store title in the hangar: its key exactly, plus every cut-short hangar title it starts with. */
export function ownedTitleCount(o: OwnedTitles, title: string): number {
  const k = paintKey(title);
  let n = o.exact.get(k) ?? 0;
  if (o.cut.size) for (const [prefix, c] of o.cut) if (k.length > prefix.length && k.startsWith(prefix)) n += c;
  return n;
}

/** Hulls you own (pledged + in-game) → copies + insurance, keyed by catalog id; empty until the catalog is read. */
export function ownedHulls(pledges: Pledge[] | null | undefined, game: GameShip[], ships: CatalogShip[]): Map<number, OwnedShip> {
  if (!ships.length) return new Map();
  return new Map(ownedShipsWithPaints(inventory(pledges ?? [], ships), game, ships).map((o) => [o.ship.id, o]));
}
