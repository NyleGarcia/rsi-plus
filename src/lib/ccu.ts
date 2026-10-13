/**
 * Cheapest CCU chain to a target ship, from a ship you own, any ship, or a ship bought from the store.
 * Edges out of ship A (msrp in cents):
 * - store: every on-sale CCU SKU of ship B with sku.price > msrp(A) → cost sku.price − msrp(A)
 *   (warbond SKUs need new money; standard/limited can be paid with store credit);
 * - owned: a CCU in your hangar A→B → cost 0 now; `paid` = its melt value (what it cost you);
 * - buyback (optional): a melted CCU A→B → cost ≈ msrp(B) − msrp(A) (buyback price; credit or cash);
 * - standalone (store start only): the virtual start → ship B with a standalone SKU on sale → cost sku.price.
 * Objective picks what is minimised (see `Objective`); ties → fewer steps. Pure; inputs come from the catalog +
 * hangar/buyback caches.
 */
import { isWarbondSku, matchShip, shipKey, type CatalogShip } from './store';

export type EdgeKind = 'warbond' | 'standard' | 'limited' | 'owned' | 'buyback' | 'standalone';

/**
 * - `spend`: least money out of pocket today (owned CCUs are free) — CCU Game "current highest savings".
 * - `cash`: least *new* money (what store credit can't pay), then spend — "lowest amount of new money".
 * - `longterm`: least total cost including what you already paid for owned CCUs — "long term highest savings".
 */
export type Objective = 'spend' | 'cash' | 'longterm';

/** Virtual start: buy a ship from the store first (any ship with a standalone SKU on sale). */
export const STORE_START = 0;

export interface OwnedCcu {
  fromId: number;
  toId: number;
  /** Pledge id (hangar) or buyback id, for linking and force include / exclude. */
  ref: number;
  source: 'hangar' | 'buyback';
  /** Cents you paid for it (hangar melt value); 0 when gifted or unknown (buyback). */
  value: number;
  /** Hangar CCU with no melt value = received as a gift. */
  gifted: boolean;
}

export interface Step {
  fromId: number;
  toId: number;
  kind: EdgeKind;
  /** Cents to pay now. */
  cost: number;
  /** Part of `cost` that must be new money. */
  cash: number;
  /** Cents already spent (owned CCUs) — only counts for `longterm`. */
  paid: number;
  label: string;
  ref?: number;
}

export interface Plan {
  steps: Step[];
  /** Total cents to spend now. */
  total: number;
  /** Part that must be new money. */
  cash: number;
  /** Already-spent money the chain consumes (owned CCUs). */
  paid: number;
  /** Baseline: msrp(target) − msrp(start), or msrp(target) when buying from the store. */
  msrpDiff: number;
  /** msrpDiff − total. */
  savings: number;
}

export interface PlanOptions {
  warbond: boolean;
  buyback: boolean;
  /** Skip limited-stock SKUs that show 0 left. */
  inStockOnly: boolean;
  objective: Objective;
  /** Standard / limited / buyback / standalone steps can be paid with store credit (only warbond is new money). */
  storeCredit: boolean;
  /** Skip hangar CCUs you received as gifts. */
  excludeGifted: boolean;
  /** Owned / buyback refs that must appear in the chain (routed through in MSRP order). */
  include: number[];
  /** Owned / buyback refs never used (force exclude, reserved by saved chains). */
  exclude: number[];
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  warbond: true,
  buyback: false,
  inStockOnly: true,
  objective: 'spend',
  storeCredit: true,
  excludeGifted: false,
  include: [],
  exclude: [],
};

function skuKind(title: string): EdgeKind {
  if (isWarbondSku({ title })) return 'warbond';
  if (/standard/i.test(title) || !title) return 'standard';
  return 'limited';
}

/** Lexicographic ranking of a path for the objective; lower wins. */
function rank(opt: PlanOptions, cost: number, cash: number, paid: number, steps: number): number[] {
  switch (opt.objective) {
    case 'cash':
      return [cash, cost, steps];
    case 'longterm':
      return [cost + paid, steps];
    default:
      return [cost, steps];
  }
}
const less = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
};

interface Graph {
  byId: Map<number, CatalogShip>;
  edges: (fromId: number) => Step[];
}

function graph(ships: CatalogShip[], owned: OwnedCcu[], opt: PlanOptions, storeStart: boolean): Graph {
  const byId = new Map(ships.map((s) => [s.id, s]));
  const offers: { to: CatalogShip; price: number; kind: EdgeKind; title: string }[] = [];
  const starts: Step[] = [];
  for (const s of ships) {
    for (const k of s.ccu) {
      if (!k.available || (opt.inStockOnly && k.stock === 0)) continue;
      const kind = skuKind(k.title);
      if (kind === 'warbond' && !opt.warbond) continue;
      offers.push({ to: s, price: k.price, kind, title: k.title || 'Standard' });
    }
    if (storeStart)
      for (const k of s.standalone) {
        if (!k.available || (opt.inStockOnly && k.stock === 0)) continue;
        const wb = isWarbondSku(k);
        if (wb && !opt.warbond) continue;
        starts.push({ fromId: STORE_START, toId: s.id, kind: 'standalone', cost: k.price, cash: wb || !opt.storeCredit ? k.price : 0, paid: 0, label: k.title || 'Standalone' });
      }
  }
  const excluded = new Set(opt.exclude);
  const ownedFrom = new Map<number, OwnedCcu[]>();
  for (const o of owned) {
    if (excluded.has(o.ref) || (o.source === 'buyback' && !opt.buyback) || (o.gifted && opt.excludeGifted)) continue;
    (ownedFrom.get(o.fromId) ?? ownedFrom.set(o.fromId, []).get(o.fromId)!).push(o);
  }
  const edges = (fromId: number): Step[] => {
    if (fromId === STORE_START) return starts;
    const a = byId.get(fromId);
    if (!a) return [];
    const out: Step[] = [];
    for (const o of offers) {
      if (o.to.id === a.id || o.price <= a.msrp) continue;
      const cost = o.price - a.msrp;
      out.push({ fromId: a.id, toId: o.to.id, kind: o.kind, cost, cash: o.kind === 'warbond' || !opt.storeCredit ? cost : 0, paid: 0, label: o.title });
    }
    for (const o of ownedFrom.get(a.id) ?? []) {
      const to = byId.get(o.toId);
      if (!to) continue;
      if (o.source === 'hangar') out.push({ fromId: a.id, toId: to.id, kind: 'owned', cost: 0, cash: 0, paid: o.value, label: 'Owned CCU', ref: o.ref });
      else {
        const cost = Math.max(0, to.msrp - a.msrp);
        out.push({ fromId: a.id, toId: to.id, kind: 'buyback', cost, cash: opt.storeCredit ? 0 : cost, paid: 0, label: 'Buyback CCU', ref: o.ref });
      }
    }
    return out;
  };
  return { byId, edges };
}

/** Dijkstra from `startId` to `targetId` on the ranked cost. n ≈ 250 ships → simple array scan is fine. */
function route(g: Graph, opt: PlanOptions, startId: number, targetId: number): Step[] | null {
  if (startId === targetId) return [];
  type D = { cost: number; cash: number; paid: number; steps: number; prev: Step | null };
  const dist = new Map<number, D>([[startId, { cost: 0, cash: 0, paid: 0, steps: 0, prev: null }]]);
  const key = (d: D) => rank(opt, d.cost, d.cash, d.paid, d.steps);
  const done = new Set<number>();
  for (;;) {
    let cur: number | null = null;
    for (const [id, d] of dist) {
      if (done.has(id)) continue;
      if (cur == null || less(key(d), key(dist.get(cur)!))) cur = id;
    }
    if (cur == null || cur === targetId) break;
    done.add(cur);
    const here = dist.get(cur)!;
    for (const e of g.edges(cur)) {
      const next: D = { cost: here.cost + e.cost, cash: here.cash + e.cash, paid: here.paid + e.paid, steps: here.steps + 1, prev: e };
      const old = dist.get(e.toId);
      if (!old || less(key(next), key(old))) dist.set(e.toId, next);
    }
  }
  const end = dist.get(targetId);
  if (!end) return null;
  const steps: Step[] = [];
  for (let s = end.prev; s; s = dist.get(s.fromId)!.prev) steps.unshift(s);
  return steps;
}

/**
 * Best chain from `startId` (a ship id, or `STORE_START` to buy one first) to `targetId`.
 * Forced CCUs (`opt.include`) are visited in order of their source ship's MSRP; null when any leg is impossible.
 */
export function plan(ships: CatalogShip[], owned: OwnedCcu[], startId: number, targetId: number, opt: PlanOptions = DEFAULT_PLAN_OPTIONS): Plan | null {
  const storeStart = startId === STORE_START;
  const g = graph(ships, owned, opt, storeStart);
  const start = storeStart ? null : g.byId.get(startId);
  const target = g.byId.get(targetId);
  if ((!storeStart && !start) || !target || startId === targetId) return null;

  const forced = opt.include
    .map((ref) => owned.find((o) => o.ref === ref))
    .filter((o): o is OwnedCcu => !!o && !opt.exclude.includes(o.ref) && g.byId.has(o.fromId) && g.byId.has(o.toId))
    .sort((a, b) => g.byId.get(a.fromId)!.msrp - g.byId.get(b.fromId)!.msrp);

  const steps: Step[] = [];
  let at = startId;
  for (const o of forced) {
    const leg = route(g, opt, at, o.fromId);
    const edge = g.edges(o.fromId).find((e) => e.ref === o.ref);
    if (!leg || !edge) return null;
    steps.push(...leg, edge);
    at = o.toId;
  }
  const last = route(g, opt, at, targetId);
  if (!last) return null;
  steps.push(...last);
  if (!steps.length) return null;

  const total = steps.reduce((n, s) => n + s.cost, 0);
  const cash = steps.reduce((n, s) => n + s.cash, 0);
  const paid = steps.reduce((n, s) => n + s.paid, 0);
  const msrpDiff = target.msrp - (start?.msrp ?? 0);
  return { steps, total, cash, paid, msrpDiff, savings: msrpDiff - total };
}

export interface SavedChain {
  id: string;
  name: string;
  /** Saved at (ms). */
  at: number;
  startId: number;
  targetId: number;
  steps: Step[];
  total: number;
  cash: number;
  opt: PlanOptions;
}

/** Refs of owned / buyback CCUs a set of chains already uses (to keep them out of new plans). */
export function reservedRefs(chains: { steps: Step[] }[]): number[] {
  return [...new Set(chains.flatMap((c) => c.steps.map((s) => s.ref).filter((r): r is number => r != null)))];
}

/**
 * CCUs you hold (hangar) or can buy back, mapped onto catalog ship ids. Upgrade JSON ids are trusted when the
 * catalog has that id *and* its name matches; otherwise the names are matched (`matchShip`). Unmapped ones are
 * returned for display.
 */
export function ownedCcus(
  pledges: { id: number; name: string; value?: number; upgrade: { fromId: number | null; fromName: string; toId: number | null; toName: string } | null }[],
  buyback: { id: number; name: string; upgrade: { fromId: number | null; fromName: string; toId: number | null; toName: string } | null }[],
  ships: CatalogShip[],
): { owned: OwnedCcu[]; unmapped: { name: string; source: 'hangar' | 'buyback' }[] } {
  const byId = new Map(ships.map((s) => [s.id, s]));
  const resolve = (id: number | null, name: string) => {
    const s = id != null ? byId.get(id) : undefined;
    if (s && (!name || shipKey(name).includes(shipKey(s.name)) || shipKey(s.name).includes(shipKey(name)))) return s;
    return name ? matchShip(name, ships) : null;
  };
  const owned: OwnedCcu[] = [];
  const unmapped: { name: string; source: 'hangar' | 'buyback' }[] = [];
  const add = (list: typeof pledges, source: 'hangar' | 'buyback') => {
    for (const p of list) {
      if (!p.upgrade) continue;
      const from = resolve(p.upgrade.fromId, p.upgrade.fromName);
      const to = resolve(p.upgrade.toId, p.upgrade.toName);
      const value = Math.round((p.value ?? 0) * 100);
      if (from && to && from.id !== to.id) owned.push({ fromId: from.id, toId: to.id, ref: p.id, source, value, gifted: source === 'hangar' && value === 0 });
      else unmapped.push({ name: p.name, source });
    }
  };
  add(pledges, 'hangar');
  add(buyback, 'buyback');
  return { owned, unmapped };
}

/** Ships you own outright (single-ship / combo pledges, upgraded ships count as their current hull). */
export function ownedShips(pledges: { ships: string[] }[], ships: CatalogShip[]): CatalogShip[] {
  const out = new Map<number, CatalogShip>();
  for (const p of pledges) for (const t of p.ships) {
    const s = matchShip(t, ships);
    if (s) out.set(s.id, s);
  }
  return [...out.values()].sort((a, b) => a.msrp - b.msrp);
}
