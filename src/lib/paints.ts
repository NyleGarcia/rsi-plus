/**
 * Paint rebuy planner — RSI's multi-paint cart discount ("More paints. More savings.": 2 paints 15 %, 3 → 20 %,
 * 5 → 25 %, 7 → 30 %, 10+ → 35 %) makes it worth melting paints you paid full price for and buying them back in one
 * cart: the melt gives the full paid value as store credit, the rebuy costs the discounted price.
 *
 * Only paints you can melt *and* rebuy right now count: the pledge is meltable with a value > 0, holds nothing but
 * paints, and every paint in it is on the store and in stock today (`rebuyCandidates`). A paint whose pledge also
 * holds a ship or gear is never a candidate (melting it would lose the rest). Pure functions over the cached hangar
 * + store paint catalog. Prices are cents; `Pledge.value` (USD) is converted here.
 *
 * Packs: the store sells a few paint packs / collections (2026-10: 3 of 378 listings), priced exactly at the tier
 * rate of their contents (890 Jump 3-pack = 3 singles − 20 %, Keystone collection = 8 singles − 30 %). `storePacks`
 * works the contents out from the names and confirms them by price sum. A pledge can then be rebought *as the pack*
 * (one listing) or *as singles* (one listing per paint, each counting toward the tier); the planner takes the cheaper
 * at the cart's rate, singles when they are what reaches a tier.
 *
 * Assumptions (unverified live): the tier discount applies on top of the price the store shows today (`discounted`
 * when on sale). Whether a pack line takes part in the tier is unknown — `packTier` (default `none`: a pack is
 * neither discounted nor counted, the safe reading; `one` / `each` when RSI turns out to treat it as a paint).
 */
import type { BuybackItem, Pledge } from './hangar';
import { categorize, line, shipsFor, type ItemRow, type OwnedShip } from './items';
import { itemKey } from './melt';
import { canMelt } from './melt';
import { matchShip, paintKey, shipKey, type CatalogShip, type StorePaint } from './store';

export interface PaintTier {
  /** Paints (cart lines) needed. */
  min: number;
  /** Discount, 0–1. */
  rate: number;
}

/** RSI's tiers, ascending. */
export const PAINT_TIERS: readonly PaintTier[] = [
  { min: 2, rate: 0.15 },
  { min: 3, rate: 0.2 },
  { min: 5, rate: 0.25 },
  { min: 7, rate: 0.3 },
  { min: 10, rate: 0.35 },
];

/** Default cap on paints in one RSI cart. */
export const CART_PAINT_LIMIT = 50;

/** Discount rate for `n` paints in the cart (0 below two). */
export function paintDiscount(n: number): number {
  let rate = 0;
  for (const t of PAINT_TIERS) if (n >= t.min) rate = t.rate;
  return rate;
}

/** The next tier above `n` paints (null at the top). */
export function nextPaintTier(n: number): PaintTier | null {
  return PAINT_TIERS.find((t) => t.min > n) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Store packs

export interface StorePack {
  pack: StorePaint;
  /** The single-paint listings it bundles (null when they couldn't be worked out from names + price). */
  paints: StorePaint[] | null;
  /** Sum of the singles' list prices, cents (0 when unknown). */
  singlesTotal: number;
  /** Discount the pack's price today gives vs its singles at list price, 0–1 (0 when unknown). */
  impliedRate: number;
}

const PACK_RE = /\b(pack|packs|collection|bundle|multi-?pack)\b/i;
export const isPackListing = (p: Pick<StorePaint, 'name'>) => PACK_RE.test(p.name);

/**
 * Packs on the store with their contents: singles whose name carries the pack's hull ("890 Jump - 3 Paint Pack" →
 * "890 Jump - … Paint") or collection word ("Keystone Paint Collection" → "… - Keystone Paint"), accepted only when
 * their list prices add up to the pack's list price exactly.
 */
export function storePacks(paints: StorePaint[]): StorePack[] {
  const singles = paints.filter((p) => !isPackListing(p));
  const out: StorePack[] = [];
  for (const pack of paints.filter(isPackListing)) {
    const head = pack.name.split(/\s[-–—:]\s/)[0]!;
    const word = pack.name.replace(/\b(\d+\s*)?(paint|paints|pack|packs|collection|bundle|multi-?pack)\b/gi, ' ').replace(/[-–—:]\s*$/, '').replace(/\s+/g, ' ').trim();
    const keys = [...new Set([head, word].filter((k) => k && k.length >= 3 && k !== pack.name))].map((k) => k.toLowerCase());
    let found: StorePaint[] | null = null;
    for (const k of keys) {
      const hit = singles.filter((s) => s.name.toLowerCase().includes(k));
      if (hit.length >= 2 && hit.reduce((a, s) => a + s.price, 0) === pack.price) {
        found = hit;
        break;
      }
    }
    const singlesTotal = found ? found.reduce((a, s) => a + s.price, 0) : 0;
    out.push({ pack, paints: found, singlesTotal, impliedRate: singlesTotal ? 1 - pack.discounted / singlesTotal : 0 });
  }
  return out.sort((a, b) => a.pack.name.localeCompare(b.pack.name));
}

// ---------------------------------------------------------------------------------------------------------------
// Melt only: paints you don't need back

export type MeltOnlyReason = 'no-ship' | 'duplicate';

export interface MeltOnly {
  pledge: Pledge;
  /** Melt credit, cents. */
  credit: number;
  why: MeltOnlyReason;
  titles: string[];
}

export const MELT_ONLY_LABEL: Record<MeltOnlyReason, string> = {
  'no-ship': 'fits no ship you own (no variant of it either)',
  duplicate: 'more copies than hulls to put it on',
};

export interface MeltOnlyOptions {
  /** Melt paints that fit no ship you own instead of rebuying them (default true). */
  noShip?: boolean;
  /** Melt copies beyond one per hull you own (default true). */
  duplicates?: boolean;
  /** Pledge ids to keep (rebuy) whatever the rules say. */
  except?: Set<number>;
  /** Catalog ships — lets `paintLine` see which variants share a hull line. */
  ships?: CatalogShip[];
}

/**
 * Hull line a paint is shared across: variants of a family (Cutlass Black / Red / Blue, every Constellation, L-21 Wolf
 * / L-22 Alpha Wolf) and the 100 / 300 / 400 series take the same paints, so a paint named for one variant counts for
 * all of them. The line is the catalog-aware `family` (the first word that is a whole ship name on its own: "wolf"
 * for L-22 Alpha Wolf, "hornet" for the Super Hornet); the 100 / 300 / 400 series collapse to "N00 series".
 */
export function paintLine(shipName: string, ships: CatalogShip[] = []): string {
  const m = /^(\d)\d\d[a-z]$/.exec(shipKey(shipName));
  if (m) return `${m[1]}00 series`;
  return line(shipName, ships);
}

/** Paint-only pledges you can melt, in hangar order. */
const paintOnly = (p: Pledge) => {
  const items = p.items.length ? p.items : p.type === 'paint' ? [{ title: p.name, kind: 'skin' }] : [];
  return items.length && canMelt(p) && items.every((i) => categorize(i.title, i.kind) === 'paint') ? items.map((i) => i.title) : null;
};

/**
 * Splits meltable paint pledges into melt-only (credit back, nothing to rebuy) and the rest (rebuy candidates):
 * a pledge whose paints all fit no ship you own — counting every variant of the line (`paintLine`) — or whose paints
 * are all surplus copies, beyond one per owned hull of that line (`rows` give the fits, `fleet` the hulls; a paint
 * with no known ship is kept). Multi-paint pledges stay rebuy candidates unless every paint in them qualifies.
 */
/** A paint inside a kept pledge that need not come back: owned elsewhere (surplus) or for no ship of yours. */
export interface Redundant {
  title: string;
  why: MeltOnlyReason;
}

export function meltOnlySplit(pledges: Pledge[], rows: ItemRow[], fleet: OwnedShip[], opts: MeltOnlyOptions = {}): { meltOnly: MeltOnly[]; keep: Pledge[]; redundant: Map<number, Redundant[]> } {
  const noShip = opts.noShip ?? true;
  const dups = opts.duplicates ?? true;
  // Hulls per paint line: a Cutlass Red paint goes on a Cutlass Black too.
  const cat = opts.ships ?? fleet.map((f) => f.ship);
  const line = (name: string) => paintLine(name, cat);
  const hulls = new Map<string, number>();
  for (const f of fleet) hulls.set(line(f.ship.name), (hulls.get(line(f.ship.name)) ?? 0) + f.count);
  const fitsOf = new Map(rows.filter((r) => r.category === 'paint').map((r) => [itemKey(r.title), r.fits]));
  /** Per paint: hulls you own in the lines it fits (Infinity when its ship is unknown) and copies still wanted. */
  const hullsFor = (title: string) => {
    const fits = fitsOf.get(itemKey(title));
    if (!fits || !fits.length) return Infinity;
    return [...new Set(fits.map((s) => line(s.name)))].reduce((a, l) => a + (hulls.get(l) ?? 0), 0);
  };
  const left = new Map<string, number>();
  // With no-ship melting off, one copy of a paint without a hull is still worth keeping (rebuying).
  const need = (title: string) => left.get(itemKey(title)) ?? (hullsFor(title) === 0 && !noShip ? 1 : hullsFor(title));
  const meltOnly: MeltOnly[] = [];
  const keep: Pledge[] = [];
  const redundant = new Map<number, Redundant[]>();
  for (const p of pledges) {
    const titles = paintOnly(p);
    if (!titles || opts.except?.has(p.id)) {
      keep.push(p);
      continue;
    }
    const credit = Math.round(p.value * 100);
    if (noShip && titles.every((t) => hullsFor(t) === 0)) {
      meltOnly.push({ pledge: p, credit, why: 'no-ship', titles });
      continue;
    }
    if (dups && titles.every((t) => need(t) !== Infinity && need(t) <= 0)) {
      meltOnly.push({ pledge: p, credit, why: 'duplicate', titles });
      continue;
    }
    // Kept: these copies fill the hulls' need; paints in it already covered (or for no ship) are redundant —
    // melt them with the pledge, don't buy them back (dedupe across packs and standalones).
    const extra: Redundant[] = [];
    for (const t of titles) {
      const n = need(t);
      if (n === Infinity) continue;
      if (noShip && hullsFor(t) === 0) extra.push({ title: t, why: 'no-ship' });
      else if (n <= 0) {
        if (dups) extra.push({ title: t, why: 'duplicate' });
      } else left.set(itemKey(t), n - 1);
    }
    if (extra.length) redundant.set(p.id, extra);
    keep.push(p);
  }
  return { meltOnly, keep, redundant };
}

// ---------------------------------------------------------------------------------------------------------------
// Candidates

export interface RebuyLine {
  /** Hangar item title (or the pack's name). */
  title: string;
  /** The listing to buy. */
  store: StorePaint;
}

/** One way to buy a pledge's paints back. */
export interface RebuyOption {
  kind: 'single' | 'pack';
  /** Listings to add to the cart (one per paint for singles, one for a pack). */
  lines: RebuyLine[];
  /** Paints this counts toward the tier (singles: lines; pack: 0 / 1 / its contents per `packTier`). */
  count: number;
  /** The bundle discount applies to it (singles always; a pack per `packTier`). */
  tiered: boolean;
  /** Store price today, cents, before the tier discount. */
  cost: number;
  /** List price (before any store sale), cents. */
  list: number;
}

/** A hangar pledge you can melt and buy back from the store today. */
export interface RebuyCandidate {
  pledge: Pledge;
  /** Store credit the melt gives, cents (= what you paid, for a paint bought at full price). */
  credit: number;
  /** Buy each paint on its own (null when one of them isn't sold singly). */
  single: RebuyOption | null;
  /** Buy the pack that holds exactly these paints (null when there is none). */
  pack: RebuyOption | null;
  /** Paint titles in the pledge. */
  titles: string[];
  /** Paints in the pledge that can't be bought back today (not sold / out of stock) — lost if you melt. Empty = whole. */
  missing: string[];
}

export type SkipReason = 'not-meltable' | 'no-value' | 'other-items' | 'not-on-store' | 'out-of-stock';

export interface Skipped {
  pledge: Pledge;
  why: SkipReason;
  /** The paint titles the reason applies to (store misses / out of stock). */
  titles: string[];
}

export const SKIP_LABEL: Record<SkipReason, string> = {
  'not-meltable': 'RSI does not let you melt it',
  'no-value': 'melts for $0 (gift / reward)',
  'other-items': 'pledge also holds ships or gear',
  'not-on-store': 'not on the store right now',
  'out-of-stock': 'out of stock on the store',
};

export type PackTier = 'none' | 'one' | 'each';

export interface CandidateOptions {
  /** Store packs (from `storePacks`) — enables the pack option. */
  packs?: StorePack[];
  /** How a pack line behaves in the tier: ignored (no discount, counts 0 — default), one paint, or each paint it holds. */
  packTier?: PackTier;
}

/** What an option costs in a cart at `rate`, cents. */
export const optionPay = (o: RebuyOption, rate: number) => (o.tiered ? Math.round(o.cost * (1 - rate)) : o.cost);

/** Cheapest option of `c` at `rate`; ties → singles (they count more toward the tier). */
export function optionAt(c: RebuyCandidate, rate: number, prefer: 'cheapest' | 'single' = 'cheapest'): RebuyOption {
  if (!c.pack) return c.single!;
  if (!c.single) return c.pack;
  if (prefer === 'single') return c.single;
  return optionPay(c.pack, rate) < optionPay(c.single, rate) ? c.pack : c.single;
}

const setKey = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b).join(',');

/**
 * Pledges holding paints, split into rebuy candidates and the rest with why. Sorted by best gain at list price.
 */
export function rebuyCandidates(pledges: Pledge[], byKey: Map<string, StorePaint>, opts: CandidateOptions = {}): { ok: RebuyCandidate[]; skipped: Skipped[] } {
  const ok: RebuyCandidate[] = [];
  const skipped: Skipped[] = [];
  const packs = opts.packs ?? [];
  const packByKey = new Map(packs.map((pk) => [paintKey(pk.pack.name), pk]));
  const packBySet = new Map(packs.filter((pk) => pk.paints).map((pk) => [setKey(pk.paints!.map((s) => s.id)), pk]));
  const tier = opts.packTier ?? 'none';
  const packOption = (pk: StorePack): RebuyOption | null =>
    pk.pack.available
      ? { kind: 'pack', lines: [{ title: pk.pack.name, store: pk.pack }], count: tier === 'none' ? 0 : tier === 'each' && pk.paints ? pk.paints.length : 1, tiered: tier !== 'none', cost: pk.pack.discounted, list: pk.pack.price }
      : null;

  for (const p of pledges) {
    const items = p.items.length ? p.items : p.type === 'paint' ? [{ title: p.name, kind: 'skin' }] : [];
    const paints = items.filter((i) => categorize(i.title, i.kind) === 'paint');
    if (!paints.length) continue;
    if (!p.meltable) {
      skipped.push({ pledge: p, why: 'not-meltable', titles: [] });
      continue;
    }
    if (!canMelt(p)) {
      skipped.push({ pledge: p, why: 'no-value', titles: [] });
      continue;
    }
    if (paints.length !== items.length) {
      skipped.push({ pledge: p, why: 'other-items', titles: items.filter((i) => categorize(i.title, i.kind) !== 'paint').map((i) => i.title) });
      continue;
    }
    const titles = paints.map((i) => i.title);
    // Singles: every paint sold on its own (a pack listing is never a "single").
    const singleOf = (title: string) => {
      const hit = byKey.get(paintKey(title));
      return hit && !isPackListing(hit) ? hit : undefined;
    };
    const singleLines = paints.map((i) => ({ title: i.title, store: singleOf(i.title)! })).filter((l) => l.store);
    const singlesComplete = singleLines.length === paints.length;
    // Pack: the pledge *is* a pack listing, or its paints are exactly a known pack's contents.
    const asPack =
      packByKey.get(paintKey(p.name)) ??
      (paints.length === 1 ? packByKey.get(paintKey(titles[0]!)) : undefined) ??
      (singlesComplete && paints.length > 1 ? packBySet.get(setKey(singleLines.map((l) => l.store.id))) : undefined);
    // A pack pledge's singles come from the pack's contents (same paints, store naming) when the hangar names differ
    // or the pledge lists only the pack itself.
    const singlesVia = !singlesComplete && asPack?.paints ? asPack.paints.map((s, i) => ({ title: asPack.paints!.length === paints.length ? titles[i]! : s.name, store: s })) : null;
    const singleAll = singlesComplete ? singleLines : singlesVia;

    const pack = asPack ? packOption(asPack) : null;
    const singleOpt = (lines: RebuyLine[]): RebuyOption => ({ kind: 'single', lines, count: lines.length, tiered: true, cost: lines.reduce((a, l) => a + l.store.discounted, 0), list: lines.reduce((a, l) => a + l.store.price, 0) });
    let single: RebuyOption | null = singleAll && singleAll.every((l) => l.store.available) ? singleOpt(singleAll) : null;
    let missing: string[] = [];
    if (!single && !pack) {
      const notSold = paints.filter((i) => !singleOf(i.title)).map((i) => i.title);
      const out = (singleAll ?? singleLines).filter((l) => !l.store.available).map((l) => l.title);
      // A pack with *some* of its paints still sold: rebuy those, the rest is lost on melt — a candidate the user
      // picks by hand (never auto-planned), flagged with what goes missing.
      const partial = (singleAll ?? singleLines).filter((l) => l.store.available);
      if (paints.length > 1 && partial.length) {
        single = singleOpt(partial);
        missing = [...notSold, ...out];
      } else {
        if (asPack && !asPack.pack.available && !out.length) out.push(asPack.pack.name);
        skipped.push(out.length && !notSold.length ? { pledge: p, why: 'out-of-stock', titles: out } : { pledge: p, why: 'not-on-store', titles: notSold.length ? notSold : titles });
        continue;
      }
    }
    ok.push({ pledge: p, credit: Math.round(p.value * 100), single, pack, titles, missing });
  }
  return { ok: ok.sort((a, b) => gainAt(b, 0) - gainAt(a, 0) || a.pledge.id - b.pledge.id), skipped };
}

/** How far under the singles' list price you paid (0–1; 0 = full price or more): a pack bought at its tier, a sale. */
export const paidOff = (c: RebuyCandidate) => (c.single?.list ? Math.max(0, 1 - c.credit / c.single.list) : 0);

/** `o` without the listings in `drop` (per-paint opt-out inside a pack); a pack listing can't be split. */
export function optionSubset(o: RebuyOption, drop: Set<number>): RebuyOption {
  if (!drop.size || o.kind === 'pack') return o;
  const lines = o.lines.filter((l) => !drop.has(l.store.id));
  if (lines.length === o.lines.length) return o;
  return { ...o, lines, count: lines.length, cost: lines.reduce((a, l) => a + l.store.discounted, 0), list: lines.reduce((a, l) => a + l.store.price, 0) };
}

/** Cheapest way to buy `c` back today at list, cents (no tier). */
export const costAlone = (c: RebuyCandidate) => Math.min(c.single?.cost ?? Infinity, c.pack?.cost ?? Infinity);

/** Store credit you are up after melting `c` and buying it back (cheapest option) at `rate` off, cents. */
export const gainAt = (c: RebuyCandidate, rate: number) => c.credit - optionPay(optionAt(c, rate), rate);

// ---------------------------------------------------------------------------------------------------------------
// Totals + plan

/** A candidate with the option chosen for the cart. */
export interface BundlePick {
  cand: RebuyCandidate;
  option: RebuyOption;
}

export interface BundleTotals {
  /** Paints counted toward the tier: picks' option counts + wanted paints. */
  lines: number;
  rate: number;
  next: PaintTier | null;
  /** Melt credit from the picks, cents. */
  credit: number;
  /** Store price before the discount (picks + wanted), cents. */
  list: number;
  /** What the cart should charge, cents. */
  pay: number;
  /** credit − discounted rebuy price of the picks: credit you keep while owning the same paints. */
  rebuyGain: number;
  /** Wanted paints in this cart vs bought on their own (their own tier). */
  wantedPay: number;
  wantedAlone: number;
  /** rebuyGain + what the wanted paints save by riding along. */
  net: number;
}

export function bundleTotals(picks: BundlePick[], wanted: StorePaint[]): BundleTotals {
  const lines = picks.reduce((n, p) => n + p.option.count, 0) + wanted.length;
  const rate = paintDiscount(lines);
  const credit = picks.reduce((a, p) => a + p.cand.credit, 0);
  const picksCost = picks.reduce((a, p) => a + p.option.cost, 0);
  const wantedCost = wanted.reduce((a, w) => a + w.discounted, 0);
  const list = picksCost + wantedCost;
  const picksPay = picks.reduce((a, p) => a + optionPay(p.option, rate), 0);
  const wantedPay = Math.round(wantedCost * (1 - rate));
  const pay = picksPay + wantedPay;
  const rebuyGain = credit - picksPay;
  const wantedAlone = Math.round(wantedCost * (1 - paintDiscount(wanted.length)));
  return { lines, rate, next: nextPaintTier(lines), credit, list, pay, rebuyGain, wantedPay, wantedAlone, net: rebuyGain + (wantedAlone - wantedPay) };
}

/**
 * Picks the candidates worth melting + rebuying together with `wanted` (paints you want to buy anyway), within
 * `limit` paints; `drop` = listings per pledge not to buy back (redundant paints). Partial packs (`missing`) are never auto-picked. Per tier (and per option preference — cheapest, or singles to reach the tier): rank by gain at
 * that rate, take every positive one that fits, then — if that tier isn't reached yet — the least-negative ones
 * until it is (a small loss on one single paint can unlock a bigger discount on the rest — never a pack); keep the plan with the best
 * `net`, ties → fewer melts. Wanted paints beyond the limit are not trimmed.
 */
export function planBundle(cands: RebuyCandidate[], wanted: StorePaint[], limit = CART_PAINT_LIMIT, drop?: Map<number, Set<number>>): BundlePick[] {
  const base = wanted.length;
  let best: { picks: BundlePick[]; net: number } = { picks: [], net: bundleTotals([], wanted).net };
  const whole = cands.filter((c) => !c.missing.length);
  const sub = (c: RebuyCandidate, o: RebuyOption) => (drop?.get(c.pledge.id)?.size ? optionSubset(o, drop.get(c.pledge.id)!) : o);
  for (const t of [{ min: 0, rate: 0 }, ...PAINT_TIERS]) {
    for (const prefer of ['cheapest', 'single'] as const) {
      const ranked = whole
        .map((c) => ({ cand: c, option: sub(c, optionAt(c, t.rate, prefer)) }))
        .map((p) => ({ ...p, gain: p.cand.credit - optionPay(p.option, t.rate) }))
        .sort((a, b) => b.gain - a.gain || a.cand.pledge.id - b.cand.pledge.id);
      const picks: BundlePick[] = [];
      let lines = base;
      for (const p of ranked) {
        if (lines + p.option.count > limit) continue;
        if (p.gain <= 0 && lines >= t.min) break;
        // A pack is melted only when buying all its paints back is cheaper than what it melts for — never as a
        // tier-filler at a loss (a single cheap paint can play that role).
        if (p.gain <= 0 && p.cand.titles.length > 1) continue;
        picks.push({ cand: p.cand, option: p.option });
        lines += p.option.count;
      }
      if (lines < t.min) continue;
      const net = bundleTotals(picks, wanted).net;
      if (net > best.net || (net === best.net && picks.length < best.picks.length)) best = { picks, net };
    }
  }
  return best.picks;
}

export interface BundleScenario {
  /** Cart size the plan was limited to. */
  limit: number;
  picks: BundlePick[];
  totals: BundleTotals;
  /** net ÷ lines, cents — value per paint in the cart. */
  perPaint: number;
}

/**
 * Best plan at every cart size worth looking at: each tier threshold, then 15 / 20 / 30 / … up to `cap` (and `cap`
 * itself). Scenarios that end up with the same picks collapse into the first; sorted by cart size.
 */
export function bundleScenarios(cands: RebuyCandidate[], wanted: StorePaint[], cap = CART_PAINT_LIMIT, drop?: Map<number, Set<number>>): BundleScenario[] {
  const sizes = [...new Set([...PAINT_TIERS.map((t) => t.min), 15, 20, 30, 40, 50, cap].filter((n) => n >= 1 && n <= cap))].sort((a, b) => a - b);
  const out: BundleScenario[] = [];
  const seen = new Set<string>();
  for (const limit of sizes) {
    const picks = planBundle(cands, wanted, limit, drop);
    const key = picks
      .map((p) => `${p.cand.pledge.id}${p.option.kind === 'pack' ? 'p' : ''}`)
      .sort()
      .join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const totals = bundleTotals(picks, wanted);
    out.push({ limit, picks, totals, perPaint: totals.lines ? Math.round(totals.net / totals.lines) : 0 });
  }
  return out;
}

/** Index of the scenario with the highest net (ties → smaller cart). */
export const bestScenario = (list: BundleScenario[]) => list.reduce((b, s, i) => (s.totals.net > (list[b]?.totals.net ?? -Infinity) ? i : b), -1);

// ---------------------------------------------------------------------------------------------------------------
// Buyback compare: what's in your buyback list that you no longer have

export interface BuybackPaint {
  item: BuybackItem;
  title: string;
  /** Catalog ships it fits (empty = unknown). */
  fits: CatalogShip[];
  /** You own a hull of that line (variants count). */
  forMyShip: boolean;
  /** Same paint on the store today, for the price. */
  store: StorePaint | null;
  /** Buyback entries holding this paint. */
  copies: number;
  /** The store sells it today (listing in stock) — buying back is pointless unless cheaper. */
  buyableNow: boolean;
}

export interface BuybackMissing {
  item: BuybackItem;
  /** Contents you don't have in the hangar. */
  titles: string[];
  /** Contents you do have (the rest). */
  have: string[];
  /** Every missing item is on sale on the store right now (paint listing in stock / ship with a standalone SKU). */
  buyableNow: boolean;
  /** Store pages for the missing items the store sells today. */
  store: StoreLink[];
}

/** A store page for something you could buy instead of buying it back. */
export interface StoreLink {
  title: string;
  url: string;
  /** Price today, cents (standalone SKU / paint listing); null when unknown. */
  price: number | null;
  /** Store SKU to add to the cart (paint listing id; ship: its cheapest standalone SKU). */
  sku: number;
}

/**
 * Store pages for hangar item titles the store sells today: paints by listing (in stock), ships / vehicles by a
 * catalog ship with an available standalone SKU (cheapest one's price). Other kinds have no store lookup.
 */
export function storeLinksFor(titles: string[], ships: CatalogShip[], storeIdx: Map<string, StorePaint>): StoreLink[] {
  const out: StoreLink[] = [];
  for (const t of [...new Set(titles)]) {
    const c = categorize(t, '');
    if (c === 'paint') {
      const sp = storeIdx.get(paintKey(t));
      if (sp?.available) out.push({ title: t, url: sp.url, price: sp.discounted, sku: sp.id });
      continue;
    }
    if (c === 'ship' || c === 'other') {
      const s = matchShip(t, ships);
      const skus = (s?.standalone.filter((k) => k.available && k.stock !== 0) ?? []).sort((a, b) => a.price - b.price);
      if (s?.link && skus[0]) out.push({ title: t, url: s.link, price: skus[0].price, sku: skus[0].id });
    }
  }
  return out;
}

export interface BuybackCompare {
  /** Paint-only buyback entries whose paint you don't own, for a ship you own. */
  paintsForMyShips: BuybackPaint[];
  /** …for ships you don't own (or unknown). */
  otherPaints: BuybackPaint[];
  /** Other buyback entries (ships, packs, gear) with at least one item you don't have. CCUs are left to the planner. */
  missing: BuybackMissing[];
  /** Buyback entries you already own again in full. */
  haveAgain: number;
  /** …and which ones. */
  ownedAgain: BuybackItem[];
  /** Packs whose contents RSI lists only as "N items" — can't be matched, shown with a hint. */
  unknown: BuybackUnknown[];
}

/** Copies of every item title in the hangar (by `itemKey`), counting items inside pledges and item-less pledge names. */
export function hangarCounts(pledges: Pledge[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pledges) {
    const titles = p.items.length ? p.items.map((i) => i.title) : p.type === 'upgrade' ? [] : [p.name];
    for (const t of titles) m.set(itemKey(t), (m.get(itemKey(t)) ?? 0) + 1);
  }
  return m;
}

/** RSI often lists a pack's contents as just "5 items" — no names to match. */
const COUNT_ONLY = /^\s*(\d+)\s+items?\s*$/i;
export const countOnly = (contained: string) => Number(COUNT_ONLY.exec(contained)?.[1] ?? 0) || null;

/** Repeated titles folded into one entry with a count, first-seen order ("Bolide, Bolide" → Bolide ×2). */
export const countTitles = (titles: string[]): { title: string; n: number }[] => {
  const m = new Map<string, number>();
  for (const t of titles) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([title, n]) => ({ title, n }));
};
/** "Title ×2" when repeated, else the title. */
export const titleWithCount = (t: { title: string; n: number }) => (t.n > 1 ? `${t.title} ×${t.n}` : t.title);

/** Contents of a buyback entry: the "Contained" list, else its name; `[]` when RSI only gave a count. */
export const buybackContents = (b: BuybackItem) => (countOnly(b.contained) ? [] : b.contained ? b.contained.split(/,\s*/).map((t) => t.trim()).filter(Boolean) : [b.name]);

/** A buyback pack whose contents RSI didn't list: what we can say about it from its name and your hangar. */
export interface BuybackUnknown {
  item: BuybackItem;
  /** Items RSI says it holds. */
  count: number;
  /** Hull named before " - " ("Perseus - 5 Paint Pack" → Perseus), '' when none. */
  hull: string;
  /** Paints in your hangar for that hull line (title, copies) — the pack's paints are usually among them. */
  ownedForHull: { title: string; n: number }[];
}

/** Describe a count-only pack: hull from its name, your hangar paints for that hull line. */
export function packHint(b: BuybackItem, rows: ItemRow[], ships: CatalogShip[]): BuybackUnknown {
  const count = countOnly(b.contained) ?? 0;
  const head = b.name.split(/\s[-–—:]\s/)[0]?.trim() ?? '';
  const hull = head && head !== b.name.trim() ? head : '';
  const fits = hull ? shipsFor(hull, ships) : [];
  const lines = new Set(fits.map((s) => paintLine(s.name, ships)));
  const hk = hull.toLowerCase();
  const ownedForHull = rows
    .filter((r) => r.category === 'paint' && (r.fits.some((s) => lines.has(paintLine(s.name, ships))) || (hk.length >= 3 && r.title.toLowerCase().startsWith(hk))))
    .map((r) => ({ title: r.title, n: r.count }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { item: b, count, hull, ownedForHull };
}

export function buybackCompare(buyback: BuybackItem[], rows: ItemRow[], fleet: OwnedShip[], ships: CatalogShip[], storeIdx: Map<string, StorePaint>): BuybackCompare {
  const owned = new Set(rows.map((r) => itemKey(r.title)));
  const lines = new Set(fleet.map((f) => paintLine(f.ship.name, ships)));
  const paints = new Map<string, BuybackPaint>();
  const missing: BuybackMissing[] = [];
  let haveAgain = 0;
  const ownedAgain: BuybackItem[] = [];
  const unknown: BuybackUnknown[] = [];
  for (const b of buyback) {
    if (b.type === 'upgrade' || b.upgrade) continue;
    const contents = buybackContents(b);
    if (!contents.length) {
      unknown.push(packHint(b, rows, ships));
      continue;
    }
    const lack = contents.filter((t) => !owned.has(itemKey(t)));
    if (!lack.length) {
      haveAgain++;
      ownedAgain.push(b);
      continue;
    }
    if (contents.every((t) => categorize(t, '') === 'paint')) {
      for (const t of lack) {
        const k = itemKey(t);
        const cur = paints.get(k);
        if (cur) {
          cur.copies++;
          continue;
        }
        const fits = shipsFor(t, ships);
        const store = storeIdx.get(paintKey(t)) ?? null;
        paints.set(k, { item: b, title: t, fits, forMyShip: fits.some((s) => lines.has(paintLine(s.name, ships))), store, copies: 1, buyableNow: !!store?.available });
      }
      continue;
    }
    const store = storeLinksFor(lack, ships, storeIdx);
    missing.push({ item: b, titles: lack, have: contents.filter((t) => owned.has(itemKey(t))), buyableNow: store.length === lack.length, store });
  }
  const all = [...paints.values()].sort((a, b) => a.title.localeCompare(b.title));
  return { paintsForMyShips: all.filter((p) => p.forMyShip), otherPaints: all.filter((p) => !p.forMyShip), missing: missing.sort((a, b) => a.item.name.localeCompare(b.item.name)), haveAgain, ownedAgain, unknown };
}
