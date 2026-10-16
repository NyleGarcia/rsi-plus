/**
 * Cheapest CCU chain to a target ship, from a ship you own, any ship, or a ship bought from the store.
 * Edges out of ship A (msrp in cents):
 * - store: every on-sale CCU SKU of ship B with sku.price > msrp(A) → cost sku.price − msrp(A)
 *   (warbond SKUs need new money; standard/limited can be paid with store credit);
 * - owned: a CCU in your hangar A→B → cost 0 now; `paid` = its melt value (what it cost you);
 * - buyback (optional): a melted CCU A→B → cost ≈ msrp(B) − msrp(A) (buyback price; credit or cash);
 * - standalone (store start only): the virtual start → ship B with a standalone SKU on sale → cost sku.price;
 * - future (`planAhead`): ship B has no CCU on sale today → assume a standard CCU at msrp(B) when it returns
 *   (event sales: IAE, Invictus, the maker's showcase) → cost msrp(B) − msrp(A), bought later. Ranked after
 *   anything buyable now at the same price; `chainEvents` alerts when such a CCU shows up in the store.
 * Objective picks what is minimised (see `Objective`); ties → fewer waits, then fewer steps. Pure; inputs come from
 * the catalog + hangar/buyback caches.
 */
import { isWarbondSku, lowestOffer, matchShip, shipKey, usd, type CatalogShip } from './store';

export type EdgeKind = 'warbond' | 'standard' | 'limited' | 'owned' | 'buyback' | 'standalone' | 'future';

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
  /** Pledge id (owned) / buyback id (buyback). */
  ref?: number;
  /** Store SKU to add to the cart (store CCU / standalone steps; none on `future` steps). */
  skuId?: number;
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
  /** `future` steps: CCUs not on sale today, bought when they return (0 unless `planAhead`). */
  waits: number;
  /** Cents of `total` that belong to `future` steps — not payable today. */
  later: number;
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
  /** Route through ships with no CCU on sale today at MSRP (`future` steps) — long-term goals across event sales. */
  planAhead?: boolean;
  /** Stops: hulls the chain must pass through (to fly a while on the way), visited in MSRP order. */
  via?: number[];
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
  planAhead: false,
  via: [],
};

function skuKind(title: string): EdgeKind {
  if (isWarbondSku({ title })) return 'warbond';
  if (/standard/i.test(title) || !title) return 'standard';
  return 'limited';
}

/** Lexicographic ranking of a path for the objective; lower wins. Waiting for a sale loses to buying today. */
function rank(opt: PlanOptions, cost: number, cash: number, paid: number, waits: number, steps: number): number[] {
  switch (opt.objective) {
    case 'cash':
      return [cash, cost, waits, steps];
    case 'longterm':
      return [cost + paid, waits, steps];
    default:
      return [cost, waits, steps];
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
  const offers: { to: CatalogShip; price: number; kind: EdgeKind; title: string; skuId?: number }[] = [];
  const starts: Step[] = [];
  for (const s of ships) {
    let onSale = false;
    for (const k of s.ccu) {
      if (!k.available || (opt.inStockOnly && k.stock === 0)) continue;
      const kind = skuKind(k.title);
      if (kind === 'warbond' && !opt.warbond) continue;
      offers.push({ to: s, price: k.price, kind, title: k.title || 'Standard', skuId: k.id });
      onSale = true;
    }
    // Nothing sells a CCU to this hull today: with planAhead, assume a standard CCU at MSRP when it next returns.
    if (opt.planAhead && !onSale && s.msrp > 0) offers.push({ to: s, price: s.msrp, kind: 'future', title: 'Not on sale now' });
    if (storeStart)
      for (const k of s.standalone) {
        if (!k.available || (opt.inStockOnly && k.stock === 0)) continue;
        const wb = isWarbondSku(k);
        if (wb && !opt.warbond) continue;
        starts.push({ fromId: STORE_START, toId: s.id, kind: 'standalone', cost: k.price, cash: wb || !opt.storeCredit ? k.price : 0, paid: 0, label: k.title || 'Standalone', skuId: k.id });
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
      out.push({ fromId: a.id, toId: o.to.id, kind: o.kind, cost, cash: o.kind === 'warbond' || !opt.storeCredit ? cost : 0, paid: 0, label: o.title, ...(o.skuId != null ? { skuId: o.skuId } : {}) });
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
  type D = { cost: number; cash: number; paid: number; waits: number; steps: number; prev: Step | null };
  const dist = new Map<number, D>([[startId, { cost: 0, cash: 0, paid: 0, waits: 0, steps: 0, prev: null }]]);
  const key = (d: D) => rank(opt, d.cost, d.cash, d.paid, d.waits, d.steps);
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
      const next: D = { cost: here.cost + e.cost, cash: here.cash + e.cash, paid: here.paid + e.paid, waits: here.waits + (e.kind === 'future' ? 1 : 0), steps: here.steps + 1, prev: e };
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
 * Stops — forced CCUs (`opt.include`) and hulls to pass through (`opt.via`) — are visited in order of the MSRP of the
 * hull they start from; null when any leg is impossible (a stop not above the previous one, not reachable…).
 */
export function plan(ships: CatalogShip[], owned: OwnedCcu[], startId: number, targetId: number, opt: PlanOptions = DEFAULT_PLAN_OPTIONS): Plan | null {
  const storeStart = startId === STORE_START;
  const g = graph(ships, owned, opt, storeStart);
  const start = storeStart ? null : g.byId.get(startId);
  const target = g.byId.get(targetId);
  if ((!storeStart && !start) || !target || startId === targetId) return null;

  type Stop = { msrp: number; ccu: OwnedCcu } | { msrp: number; via: number };
  const stops: Stop[] = [
    ...opt.include
      .map((ref) => owned.find((o) => o.ref === ref))
      .filter((o): o is OwnedCcu => !!o && !opt.exclude.includes(o.ref) && g.byId.has(o.fromId) && g.byId.has(o.toId))
      .map((ccu) => ({ msrp: g.byId.get(ccu.fromId)!.msrp, ccu })),
    ...(opt.via ?? []).filter((id) => id !== startId && id !== targetId).map((via) => ({ msrp: g.byId.get(via)?.msrp ?? -1, via })),
  ].sort((a, b) => a.msrp - b.msrp);

  const steps: Step[] = [];
  let at = startId;
  for (const st of stops) {
    if ('via' in st) {
      if (st.msrp < 0) return null;
      const leg = route(g, opt, at, st.via);
      if (!leg || (at !== st.via && !leg.length)) return null;
      steps.push(...leg);
      at = st.via;
      continue;
    }
    const o = st.ccu;
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
  const future = steps.filter((s) => s.kind === 'future');
  return { steps, total, cash, paid, msrpDiff, savings: msrpDiff - total, waits: future.length, later: future.reduce((n, s) => n + s.cost, 0) };
}

export interface SavedChain {
  id: string;
  name: string;
  /** Fleet plan the chain was saved from (its name) — chains of one plan list together. */
  group?: string;
  /** Saved at (ms). */
  at: number;
  startId: number;
  targetId: number;
  steps: Step[];
  total: number;
  cash: number;
  opt: PlanOptions;
}

// ---- fleet plan: several goals at once ----

/** One ship you want: from a hull (or `STORE_START`, or `null` = pick the best source for me), via stops, to a target. */
export interface Goal {
  id: string;
  fromId: number | null;
  targetId: number;
  via: number[];
}
export interface FleetLeg {
  goal: Goal;
  /** Source used (the picked one for an auto goal); null when nothing could start the chain. */
  startId: number | null;
  plan: Plan | null;
  auto: boolean;
  /** Planned ahead although the option is off: no chain with today's sales (target not on sale — an Orion, an Arrastra). */
  ahead: boolean;
}
export interface FleetPlan {
  legs: FleetLeg[];
  total: number;
  cash: number;
  paid: number;
  later: number;
  waits: number;
  msrpDiff: number;
  savings: number;
  /** Goals with no chain. */
  failed: number;
}
export interface FleetOptions {
  /** Hull copies you own that can be upgraded (one copy per goal). */
  hulls: { id: number; count: number }[];
  /** Hulls an auto goal never upgrades (ones you want to keep flying). */
  keep?: number[];
  /** Hulls an auto goal upgrades first when one of them gets there (cheap LTI tokens, ships you don't fly). */
  prefer?: number[];
  /** An auto goal may start by buying a ship from the store. */
  storeStart?: boolean;
}

/** Auto source choice: most saved vs MSRP, then least to pay now, then fewest waits. */
const better = (a: Plan, b: Plan) => a.savings !== b.savings ? a.savings > b.savings : a.total - a.later !== b.total - b.later ? a.total - a.later < b.total - b.later : a.waits < b.waits;

/**
 * Plans several goals together, in the given order (= priority): each goal's chain may not reuse an owned / buyback
 * CCU an earlier goal took, and each owned hull copy starts at most one chain (goals with a fixed source claim theirs
 * first). An auto goal (`fromId: null`) tries every free hull copy cheaper than the target (not in `keep`) and, with
 * `storeStart`, buying from the store, and keeps the one that saves most. `opt.include` / `opt.via` are ignored —
 * stops are per goal.
 */
export function planFleet(ships: CatalogShip[], owned: OwnedCcu[], goals: Goal[], opt: PlanOptions, fo: FleetOptions): FleetPlan {
  const byId = new Map(ships.map((s) => [s.id, s]));
  const free = new Map(fo.hulls.map((h) => [h.id, h.count]));
  for (const g of goals) if (g.fromId != null && free.get(g.fromId)) free.set(g.fromId, free.get(g.fromId)! - 1);
  const keep = new Set(fo.keep ?? []);
  const used = new Set<number>();
  const legs: FleetLeg[] = [];
  for (const goal of goals) {
    const o: PlanOptions = { ...opt, include: [], via: goal.via, exclude: [...new Set([...opt.exclude, ...used])] };
    let startId = goal.fromId;
    let best: Plan | null = null;
    let ahead = false;
    const target = byId.get(goal.targetId);
    const cands = goal.fromId != null ? [goal.fromId] : [...free].filter(([id, n]) => n > 0 && !keep.has(id) && (byId.get(id)?.msrp ?? Infinity) < (target?.msrp ?? 0)).map(([id]) => id);
    if (goal.fromId == null && fo.storeStart) cands.push(STORE_START);
    // Today's sales first; only when no source gets there, plan ahead (waiting for the target's CCU to return).
    // Within a pass, preferred hulls first: the best of them wins over any other hull.
    const pref = new Set(fo.prefer ?? []);
    const groups = [cands.filter((c) => pref.has(c)), cands.filter((c) => !pref.has(c))];
    search: for (const pass of o.planAhead ? [o] : [o, { ...o, planAhead: true }]) {
      for (const group of groups) {
        for (const c of group) {
          const p = plan(ships, owned, c, goal.targetId, pass);
          if (p && (!best || better(p, best))) (best = p), (startId = c);
        }
        if (best) {
          ahead = pass !== o;
          break search;
        }
      }
    }
    if (goal.fromId == null && best && startId != null && startId !== STORE_START) free.set(startId, free.get(startId)! - 1);
    for (const r of reservedRefs(best ? [best] : [])) used.add(r);
    legs.push({ goal, startId: best ? startId : goal.fromId, plan: best, auto: goal.fromId == null, ahead });
  }
  const sum = (f: (p: Plan) => number) => legs.reduce((n, l) => n + (l.plan ? f(l.plan) : 0), 0);
  return { legs, total: sum((p) => p.total), cash: sum((p) => p.cash), paid: sum((p) => p.paid), later: sum((p) => p.later), waits: sum((p) => p.waits), msrpDiff: sum((p) => p.msrpDiff), savings: sum((p) => p.savings), failed: legs.filter((l) => !l.plan).length };
}

/** Refs of owned / buyback CCUs a set of chains already uses (to keep them out of new plans). */
export function reservedRefs(chains: { steps: Step[] }[]): number[] {
  return [...new Set(chains.flatMap((c) => c.steps.map((s) => s.ref).filter((r): r is number => r != null)))];
}

/**
 * Saved chains with `future` steps are long-term goals: when the store starts selling a CCU to one of those hulls
 * (any SKU, in stock), one feed event per chain step + SKU — "X → Y is on sale now, $N (planned $M)". The feed's
 * key dedup keeps it to one alert per SKU appearance; the event opens the CCU planner.
 */
export function chainEvents(chains: SavedChain[], ships: CatalogShip[], now: number): import('./watch').FeedEvent[] {
  const byId = new Map(ships.map((s) => [s.id, s]));
  const events: import('./watch').FeedEvent[] = [];
  for (const c of chains) {
    for (const s of c.steps) {
      if (s.kind !== 'future') continue;
      const from = byId.get(s.fromId);
      const to = byId.get(s.toId);
      if (!from || !to) continue;
      const o = lowestOffer({ ...to, standalone: [] });
      if (!o) continue;
      const sku = to.ccu.find((k) => k.price === o.price && k.available && k.stock !== 0);
      const cost = o.price - from.msrp;
      if (cost <= 0 || !sku) continue;
      events.push({
        key: `ccu:${c.id}:${s.fromId}>${s.toId}:${sku.id}`,
        kind: 'store',
        title: `${c.name}: ${from.name} → ${to.name} CCU on sale — ${usd(cost)}`,
        body: `${o.title} · planned ${usd(s.cost)} · open the CCU planner to re-check the chain`,
        url: 'hub.html#ccu',
        at: now,
        seen: false,
      });
    }
  }
  return events;
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

/** Hull copies you own (one per pledge listing it) — what a fleet plan can upgrade. */
export function ownedHulls(pledges: { ships: string[] }[], ships: CatalogShip[]): { id: number; count: number }[] {
  const n = new Map<number, number>();
  for (const p of pledges) for (const t of p.ships) {
    const s = matchShip(t, ships);
    if (s) n.set(s.id, (n.get(s.id) ?? 0) + 1);
  }
  return [...n].map(([id, count]) => ({ id, count }));
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
