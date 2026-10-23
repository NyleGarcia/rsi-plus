/**
 * Melt planning over hangar pledges. Melting a pledge gives its full `value` as store credit and deletes every
 * item in it, so "melt duplicates" = pick pledges whose every item still exists in another kept pledge.
 * Pure functions over `Pledge[]`.
 */
import type { Pledge, PledgeType } from './hangar';

export interface MeltSummary {
  credit: number;
  pledges: number;
  /** Items that would disappear from the hangar entirely (no copy left in kept pledges). */
  lost: string[];
  /** Items left with fewer copies than you need (e.g. a paint for 3 hulls down to 1 copy). */
  short: string[];
  /** Items that stay because another kept pledge has them. */
  stillOwned: string[];
}

export const itemKey = (title: string) => title.toLowerCase().replace(/\s+/g, ' ').trim();
/** Items a pledge contributes; a CCU pledge counts as its own item (melting it loses that upgrade). */
function keysOf(p: Pledge): string[] {
  if (p.items.length) return p.items.map((i) => itemKey(i.title));
  return p.type === 'upgrade' && p.upgrade ? [`upgrade: ${p.upgrade.fromName} → ${p.upgrade.toName}`.toLowerCase()] : [itemKey(p.name)];
}
/** LTI is worth keeping too: an LTI hull is a separate thing from the same hull without it. */
const ltiKeys = (p: Pledge) => (p.lti ? p.items.filter((i) => /^(ship|vehicle)$/i.test(i.kind)).map((i) => `lti:${itemKey(i.title)}`) : []);
const allKeyCache = new WeakMap<Pledge, string[]>();
/** `keysOf` + `ltiKeys`, once per pledge: the planners recount every pledge on each pick or chip change. */
function allKeys(p: Pledge): string[] {
  let k = allKeyCache.get(p);
  if (!k) allKeyCache.set(p, (k = [...keysOf(p), ...ltiKeys(p)]));
  return k;
}

/** Worth melting: RSI allows it and it gives credit ($0 pledges — gifts, rewards — only lose you the item). */
export const canMelt = (p: Pledge) => p.meltable && p.value > 0;

/** Copies of an item worth keeping: 1, or more for paints that fit several hulls you own (`DedupeOptions.keep`). */
const need = (keep: Map<string, number> | undefined, k: string) => Math.max(1, keep?.get(k) ?? 1);

/** What melting `selected` does, given everything in `all`. */
export function meltSummary(all: Pledge[], selected: Set<number>, opts: DedupeOptions = {}): MeltSummary {
  const kept = keptCounts(all, selected);
  const lost = new Set<string>();
  const short = new Set<string>();
  const still = new Set<string>();
  let credit = 0;
  let n = 0;
  for (const p of all) {
    if (!selected.has(p.id)) continue;
    n++;
    credit += p.value;
    for (const i of p.items.length ? p.items : [{ title: p.upgrade ? `Upgrade ${p.upgrade.fromName} → ${p.upgrade.toName}` : p.name, kind: '' }]) {
      const k = p.items.length ? itemKey(i.title) : keysOf(p)[0]!;
      const left = kept.get(k) ?? 0;
      (left ? still : lost).add(i.title);
      if (left && left < need(opts.keep, k)) short.add(`${i.title} (${left} of ${need(opts.keep, k)} needed)`);
    }
    for (const k of ltiKeys(p)) if (!kept.get(k)) lost.add(`LTI on ${k.slice(4)}`);
  }
  return { credit, pledges: n, lost: [...lost].sort(), short: [...short].sort(), stillOwned: [...still].sort() };
}

/**
 * Pledges you can melt without losing anything: afterwards every item (and every LTI hull) still exists in a
 * kept pledge. Greedy by melt value — highest credit first — re-checking after each pick. Skips non-meltable and
 * $0 pledges, CCUs and game packages (melting a package loses the game).
 */
export interface DedupeOptions {
  /** Pledge types that may be picked (default: every type but CCUs). */
  types?: Set<PledgeType>;
  /** Item key → copies to keep (default 1). Paints that fit N hulls you own need N — one per ship. */
  keep?: Map<string, number>;
  /** Never pick LTI pledges (default false — an LTI copy is only picked when another LTI copy stays). */
  keepLti?: boolean;
  /** Pledge ids never picked (labelled *Keep*). */
  never?: Set<number>;
}

export function duplicatePlan(all: Pledge[], opts: DedupeOptions = {}): Pledge[] {
  const count = new Map<string, number>();
  for (const p of all) for (const k of allKeys(p)) count.set(k, (count.get(k) ?? 0) + 1);
  const pick: Pledge[] = [];
  const pool = all
    .filter((p) => canMelt(p) && p.type !== 'upgrade' && !p.hasGame && p.items.length && (!opts.types || opts.types.has(p.type)) && !(opts.keepLti && p.lti) && !opts.never?.has(p.id))
    .sort((a, b) => b.value - a.value || a.id - b.id);
  for (const p of pool) {
    const keys = allKeys(p);
    if (!keys.every((k) => (count.get(k) ?? 0) >= need(opts.keep, k) + 1)) continue;
    for (const k of keys) count.set(k, count.get(k)! - 1);
    pick.push(p);
  }
  return pick;
}

/** Kept copies of every key when `picked` is melted (helper for marginal checks). */
function keptCounts(all: Pledge[], picked: Set<number>): Map<string, number> {
  const kept = new Map<string, number>();
  for (const p of all) if (!picked.has(p.id)) for (const k of allKeys(p)) kept.set(k, (kept.get(k) ?? 0) + 1);
  return kept;
}

/** Items (and LTI) that disappear if `p` is melted on top of `picked` — [] means it's a pure duplicate right now. */
export function marginalLoss(all: Pledge[], picked: Set<number>, p: Pledge, opts: DedupeOptions = {}): string[] {
  if (picked.has(p.id)) return [];
  return lossWith(keptCounts(all, picked), p, opts);
}

/** Same as `marginalLoss` but with a kept-count table you already have (UI: one table for every row). */
export function lossWith(kept: Map<string, number>, p: Pledge, opts: DedupeOptions = {}): string[] {
  const out: string[] = [];
  const titles = p.items.length ? p.items.map((i) => i.title) : [p.upgrade ? `Upgrade ${p.upgrade.fromName} → ${p.upgrade.toName}` : p.name];
  // `kept` still counts p itself (it isn't picked yet): a key survives only if someone else holds it too.
  keysOf(p).forEach((k, i) => (kept.get(k) ?? 0) >= need(opts.keep, k) + 1 || out.push(titles[i]!));
  for (const k of ltiKeys(p)) if ((kept.get(k) ?? 0) < 2) out.push(`LTI on ${k.slice(4)}`);
  return [...new Set(out)];
}
export { keptCounts };

export interface TargetPlan {
  picked: Pledge[];
  summary: MeltSummary;
  /** False when even melting every candidate can't reach the target. */
  reached: boolean;
}

/**
 * Reach `target` USD of store credit losing as few unique items as possible: duplicates first (lose nothing,
 * highest value first), then repeatedly the pledge that loses the fewest *additional* items — most credit per
 * lost item as tie-break — until the target is met; finally drop any pick the target no longer needs (worst
 * loss-per-dollar first). Candidates: `canMelt`, not a game package (losing the game is never worth it).
 * Kept counts are maintained incrementally — O(pool² · items), fine for hangars of hundreds.
 */
export function targetPlan(all: Pledge[], target: number, opts: DedupeOptions = {}): TargetPlan {
  const picked = new Set<number>();
  let credit = 0;
  const kept = keptCounts(all, picked);
  const take = (p: Pledge) => {
    picked.add(p.id);
    credit += p.value;
    for (const k of allKeys(p)) kept.set(k, (kept.get(k) ?? 1) - 1);
  };
  const untake = (p: Pledge) => {
    picked.delete(p.id);
    credit -= p.value;
    for (const k of allKeys(p)) kept.set(k, (kept.get(k) ?? 0) + 1);
  };
  const pool = all.filter((p) => canMelt(p) && !p.hasGame && (!opts.types || opts.types.has(p.type)) && !(opts.keepLti && p.lti) && !opts.never?.has(p.id));
  for (const p of duplicatePlan(all, opts)) {
    if (credit >= target) break;
    take(p);
  }
  while (credit < target) {
    let best: { p: Pledge; loss: number } | null = null;
    for (const p of pool) {
      if (picked.has(p.id)) continue;
      const loss = lossWith(kept, p, opts).length;
      if (!best || loss < best.loss || (loss === best.loss && p.value / (loss + 1) > best.p.value / (best.loss + 1)) || (loss === best.loss && p.value === best.p.value && p.id < best.p.id)) best = { p, loss };
    }
    if (!best) break;
    take(best.p);
  }
  // Trim: anything whose removal keeps us at/above target goes, worst loss-per-dollar first. A pick's loss = its
  // keys nobody else keeps (kept count 0 after all picks).
  const lossNow = (p: Pledge) => allKeys(p).filter((k) => (kept.get(k) ?? 0) === 0).length;
  const byWorst = all.filter((p) => picked.has(p.id)).sort((a, b) => lossNow(b) / (b.value || 1) - lossNow(a) / (a.value || 1) || a.value - b.value);
  for (const p of byWorst) if (credit - p.value >= target) untake(p);
  const list = all.filter((p) => picked.has(p.id)).sort((a, b) => b.value - a.value);
  return { picked: list, summary: meltSummary(all, picked, opts), reached: credit >= target };
}

/** Item key → every pledge holding it (in hangar order, once per pledge), for `copiesElsewhere`. Build once per hangar. */
export function holdersIndex(all: Pledge[]): Map<string, Pledge[]> {
  const holders = new Map<string, Pledge[]>();
  for (const q of all) {
    for (const k of new Set(q.items.map((i) => itemKey(i.title)))) {
      const list = holders.get(k);
      if (list) list.push(q);
      else holders.set(k, [q]);
    }
  }
  return holders;
}

/**
 * For a pledge you're melting: each of its items and the *other* (unpicked) pledges that still hold a copy —
 * "melt this, you have the same item in #123". Items with no other copy are listed with an empty `in`.
 */
export function copiesElsewhere(index: Map<string, Pledge[]>, picked: Set<number>, p: Pledge): { title: string; in: Pledge[] }[] {
  const holders = (k: string) => (index.get(k) ?? []).filter((q) => q.id !== p.id && !picked.has(q.id));
  const seen = new Set<string>();
  const out: { title: string; in: Pledge[] }[] = [];
  for (const i of p.items) {
    const k = itemKey(i.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title: i.title, in: holders(k) });
  }
  return out;
}
