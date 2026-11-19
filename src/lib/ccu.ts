/**
 * Cheapest CCU chain to a target ship, from a ship you own, any ship, or a ship bought from the store.
 * Edges out of ship A (msrp in cents):
 * - store: every on-sale CCU SKU of ship B with sku.price > msrp(A) and msrp(B) > msrp(A) → cost sku.price − msrp(A)
 *   (warbond SKUs need new money; standard/limited can be paid with store credit);
 * - owned: a CCU in your hangar A→B → cost 0 now; `paid` = its melt value (what it cost you);
 * - buyback (optional): a melted CCU A→B → cost ≈ msrp(B) − msrp(A) (buyback price; credit or cash);
 * - standalone (store start only): the virtual start → ship B with a standalone SKU on sale → cost sku.price;
 * - future (`planAhead`): ship B has no CCU on sale today → assume a standard CCU at msrp(B) when it returns
 *   (event sales: IAE, Invictus, the maker's showcase) → cost msrp(B) − msrp(A), bought later. Ranked after
 *   anything buyable now at the same price; `chainEvents` alerts when such a CCU shows up in the store.
 * Objective picks what is minimised (see `Objective`); ties → fewer waits, then fewer steps (or more steps that save money, `PlanOptions.steps`). Pure; inputs come from
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
  /** Buyback only: what RSI asks to buy it back today (cents), once the entry's own page was read (Buyback page → Load contents & prices). */
  price?: number;
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
  /** `future` step priced at the last sale price seen (not MSRP): when it was seen, and whether it was a warbond CCU. */
  est?: { at: number; wb: boolean };
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
  /** Steps that save money (cost below the MSRP difference they cover: an owned CCU, a CCU on sale): see `saves`. */
  useful?: number;
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
  /** Store SKUs (CCU / standalone) never used: steps ignored from a chain, so the planner routes around that offer. */
  skip?: number[];
  /**
   * Price a "wait for a sale" step at the last CCU price seen below MSRP (`CatalogShip.expect`) instead of MSRP.
   * Default on; a CCU on sale today is always used at today's price, history only fills in for what is not sold now.
   */
  lastSeen?: boolean;
  /** Hulls the chain never waits for: a "wait for a sale" step to one of them was skipped, so the chain goes another way. */
  noWait?: number[];
  /** Use the CCUs in your hangar (default on). Off: plan as if you owned none — what the route costs bought fresh, and your CCUs stay free for other chains. */
  useOwned?: boolean;
  /**
   * Tie-break after cost and waits: `fewer` steps (default, also when unset) or `more` — more steps that *save money*
   * (`saves`), then fewer steps: a step bought at the plain MSRP difference saves nothing, so it never makes a chain
   * longer. Never changes the cost of the chain — only which of the equally priced chains is shown.
   */
  steps?: StepsPreference;
  /**
   * Store start limited to these standalone SKUs (e.g. the ones that come with LTI, from Browse's listing); unset = any
   * standalone on sale.
   */
  startSkus?: number[];
}

export type StepsPreference = 'fewer' | 'more';

/**
 * What a chain really saves against the MSRP gap: what is still to pay AND what its owned CCUs cost you both count.
 * (`savings` alone treats owned CCUs as free — right for ranking chains by what is left to spend, wrong as a headline.)
 */
export const savedVsMsrp = (p: Pick<Plan, 'savings' | 'paid'>): number => p.savings - p.paid;

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
  skip: [],
  steps: 'fewer',
  noWait: [],
  useOwned: true,
};

function skuKind(title: string): EdgeKind {
  if (isWarbondSku({ title })) return 'warbond';
  if (/standard/i.test(title) || !title) return 'standard';
  return 'limited';
}

/** Running totals of a path (one per node in Dijkstra). */
interface Dist {
  cost: number;
  cash: number;
  paid: number;
  waits: number;
  steps: number;
  /** Steps so far that save money (`saves`). */
  useful: number;
  prev: Step | null;
  id: number;
  /** MSRP of the node (0 for the store start): orders equally ranked nodes when more steps are preferred. */
  msrp: number;
  /** Order the node was first reached: ties settle the earliest one (the old linear scan's order). */
  seq: number;
}

/** What a path is ranked on: running totals (a Dijkstra node, or a whole `Plan` with `steps` = its length). */
type Ranked = { cost: number; cash: number; paid: number; waits: number; steps: number; useful: number };

/**
 * What a step that waits for a sale must save over buying today to be worth the wait (cents). A wait is a bet: the
 * CCU may not come back, or not at the price last seen. Without this, a chain of many cheap past warbond prices
 * always beats one CCU you can buy now, and a plan turns into a dozen things to wait for. Ranking only — the totals
 * shown are the real prices.
 */
export const WAIT_RISK = 2500;

/** Cost part of the ranking (objective with `WAIT_RISK` per waiting step, then waits): -1 / 0 / 1. */
function rank(objective: Objective, a: Ranked, b: Ranked): number {
  const ra = a.waits * WAIT_RISK;
  const rb = b.waits * WAIT_RISK;
  if (objective === 'cash') {
    if (a.cash + ra !== b.cash + rb) return a.cash + ra < b.cash + rb ? -1 : 1;
    if (a.cost + ra !== b.cost + rb) return a.cost + ra < b.cost + rb ? -1 : 1;
  } else if (objective === 'longterm') {
    const x = a.cost + a.paid + ra;
    const y = b.cost + b.paid + rb;
    if (x !== y) return x < y ? -1 : 1;
  } else if (a.cost + ra !== b.cost + rb) return a.cost + ra < b.cost + rb ? -1 : 1;
  if (a.waits !== b.waits) return a.waits < b.waits ? -1 : 1;
  return 0;
}

/**
 * Lexicographic ranking of a path for the objective; true when `a` beats `b`. Waiting for a sale loses to buying today;
 * then fewer steps, or more with `steps: 'more'`.
 */
function before(objective: Objective, steps: StepsPreference | undefined, a: Ranked, b: Ranked): boolean {
  const r = rank(objective, a, b);
  if (r) return r < 0;
  if (steps === 'more' && a.useful !== b.useful) return a.useful > b.useful;
  return a.steps < b.steps;
}

/**
 * A step that saves money: it costs less than the MSRP difference it covers (`fromMsrp` 0 for the store start) — an
 * owned CCU, a CCU on sale, a discounted standalone. A step at the plain difference is a ship to stop at, nothing more.
 */
export const saves = (cost: number, fromMsrp: number, toMsrp: number) => cost < toMsrp - fromMsrp;

/** True when chain `a` beats chain `b` for these options (the planner's own order: objective, waits, steps). */
export function planBefore(opt: Pick<PlanOptions, 'objective' | 'steps'>, a: Plan, b: Plan): boolean {
  return before(opt.objective, opt.steps, { ...a, cost: a.total, steps: a.steps.length, useful: a.useful ?? 0 }, { ...b, cost: b.total, steps: b.steps.length, useful: b.useful ?? 0 });
}

/**
 * The CCU graph for one set of options (warbond / buyback / stock / credit / gifted / exclude / planAhead — not the
 * objective, start, target or stops). Build it once and pass it to `plan` for every start and target with those
 * options; each node's out-edges are built on first use and reused.
 */
export interface PlanGraph {
  byId: Map<number, CatalogShip>;
  edges: (fromId: number) => Step[];
}

export function planGraph(ships: CatalogShip[], owned: OwnedCcu[], opt: PlanOptions): PlanGraph {
  const byId = new Map(ships.map((s) => [s.id, s]));
  const offers: { to: CatalogShip; price: number; kind: EdgeKind; title: string; skuId?: number; est?: { at: number; wb: boolean } }[] = [];
  const starts: Step[] = [];
  const skip = new Set(opt.skip ?? []);
  const noWait = new Set(opt.noWait ?? []);
  const startOk = opt.startSkus ? new Set(opt.startSkus) : null;
  for (const s of ships) {
    let onSale = false;
    for (const k of s.ccu) {
      if (!k.available || (opt.inStockOnly && k.stock === 0)) continue;
      const kind = skuKind(k.title);
      if (kind === 'warbond' && !opt.warbond) continue;
      // An ignored offer is still on sale: the hull must not turn into a "wait for a sale" step at MSRP instead.
      if (skip.has(k.id)) {
        onSale = true;
        continue;
      }
      offers.push({ to: s, price: k.price, kind, title: k.title || 'Standard', skuId: k.id });
      onSale = true;
    }
    // Nothing sells a CCU to this hull today: with planAhead, assume a standard CCU at MSRP when it next returns.
    if (opt.planAhead && !onSale && s.msrp > 0 && !noWait.has(s.id)) {
      // Last sale price seen, when there is one below MSRP (the cheaper of standard and — if allowed — warbond).
      const e = opt.lastSeen === false ? undefined : s.expect;
      const wb = opt.warbond ? e?.wb : undefined;
      const pick = wb && (!e?.std || wb.price < e.std.price) ? { ...wb, wb: true } : e?.std ? { ...e.std, wb: false } : null;
      if (pick && pick.price < s.msrp) offers.push({ to: s, price: pick.price, kind: 'future', title: pick.wb ? 'Last seen warbond price' : 'Last seen sale price', est: { at: pick.at, wb: pick.wb } });
      else offers.push({ to: s, price: s.msrp, kind: 'future', title: 'Not on sale now' });
    }
    for (const k of s.standalone) {
      if (!k.available || (opt.inStockOnly && k.stock === 0) || skip.has(k.id) || (startOk && !startOk.has(k.id))) continue;
      const wb = isWarbondSku(k);
      if (wb && !opt.warbond) continue;
      starts.push({ fromId: STORE_START, toId: s.id, kind: 'standalone', cost: k.price, cash: wb || !opt.storeCredit ? k.price : 0, paid: 0, label: k.title || 'Standalone', skuId: k.id });
    }
  }
  const excluded = new Set(opt.exclude);
  const ownedFrom = new Map<number, OwnedCcu[]>();
  for (const o of owned) {
    if (excluded.has(o.ref) || (o.source === 'buyback' && !opt.buyback) || (o.source === 'hangar' && opt.useOwned === false) || (o.gifted && opt.excludeGifted)) continue;
    (ownedFrom.get(o.fromId) ?? ownedFrom.set(o.fromId, []).get(o.fromId)!).push(o);
  }
  const adj = new Map<number, Step[]>();
  const edges = (fromId: number): Step[] => {
    if (fromId === STORE_START) return starts;
    const hit = adj.get(fromId);
    if (hit) return hit;
    const a = byId.get(fromId);
    if (!a) return [];
    const out: Step[] = [];
    for (const o of offers) {
      // RSI only sells CCUs up: the target must be worth more than the hull it starts from.
      if (o.to.id === a.id || o.price <= a.msrp || o.to.msrp <= a.msrp) continue;
      const cost = o.price - a.msrp;
      out.push({ fromId: a.id, toId: o.to.id, kind: o.kind, cost, cash: o.kind === 'warbond' || o.est?.wb || !opt.storeCredit ? cost : 0, paid: 0, label: o.title, ...(o.skuId != null ? { skuId: o.skuId } : {}), ...(o.est ? { est: o.est } : {}) });
    }
    for (const o of ownedFrom.get(a.id) ?? []) {
      const to = byId.get(o.toId);
      // Never step down: a CCU whose target now lists at or below its source (a price change, a name mapped to the
      // wrong hull) can't be applied usefully, and a buyback one would show as a free downgrade. Unpriced targets pass.
      if (!to || (to.msrp > 0 && to.msrp <= a.msrp)) continue;
      if (o.source === 'hangar') out.push({ fromId: a.id, toId: to.id, kind: 'owned', cost: 0, cash: 0, paid: o.value, label: 'Owned CCU', ref: o.ref });
      else {
        // RSI's own buy-back price when the entry's page was read; else the MSRP gap (what a standard CCU would cost)
        const cost = o.price ?? to.msrp - a.msrp;
        out.push({ fromId: a.id, toId: to.id, kind: 'buyback', cost, cash: opt.storeCredit ? 0 : cost, paid: 0, label: 'Buyback CCU', ref: o.ref });
      }
    }
    adj.set(fromId, out);
    return out;
  };
  return { byId, edges };
}

/**
 * Dijkstra from `startId` to `targetId` on the ranked cost, binary heap with lazy deletion. Every edge costs ≥ 0 and a
 * settled node is never updated again, so each node is expanded once and the `prev` links form a tree (no loop, even
 * through a zero-cost cycle of owned CCUs to an unpriced hull).
 *
 * Fewer steps: the step count is part of the order (an extra edge never makes a path better), plain Dijkstra.
 * More steps: an extra zero-cost edge (an owned CCU) does make a path better, so the heap pops equally ranked nodes
 * cheapest hull first instead — a zero-cost edge goes up in MSRP, so every zero-cost way into a node is relaxed before
 * the node is settled with the most steps. Cost and waits stay primary in both.
 */
function route(g: PlanGraph, opt: Pick<PlanOptions, 'objective' | 'steps'>, startId: number, targetId: number): Step[] | null {
  if (startId === targetId) return [];
  const { objective, steps: pref } = opt;
  let seq = 0;
  const msrpOf = (id: number) => (id === STORE_START ? 0 : (g.byId.get(id)?.msrp ?? 0));
  const first: Dist = { cost: 0, cash: 0, paid: 0, waits: 0, steps: 0, useful: 0, prev: null, id: startId, msrp: msrpOf(startId), seq: seq++ };
  const dist = new Map<number, Dist>([[startId, first]]);
  const done = new Set<number>();
  const lt =
    pref === 'more'
      ? (a: Dist, b: Dist) => {
          const r = rank(objective, a, b);
          return r ? r < 0 : a.msrp !== b.msrp ? a.msrp < b.msrp : a.seq < b.seq;
        }
      : (a: Dist, b: Dist) => before(objective, pref, a, b) || (!before(objective, pref, b, a) && a.seq < b.seq);
  const heap: Dist[] = [first];
  const push = (d: Dist) => {
    let i = heap.push(d) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!lt(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const pop = (): Dist => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && lt(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && lt(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!];
        i = m;
      }
    }
    return top;
  };
  const cand: Dist = { ...first };
  while (heap.length) {
    const here = pop();
    // Stale entry: the node was settled, or reached more cheaply since this one was queued.
    if (done.has(here.id) || dist.get(here.id) !== here) continue;
    if (here.id === targetId) break;
    done.add(here.id);
    for (const e of g.edges(here.id)) {
      if (done.has(e.toId)) continue;
      const old = dist.get(e.toId);
      // Compare in a scratch record; allocate only when the edge improves the node.
      cand.cost = here.cost + e.cost;
      cand.cash = here.cash + e.cash;
      cand.paid = here.paid + e.paid;
      cand.waits = here.waits + (e.kind === 'future' ? 1 : 0);
      cand.steps = here.steps + 1;
      cand.useful = here.useful + (saves(e.cost, here.msrp, msrpOf(e.toId)) ? 1 : 0);
      if (old && !before(objective, pref, cand, old)) continue;
      const next: Dist = { ...cand, prev: e, id: e.toId, msrp: msrpOf(e.toId), seq: old ? old.seq : seq++ };
      dist.set(e.toId, next);
      push(next);
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
 * `g`: a `planGraph` built from the same ships / owned / options, to share it across many plans.
 */
export function plan(ships: CatalogShip[], owned: OwnedCcu[], startId: number, targetId: number, opt: PlanOptions = DEFAULT_PLAN_OPTIONS, g: PlanGraph = planGraph(ships, owned, opt)): Plan | null {
  const storeStart = startId === STORE_START;
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
  const msrpOf = (id: number) => (id === STORE_START ? 0 : (g.byId.get(id)?.msrp ?? 0));
  const useful = steps.filter((s) => saves(s.cost, msrpOf(s.fromId), msrpOf(s.toId))).length;
  return { steps, total, cash, paid, msrpDiff, savings: msrpDiff - total, waits: future.length, later: future.reduce((n, s) => n + s.cost, 0), useful };
}

/**
 * When no chain gets to `targetId`: the hull with the highest MSRP below the target's that a chain from `startId` does
 * reach on graph `g` (same MSRP: the lower id). Null when nothing below the target is reachable, the target is unknown,
 * or the graph does reach the target — then the graph isn't what blocks the chain (a stop or a forced CCU is), and a
 * lower target would hit the same wall. Walks the graph only: stops / forced CCUs are the caller's (`plan`) to check.
 */
export function farthestReachable(g: PlanGraph, startId: number, targetId: number): number | null {
  const target = g.byId.get(targetId);
  if (!target) return null;
  const seen = new Set<number>([startId]);
  const todo = [startId];
  let best: CatalogShip | null = null;
  while (todo.length) {
    for (const e of g.edges(todo.pop()!)) {
      if (seen.has(e.toId)) continue;
      if (e.toId === targetId) return null;
      seen.add(e.toId);
      todo.push(e.toId);
      const s = g.byId.get(e.toId);
      if (s && s.id !== targetId && s.msrp < target.msrp && (!best || s.msrp > best.msrp || (s.msrp === best.msrp && s.id < best.id))) best = s;
    }
  }
  return best?.id ?? null;
}

/** A chain other than the best one, and what was taken out of the options to get it (to apply it in the planner). */
export interface Alternative {
  plan: Plan;
  /** Store SKUs (CCU / standalone) to add to `PlanOptions.skip`. */
  skip: number[];
  /** Owned / buyback refs to add to `PlanOptions.exclude`. */
  exclude: number[];
  /** Hulls to add to `PlanOptions.noWait` (a waiting step left out). */
  noWait: number[];
  /** The "own vs not" variant, planned by switching `PlanOptions.useOwned`. */
  useOwned?: boolean;
  /** This route uses none of / uses the CCUs in your hangar where the chain shown does the opposite: for the label. */
  tag?: 'without-owned' | 'with-owned';
}

/**
 * Identity of a chain as the user sees it: its steps' targets, kinds, SKU and prices. Not the owned / buyback ref — two
 * copies of the same CCU are the same route.
 */
const chainKey = (p: Plan) => p.steps.map((s) => `${s.toId}:${s.kind}:${s.skuId ?? ''}:${s.cost}:${s.paid}`).join('|');

/**
 * Up to `n` chains that differ from the best one and from each other, best first by the planner's order. Each one is
 * the best chain once one step of the best chain is taken out (a store SKU skipped, an owned / buyback CCU excluded —
 * with every other copy of that CCU, same hulls and source, a hull no longer waited for). With `steps: 'more'`,
 * a chain that only drops hulls of the best one (same ships minus a stop) isn't a different route and is left out.
 * One more may follow them: the route without (or with) the CCUs in your hangar, marked `useOwned`. Pure, like `plan`.
 */
export function planAlternatives(ships: CatalogShip[], owned: OwnedCcu[], startId: number, targetId: number, opt: PlanOptions, n = 3): Alternative[] {
  const best = plan(ships, owned, startId, targetId, opt);
  if (!best || n <= 0) return [];
  const seen = new Set([chainKey(best)]);
  const bestHulls = new Set(best.steps.map((s) => s.toId));
  const out: Alternative[] = [];
  for (const s of best.steps) {
    let alt: Alternative;
    if ((s.kind === 'owned' || s.kind === 'buyback') && s.ref != null) {
      if (opt.exclude.includes(s.ref)) continue;
      const source = s.kind === 'owned' ? 'hangar' : 'buyback';
      const refs = [...new Set([s.ref, ...owned.filter((c) => c.fromId === s.fromId && c.toId === s.toId && c.source === source && !opt.exclude.includes(c.ref)).map((c) => c.ref)])];
      const p = plan(ships, owned, startId, targetId, { ...opt, include: opt.include.filter((r) => !refs.includes(r)), exclude: [...opt.exclude, ...refs] });
      if (!p) continue;
      alt = { plan: p, skip: [], exclude: refs, noWait: [] };
    } else if (s.kind !== 'future' && s.skuId != null) {
      if ((opt.skip ?? []).includes(s.skuId)) continue;
      const p = plan(ships, owned, startId, targetId, { ...opt, skip: [...(opt.skip ?? []), s.skuId] });
      if (!p) continue;
      alt = { plan: p, skip: [s.skuId], exclude: [], noWait: [] };
    } else if (s.kind === 'future') {
      // a step that waits for a sale: the best chain that does not wait for that hull
      if ((opt.noWait ?? []).includes(s.toId)) continue;
      const p = plan(ships, owned, startId, targetId, { ...opt, noWait: [...(opt.noWait ?? []), s.toId] });
      if (!p) continue;
      alt = { plan: p, skip: [], exclude: [], noWait: [s.toId] };
    } else continue;
    const k = chainKey(alt.plan);
    if (seen.has(k)) continue;
    if (opt.steps === 'more' && alt.plan.steps.length < best.steps.length && alt.plan.steps.every((x) => bestHulls.has(x.toId))) continue;
    seen.add(k);
    out.push(alt);
  }
  const ranked = out.sort((a, b) => (planBefore(opt, a.plan, b.plan) ? -1 : planBefore(opt, b.plan, a.plan) ? 1 : 0)).slice(0, n);
  // Own vs not: the route without the CCUs in your hangar (when the best chain uses one), or with them (when they are
  // switched off) — always offered, on top of the `n` above, so the two can be compared.
  const flip = opt.useOwned === false ? owned.some((c) => c.source === 'hangar') : best.steps.some((s) => s.kind === 'owned');
  if (flip) {
    const useOwned = opt.useOwned === false;
    const p = plan(ships, owned, startId, targetId, { ...opt, useOwned, include: useOwned ? opt.include : [] });
    if (p && chainKey(p) !== chainKey(best)) {
      // the same chain as one already listed (the best chain used a single CCU of yours): mark that one, no second row
      const tag = useOwned ? 'with-owned' : 'without-owned';
      const same = ranked.find((x) => chainKey(x.plan) === chainKey(p));
      if (same) same.tag = tag;
      else ranked.push({ plan: p, skip: [], exclude: [], noWait: [], useOwned, tag });
    }
  }
  return ranked;
}

/** The planner options with an alternative's removals added (an excluded CCU is no longer forced in). */
export function applyAlternative(
  opt: Pick<PlanOptions, 'skip' | 'exclude' | 'include' | 'noWait' | 'useOwned'>,
  alt: Pick<Alternative, 'skip' | 'exclude'> & Partial<Pick<Alternative, 'noWait' | 'useOwned'>>,
): Pick<PlanOptions, 'skip' | 'exclude' | 'include' | 'noWait' | 'useOwned'> {
  return {
    skip: [...new Set([...(opt.skip ?? []), ...alt.skip])],
    exclude: [...new Set([...opt.exclude, ...alt.exclude])],
    include: alt.useOwned === false ? [] : opt.include.filter((r) => !alt.exclude.includes(r)),
    noWait: [...new Set([...(opt.noWait ?? []), ...(alt.noWait ?? [])])],
    useOwned: alt.useOwned ?? opt.useOwned,
  };
}

/**
 * One entry of *My chains*: a ship you want and how to get there. The list is planned together, top first (`planChains`):
 * an earlier chain gets first pick of your CCUs and hull copies. `steps` / `total` / `cash` / `startId` are the last
 * plan, kept so the Feed, the Pledges page and the CCUs page can say which CCUs a chain uses without planning.
 */
export interface SavedChain {
  id: string;
  name: string;
  /** Old saves: the fleet plan the chain was saved from. No longer written. */
  group?: string;
  /** Saved at (ms). */
  at: number;
  /** The source hull — for an `auto` chain, the one the last plan picked. */
  startId: number;
  targetId: number;
  steps: Step[];
  total: number;
  cash: number;
  /** This chain's options: objective, warbond / buyback…, stops (`via`), the CCUs you forced in or out. */
  opt: PlanOptions;
  /** The planner picks the source each time: the best free hull copy (or a store ship, with `storeStart`). */
  auto?: boolean;
  storeStart?: boolean;
  lti?: Goal['lti'];
  /** CCUs of this chain you have applied in the hangar (from RSI's hangar log), in the order they were found. */
  applied?: AppliedStep[];
  /** The chain is finished: its last CCU was applied, the target is in your hangar. No longer planned. */
  done?: { at: number; pledgeId: number; spent: number };
}

/** One CCU of a chain applied in the hangar. */
export interface AppliedStep {
  /** The CCU's pledge id (gone from the hangar now). */
  ref: number;
  fromId: number;
  toId: number;
  /** The pledge it went onto. */
  pledgeId: number;
  at: number;
  /** What the CCU was worth (cents). */
  value: number;
}

// ---- fleet plan: several goals at once ----

/** One ship you want: from a hull (or `STORE_START`, or `null` = pick the best source for me), via stops, to a target. */
export interface Goal {
  id: string;
  fromId: number | null;
  targetId: number;
  via: number[];
  /** Auto source may start by buying a store ship (unset = the plan-wide default `FleetOptions.storeStart`). */
  storeStart?: boolean;
  /**
   * Insurance of the hull copy to upgrade: `any`; `prefer` an LTI copy when one gets there; `only` LTI copies (no store
   * start — a new ship has no LTI). A CCU keeps the pledge's insurance, so LTI goals should start from LTI tokens.
   */
  lti?: 'any' | 'prefer' | 'only';
  /** This goal's own options (a chain of *My chains*); unset = the plan-wide ones. Its `via` is `via` above. */
  opt?: PlanOptions;
}
export interface FleetLeg {
  goal: Goal;
  /** Source used (the picked one for an auto goal); null when nothing could start the chain. */
  startId: number | null;
  plan: Plan | null;
  auto: boolean;
  /** The upgraded hull copy is on an LTI pledge. */
  lti: boolean;
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
  /** Hull copies you own that can be upgraded (one copy per goal); `lti` = how many of them are on LTI pledges. */
  hulls: { id: number; count: number; lti?: number }[];
  /** Hulls an auto goal never upgrades (ones you want to keep flying). */
  keep?: number[];
  /** Hulls an auto goal upgrades first when one of them gets there (cheap LTI tokens, ships you don't fly). */
  prefer?: number[];
  /** Default for goals without their own `storeStart`: an auto goal may start by buying a ship from the store. */
  storeStart?: boolean;
}

/** Auto source choice: most saved vs MSRP (a wait counts `WAIT_RISK` against it), then least to pay now, then fewest waits: > 0 when `a` wins, 0 on a tie. */
const better = (a: Plan, b: Plan): number => {
  const sa = a.savings - a.waits * WAIT_RISK;
  const sb = b.savings - b.waits * WAIT_RISK;
  if (sa !== sb) return sa > sb ? 1 : -1;
  if (a.total - a.later !== b.total - b.later) return a.total - a.later < b.total - b.later ? 1 : -1;
  return a.waits === b.waits ? 0 : a.waits < b.waits ? 1 : -1;
};

/**
 * Plans several goals together, in the given order (= priority): each goal's chain may not reuse an owned / buyback
 * CCU an earlier goal took, and each owned hull copy starts at most one chain (goals with a fixed source claim theirs
 * first). An auto goal (`fromId: null`) tries every free hull copy cheaper than the target (not in `keep`) and, with
 * its `storeStart`, buying from the store, and keeps the one that saves most. Candidates are tried in groups — LTI
 * copies first for an `lti: 'prefer'` goal (only those for `only`), then `prefer` hulls — and the first group with a
 * chain wins. A goal that doesn't ask for LTI uses a non-LTI copy when the hull has one, leaving LTI copies for the
 * goals that want them. `opt.include` / `opt.via` are ignored — stops are per goal. A goal carrying its own `opt`
 * plans with those options (objective, warbond, forced CCUs…); `opt.exclude` still applies to every goal.
 */
export function planFleet(ships: CatalogShip[], owned: OwnedCcu[], goals: Goal[], opt: PlanOptions, fo: FleetOptions): FleetPlan {
  const byId = new Map(ships.map((s) => [s.id, s]));
  /** Free copies per hull, split by insurance. */
  const free = new Map(fo.hulls.map((h) => [h.id, { lti: Math.min(h.lti ?? 0, h.count), plain: h.count - Math.min(h.lti ?? 0, h.count) }]));
  const wantsLti = (g: Goal) => g.lti === 'prefer' || g.lti === 'only';
  const has = (id: number, ltiOnly: boolean) => {
    const f = free.get(id);
    return !!f && (ltiOnly ? f.lti > 0 : f.lti + f.plain > 0);
  };
  /** Take one copy: an LTI one when the goal wants it (and there is one), else a plain one first. Returns its LTI. */
  const take = (id: number, g: Goal): boolean => {
    const f = free.get(id);
    if (!f) return false;
    const lti = wantsLti(g) ? f.lti > 0 : f.plain === 0 && f.lti > 0;
    if (lti) f.lti--;
    else if (f.plain > 0) f.plain--;
    return lti;
  };
  const claimed = new Map<string, boolean>();
  for (const g of goals) if (g.fromId != null && g.fromId !== STORE_START && has(g.fromId, g.lti === 'only')) claimed.set(g.id, take(g.fromId, g));
  const keep = new Set(fo.keep ?? []);
  /** Hulls some goal starts from by choice: an auto goal with an equally good other source leaves them be. */
  const wanted = new Set(goals.map((g) => g.fromId).filter((id): id is number => id != null && id !== STORE_START));
  const used = new Set<number>();
  const legs: FleetLeg[] = [];
  // One graph per (exclude, planAhead): shared by every candidate hull of a goal, and by later goals until a chain
  // reserves more CCUs.
  const graphs = new Map<string, PlanGraph>();
  const graphOf = (o: PlanOptions) => {
    const k = `${!!o.planAhead}|${o.lastSeen !== false}|${+o.warbond}${+o.buyback}${+o.inStockOnly}${+o.storeCredit}${+o.excludeGifted}${+(o.useOwned !== false)}|${[...(o.noWait ?? [])].sort((a, b) => a - b).join(',')}|${[...o.exclude].sort((a, b) => a - b).join(',')}|${[...(o.skip ?? [])].sort((a, b) => a - b).join(',')}`;
    return graphs.get(k) ?? graphs.set(k, planGraph(ships, owned, o)).get(k)!;
  };
  for (const goal of goals) {
    // A goal with its own options plans with them (and may force CCUs in, unless an earlier goal took them).
    const base = goal.opt ?? opt;
    const o: PlanOptions = { ...base, include: goal.opt ? base.include.filter((r) => !used.has(r)) : [], via: goal.via, exclude: [...new Set([...opt.exclude, ...(goal.opt ? base.exclude : []), ...used])] };
    let startId = goal.fromId;
    let best: Plan | null = null;
    let ahead = false;
    const target = byId.get(goal.targetId);
    const only = goal.lti === 'only';
    const cands =
      goal.fromId != null
        ? [goal.fromId]
        : [...free.keys()].filter((id) => has(id, only) && !keep.has(id) && (byId.get(id)?.msrp ?? Infinity) < (target?.msrp ?? 0));
    if (goal.fromId == null && !only && (goal.storeStart ?? fo.storeStart)) cands.push(STORE_START);
    // Today's sales first; only when no source gets there, plan ahead (waiting for the target's CCU to return).
    // Within a pass, groups in order — LTI copies (prefer-LTI goals), then preferred hulls — and the first group
    // with a chain wins over any later one.
    const pref = new Set(fo.prefer ?? []);
    const ltiFirst = goal.lti === 'prefer' && goal.fromId == null;
    const isLti = (c: number) => (free.get(c)?.lti ?? 0) > 0;
    const groups = (ltiFirst ? [cands.filter(isLti), cands.filter((c) => !isLti(c))] : [cands]).flatMap((g) => [g.filter((c) => pref.has(c)), g.filter((c) => !pref.has(c))]);
    search: for (const pass of o.planAhead ? [o] : [o, { ...o, planAhead: true }]) {
      for (const group of groups) {
        for (const c of group) {
          const p = plan(ships, owned, c, goal.targetId, pass, graphOf(pass));
          if (!p) continue;
          const d = best ? better(p, best) : 1;
          // As good either way: leave alone a hull (and the CCUs from it) that another goal names as its source.
          if (d > 0 || (d === 0 && startId != null && wanted.has(startId) && !wanted.has(c))) (best = p), (startId = c);
        }
        if (best) {
          ahead = pass !== o;
          break search;
        }
      }
    }
    let lti = claimed.get(goal.id) ?? false;
    if (goal.fromId == null && best && startId != null && startId !== STORE_START) lti = take(startId, goal);
    for (const r of reservedRefs(best ? [best] : [])) used.add(r);
    legs.push({ goal, startId: best ? startId : goal.fromId, plan: best, auto: goal.fromId == null, lti, ahead });
  }
  const sum = (f: (p: Plan) => number) => legs.reduce((n, l) => n + (l.plan ? f(l.plan) : 0), 0);
  return { legs, total: sum((p) => p.total), cash: sum((p) => p.cash), paid: sum((p) => p.paid), later: sum((p) => p.later), waits: sum((p) => p.waits), msrpDiff: sum((p) => p.msrpDiff), savings: sum((p) => p.savings), failed: legs.filter((l) => !l.plan).length };
}

// ---- My chains: the saved list, planned together ----

/** A saved chain as a goal: its source (none for an auto chain), stops and own options. */
export const chainGoal = (c: SavedChain): Goal => ({
  id: c.id,
  fromId: c.auto ? null : c.startId,
  targetId: c.targetId,
  via: c.opt.via ?? [],
  ...(c.storeStart !== undefined ? { storeStart: c.storeStart } : {}),
  ...(c.lti ? { lti: c.lti } : {}),
  opt: c.opt,
});

/** Every saved chain planned together, in list order (leg `i` is chain `i`). `exclude`: CCUs no chain may use. */
export function planChains(ships: CatalogShip[], owned: OwnedCcu[], chains: SavedChain[], fo: FleetOptions, exclude: number[] = []): FleetPlan {
  return planFleet(ships, owned, chains.map(chainGoal), { ...DEFAULT_PLAN_OPTIONS, exclude }, fo);
}

const sameSteps = (a: Step[], b: Step[]) => a.length === b.length && a.every((s, i) => s.fromId === b[i]!.fromId && s.toId === b[i]!.toId && s.kind === b[i]!.kind && s.cost === b[i]!.cost && s.cash === b[i]!.cash && s.paid === b[i]!.paid && s.ref === b[i]!.ref && s.skuId === b[i]!.skuId && s.est?.at === b[i]!.est?.at);

/**
 * The chains with their kept plan brought up to date from `fleet` (`planChains` of the same list). A chain with no
 * chain today keeps nothing: it uses no CCU, so it holds none back. Returns the same array when nothing changed, so a
 * caller can write only on a real change.
 */
export function withPlans(chains: SavedChain[], fleet: FleetPlan): SavedChain[] {
  let changed = false;
  const out = chains.map((c, i) => {
    const leg = fleet.legs[i];
    if (!leg || leg.goal.id !== c.id) return c;
    const steps = leg.plan?.steps ?? [];
    const startId = leg.plan && leg.startId != null ? leg.startId : c.startId;
    const total = leg.plan?.total ?? 0;
    const cash = leg.plan?.cash ?? 0;
    if (startId === c.startId && total === c.total && cash === c.cash && sameSteps(steps, c.steps)) return c;
    changed = true;
    return { ...c, startId, steps, total, cash };
  });
  return changed ? out : chains;
}

/**
 * Goals of the old fleet plan folded into the saved chains (once). A goal that *Save plan* already turned into a chain
 * (same target, same source or an auto goal) marks that chain instead of adding a second one; the rest are appended in
 * their order, to be planned on the next pass.
 */
export function mergeGoals(chains: SavedChain[], goals: Goal[], name: (id: number | null) => string, now: number): SavedChain[] {
  const out = chains.map((c) => ({ ...c }));
  const taken = new Set<string>();
  goals.forEach((g, i) => {
    // An auto goal only matches a chain Save plan made (it has a `group`): a chain you saved by hand with a source of
    // your choosing is another chain to the same ship, not this goal.
    const hit = out.find((c) => !taken.has(c.id) && c.targetId === g.targetId && (g.fromId == null ? !!c.group : g.fromId === c.startId));
    if (hit) {
      taken.add(hit.id);
      if (g.fromId == null) hit.auto = true;
      if (g.storeStart !== undefined) hit.storeStart = g.storeStart;
      if (g.lti) hit.lti = g.lti;
      return;
    }
    out.push({
      id: `${g.id}${i}`,
      name: g.fromId == null ? name(g.targetId) : `${name(g.fromId)} → ${name(g.targetId)}`,
      at: now,
      startId: g.fromId ?? STORE_START,
      targetId: g.targetId,
      steps: [],
      total: 0,
      cash: 0,
      opt: { ...DEFAULT_PLAN_OPTIONS, include: [], exclude: [], skip: [], via: [...g.via] },
      ...(g.fromId == null ? { auto: true } : {}),
      ...(g.storeStart !== undefined ? { storeStart: g.storeStart } : {}),
      ...(g.lti ? { lti: g.lti } : {}),
    });
  });
  return out;
}

/**
 * Chains saved before *My chains* kept the CCUs other chains held in their own `opt.exclude` (that is how a chain was
 * kept off them). The order of the list decides that now, so those go; a CCU you forced out yourself — one no other
 * chain uses — stays forced out.
 */
export function dropBakedExcludes(chains: SavedChain[]): SavedChain[] {
  return chains.map((c) => {
    if (!c.opt.exclude.length) return c;
    const others = new Set(reservedRefs(chains.filter((x) => x.id !== c.id)));
    const exclude = c.opt.exclude.filter((r) => !others.has(r));
    return exclude.length === c.opt.exclude.length ? c : { ...c, opt: { ...c.opt, exclude } };
  });
}

// ---- applying a chain in the hangar ----

/**
 * CCUs the chains were planned with that are no longer in the hangar: applied, melted or gifted since. Only owned
 * steps of chains still being planned; `known` = pledge ids in the hangar now.
 */
export function goneRefs(chains: SavedChain[], known: ReadonlySet<number>): number[] {
  const out = new Set<number>();
  for (const c of chains) {
    if (c.done) continue;
    const seen = new Set((c.applied ?? []).map((a) => a.ref));
    for (const s of c.steps) if (s.kind === 'owned' && s.ref != null && !known.has(s.ref) && !seen.has(s.ref)) out.add(s.ref);
  }
  return [...out];
}

/**
 * The chains after a look at RSI's hangar log (`consumed`: upgrade id → the pledge it was applied to). A chain whose
 * CCU was applied records it; when that CCU was the one reaching the target the chain is `done` (nothing left to
 * plan, nothing held back). Otherwise it carries on from the hull the pledge has become — pinned to it, so an auto
 * chain does not start over from another ship. A CCU that is gone without being applied (melted, gifted) changes
 * nothing here: the chain is simply planned again without it. Returns the same array when nothing changed.
 */
export function reconcileApplied(chains: SavedChain[], consumed: ReadonlyMap<number, { pledgeId: number; at: number; value: number }>): SavedChain[] {
  let changed = false;
  const out = chains.map((c) => {
    if (c.done) return c;
    const had = new Set((c.applied ?? []).map((a) => a.ref));
    const fresh: AppliedStep[] = [];
    for (const s of c.steps) {
      if (s.kind !== 'owned' || s.ref == null || had.has(s.ref)) continue;
      const hit = consumed.get(s.ref);
      if (hit) fresh.push({ ref: s.ref, fromId: s.fromId, toId: s.toId, pledgeId: hit.pledgeId, at: hit.at, value: hit.value });
    }
    if (!fresh.length) return c;
    changed = true;
    const applied = [...(c.applied ?? []), ...fresh];
    const used = new Set(applied.map((a) => a.ref));
    const opt = { ...c.opt, include: c.opt.include.filter((r) => !used.has(r)), exclude: c.opt.exclude.filter((r) => !used.has(r)) };
    const last = applied.find((a) => a.toId === c.targetId);
    if (last) {
      const at = Math.max(...applied.map((a) => a.at).filter((t) => Number.isFinite(t)), 0) || last.at;
      return { ...c, opt, applied, done: { at, pledgeId: last.pledgeId, spent: applied.reduce((n, a) => n + a.value, 0) }, steps: [], total: 0, cash: 0 };
    }
    // the furthest hull reached: the applied step whose target no other applied step starts from
    const reached = applied.filter((a) => !applied.some((b) => b.fromId === a.toId)).at(-1) ?? applied.at(-1)!;
    return { ...c, opt, applied, auto: false, startId: reached.toId };
  });
  return changed ? out : chains;
}

/** An upgrade the hangar log says was applied: its hulls (catalog ids, null when the name matched none) and where it went. */
export interface AppliedUpgrade {
  id: number;
  fromId: number | null;
  toId: number | null;
  pledgeId: number;
  at: number;
  value: number;
}

/**
 * Chains finished without RSI+ having seen which CCUs they used (applied before the chain kept its plan, or after a
 * re-plan): a chain is taken as done when, since about when it was added, an upgrade *to its target* was applied on a
 * pledge. Every upgrade applied on that pledge since then counts as the chain's. Only for chains with nothing recorded
 * yet, one chain per pledge, in list order. Asked for by the user (*Check hangar log*), never on its own: an upgrade
 * to the same ship for another purpose would close the chain too. Returns the same array when nothing changed.
 */
export function reconcileByTarget(chains: SavedChain[], applied: readonly AppliedUpgrade[], slackMs = 86_400_000): SavedChain[] {
  const usedPledges = new Set(chains.filter((c) => c.done).map((c) => c.done!.pledgeId));
  let changed = false;
  const out = chains.map((c) => {
    if (c.done || c.applied?.length) return c;
    const since = c.at - slackMs;
    const last = applied.filter((u) => u.toId === c.targetId && !usedPledges.has(u.pledgeId) && !(u.at < since)).sort((a, b) => b.at - a.at)[0];
    if (!last) return c;
    usedPledges.add(last.pledgeId);
    changed = true;
    const steps: AppliedStep[] = applied
      .filter((u) => u.pledgeId === last.pledgeId && !(u.at < since) && u.fromId != null && u.toId != null)
      .sort((a, b) => a.at - b.at)
      .map((u) => ({ ref: u.id, fromId: u.fromId!, toId: u.toId!, pledgeId: u.pledgeId, at: u.at, value: u.value }));
    const used = new Set(steps.map((a) => a.ref));
    return { ...c, opt: { ...c.opt, include: c.opt.include.filter((r) => !used.has(r)), exclude: c.opt.exclude.filter((r) => !used.has(r)) }, applied: steps, done: { at: last.at, pledgeId: last.pledgeId, spent: steps.reduce((n, a) => n + a.value, 0) }, steps: [], total: 0, cash: 0 };
  });
  return changed ? out : chains;
}

/** Refs of owned / buyback CCUs a set of chains already uses (to keep them out of new plans). */
export function reservedRefs(chains: { steps: Step[] }[]): number[] {
  return [...new Set(chains.flatMap((c) => c.steps.map((s) => s.ref).filter((r): r is number => r != null)))];
}

/**
 * `exclude` plus the CCUs held by saved chains that aren't `own`. `own` picks the chains of the plan on screen (the
 * route just saved, the fleet plan being edited): their CCUs stay usable, so saving a plan doesn't re-plan it without them.
 */
export function excludeReserved(exclude: number[], chains: SavedChain[], own: (c: SavedChain) => boolean): number[] {
  return [...new Set([...exclude, ...reservedRefs(chains.filter((c) => !own(c)))])];
}

/** The exclusions fleet leg `i` was planned with — `exclude` plus the CCUs the goals above it took — to re-plan it alone. */
export function legExclude(fleet: FleetPlan, i: number, exclude: number[]): number[] {
  return [...new Set([...exclude, ...reservedRefs(fleet.legs.slice(0, i).flatMap((l) => (l.plan ? [l.plan] : [])))])];
}

/** A fleet goal opened in the single planner: its route and the exclusions the fleet planned that leg with (`legExclude`). */
export interface OpenedLeg {
  startId: number;
  targetId: number;
  exclude: number[];
  /** The chain of *My chains* it is (saving then updates that chain). */
  chainId?: string;
}

/**
 * The single planner's `exclude` for route `startId` → `targetId`: the user's force-excludes plus other saved chains'
 * CCUs (`excludeSaved`). While an opened fleet leg's route is on screen its exclusions apply instead — they are kept out
 * of the user's options, which the fleet plan shares, so going back to the fleet plans it as before.
 */
export function plannerExclude(exclude: number[], chains: SavedChain[], excludeSaved: boolean, startId: number | null, targetId: number | null, leg: OpenedLeg | null): number[] {
  if (leg && leg.startId === startId && leg.targetId === targetId) return [...new Set([...exclude, ...leg.exclude])];
  return excludeSaved ? excludeReserved(exclude, chains, (c) => c.startId === startId && c.targetId === targetId) : exclude;
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
  buyback: { id: number; name: string; price?: number; upgrade: { fromId: number | null; fromName: string; toId: number | null; toName: string } | null }[],
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
  const add = (list: (typeof pledges[number] & { price?: number })[], source: 'hangar' | 'buyback') => {
    for (const p of list) {
      if (!p.upgrade) continue;
      const from = resolve(p.upgrade.fromId, p.upgrade.fromName);
      const to = resolve(p.upgrade.toId, p.upgrade.toName);
      const value = Math.round((p.value ?? 0) * 100);
      if (from && to && from.id !== to.id) owned.push({ fromId: from.id, toId: to.id, ref: p.id, source, value, gifted: source === 'hangar' && value === 0, ...(source === 'buyback' && p.price ? { price: p.price } : {}) });
      else unmapped.push({ name: p.name, source });
    }
  };
  add(pledges, 'hangar');
  add(buyback, 'buyback');
  return { owned, unmapped };
}

/** Hull copies you own (one per pledge listing it) — what a fleet plan can upgrade. */
export function ownedHulls(pledges: { ships: string[]; lti?: boolean }[], ships: CatalogShip[]): { id: number; count: number; lti: number }[] {
  const n = new Map<number, { count: number; lti: number }>();
  for (const p of pledges) for (const t of p.ships) {
    const s = matchShip(t, ships);
    if (!s) continue;
    const h = n.get(s.id) ?? { count: 0, lti: 0 };
    h.count++;
    if (p.lti) h.lti++;
    n.set(s.id, h);
  }
  return [...n].map(([id, h]) => ({ id, ...h }));
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
