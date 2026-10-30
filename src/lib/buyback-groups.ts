/**
 * Buyback → Group by: the buyback list split into collapsible groups by pledge type or by ship. Pure, so the panel
 * (`BuybackPanel.svelte`) only renders what this returns.
 *
 * By ship, an entry goes under every hull line it holds (`line()` — the same lines My items → Group: ship uses):
 * a CCU under its target ship, a ship / pack under each ship or vehicle it contains, a paint or component under the
 * hull its title names, and a count-only entry ("Perseus - 5 Paint Pack", contents not loaded yet) under the hull in
 * its name. Like My items, other things (decorations, models, gear) are not matched to a hull even when their title
 * names one. Entries naming no known hull go last, under "No ship / unknown ship".
 */
import type { BuybackItem, PledgeType } from './hangar';
import { categorize, familyLabel, line, shipsFor, type Category } from './items';
import { buybackContents } from './paints';
import { matchShip, type CatalogShip } from './store';

export type BuybackGroupBy = 'none' | 'type' | 'ship';
export interface BuybackGroup {
  key: string;
  /** '' for the single group of `none` (no header). */
  label: string;
  items: BuybackItem[];
}

export const BUYBACK_GROUP_BY: { value: BuybackGroupBy; label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'type', label: 'Group: type' },
  { value: 'ship', label: 'Group: ship' },
];

/** Type groups in this order. */
const TYPE_ORDER: PledgeType[] = ['ship', 'package', 'combo', 'upgrade', 'paint', 'gear', 'hangar', 'subscriber', 'other'];
export const TYPE_LABEL: Record<PledgeType, string> = {
  ship: 'Ships',
  package: 'Game packages',
  combo: 'Combos',
  upgrade: 'Upgrades (CCUs)',
  paint: 'Paints',
  gear: 'Gear',
  hangar: 'Hangar decorations',
  subscriber: 'Subscriber items',
  other: 'Other',
};

const NO_SHIP = 'b|~';

/** Hulls one item is for: a ship / vehicle is its own hull, a paint or component fits the hull it names, anything else none. */
function hullsOf(title: string, cat: Category, ships: CatalogShip[]): CatalogShip[] {
  if (cat === 'ship') {
    const ship = matchShip(title, ships);
    return ship ? [ship] : shipsFor(title, ships);
  }
  return cat === 'paint' || cat === 'component' ? shipsFor(title, ships) : [];
}

/** Without item kinds (contents not loaded): the entry's type says what a ship / paint entry holds, the title the rest. */
function guessCategory(title: string, type: PledgeType): Category {
  if (type === 'ship') return 'ship';
  if (type === 'paint') return 'paint';
  const cat = categorize(title, '');
  // A package / combo listed by title only: a title that is no paint, gear or the like is taken as a ship.
  return cat === 'other' && (type === 'package' || type === 'combo') ? 'ship' : cat;
}

/** The hull lines a buyback entry is for (empty = none known). */
export function buybackLines(b: BuybackItem, ships: CatalogShip[]): string[] {
  const hulls: CatalogShip[] = [];
  const up = b.upgrade;
  if (up) {
    // A CCU is for the ship it upgrades to; one whose target can't be read stays unknown (never the source ship).
    const to = (up.toId != null ? ships.find((s) => s.id === up.toId) : undefined) ?? (up.toName ? matchShip(up.toName, ships) : null);
    if (to) hulls.push(to);
  } else if (b.items?.length) {
    for (const it of b.items) hulls.push(...hullsOf(it.title, categorize(it.title, it.kind), ships));
  } else {
    const titles = buybackContents(b);
    for (const t of titles.length ? titles : [b.name]) hulls.push(...hullsOf(t, guessCategory(t, b.type), ships));
  }
  return [...new Set(hulls.map((s) => line(s.name, ships)).filter(Boolean))];
}

/** Split `list` (already filtered and sorted — each group keeps that order) into groups. */
export function buybackGroups(list: BuybackItem[], by: BuybackGroupBy, ships: CatalogShip[]): BuybackGroup[] {
  if (by === 'none') return [{ key: 'b|all', label: '', items: list }];
  const m = new Map<string, BuybackGroup>();
  const add = (key: string, label: string, b: BuybackItem) => {
    const g = m.get(key) ?? { key, label, items: [] };
    g.items.push(b);
    m.set(key, g);
  };
  for (const b of list) {
    if (by === 'type') add(`b|t:${b.type}`, TYPE_LABEL[b.type] ?? b.type, b);
    else {
      const lines = buybackLines(b, ships);
      if (!lines.length) add(NO_SHIP, 'No ship / unknown ship', b);
      for (const l of lines) add(`b|s:${l}`, familyLabel(l, ships), b);
    }
  }
  const groups = [...m.values()];
  const rank = (g: BuybackGroup) => {
    const i = TYPE_ORDER.indexOf(g.key.slice(4) as PledgeType);
    return i < 0 ? TYPE_ORDER.length : i;
  };
  if (by === 'type') return groups.sort((a, b) => rank(a) - rank(b));
  return groups.sort((a, b) => Number(a.key === NO_SHIP) - Number(b.key === NO_SHIP) || a.label.localeCompare(b.label));
}
