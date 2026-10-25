/**
 * My CCUs page model: every upgrade you hold — hangar (applied for free) and buyback (melted, buy back to use) — as a
 * flat row joined with the catalog (both hulls, MSRPs) and the pledge's flags, plus the facets, ranges, totals, groups
 * and CSV the page renders. Money in cents; `gap` = target MSRP − source MSRP (what the store would charge for the
 * upgrade at list), `saving` = gap − what you paid (negative = you paid over the gap). Pure.
 * Spec: docs/plans/specs/filters-and-labels.md → CCUs page.
 */
import { INSURANCE_OPTIONS, STAGE_OPTIONS, yesNo, type Facet, type FacetOption, type RangeFacet } from './facets';
import { cell, type BuybackItem, type Pledge } from './hangar';
import { isWarbondSku, matchShip, type CatalogShip } from './store';
import type { OwnedCcu, SavedChain } from './ccu';

export interface CcuRow {
  /** `hangar:<pledge id>` / `buyback:<buyback id>`. */
  key: string;
  from: CatalogShip | null;
  to: CatalogShip | null;
  fromName: string;
  toName: string;
  place: 'hangar' | 'buyback';
  /** Cents: hangar melt value (0 when gifted); buyback price when the entry's page was read, else null. */
  paid: number | null;
  targetMsrp: number | null;
  sourceMsrp: number | null;
  /** targetMsrp − sourceMsrp; null when either is unknown. */
  gap: number | null;
  /** gap − paid; null when either is unknown. */
  saving: number | null;
  warbond: boolean;
  /** Pledge's insurance text ('' for buyback / none listed). */
  insurance: string;
  lti: boolean;
  giftable: boolean;
  gifted: boolean;
  meltable: boolean;
  /** A saved chain step uses this CCU (by ref, or by from→to on an owned / buyback step). */
  inChain: boolean;
  /** Name of the first saved chain using it. */
  chain: string | null;
  /** Pledge id (hangar) / buyback id. */
  ref: number;
  pledge?: Pledge;
  buyback?: BuybackItem;
}

const msrpOf = (s: CatalogShip | null) => (s && s.msrp > 0 ? s.msrp : null);

/**
 * Rows for every CCU in `owned` (mapped by `ownedCcus`) plus the upgrades it couldn't map to catalog ships (shown with
 * their RSI names, `from` / `to` null). Hangar first, then buyback, each in RSI order.
 */
export function ccuRows(owned: OwnedCcu[], ships: CatalogShip[], pledges: Pledge[], buyback: BuybackItem[], chains: SavedChain[]): CcuRow[] {
  const byId = new Map(ships.map((s) => [s.id, s]));
  const pledgeById = new Map(pledges.map((p) => [p.id, p]));
  const buybackById = new Map(buyback.map((b) => [b.id, b]));
  /** Owned steps are hangar CCUs, buyback steps buyback ones (pledge and buyback ids are separate id spaces). */
  const chainOf = (o: { place: 'hangar' | 'buyback'; ref: number; fromId: number | null; toId: number | null }): string | null => {
    const kind = o.place === 'hangar' ? 'owned' : 'buyback';
    for (const c of chains)
      for (const s of c.steps)
        if (s.kind === kind && (s.ref != null ? s.ref === o.ref : s.fromId === o.fromId && s.toId === o.toId)) return c.name;
    return null;
  };
  const row = (place: 'hangar' | 'buyback', ref: number, from: CatalogShip | null, to: CatalogShip | null, gifted: boolean): CcuRow => {
    const pledge = place === 'hangar' ? pledgeById.get(ref) : undefined;
    const bb = place === 'buyback' ? buybackById.get(ref) : undefined;
    const up = pledge?.upgrade ?? bb?.upgrade ?? null;
    const paid = pledge ? Math.round((pledge.value ?? 0) * 100) : (bb?.price ?? null);
    const sourceMsrp = msrpOf(from);
    const targetMsrp = msrpOf(to);
    const gap = sourceMsrp != null && targetMsrp != null ? targetMsrp - sourceMsrp : null;
    const chain = chainOf({ place, ref, fromId: from?.id ?? null, toId: to?.id ?? null });
    return {
      key: `${place}:${ref}`,
      from,
      to,
      fromName: from?.name ?? up?.fromName ?? '',
      toName: to?.name ?? up?.toName ?? '',
      place,
      paid,
      targetMsrp,
      sourceMsrp,
      gap,
      saving: gap != null && paid != null ? gap - paid : null,
      warbond: pledge ? pledge.warbond : isWarbondSku({ title: bb?.name ?? '' }),
      insurance: pledge?.insurance ?? '',
      lti: pledge?.lti ?? false,
      giftable: pledge?.giftable ?? false,
      gifted,
      meltable: pledge?.meltable ?? false,
      inChain: chain != null,
      chain,
      ref,
      ...(pledge ? { pledge } : {}),
      ...(bb ? { buyback: bb } : {}),
    };
  };
  const out: CcuRow[] = [];
  const seen = new Set<string>();
  for (const o of owned) {
    seen.add(`${o.source}:${o.ref}`);
    out.push(row(o.source, o.ref, byId.get(o.fromId) ?? null, byId.get(o.toId) ?? null, o.gifted));
  }
  // Upgrades `ownedCcus` couldn't map (name not in the catalog, or the catalog not loaded): best-effort names only.
  const loose = (place: 'hangar' | 'buyback', list: { id: number; upgrade: Pledge['upgrade']; value?: number }[]) => {
    for (const p of list) {
      if (!p.upgrade || seen.has(`${place}:${p.id}`)) continue;
      const from = p.upgrade.fromName ? matchShip(p.upgrade.fromName, ships) : null;
      const to = p.upgrade.toName ? matchShip(p.upgrade.toName, ships) : null;
      out.push(row(place, p.id, from, to && to.id !== from?.id ? to : null, place === 'hangar' && Math.round((p.value ?? 0) * 100) === 0));
    }
  };
  loose('hangar', pledges);
  loose('buyback', buyback);
  const order = (r: CcuRow) => (r.place === 'hangar' ? 0 : 1);
  return out.map((r, i) => ({ r, i })).sort((a, b) => order(a.r) - order(b.r) || a.i - b.i).map((x) => x.r);
}

export type SavingBucket = 'saves' | 'none' | 'negative' | 'unknown';
export const savingOf = (r: CcuRow): SavingBucket => (r.saving == null ? 'unknown' : r.saving > 0 ? 'saves' : r.saving < 0 ? 'negative' : 'none');

const makerOptions = (rows: CcuRow[], get: (r: CcuRow) => CatalogShip | null): FacetOption<CcuRow>[] => {
  const makers = [...new Set(rows.map((r) => get(r)?.manufacturer).filter((m): m is string => !!m))].sort((a, b) => a.localeCompare(b));
  return makers.map((m) => ({ id: m, label: m, test: (r: CcuRow) => get(r)?.manufacturer === m }));
};

export function ccuFacets(rows: CcuRow[]): Facet<CcuRow>[] {
  return [
    {
      id: 'place',
      label: 'Place',
      options: [
        { id: 'hangar', label: 'Hangar', hint: 'In your hangar — applying it costs nothing more', test: (r) => r.place === 'hangar' },
        { id: 'buyback', label: 'Buyback', hint: 'Melted — buy it back to use it', test: (r) => r.place === 'buyback' },
      ],
    },
    {
      id: 'saving',
      label: 'Saving',
      options: [
        { id: 'saves', label: 'Saves', hint: 'Paid less than the MSRP gap between the two hulls', test: (r) => savingOf(r) === 'saves' },
        { id: 'none', label: 'No saving', hint: 'Paid exactly the MSRP gap', test: (r) => savingOf(r) === 'none' },
        { id: 'negative', label: 'Negative', hint: 'Paid more than the MSRP gap today (MSRPs changed since)', test: (r) => savingOf(r) === 'negative' },
        { id: 'unknown', label: 'Unknown', hint: 'Buyback price not read yet, or a hull without an MSRP', test: (r) => savingOf(r) === 'unknown' },
      ],
    },
    {
      id: 'warbond',
      label: 'Warbond',
      options: [
        { id: 'yes', label: 'Warbond', test: (r) => r.warbond },
        { id: 'no', label: 'Standard', test: (r) => !r.warbond },
      ],
    },
    { id: 'insurance', label: 'Insurance', options: INSURANCE_OPTIONS((r: CcuRow) => r.insurance, (r) => r.lti) },
    { id: 'stage', label: 'Target stage', options: STAGE_OPTIONS((r: CcuRow) => r.to?.flyable ?? '') },
    { id: 'giftable', label: 'Giftable', options: yesNo<CcuRow>('Giftable', (r) => r.giftable) },
    { id: 'gifted', label: 'Gifted', options: yesNo<CcuRow>('Gifted', (r) => r.gifted, ['Hangar CCU with no melt value — received as a gift', 'Bought, or in buyback']) },
    { id: 'meltable', label: 'Meltable', options: yesNo<CcuRow>('Meltable', (r) => r.meltable) },
    { id: 'fromMaker', label: 'Source maker', multiple: true, options: makerOptions(rows, (r) => r.from) },
    { id: 'toMaker', label: 'Target maker', multiple: true, options: makerOptions(rows, (r) => r.to) },
    { id: 'chain', label: 'Saved chain', options: yesNo<CcuRow>('In a saved chain', (r) => r.inChain, ['A chain saved in the CCU planner uses it', 'No saved chain uses it']) },
  ];
}

const dollars = (c: number | null) => (c == null ? null : c / 100);
export const ccuRanges: RangeFacet<CcuRow>[] = [
  { id: 'targetMsrp', label: 'Target MSRP', unit: 'usd', get: (r) => dollars(r.targetMsrp) },
  { id: 'paid', label: 'Paid', unit: 'usd', get: (r) => dollars(r.paid) },
  { id: 'savingAmt', label: 'Saving', unit: 'usd', get: (r) => dollars(r.saving) },
];

export interface CcuTotals {
  count: number;
  /** Cents; rows with an unknown amount are left out of each sum. */
  paid: number;
  gap: number;
  saving: number;
  /** Rows whose paid / saving is unknown (buyback without a price, hull without MSRP). */
  unknown: number;
}
export function ccuTotals(rows: CcuRow[]): CcuTotals {
  const sum = (f: (r: CcuRow) => number | null) => rows.reduce((n, r) => n + (f(r) ?? 0), 0);
  return { count: rows.length, paid: sum((r) => r.paid), gap: sum((r) => r.gap), saving: sum((r) => r.saving), unknown: rows.filter((r) => r.saving == null).length };
}

export interface CcuGroup {
  key: string;
  /** First row of the group (in the incoming order). */
  rep: CcuRow;
  rows: CcuRow[];
}
/** Identical upgrades (same place, same from → to) stacked; keeps the incoming order (sort first, then group). */
export function groupCcus(rows: CcuRow[]): CcuGroup[] {
  const m = new Map<string, CcuGroup>();
  for (const r of rows) {
    const key = `${r.place}|${r.from?.id ?? r.fromName.toLowerCase()}>${r.to?.id ?? r.toName.toLowerCase()}`;
    const g = m.get(key);
    if (g) g.rows.push(r);
    else m.set(key, { key, rep: r, rows: [r] });
  }
  return [...m.values()];
}

const money = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2));
export function ccuCsv(rows: CcuRow[]): string {
  const head = ['place', 'ref', 'from', 'from_maker', 'to', 'to_maker', 'paid_usd', 'source_msrp_usd', 'target_msrp_usd', 'gap_usd', 'saving_usd', 'warbond', 'insurance', 'giftable', 'gifted', 'meltable', 'saved_chain', 'target_stage', 'target_size'];
  return [
    head.join(','),
    ...rows.map((r) =>
      [r.place, r.ref, r.fromName, r.from?.manufacturer ?? '', r.toName, r.to?.manufacturer ?? '', money(r.paid), money(r.sourceMsrp), money(r.targetMsrp), money(r.gap), money(r.saving), r.warbond, r.lti ? 'LTI' : r.insurance, r.giftable, r.gifted, r.meltable, r.chain ?? '', r.to?.flyable ?? '', r.to?.size ?? '']
        .map(cell)
        .join(','),
    ),
  ].join('\n');
}
