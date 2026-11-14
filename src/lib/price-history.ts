/**
 * Price history: what each hull's MSRP, CCU and standalone SKUs cost, as runs of one price over time. RSI has no
 * price history, so RSI+ keeps its own from every catalog refresh (`recordPrices`); the years before come from the
 * archive shipped with the extension (`withArchive`, runs marked `src`).
 *
 * Which price counts, most trusted first — current always beats history:
 *   1. what the store sells right now (the live catalog; nothing here is asked);
 *   2. the most recent run, whoever saw it;
 *   3. on a tie or an overlap, a run RSI+ saw itself over an archived one.
 */
import { isWarbondSku, type CatalogShip, type Sku } from './store';

/** `ccu` / `ship`: the cheapest non-warbond CCU / standalone SKU on sale; `-wb`: the cheapest warbond one. */
export type PriceKind = 'msrp' | 'ccu' | 'ccu-wb' | 'ship' | 'ship-wb';
export const PRICE_KINDS: PriceKind[] = ['msrp', 'ccu', 'ccu-wb', 'ship', 'ship-wb'];

export interface PriceRun {
  /** USD cents. */
  p: number;
  /** First and last time it was seen at this price (ms). */
  from: number;
  to: number;
  /** Where an imported run came from; absent = RSI+ read it from RSI itself. */
  src?: string;
}
/** Ship id → kind → runs, oldest first. */
export type PriceHistory = Record<string, Partial<Record<PriceKind, PriceRun[]>>>;

/** Two sightings of the same price this far apart are two runs: nobody saw what the store did in between. */
export const RUN_GAP = 7 * 86_400_000;
/** Runs kept per ship and kind (oldest dropped). */
export const MAX_RUNS = 40;

const cheapest = (skus: Sku[], warbond: boolean): number | null => {
  let best: number | null = null;
  for (const k of skus) if (k.available && k.stock !== 0 && isWarbondSku(k) === warbond && (best == null || k.price < best)) best = k.price;
  return best;
};

/** What the catalog says a hull costs right now, per kind (absent = not on sale in that form). */
export function observe(s: CatalogShip): Partial<Record<PriceKind, number>> {
  const out: Partial<Record<PriceKind, number>> = {};
  if (s.msrpSource === 'wiki') return out; // not RSI's price
  const put = (k: PriceKind, v: number | null) => {
    if (v != null && v > 0) out[k] = v;
  };
  put('msrp', s.msrp);
  put('ccu', cheapest(s.ccu, false));
  put('ccu-wb', cheapest(s.ccu, true));
  put('ship', cheapest(s.standalone, false));
  put('ship-wb', cheapest(s.standalone, true));
  return out;
}

const byFrom = (a: PriceRun, b: PriceRun) => a.from - b.from || a.to - b.to;

/** Stamp today's catalog prices into the history (new object; untouched ships keep their entry). */
export function recordPrices(history: PriceHistory, ships: CatalogShip[], now: number): PriceHistory {
  const out: PriceHistory = { ...history };
  for (const s of ships) {
    const seen = observe(s);
    const kinds = Object.keys(seen) as PriceKind[];
    if (!kinds.length) continue;
    const entry = { ...out[s.id] };
    for (const k of kinds) {
      const price = seen[k]!;
      const runs = [...(entry[k] ?? [])];
      // the newest run RSI+ saw itself: the same price soon after only stretches it
      let last = -1;
      for (let i = runs.length - 1; i >= 0; i--) {
        if (!runs[i]!.src) {
          last = i;
          break;
        }
      }
      const prev = last >= 0 ? runs[last]! : null;
      if (prev && prev.p === price && now - prev.to <= RUN_GAP) runs[last] = { ...prev, to: Math.max(prev.to, now) };
      else runs.push({ p: price, from: now, to: now });
      entry[k] = runs.sort(byFrom).slice(-MAX_RUNS);
    }
    out[s.id] = entry;
  }
  return out;
}

const overlaps = (a: PriceRun, b: PriceRun) => a.from <= b.to && b.from <= a.to;

/**
 * Add imported runs. Each gets `src`; one that overlaps a run RSI+ saw itself is dropped (our own reading wins), and
 * re-importing the same source replaces its earlier runs instead of doubling them.
 */
export function mergeImport(history: PriceHistory, imported: PriceHistory, src: string): PriceHistory {
  const out: PriceHistory = { ...history };
  for (const [id, kinds] of Object.entries(imported)) {
    const entry = { ...out[id] };
    for (const k of PRICE_KINDS) {
      const add = (kinds[k] ?? []).filter((r) => r.p > 0 && Number.isFinite(r.from) && Number.isFinite(r.to) && r.from <= r.to);
      if (!add.length) continue;
      const keep = (entry[k] ?? []).filter((r) => r.src !== src);
      const own = keep.filter((r) => !r.src);
      const fresh = add.filter((r) => !own.some((o) => overlaps(o, r))).map((r) => ({ p: r.p, from: r.from, to: r.to, src }));
      entry[k] = [...keep, ...fresh].sort(byFrom).slice(-MAX_RUNS);
    }
    out[id] = entry;
  }
  return out;
}

export interface Seen extends PriceRun {
  kind: PriceKind;
}

/** The most recent run among `kinds` (latest `to`; a tie goes to the run RSI+ saw itself), or null. */
export function lastSeen(history: PriceHistory, id: number | string, kinds: readonly PriceKind[]): Seen | null {
  let best: Seen | null = null;
  for (const k of kinds) {
    for (const r of history[id]?.[k] ?? []) {
      if (!best || r.to > best.to || (r.to === best.to && !r.src && !!best.src)) best = { ...r, kind: k };
    }
  }
  return best;
}

/** Every run of a ship, newest first, for display. */
export function runsOf(history: PriceHistory, id: number | string, kinds: readonly PriceKind[] = PRICE_KINDS): Seen[] {
  return kinds.flatMap((k) => (history[id]?.[k] ?? []).map((r) => ({ ...r, kind: k }))).sort((a, b) => b.to - a.to || b.from - a.from);
}

/** The lowest price ever recorded among `kinds`, or null. */
export function lowestSeen(history: PriceHistory, id: number | string, kinds: readonly PriceKind[]): Seen | null {
  let best: Seen | null = null;
  for (const r of runsOf(history, id, kinds)) if (!best || r.p < best.p) best = r;
  return best;
}

/**
 * The catalog with `expect` on each hull: the last CCU price seen below today's MSRP, standard and warbond — what the
 * planner prices a "wait for a sale" step at instead of MSRP. A price at or above MSRP says nothing new and is left
 * out; whether the hull is on sale today is the planner's call (it only reads `expect` when nothing sells a CCU to it).
 */
export function withExpected(ships: CatalogShip[], history: PriceHistory): CatalogShip[] {
  return ships.map((s) => {
    if (!history[s.id] || s.msrp <= 0) return s;
    const pick = (k: PriceKind) => {
      const r = lastSeen(history, s.id, [k]);
      return r && r.p < s.msrp ? { price: r.p, at: r.to } : undefined;
    };
    const std = pick('ccu');
    const wb = pick('ccu-wb');
    return std || wb ? { ...s, expect: { ...(std ? { std } : {}), ...(wb ? { wb } : {}) } } : s;
  });
}

export const PRICE_KIND_LABEL: Record<PriceKind, string> = { msrp: 'MSRP', ccu: 'CCU', 'ccu-wb': 'Warbond CCU', ship: 'Standalone', 'ship-wb': 'Warbond standalone' };

// ---------------------------------------------------------------------------------------------------------------
// The archive: prices from the years before RSI+ kept its own history, shipped with the extension
// (`data/price-seed.json`, compact: ship id → kind → [cents, first day, last day], days since 1970). It is read on
// demand and merged at read time — never written to storage — so RSI+'s own readings always win where they overlap.

export const ARCHIVE = 'archive';
const DAY = 86_400_000;
type Seed = { through: number; h: Record<string, Partial<Record<PriceKind, [number, number, number][]>>> };

/** The compact seed → runs (a run covers its whole last day). */
export function expandSeed(seed: Seed): PriceHistory {
  const out: PriceHistory = {};
  for (const [id, kinds] of Object.entries(seed.h)) {
    const entry: PriceHistory[string] = {};
    for (const k of PRICE_KINDS) {
      const runs = kinds[k];
      if (runs?.length) entry[k] = runs.map(([p, from, to]) => ({ p, from: from * DAY, to: to * DAY }));
    }
    out[id] = entry;
  }
  return out;
}

let archive: Promise<PriceHistory> | null = null;
/** The shipped archive (loaded once, on first use). */
export const archivePrices = (): Promise<PriceHistory> => (archive ??= import('./data/price-seed.json').then((m) => expandSeed((m.default ?? m) as unknown as Seed)));

/** Your own history with the archive behind it: what every page reads. */
export async function withArchive(own: PriceHistory): Promise<PriceHistory> {
  try {
    return mergeImport(own, await archivePrices(), ARCHIVE);
  } catch {
    return own; // the archive failed to load: your own readings still work
  }
}
