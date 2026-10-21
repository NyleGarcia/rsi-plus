/**
 * Bundle value: what a multi-item listing (ship pack, game package, career kit, paint collection, armor set) would
 * cost bought piece by piece, and what it saves. RSI lists a listing's contents (`StoreItem.contents`, from the store's
 * `gameItems`) but never their separate prices, so the pieces are priced from what the store sells on its own:
 * - a hull → the ship catalog's MSRP (list price of the standalone), else a standalone-ship listing of that name;
 * - everything else → the cheapest *other* listing whose contents fit inside the bundle, biggest first — armor pieces
 *   are never sold alone, only as a set, so a "Gear Pack" is priced as its armor set + the singles around it;
 * - hangars and the game download are extras: listed as included, never priced, and not counted when deciding
 *   whether something is a bundle (a standalone ship ships with a hangar — that's no bundle); UEC is priced at RSI's
 *   own rate (1,000 UEC = $1);
 * - insurance is not an item at all but a term on the hull(s): it becomes the listing's `insurance` tag (LTI, 6 mo …)
 *   and never appears among the parts.
 * Savings compare the bundle with the pieces that *can* be bought; what's left unpriced is said so.
 */
import { matchShip, paintKey, type CatalogShip, type StoreContent, type StoreItem } from './store';

/** One line of a bundle's breakdown: a piece, or a smaller listing (`pieces`) that covers several of them. */
export interface BundlePart {
  name: string;
  /** USD cents when the store sells it (alone or as the set in `pieces`), else null. */
  price: number | null;
  /** How many times the bundle grants it (weapon kits list the same gun twice). */
  count: number;
  ship?: true;
  /** Insurance / hangar / download: included with the bundle, never sold. */
  extra?: true;
  /** When priced as a set: the pieces of the bundle that set covers. */
  pieces?: string[];
}
export interface BundleValue {
  parts: BundlePart[];
  /** Insurance on the hulls, as a tag: "LTI", "6 mo", "120 mo"; null when the contents name none. */
  insurance: string | null;
  /** Pieces in the bundle, counting duplicates and extras. */
  total: number;
  /** Pieces covered by a price, counting duplicates. */
  priced: number;
  /** Pieces that could carry a price (not extras). */
  priceable: number;
  /** Sum of the separate prices (cents). */
  separate: number;
  /** `separate` − the price paid for the bundle now; negative when the pieces are cheaper apart. */
  savings: number;
  /** Savings as a share of `separate` (0–100), 0 when nothing is priced. */
  pct: number;
}

/** Store names vary only in quotes and separators ("Greycat Aril ‘Hazard’ Core" vs "Greycat Aril 'Hazard' Core"). */
export const contentKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[‘’‚‛'"“”„]/g, '')
    .replace(/\s*[-–—:]\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const isExtra = (name: string) => /\binsurance\b|\bhangar\b|digital download|^[\d,]+ uec$/i.test(name.trim());
export const isInsurance = (name: string) => /\binsurance\b/i.test(name);
/** "Lifetime Insurance" → "LTI", "6 Month Insurance" → "6 mo"; null for anything else. */
export function insuranceTag(name: string): string | null {
  if (/lifetime|\blti\b/i.test(name)) return 'LTI';
  const m = /(\d+)\s*-?\s*month/i.exec(name);
  return m ? `${m[1]} mo` : isInsurance(name) ? name.replace(/\s*insurance\s*/i, '').trim() || 'insured' : null;
}
/** The listing's insurance tag: from its contents, else from an "LTI" in its name (older copies have no contents). */
export function insuranceOf(it: Pick<StoreItem, 'name' | 'contents'>): string | null {
  for (const c of it.contents ?? []) if (isInsurance(c.name)) return insuranceTag(c.name);
  return /\blti\b|lifetime insurance/i.test(it.name) ? 'LTI' : null;
}
const uecPrice = (name: string): number | null => {
  const m = /^([\d,]+) uec$/i.exec(name.trim());
  return m ? Math.round(Number(m[1]!.replace(/,/g, '')) / 10) : null; // 1,000 UEC = $1 = 100 cents
};
/** Two or more pieces beyond insurance / hangar / download = a bundle worth valuing. */
export const isBundle = (it: Pick<StoreItem, 'contents'>) => (it.contents ?? []).filter((c) => !isExtra(c.name)).length >= 2;
/** Anything with two or more contents besides insurance can be opened to show them (a standalone ship: hull + hangar). */
export const hasContents = (it: Pick<StoreItem, 'contents'>) => (it.contents ?? []).filter((c) => !isInsurance(c.name)).length >= 2;

interface Cover {
  id: number;
  name: string;
  price: number;
  /** Sorted content keys (non-ship, non-extra), with duplicates. */
  keys: string[];
}
export interface PriceIndex {
  /** Every listing that could price part of another, biggest content first, cheapest first within a size. */
  covers: Cover[];
  /** listing-name key (`paintKey`, which also drops maker prefixes) → cheapest current price, single-content listings only. */
  byName: Map<string, number>;
  ships: CatalogShip[];
}

const lower = (m: Map<string, number>, k: string, v: number) => {
  if (!k) return;
  const cur = m.get(k);
  if (cur == null || v < cur) m.set(k, v);
};
const coverKeys = (contents: StoreContent[]) =>
  contents
    .filter((c) => !c.ship && !isExtra(c.name))
    .map((c) => contentKey(c.name))
    .sort();

/** Index the store once per listing (the catalog array is part of the key for ship matching). */
export function priceIndex(items: StoreItem[], ships: CatalogShip[]): PriceIndex {
  const bySig = new Map<string, Cover>();
  const byName = new Map<string, number>();
  for (const it of items) {
    if (it.category === 'subscribers') continue; // subscriber prices aren't what the store charges everyone
    const keys = coverKeys(it.contents ?? []);
    if (!keys.length) {
      if (!it.contents?.length) lower(byName, paintKey(it.name), it.discounted); // copies saved before contents were read
      continue;
    }
    if (keys.length === 1) lower(byName, paintKey(it.name), it.discounted);
    const sig = keys.join('|');
    const cur = bySig.get(sig);
    if (!cur || it.discounted < cur.price) bySig.set(sig, { id: it.id, name: it.name, price: it.discounted, keys });
  }
  const covers = [...bySig.values()].sort((a, b) => b.keys.length - a.keys.length || a.price - b.price);
  return { covers, byName, ships };
}

/** Separate price of one hull: catalog MSRP, else a standalone listing of that name. */
function shipPrice(name: string, idx: PriceIndex): number | null {
  const s = matchShip(name, idx.ships);
  if (s?.msrp) return s.msrp;
  const k = contentKey(name);
  return idx.covers.find((c) => c.keys.length === 1 && c.keys[0] === k)?.price ?? idx.byName.get(paintKey(name)) ?? null;
}

const memo = new WeakMap<PriceIndex, Map<number, BundleValue | null>>();
/** The breakdown of a bundle (`isBundle`) or of anything with contents to show; null for single items. */
export function bundleValue(it: Pick<StoreItem, 'id' | 'name' | 'contents' | 'discounted'>, idx: PriceIndex): BundleValue | null {
  const contents = (it.contents ?? []).filter((c) => !isInsurance(c.name));
  if (contents.length < 2) return null;
  let m = memo.get(idx);
  if (!m) memo.set(idx, (m = new Map()));
  const hit = m.get(it.id);
  if (hit !== undefined) return hit;
  const v = value(it, contents, idx);
  v.insurance = insuranceOf(it);
  m.set(it.id, v);
  return v;
}

function value(it: Pick<StoreItem, 'id' | 'discounted'>, contents: StoreContent[], idx: PriceIndex): BundleValue {
  const parts: BundlePart[] = [];
  const add = (p: BundlePart) => {
    const prev = parts.find((q) => q.name === p.name && !!q.ship === !!p.ship && !q.pieces && !p.pieces);
    if (prev) prev.count += p.count;
    else parts.push(p);
  };
  // Pieces that can be covered by other listings (by key), keeping the display name.
  const remaining = new Map<string, { name: string; n: number }>();
  for (const c of contents) {
    if (c.ship) add({ name: c.name, ship: true, price: shipPrice(c.name, idx), count: 1 });
    else if (isExtra(c.name)) add({ name: c.name, extra: true, price: uecPrice(c.name), count: 1 });
    else {
      const k = contentKey(c.name);
      const r = remaining.get(k);
      if (r) r.n++;
      else remaining.set(k, { name: c.name, n: 1 });
    }
  }
  const size = [...remaining.values()].reduce((n, r) => n + r.n, 0);
  const fits = (c: Cover) => {
    const need = new Map<string, number>();
    for (const k of c.keys) need.set(k, (need.get(k) ?? 0) + 1);
    for (const [k, n] of need) if ((remaining.get(k)?.n ?? 0) < n) return false;
    return true;
  };
  // Biggest covers first (an armor set before its single backpack), never the bundle itself or a same-size twin.
  for (const c of idx.covers) {
    if (c.id === it.id || c.keys.length >= size) continue;
    while (fits(c)) {
      const pieces: string[] = [];
      for (const k of c.keys) {
        const r = remaining.get(k)!;
        pieces.push(r.name);
        if (--r.n === 0) remaining.delete(k);
      }
      if (c.keys.length === 1) add({ name: pieces[0]!, price: c.price, count: 1 });
      else parts.push({ name: c.name, price: c.price, count: 1, pieces });
      if (!remaining.size) break;
    }
    if (!remaining.size) break;
  }
  for (const r of remaining.values()) add({ name: r.name, price: idx.byName.get(paintKey(r.name)) ?? null, count: r.n });
  let separate = 0;
  let priced = 0;
  let priceable = 0;
  let total = 0;
  for (const p of parts) {
    const n = p.pieces?.length ?? p.count;
    total += n;
    if (!p.extra) priceable += n;
    if (p.price != null) {
      priced += n;
      separate += p.price * p.count;
    }
  }
  const savings = separate - it.discounted;
  return { parts, insurance: null, total, priced, priceable, separate, savings, pct: separate > 0 ? Math.round((100 * savings) / separate) : 0 };
}
