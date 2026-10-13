/**
 * Item-level view of the hangar: every `.items .item` of every pledge, categorized, merged by title, and
 * linked to ships (paints/components "fit" a ship family). Pure — input is the cached `Pledge[]` + catalog.
 * RSI item kinds (per HangarXPLOR): Ship, Skin, FPS Equipment, Component, Hangar decoration,
 * Hangar / RSIItem_kind_HANGARPASS, Insurance; game packages are titled "… Digital Download".
 */
import { cell, type Pledge } from './hangar';
import { itemKey } from './melt';
import { matchShip, paintKey, shipKey, type CatalogShip, type StorePaint } from './store';

export type Category = 'ship' | 'paint' | 'armor' | 'weapon' | 'fps' | 'component' | 'decoration' | 'hangar' | 'game' | 'insurance' | 'credits' | 'other';

export const CATEGORY_LABEL: Record<Category, string> = {
  ship: 'Ships & vehicles',
  paint: 'Paints',
  armor: 'Armor',
  weapon: 'FPS weapons',
  fps: 'Other FPS gear',
  component: 'Ship components',
  decoration: 'Hangar decorations',
  hangar: 'Hangars',
  game: 'Game packages',
  insurance: 'Insurance',
  credits: 'Credits',
  other: 'Other / flair',
};

const ARMOR = /\b(armou?r|helmet|undersuit|suit|core|arms|legs|backpack|torso|chest)\b/i;
const WEAPON = /\b(rifle|pistol|smg|shotgun|sniper|lmg|knife|launcher|grenade|carbine|weapon|blade)\b/i;

export function categorize(title: string, kind: string): Category {
  const k = kind.toLowerCase();
  if (/digital download/i.test(title)) return 'game';
  if (k === 'ship' || k === 'vehicle') return 'ship';
  if (k === 'insurance' || /\binsurance\b/i.test(title)) return 'insurance';
  if (k.includes('skin') || /\b(paint|livery|skin)\b/i.test(title)) return 'paint';
  if (k.includes('fps')) return ARMOR.test(title) ? 'armor' : WEAPON.test(title) ? 'weapon' : 'fps';
  if (k.includes('component')) return 'component';
  if (k.includes('decoration')) return 'decoration';
  if (k.includes('hangar')) return 'hangar';
  if (k.includes('credit') || /\b(uec|credits?)\b/i.test(title)) return 'credits';
  if (ARMOR.test(title) && /armou?r|helmet|undersuit/i.test(title)) return 'armor';
  return 'other';
}

/** Tokens that never identify a hull family on their own. */
const GENERIC = new Set(
  'mk ii iii iv v black red blue white green gold silver grey gray edition series paint livery skin pack bundle the and of with for best show limited special warbond standard lti wb plus'.split(
    ' ',
  ),
);

/**
 * Hull family of a catalog ship — the word paints are usually named after: "Cutlass Black" → "cutlass",
 * "F7C Hornet Mk II" → "hornet", "300i" → "300i". First non-generic token of ≥ 3 chars that isn't a short
 * model code (letters+digits like f7c, a2, c2) unless it's the only token.
 */
export function family(name: string): string {
  const toks = shipKey(name).split(' ').filter(Boolean);
  const pick = toks.find((t) => t.length >= 3 && !GENERIC.has(t) && !/^[a-z]\d+[a-z]?$/.test(t));
  return pick ?? toks[0] ?? '';
}

/**
 * Catalog ships an item (paint/component/…) is for: ships whose full name is in the title win (most specific);
 * otherwise every ship of the family named in the title. Empty when nothing matches.
 */
export function shipsFor(title: string, ships: CatalogShip[]): CatalogShip[] {
  // RSI paint titles put the hull before a dash ("Cutlass - Black and White Livery"): when that part names a
  // ship, match only it — otherwise colour words in the paint name ("Black") look like variants (Cutlass Black).
  const head = title.split(/\s[-–—:]\s/)[0]!;
  if (head !== title) {
    const hit = matchFor(head, ships);
    if (hit.length) return hit;
  }
  return matchFor(title, ships);
}

/** Store names for a whole model line: "100 series" = 100i / 125a / 135c, "300 series" = 300i / 315p / 325a / 350r. */
const SERIES: [RegExp, RegExp][] = [
  [/\b100 series\b/, /^1\d\d[a-z]$/],
  [/\b300 series\b/, /^3\d\d[a-z]$/],
];

function matchFor(text: string, ships: CatalogShip[]): CatalogShip[] {
  const key = ` ${shipKey(text)} `;
  for (const [re, hull] of SERIES) if (re.test(key)) return ships.filter((s) => hull.test(shipKey(s.name)));
  const exact = ships.filter((s) => {
    const k = shipKey(s.name);
    return k && key.includes(` ${k} `);
  });
  if (exact.length) {
    // Keep only the longest names (e.g. "Cutlass Black" over "Cutlass").
    const max = Math.max(...exact.map((s) => shipKey(s.name).length));
    return exact.filter((s) => shipKey(s.name).length === max);
  }
  const fams = new Set(ships.map((s) => family(s.name)).filter((f) => f.length >= 3 && key.includes(` ${f} `)));
  return ships.filter((s) => fams.has(family(s.name)));
}

export interface ItemRow {
  /** category + normalized title — identical items across pledges merge here. */
  key: string;
  title: string;
  category: Category;
  count: number;
  pledges: { id: number; name: string; value: number; giftable: boolean; type: Pledge['type'] }[];
  /** For ships: the catalog ship. */
  ship: CatalogShip | null;
  /** For paints/components/…: the catalog ships it fits (empty = unknown). */
  fits: CatalogShip[];
  /** How `fits` was found: the item's name, or (fallback) the ships packed in the same pledge. */
  fitsVia: 'name' | 'pledge' | null;
  giftable: boolean;
  lti: boolean;
  /** For ships: distinct insurance terms across the pledges holding it (e.g. ['LTI', '120 mo']). */
  insurance: string[];
}

export function inventory(pledges: Pledge[], ships: CatalogShip[]): ItemRow[] {
  const rows = new Map<string, ItemRow>();
  for (const p of pledges) {
    // CCU pledges hold no items of their own worth listing.
    const items = p.items.length ? p.items : p.type === 'upgrade' ? [] : [{ title: p.name, kind: '' }];
    for (const it of items) {
      const category = categorize(it.title, it.kind);
      const key = `${category}|${it.title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
      let r = rows.get(key);
      if (!r) {
        const ship = category === 'ship' ? matchShip(it.title, ships) : null;
        const fits = category === 'paint' || category === 'component' ? shipsFor(it.title, ships) : [];
        r = { key, title: it.title, category, count: 0, pledges: [], ship, fits, fitsVia: fits.length ? 'name' : null, giftable: false, lti: false, insurance: [] };
        rows.set(key, r);
      }
      r.count++;
      r.pledges.push({ id: p.id, name: p.name, value: p.value, giftable: p.giftable, type: p.type });
      r.giftable ||= p.giftable;
      if (category === 'ship') {
        r.lti ||= p.lti;
        if (p.insurance && !r.insurance.includes(p.insurance)) r.insurance.push(p.insurance);
      }
    }
  }
  // Paints whose name names no ship ("Ghoulish Green Paint") but came in a pack with ships: they're for those.
  const shipsIn = new Map<number, CatalogShip[]>();
  for (const r of rows.values())
    if (r.ship) for (const p of r.pledges) shipsIn.set(p.id, [...(shipsIn.get(p.id) ?? []), r.ship]);
  for (const r of rows.values()) {
    if (r.category !== 'paint' || r.fits.length) continue;
    const near = uniqueShips(r.pledges.flatMap((p) => shipsIn.get(p.id) ?? []));
    if (near.length) Object.assign(r, { fits: near, fitsVia: 'pledge' });
  }
  return [...rows.values()];
}

const uniqueShips = (list: CatalogShip[]) => [...new Map(list.map((s) => [s.id, s])).values()];

/** Display name of a hull family as written in the catalog ("cutlass" → "Cutlass", "100i" → "100i"). */
export function familyLabel(fam: string, ships: CatalogShip[]): string {
  for (const s of ships) {
    const w = s.name.split(/\s+/).find((x) => shipKey(x) === fam);
    if (w) return w;
  }
  return fam ? fam[0]!.toUpperCase() + fam.slice(1) : fam;
}

export interface OwnedShip {
  ship: CatalogShip;
  /** Hull copies across pledges. */
  count: number;
  lti: boolean;
  /** Distinct insurance terms across copies (['LTI'], ['120 mo', '6 mo'], [] when unknown). */
  insurance: string[];
  /** Item rows (as listed in the hangar) for this hull. */
  items: ItemRow[];
  /** Paints you own that fit this ship. */
  paints: ItemRow[];
}

/** Your ships (matched to the catalog), each with the paints you own for it. */
export function ownedShipsWithPaints(rows: ItemRow[]): OwnedShip[] {
  const by = new Map<number, OwnedShip>();
  for (const r of rows) {
    if (r.category !== 'ship' || !r.ship) continue;
    const o = by.get(r.ship.id) ?? { ship: r.ship, count: 0, lti: false, insurance: [], items: [], paints: [] };
    o.count += r.count;
    o.lti ||= r.lti;
    for (const i of r.insurance) if (!o.insurance.includes(i)) o.insurance.push(i);
    o.items.push(r);
    by.set(r.ship.id, o);
  }
  for (const r of rows) {
    if (r.category !== 'paint') continue;
    for (const s of r.fits) by.get(s.id)?.paints.push(r);
  }
  return [...by.values()].sort((a, b) => a.ship.name.localeCompare(b.ship.name));
}

/** Paint ownership vs your fleet: fits a ship you own / fits only ships you don't / unknown ship. */
export function paintStatus(r: ItemRow, ownedIds: Set<number>): 'owned-ship' | 'no-ship' | 'unknown' {
  if (!r.fits.length) return 'unknown';
  return r.fits.some((s) => ownedIds.has(s.id)) ? 'owned-ship' : 'no-ship';
}

export interface PaintGroup {
  /** `f:<family>` or `~` (paints whose ship couldn't be worked out). */
  key: string;
  label: string;
  /** Hulls of this family you own (empty = you don't own one). */
  owned: OwnedShip[];
  paints: ItemRow[];
}

/**
 * Paints by ship family, with the hulls of that family you own — for "all paints, with ships and without".
 * `withEmpty` adds families you own with no paints. A family-wide paint shows once under its family.
 */
export function paintGroups(rows: ItemRow[], fleet: OwnedShip[], withEmpty = false): PaintGroup[] {
  const m = new Map<string, PaintGroup>();
  const get = (fam: string, ships: CatalogShip[]) => {
    const key = fam ? `f:${fam}` : '~';
    let g = m.get(key);
    if (!g) m.set(key, (g = { key, label: fam ? familyLabel(fam, ships) : 'Unknown ship', owned: [], paints: [] }));
    return g;
  };
  for (const r of rows) {
    if (r.category !== 'paint') continue;
    const fams = [...new Set(r.fits.map((s) => family(s.name)))];
    if (!fams.length) get('', []).paints.push(r);
    for (const f of fams) get(f, r.fits).paints.push(r);
  }
  for (const o of fleet) {
    const f = family(o.ship.name);
    if (!withEmpty && !m.has(`f:${f}`)) continue;
    get(f, [o.ship]).owned.push(o);
  }
  return [...m.values()].sort((a, b) => Number(a.key === '~') - Number(b.key === '~') || a.label.localeCompare(b.label));
}

export function itemsCsv(list: ItemRow[]): string {
  const head = ['item', 'category', 'qty', 'ship', 'fits_via', 'giftable', 'pledge_ids', 'pledges'];
  return [
    head.join(','),
    ...list.map((r) =>
      [r.title, CATEGORY_LABEL[r.category], r.count, (r.ship ? [r.ship] : r.fits).map((s) => s.name).join('; '), r.fitsVia ?? '', r.giftable, r.pledges.map((p) => p.id).join('; '), r.pledges.map((p) => p.name).join('; ')]
        .map(cell)
        .join(','),
    ),
  ].join('\n');
}

/** Known RSI events / promos (tested against the item title, then the pledge name). */
const EVENTS: [RegExp, string][] = [
  [/luminalia/i, 'Luminalia'],
  [/coramor/i, 'Coramor'],
  [/red festival|lunar new year/i, 'Red Festival'],
  [/stella fortuna/i, 'Stella Fortuna'],
  [/day of the vara|vara/i, 'Day of the Vara'],
  [/invictus/i, 'Invictus Launch Week'],
  [/\biae\b|intergalactic aerospace expo/i, 'IAE'],
  [/foundation festival/i, 'Foundation Festival'],
  [/alien week/i, 'Alien Week'],
  [/xeno ?threat/i, 'XenoThreat'],
  [/ship showdown/i, 'Ship Showdown'],
  [/citizen ?con/i, 'CitizenCon'],
  [/anniversary/i, 'Anniversary'],
  [/best in show|\bbis\b/i, 'Best in Show'],
  [/\b(subscriber|imperator|centurion)\b/i, 'Subscriber'],
  [/referral|recruit/i, 'Referral'],
  [/twitch ?con/i, 'TwitchCon'],
  [/\bjump ?town\b/i, 'Jumptown'],
  [/\bace astronaut\b/i, 'Ace Astronaut'],
];

/** First words that never name a series on their own. */
const NOT_SERIES = new Set(['the', 'a', 'an', 'ship', 'paint', 'game', 'star', 'squadron', 'standalone', 'upgrade', 'lifetime', 'digital', 'rsi', 'light', 'medium', 'heavy']);

/**
 * Event / collection each non-ship item belongs to (row key → label): a known event (Luminalia, IAE, …) in the
 * title or its pledge's name, else the name prefix it shares with other items ("RSI Disc. Helmet" + "RSI Disc. Arms"
 * → "RSI Disc."; "AA Core" + "AA Legs" → "AA"). Paints only get known events — their prefix is the ship.
 */
export function seriesOf(rows: ItemRow[]): Map<string, string> {
  const out = new Map<string, string>();
  const words = (t: string) => t.trim().split(/\s+/);
  const prefixes = (t: string) => {
    const w = words(t);
    return [w.slice(0, 2).join(' '), w[0]!].filter((p, i) => i === 1 || w.length > 2);
  };
  // How many distinct items share each prefix.
  const tally = new Map<string, number>();
  const cands = rows.filter((r) => r.category !== 'ship' && r.category !== 'paint' && r.category !== 'insurance' && r.category !== 'game');
  for (const r of cands) for (const p of new Set(prefixes(r.title).map((x) => x.toLowerCase()))) tally.set(p, (tally.get(p) ?? 0) + 1);

  for (const r of rows) {
    if (r.category === 'ship' || r.category === 'insurance' || r.category === 'game') continue;
    const ev = EVENTS.find(([re]) => re.test(r.title)) ?? EVENTS.find(([re]) => r.pledges.some((p) => re.test(p.name)));
    if (ev) {
      out.set(r.key, ev[1]);
      continue;
    }
    if (r.category === 'paint') continue;
    // Longest shared prefix wins; a lone generic first word ("RSI", "Heavy") isn't a series, "RSI Disc." is.
    const hit = prefixes(r.title).find((p) => {
      const first = words(p)[0]!.toLowerCase().replace(/[^a-z0-9]/g, '');
      const single = words(p).length === 1;
      return (tally.get(p.toLowerCase()) ?? 0) >= 2 && !(single && (first.length < 2 || NOT_SERIES.has(first)));
    });
    if (hit) out.set(r.key, hit);
  }
  return out;
}

/** Store paints by ship family (`shipsFor` on the store name); `~` = packs / collections naming no ship. */
export function storePaintsByFamily(paints: StorePaint[], ships: CatalogShip[]): Map<string, StorePaint[]> {
  const m = new Map<string, StorePaint[]>();
  for (const sp of paints) {
    const fams = [...new Set(shipsFor(sp.name, ships).map((s) => family(s.name)))];
    for (const f of fams.length ? fams : ['~']) m.set(f, [...(m.get(f) ?? []), sp]);
  }
  return m;
}

/** Hangar paint → the same paint on the store (for a buy / price link), by normalized title. */
export function storePaintFor(r: ItemRow, byKey: Map<string, StorePaint>): StorePaint | null {
  return byKey.get(paintKey(r.title)) ?? null;
}
export const storePaintIndex = (paints: StorePaint[]) => new Map(paints.map((p) => [paintKey(p.name), p]));

/**
 * Copies of each paint worth keeping — one per hull you own that it fits (a family paint for 2 Cutlasses needs 2),
 * so the melt planner never calls a paint a duplicate while every ship could use one. Keys match `melt.itemKey`.
 */
export function paintCopiesNeeded(rows: ItemRow[], fleet: OwnedShip[]): Map<string, number> {
  const hulls = new Map(fleet.map((f) => [f.ship.id, f.count]));
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.category !== 'paint') continue;
    const n = r.fits.reduce((a, s) => a + (hulls.get(s.id) ?? 0), 0);
    if (n > 1) out.set(itemKey(r.title), n);
  }
  return out;
}
