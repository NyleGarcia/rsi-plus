/**
 * Facet definitions for the hangar pages (Pledges, My ships) — pure, so the predicates are testable. The pages bind
 * `FacetBar` to these and persist the chosen values in their own prefs. Spec: docs/plans/specs/filters-and-labels.md.
 */
import { INSURANCE_OPTIONS, SIZE_OPTIONS, STAGE_OPTIONS, stageOf, yesNo, type Facet, type FacetOption, type RangeFacet } from './facets';
import type { Pledge, PledgeType } from './hangar';
import type { OwnedShip } from './items';
import { allLabels, idsWith, type Labels } from './labels';
import { canMelt } from './melt';
import { matchShip, type CatalogShip } from './store';

export const PLEDGE_TYPES: PledgeType[] = ['ship', 'package', 'combo', 'upgrade', 'paint', 'gear', 'hangar', 'subscriber', 'other'];

/**
 * Gifted = no melt value and not a $0 flair. RSI shows no gift marker on a pledge; a gift arrives with value 0 (the
 * sender's money stays theirs). Assumption: free flair / hangar decorations / subscriber items are also $0 but are
 * types `other` / `hangar` / `subscriber`, so those are left out — a gifted *item* of those types reads as not gifted.
 * Same rule as `OwnedCcu.gifted` (hangar CCU with value 0).
 */
export const isGifted = (p: Pick<Pledge, 'value' | 'type'>) => p.value === 0 && p.type !== 'other' && p.type !== 'hangar' && p.type !== 'subscriber';

export type PackageShape = 'ships' | 'no-ships' | 'ccu' | 'multi' | 'single';
const isHullKind = (kind: string) => /^(ship|vehicle)$/i.test(kind);
/** Ship / vehicle titles inside a pledge (the parsed `ships` plus items RSI lists as Ship / Vehicle), de-duplicated. */
export const hullsIn = (p: Pick<Pledge, 'ships' | 'items'>) => [...new Set([...p.ships, ...p.items.filter((i) => isHullKind(i.kind)).map((i) => i.title)])];
/** Every package shape a pledge has (they overlap: a ship pack with paints is `ships` + `multi`). */
export function packageShape(p: Pick<Pledge, 'ships' | 'items' | 'type' | 'upgrade'>): PackageShape[] {
  const out: PackageShape[] = [hullsIn(p).length ? 'ships' : 'no-ships'];
  if (p.type === 'upgrade' || p.upgrade || p.items.some((i) => /upgrade/i.test(i.kind))) out.push('ccu');
  out.push(p.items.length > 1 ? 'multi' : 'single');
  return out;
}

export interface PledgeFacetCtx {
  /** Your labels (`lib/labels.ts`): one Labels option per label in use. */
  labels?: Labels;
  /** Catalog ships, for the stage of the hulls inside; the Stage facet is left out when empty. */
  ships?: CatalogShip[];
  /** "Contents sold on the store today" — from the page's store listing; the In store facet is left out when null. */
  inStore?: ((p: Pledge) => boolean) | null;
  /** Type options to offer (the types present in the hangar); all of `PLEDGE_TYPES` when absent. */
  types?: PledgeType[];
}

/** Catalog stages of the hulls inside a pledge. */
const stagesOf = (p: Pledge, ships: CatalogShip[]) => hullsIn(p).map((t) => matchShip(t, ships)).filter((s): s is CatalogShip => !!s).map((s) => stageOf(s.flyable));

/** Pledges page facets (in display order). `primary`: type, insurance, warbond, giftable. */
export function pledgeFacets(ctx: PledgeFacetCtx = {}): Facet<Pledge>[] {
  const ships = ctx.ships ?? [];
  const labelOpts: FacetOption<Pledge>[] = allLabels(ctx.labels ?? {}).map((l) => {
    const ids = idsWith(ctx.labels ?? {}, l.name);
    return { id: l.name.toLowerCase(), label: l.name, test: (p) => ids.has(p.id) };
  });
  const out: (Facet<Pledge> | null)[] = [
    { id: 'type', label: 'Type', multiple: true, options: (ctx.types ?? PLEDGE_TYPES).map((t) => ({ id: t, label: t, test: (p) => p.type === t })) },
    { id: 'insurance', label: 'Insurance', options: INSURANCE_OPTIONS<Pledge>((p) => p.insurance, (p) => p.lti) },
    { id: 'warbond', label: 'Warbond', options: [
      { id: 'yes', label: 'Warbond', test: (p) => p.warbond },
      { id: 'no', label: 'Standard', test: (p) => !p.warbond },
    ] },
    { id: 'giftable', label: 'Giftable', options: yesNo<Pledge>('Giftable', (p) => p.giftable) },
    { id: 'gifted', label: 'Gifted', hint: 'No melt value and not a $0 flair — RSI shows no gift marker, so this is a guess', options: yesNo<Pledge>('Gifted', isGifted, ['No melt value and not a $0 flair (a guess: RSI shows no gift marker)', 'Has melt value, or a $0 flair / hangar / subscriber item']) },
    { id: 'meltable', label: 'Meltable', options: [
      { id: 'yes', label: 'Meltable', hint: 'Melts for store credit (meltable and worth more than $0)', test: canMelt },
      { id: 'no', label: 'Not meltable', hint: 'RSI offers no melt for it', test: (p) => !p.meltable },
      { id: 'zero', label: 'No melt value', hint: 'Meltable but worth $0 (flair, gifts, rewards)', test: (p) => p.meltable && p.value <= 0 },
    ] },
    { id: 'package', label: 'Package', options: [
      { id: 'ships', label: 'With ships', test: (p) => packageShape(p).includes('ships') },
      { id: 'no-ships', label: 'Without ships', test: (p) => packageShape(p).includes('no-ships') },
      { id: 'ccu', label: 'With CCU', test: (p) => packageShape(p).includes('ccu') },
      { id: 'multi', label: 'Multiple items', test: (p) => packageShape(p).includes('multi') },
      { id: 'single', label: 'Single item', test: (p) => packageShape(p).includes('single') },
    ] },
    ctx.inStore
      ? { id: 'store', label: 'In store', options: yesNo<Pledge>('Sold today', ctx.inStore, ['Something in it (a ship with a standalone, or a paint) is on the store today', 'Nothing in it is on the store today']) }
      : null,
    ships.length
      ? { id: 'stage', label: 'Stage', hint: 'Of the hulls inside', options: [
          { id: 'ready', label: 'Any flight ready', test: (p) => stagesOf(p, ships).includes('ready') },
          { id: 'concept', label: 'Any concept', test: (p) => stagesOf(p, ships).includes('concept') },
        ] }
      : null,
    { id: 'game', label: 'Game package', options: yesNo<Pledge>('Game package', (p) => p.hasGame) },
    { id: 'upgraded', label: 'Upgraded', options: yesNo<Pledge>('Upgraded', (p) => p.upgraded) },
    { id: 'buyback', label: 'Buyback', options: [
      { id: 'no', label: 'No buyback after melt', hint: 'RSI marks these as not buy-backable: melting is final', test: (p) => !!p.noBuyback },
      { id: 'yes', label: 'Buy-backable', test: (p) => !p.noBuyback },
    ] },
    { id: 'named', label: 'Named ship', options: yesNo<Pledge>('Named', (p) => !!(p.nickname || p.reservedNames?.length)) },
    labelOpts.length ? { id: 'labels', label: 'Labels', hint: 'Your own labels', options: labelOpts } : null,
  ];
  return out.filter((f): f is Facet<Pledge> => !!f);
}
export const PLEDGE_PRIMARY = ['type', 'insurance', 'warbond', 'giftable'];
export const pledgeRanges: RangeFacet<Pledge>[] = [{ id: 'value', label: 'Melt value', unit: 'usd', get: (p) => p.value }];

/** How you have a hull: pledged only / in-game only / both. */
export const hadAs = (f: Pick<OwnedShip, 'count' | 'game'>): 'pledged' | 'game' | 'both' => (f.game <= 0 ? 'pledged' : f.game >= f.count ? 'game' : 'both');

/** My ships facets. `primary`: insurance, stage, size. */
export function shipFacets(fleet: OwnedShip[] = []): Facet<OwnedShip>[] {
  const makers = [...new Set(fleet.map((f) => f.ship.manufacturer).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return [
    { id: 'insurance', label: 'Insurance', options: INSURANCE_OPTIONS<OwnedShip>((f) => f.insurance[0] ?? '', (f) => f.lti) },
    { id: 'stage', label: 'Stage', options: STAGE_OPTIONS<OwnedShip>((f) => f.ship.flyable) },
    { id: 'size', label: 'Size', options: SIZE_OPTIONS<OwnedShip>((f) => f.ship.size ?? '') },
    { id: 'had', label: 'Had as', options: [
      { id: 'pledged', label: 'Pledged only', hint: 'Every copy is in a pledge on your RSI account', test: (f) => hadAs(f) === 'pledged' },
      { id: 'game', label: 'In-game only', hint: 'Bought with aUEC or earned — not on your RSI account', test: (f) => hadAs(f) === 'game' },
      { id: 'both', label: 'Both', test: (f) => hadAs(f) === 'both' },
    ] },
    { id: 'paints', label: 'Paints', options: [
      { id: 'yes', label: 'Has paints', test: (f) => f.paints.length > 0 },
      { id: 'no', label: 'No paints', test: (f) => f.paints.length === 0 },
    ] },
    { id: 'maker', label: 'Maker', options: makers.map((m) => ({ id: m.toLowerCase(), label: m, test: (f: OwnedShip) => f.ship.manufacturer === m })) },
  ];
}
export const SHIP_PRIMARY = ['insurance', 'stage', 'size'];
export const shipRanges: RangeFacet<OwnedShip>[] = [{ id: 'msrp', label: 'MSRP', unit: 'usd', get: (f) => (f.ship.msrp ? f.ship.msrp / 100 : null) }];
