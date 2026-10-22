<script lang="ts">
  /**
   * Paint rebuy: melt paints you paid full price for, buy them back in one cart with RSI's multi-paint discount
   * (2 → 15 % … 10+ → 35 %), pocket the difference as store credit. Only pledges you can melt *and* rebuy today
   * are counted (`rebuyCandidates`); the plan ranks them by gain and fills up to the cart cap. A pledge whose paints
   * the store also sells as a pack can be rebought as the pack (one listing) or as singles (each counts toward the tier).
   */
  import Wizard, { type WizardStep } from './Wizard.svelte';
  import { addStandalone, CART_URL, CartError, readCart, type CartSnapshot } from '@/lib/cart';
  import { cartErrorLabel, createCartLedger, type CartState } from '@/lib/cart-ui.svelte';
  import { HANGAR_PAGE, hangarUrl, type BuybackItem, type Pledge } from '@/lib/hangar';
  import { refreshHangar, type HangarProgress } from '@/lib/hangar-refresh';
  import { storePaintIndex, type ItemRow, type OwnedShip } from '@/lib/items';
  import { itemKey } from '@/lib/melt';
  import { sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';
  import Stat from './Stat.svelte';
  import { cn } from '@/lib/utils';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import * as Tooltip from '@/components/ui/tooltip';
  import Thumb from './Thumb.svelte';
  import Section from './Section.svelte';
  import Tag from './Tag.svelte';
  import HintBadge from './HintBadge.svelte';
  import TipButton from './TipButton.svelte';
  import LazyTip from './LazyTip.svelte';
  import OpenCartButton from './OpenCartButton.svelte';
  import Empty from './Empty.svelte';
  import Chip from './Chip.svelte';
  import Segmented from './Segmented.svelte';
  import * as Alert from '@/components/ui/alert';
  import * as Select from '@/components/ui/select';
  import * as Command from '@/components/ui/command';
  import * as Collapsible from '@/components/ui/collapsible';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import { Progress } from '@/components/ui/progress';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import House from '@lucide/svelte/icons/house';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Star from '@lucide/svelte/icons/star';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import {
    bestScenario,
    bundleScenarios,
    bundleTotals,
    buybackCompare,
    buybackContents,
    countTitles,
    titleWithCount,
    hangarCounts,
    CART_PAINT_LIMIT,
    costAlone,
    gainAt,
    MELT_ONLY_LABEL,
    meltOnlySplit,
    optionAt,
    optionPay,
    optionSubset,
    paintLine,
    paidOff,
    PAINT_TIERS,
    paintDiscount,
    planBundle,
    rebuyCandidates,
    SKIP_LABEL,
    storePacks,
    type BundlePick,
    type PackTier,
    type RebuyCandidate,
    type MeltOnly,
    MELT_ONLY_LABEL as REDUNDANT_LABEL,
    type RebuyOption,
    type SkipReason,
  } from '@/lib/paints';
  import { paintKey, priceLabel, usd, type CatalogShip, type StorePaint } from '@/lib/store';
  import { ownUsd } from '@/lib/privacy.svelte';

  let {
    pledges,
    rows,
    fleet,
    ships,
    storePaints,
    ownedStoreIds,
    buyback = [],
  }: {
    pledges: Pledge[];
    /** Saved buyback list (Buyback tab), for the compare. */
    buyback?: BuybackItem[];
    /** Store catalog (which variants share a paint line). */
    ships: CatalogShip[];
    /** Hangar item rows (paint → ships it fits). */
    rows: ItemRow[];
    /** Ships you own. */
    fleet: OwnedShip[];
    storePaints: StorePaint[];
    /** Store listings you already own (not offered as "new" paints). */
    ownedStoreIds: Set<number>;
  } = $props();

  // ---- prefs (wanted paints, cap, pack counting) ----
  const PREFS = 'rsiplus:paintbundle';
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<{ wanted: number[]; limit: number; packTier: PackTier; meltNoShip: boolean; meltDups: boolean; bbHideStore: boolean; bbOwned: number[] }>;
    } catch {
      return {};
    }
  })();
  let wantedIds = $state<number[]>(saved.wanted ?? []);
  let limit = $state(saved.limit ?? CART_PAINT_LIMIT);
  let packTier = $state<PackTier>(saved.packTier ?? 'none');
  let meltNoShip = $state(saved.meltNoShip ?? true);
  let meltDups = $state(saved.meltDups ?? true);
  /** Melt-only pledges the user wants to rebuy anyway. */
  let forceRebuy = $state<number[]>([]);
  /** Per pledge: store listing ids inside a pack the user set by hand (overrides the automatic dedupe). */
  let dropped = $state<Record<number, number[]>>({});
  $effect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ wanted: wantedIds, limit, packTier, meltNoShip, meltDups, bbHideStore, bbOwned: bbOwnedIds }));
    } catch {
      /* fine */
    }
  });

  const idx = $derived(storePaintIndex(storePaints));
  const byId = $derived(new Map(storePaints.map((p) => [p.id, p])));
  const packs = $derived(storePacks(storePaints));
  /** Paints you don't need back (fit no owned ship / surplus copies): melt for credit, no rebuy. */
  const melt = $derived(meltOnlySplit(pledges, rows, fleet, { noShip: meltNoShip, duplicates: meltDups, except: new Set(forceRebuy), ships }));
  const meltOnly = $derived(melt.meltOnly);
  const meltOnlyCredit = $derived(meltOnly.reduce((a, m) => a + m.credit, 0));
  const split = $derived(rebuyCandidates(melt.keep, idx, { packs, packTier }));
  const cands = $derived(split.ok);
  const candById = $derived(new Map(cands.map((c) => [c.pledge.id, c])));
  /** Automatic dedupe: redundant paints inside kept packs → their listing ids (not bought back) + why. */
  const autoDrop = $derived.by(() => {
    const m = new Map<number, Map<number, MeltOnly['why']>>();
    for (const c of cands) {
      const red = melt.redundant.get(c.pledge.id);
      if (!red || !c.single) continue;
      const ids = new Map<number, MeltOnly['why']>();
      for (const r of red) for (const l of c.single.lines) if (l.title === r.title) ids.set(l.store.id, r.why);
      if (ids.size) m.set(c.pledge.id, ids);
    }
    return m;
  });
  const dropMap = $derived(new Map<number, Set<number>>(cands.map((c): [number, Set<number>] => [c.pledge.id, dropSet(c.pledge.id)]).filter(([, set]) => set.size > 0)));
  const wanted = $derived(wantedIds.map((id) => byId.get(id)).filter((p): p is StorePaint => !!p && p.available));

  // ---- picks: auto plan until the user touches a row ----
  let manual = $state<number[] | null>(null);
  /** Pack / singles chosen by hand per pledge (else the cheaper at the cart's rate). */
  let optionOf = $state<Record<number, RebuyOption['kind']>>({});
  const dropSet = (id: number) => new Set(dropped[id] ?? [...(autoDrop.get(id)?.keys() ?? [])]);
  const plan = $derived(planBundle(cands, wanted, limit, dropMap));
  const picks = $derived.by((): BundlePick[] => {
    if (manual == null) return plan;
    const list = manual.map((id) => candById.get(id)).filter((c): c is RebuyCandidate => !!c);
    const choose = (c: RebuyCandidate, rate: number): RebuyOption => {
      const want = optionOf[c.pledge.id];
      return optionSubset((want === 'pack' ? c.pack : want === 'single' ? c.single : null) ?? optionAt(c, rate), dropSet(c.pledge.id));
    };
    // Two passes: the rate depends on how many paints the chosen options count.
    const rate0 = bundleTotals(list.map((c) => ({ cand: c, option: choose(c, 0) })), wanted).rate;
    return list.map((c) => ({ cand: c, option: choose(c, rate0) }));
  });
  const dropLine = (id: number, storeId: number, on: boolean) => {
    const s = dropSet(id);
    on ? s.delete(storeId) : s.add(storeId);
    dropped = { ...dropped, [id]: [...s] };
  };
  const pickedIds = $derived(new Set(picks.map((p) => p.cand.pledge.id)));
  const pickOf = $derived(new Map(picks.map((p) => [p.cand.pledge.id, p])));
  const totals = $derived(bundleTotals(picks, wanted));
  const toManual = () => {
    if (manual != null) return;
    manual = picks.map((p) => p.cand.pledge.id);
    optionOf = Object.fromEntries(picks.filter((p) => p.cand.single && p.cand.pack).map((p) => [p.cand.pledge.id, p.option.kind]));
  };
  const toggle = (id: number) => {
    toManual();
    const s = new Set(manual ?? []);
    s.has(id) ? s.delete(id) : s.add(id);
    manual = [...s];
  };
  const setOption = (id: number, kind: RebuyOption['kind']) => {
    toManual();
    optionOf = { ...optionOf, [id]: kind };
    if (!pickedIds.has(id)) manual = [...(manual ?? []), id];
  };
  const applyPicks = (list: BundlePick[]) => {
    manual = list.map((p) => p.cand.pledge.id);
    optionOf = Object.fromEntries(list.filter((p) => p.cand.single && p.cand.pack).map((p) => [p.cand.pledge.id, p.option.kind]));
  };
  const paintsOf = (list: RebuyCandidate[]) => list.reduce((n, c) => n + (c.single?.count ?? c.pack?.count ?? 0), 0);
  const overCap = $derived(totals.lines > limit);
  /** Full option shown for a row (before per-paint opt-outs): the pick's kind, else the cheaper one at the cart's rate. */
  const rowFull = (c: RebuyCandidate): RebuyOption => {
    const kind = pickOf.get(c.pledge.id)?.option.kind ?? optionOf[c.pledge.id];
    return (kind === 'pack' ? c.pack : kind === 'single' ? c.single : null) ?? optionAt(c, totals.rate);
  };
  const rowOption = (c: RebuyCandidate) => optionSubset(rowFull(c), dropSet(c.pledge.id));
  const inCart = (o: RebuyOption) => optionPay(o, totals.rate);

  // ---- candidate rows: filter + sort ----
  type CandShow = '' | 'picked' | 'unpicked' | 'gain' | 'keep' | 'packs' | 'singles' | 'partial' | 'sale' | 'dedupe';
  type CandKey = 'paint' | 'ship' | 'pledge' | 'paints' | 'paid' | 'alone' | 'here' | 'gainAlone' | 'gainHere' | 'off';
  let candQ = $state('');
  let candShow = $state<CandShow>('');
  /** Ship filter (candidates + melt only): a hull name from the paints' fits, '' = any. */
  let candShip = $state('');
  let candSort = $state<SortState<CandKey>>({ key: 'gainHere', dir: 'desc' });
  /** Ships each hangar paint fits (from the items view), for the Ship column and search. */
  const fitsByKey = $derived(new Map(rows.filter((r) => r.category === 'paint').map((r) => [itemKey(r.title), r.fits.map((x) => x.name)])));
  const shipsOf = (c: RebuyCandidate) => [...new Set(c.titles.flatMap((t) => fitsByKey.get(itemKey(t)) ?? []))];
  const ownedNames = $derived(new Set(fleet.map((f) => f.ship.name)));
  const line = (name: string) => paintLine(name, ships);
  const ownedLines = $derived(new Set(fleet.map((f) => line(f.ship.name))));
  /** Variants you own that a paint named for another hull of the line also fits. */
  const variantsOwned = (names: string[]) => (names.some((n) => ownedNames.has(n)) ? [] : fleet.filter((f) => names.some((n) => line(n) === line(f.ship.name))).map((f) => f.ship.name));
  /** Why a paint reads as fitting / not fitting: fits, line, hulls you own in it. */
  const explain = (names: string[]) => {
    if (!names.length) return 'No store ship found in the paint name — treated as unknown (kept).';
    const lines = [...new Set(names.map(line))];
    const hulls = fleet.filter((f) => lines.includes(line(f.ship.name)));
    return `Fits: ${names.join(', ')}\nLine: ${lines.join(', ')}\nHulls you own in it: ${hulls.length ? hulls.map((f) => `${f.ship.name} ×${f.count}`).join(', ') : 'none'}`;
  };
  /** Hangar ships the catalog didn't match — their paints can read as "no ship". */
  const unmatchedShips = $derived(rows.filter((r) => r.category === 'ship' && !r.ship).map((r) => r.title));
  interface CandRow {
    c: RebuyCandidate;
    full: RebuyOption;
    o: RebuyOption;
    alone: number;
    g: number;
    gAlone: number;
    on: boolean;
    isPack: boolean;
    ships: string[];
    sale: boolean;
  }
  const candRows = $derived.by((): CandRow[] => {
    const all = cands.map((c): CandRow => {
      const full = rowFull(c);
      const o = optionSubset(full, dropSet(c.pledge.id));
      const alone = costAlone(c);
      return { c, full, o, alone, g: c.credit - inCart(o), gAlone: c.credit - alone, on: pickedIds.has(c.pledge.id), isPack: c.titles.length > 1, ships: shipsOf(c), sale: full.lines.some((l) => l.store.discounted < l.store.price) };
    });
    const q = candQ.trim().toLowerCase();
    const shown = all.filter((r) => {
      if (q && !`${r.c.titles.join(' ')} ${r.c.pledge.name} ${r.c.pledge.id} ${r.ships.join(' ')}`.toLowerCase().includes(q)) return false;
      if (candShip && !r.ships.includes(candShip)) return false;
      switch (candShow) {
        case 'picked': return r.on;
        case 'unpicked': return !r.on;
        case 'gain': return r.g > 0;
        case 'keep': return r.g <= 0;
        case 'packs': return r.isPack;
        case 'singles': return !r.isPack;
        case 'partial': return r.c.missing.length > 0;
        case 'sale': return r.sale;
        case 'dedupe': return dropSet(r.c.pledge.id).size > 0;
        default: return true;
      }
    });
    return sortBy(shown, candSort, {
      paint: (r) => r.c.titles[0] ?? '',
      ship: (r) => r.ships[0] ?? null,
      pledge: (r) => r.c.pledge.name,
      paints: (r) => r.full.lines.length,
      paid: (r) => r.c.credit,
      alone: (r) => r.alone,
      here: (r) => inCart(r.o),
      gainAlone: (r) => r.gAlone,
      gainHere: (r) => r.g,
      off: (r) => paidOff(r.c) || null,
    });
  });
  const candCounts = $derived.by(() => {
    const n = { picked: 0, gain: 0, packs: 0, partial: 0, sale: 0, dedupe: 0 };
    for (const c of cands) {
      const o = rowOption(c);
      if (pickedIds.has(c.pledge.id)) n.picked++;
      if (c.credit - inCart(o) > 0) n.gain++;
      if (c.titles.length > 1) n.packs++;
      if (c.missing.length) n.partial++;
      if (dropSet(c.pledge.id).size) n.dedupe++;
      if (rowFull(c).lines.some((l) => l.store.discounted < l.store.price)) n.sale++;
    }
    return n;
  });

  // ---- melt-only rows: filter + sort ----
  type MeltKey = 'paint' | 'why' | 'pledge' | 'credit';
  let meltWhy = $state<'' | MeltOnly['why']>('');
  let meltSort = $state<SortState<MeltKey>>({ key: 'credit', dir: 'desc' });
  const meltShips = (m: MeltOnly) => [...new Set(m.titles.flatMap((t) => fitsByKey.get(itemKey(t)) ?? []))];
  /** Every hull named by a candidate or melt-only paint, for the Ship filter. */
  const shipOptions = $derived([...new Set([...cands.flatMap(shipsOf), ...meltOnly.flatMap(meltShips)])].sort((a, b) => a.localeCompare(b)));
  const meltRows = $derived(
    sortBy(
      meltOnly.filter(
        (m) =>
          (!meltWhy || m.why === meltWhy) &&
          (!candShip || meltShips(m).includes(candShip)) &&
          (!candQ.trim() || `${m.titles.join(' ')} ${m.pledge.name} ${m.pledge.id}`.toLowerCase().includes(candQ.trim().toLowerCase())),
      ),
      meltSort,
      { paint: (m) => m.titles[0] ?? '', why: (m) => m.why, pledge: (m) => m.pledge.name, credit: (m) => m.credit },
    ),
  );

  // ---- best value by cart size ----
  const scenarios = $derived(bundleScenarios(cands, wanted, limit, dropMap));
  const bestIdx = $derived(bestScenario(scenarios));
  const sameAs = (list: BundlePick[]) => list.length === picks.length && list.every((p) => pickOf.get(p.cand.pledge.id)?.option.kind === p.option.kind);

  // ---- new paints to add ----
  let q = $state('');
  const matches = $derived.by(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return storePaints.filter((p) => p.available && !ownedStoreIds.has(p.id) && !wantedIds.includes(p.id) && p.name.toLowerCase().includes(query)).slice(0, 12);
  });
  const addWanted = (id: number) => ((wantedIds = [...wantedIds, id]), (q = ''));
  const dropWanted = (id: number) => (wantedIds = wantedIds.filter((x) => x !== id));

  // ---- skipped paints ----
  let showSkipped = $state(false);
  let showOptions = $state(false);
  const ahead = $derived(totals.net + meltOnlyCredit);
  let showPacks = $state(false);
  const skippedBy = $derived.by(() => {
    const m = new Map<SkipReason, typeof split.skipped>();
    for (const s of split.skipped) m.set(s.why, [...(m.get(s.why) ?? []), s]);
    return [...m.entries()];
  });
  /** First tier that beats a pack's own discount. */
  const beats = (rate: number) => PAINT_TIERS.find((t) => t.rate > rate + 1e-9) ?? null;

  // ---- RSI cart ----
  const cart = createCartLedger();
  /** Every cart line of the plan: the picks' listings + wanted paints (one line per listing; a repeated listing adds qty). */
  const cartLines = $derived.by(() => {
    const m = new Map<number, { paint: StorePaint; qty: number }>();
    for (const p of picks) for (const l of p.option.lines) m.set(l.store.id, { paint: l.store, qty: (m.get(l.store.id)?.qty ?? 0) + 1 });
    for (const w of wanted) m.set(w.id, { paint: w, qty: (m.get(w.id)?.qty ?? 0) + 1 });
    return [...m.values()];
  });
  /** Every line in order, one at a time (RSI's polite gap), stopping at the first failure; lines already in are skipped. */
  const addAll = () => cart.addAll(cartLines.map((l) => ({ key: l.paint.id, task: () => addStandalone(l.paint.id, l.qty) })));
  const cartBusy = $derived(cart.busy);
  const added = $derived(cartLines.filter((l) => cart.of(l.paint.id)?.st === 'added').length);

  // ---- melt checklist: a snapshot of what to melt, ticked by hand or by vanishing from a reloaded hangar ----
  interface MeltItem {
    id: number;
    name: string;
    titles: string[];
    credit: number;
    why: 'rebuy' | 'melt-only';
    page: number;
  }
  interface MeltList {
    at: number;
    items: MeltItem[];
    /** pledge id → when ticked by hand (ms). */
    done: Record<number, number>;
    /** RSI's cart held every planned line when the list was started (the guide gates melting on it). */
    confirmed?: boolean;
  }
  const MELT_KEY = 'rsiplus:paintbundle:melt';
  let meltList = $state<MeltList | null>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(MELT_KEY) ?? 'null') as MeltList | null;
      } catch {
        return null;
      }
    })(),
  );
  $effect(() => {
    try {
      meltList ? localStorage.setItem(MELT_KEY, JSON.stringify(meltList)) : localStorage.removeItem(MELT_KEY);
    } catch {
      /* fine */
    }
  });
  const pageOf = (id: number) => {
    const i = pledges.findIndex((p) => p.id === id);
    return pledges[i]?.page ?? (i >= 0 ? Math.floor(i / HANGAR_PAGE) + 1 : 1);
  };
  const itemOfCand = (c: RebuyCandidate): MeltItem => ({ id: c.pledge.id, name: c.pledge.name, titles: c.titles, credit: c.credit, why: 'rebuy', page: pageOf(c.pledge.id) });
  const itemOfMelt = (m: MeltOnly): MeltItem => ({ id: m.pledge.id, name: m.pledge.name, titles: m.titles, credit: m.credit, why: 'melt-only', page: pageOf(m.pledge.id) });
  /** Last hangar page first: melting from the bottom never shifts the rows (and page numbers) still to do. */
  const byPage = (a: MeltItem, b: MeltItem) => b.page - a.page || b.id - a.id;
  /** Ticked by hand and still in the loaded hangar: their rows are gone on RSI, so links below them shift up. */
  const meltedIds = $derived(new Set(Object.keys(meltList?.done ?? {}).map(Number).filter((id) => hangarIds.has(id))));
  /** Today's plan as checklist items: picked rebuys + melt-only. */
  const planItems = $derived([...picks.map((p) => itemOfCand(p.cand)), ...meltOnly.map(itemOfMelt)].sort(byPage));
  /** Pledge ids on the checklist. */
  const listed = $derived(new Set(meltList?.items.map((it) => it.id) ?? []));
  const newFromPlan = $derived(planItems.filter((it) => !listed.has(it.id)));
  /** Replace the checklist with today's plan (ticks kept for pledges still on it). */
  function startMeltList() {
    const keep = new Set(planItems.map((it) => it.id));
    meltList = { at: Date.now(), items: planItems, done: Object.fromEntries(Object.entries(meltList?.done ?? {}).filter(([id]) => keep.has(Number(id)))), confirmed: cartLines.length === 0 || !!check?.ok };
  }
  /** Add pledges to the checklist (starts one if needed). A rebuy added later means the cart must be confirmed again. */
  function addToList(items: MeltItem[]) {
    const cur: MeltList = meltList ?? { at: Date.now(), items: [], done: {}, confirmed: cartLines.length === 0 || !!check?.ok };
    const add = items.filter((it) => !cur.items.some((x) => x.id === it.id));
    if (!add.length) return;
    meltList = { ...cur, items: [...cur.items, ...add].sort(byPage), confirmed: add.some((it) => it.why === 'rebuy') && cartLines.length ? false : cur.confirmed };
  }
  /** A rebuy candidate onto the checklist: picked too (its paints join the cart plan), so nothing is melted unbought. */
  function addCand(c: RebuyCandidate) {
    if (!pickedIds.has(c.pledge.id)) toggle(c.pledge.id);
    addToList([itemOfCand(c)]);
  }
  function dropFromList(id: number) {
    if (!meltList) return;
    const done = { ...meltList.done };
    delete done[id];
    meltList = { ...meltList, items: meltList.items.filter((it) => it.id !== id), done };
  }
  // ---- checklist filters ----
  type ListShow = 'todo' | 'all' | 'done' | 'rebuy' | 'melt-only';
  let listShow = $state<ListShow>('todo');
  let listQ = $state('');
  const listPass = (it: MeltItem) => {
    const q = listQ.trim().toLowerCase();
    if (q && !`${it.name} ${it.titles.join(' ')} ${it.id}`.toLowerCase().includes(q)) return false;
    const st = meltStatus(it);
    return listShow === 'todo' ? st === 'todo' : listShow === 'done' ? st !== 'todo' : listShow === 'all' ? true : it.why === listShow;
  };
  // ---- reload the hangar right here (no trip to the Hangar tab) ----
  let reloading = $state<HangarProgress | null>(null);
  let reloadErr = $state('');
  const reloadLabel = $derived(reloading ? `Reloading… page ${reloading.page}${reloading.pages ? ` / ${reloading.pages}` : ''}` : 'Reload hangar');
  async function reloadHangar() {
    if (reloading) return;
    reloading = { page: 0, count: 0 };
    reloadErr = '';
    try {
      await refreshHangar((p) => (reloading = p));
    } catch (e) {
      reloadErr = (e as Error).message;
    } finally {
      reloading = null;
    }
  }
  const hangarIds = $derived(new Set(pledges.map((p) => p.id)));
  const meltStatus = (it: MeltItem): 'done' | 'gone' | 'todo' => (meltList?.done[it.id] ? 'done' : !hangarIds.has(it.id) ? 'gone' : 'todo');
  const tickMelt = (id: number, on: boolean) => {
    if (!meltList) return;
    const done = { ...meltList.done };
    on ? (done[id] = Date.now()) : delete done[id];
    meltList = { ...meltList, done };
  };
  const meltProgress = $derived.by(() => {
    if (!meltList) return null;
    const finished = meltList.items.filter((it) => meltStatus(it) !== 'todo');
    return { n: finished.length, total: meltList.items.length, credit: finished.reduce((a, it) => a + it.credit, 0), creditTotal: meltList.items.reduce((a, it) => a + it.credit, 0) };
  });
  const meltPages = $derived.by(() => {
    const m = new Map<number, MeltItem[]>();
    for (const it of meltList?.items ?? []) m.set(it.page, [...(m.get(it.page) ?? []), it]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  });

  // ---- buyback compare ----
  const bbc = $derived(buybackCompare(buyback, rows, fleet, ships, idx));
  type BbView = 'mine' | 'other' | 'items' | 'owned';
  const hangarQty = $derived(hangarCounts(pledges));
  const qtyOf = (t: string) => hangarQty.get(itemKey(t)) ?? 0;
  let bbView = $state<BbView>('mine');
  let showBb = $state(false);
  let bbQ = $state('');
  let bbHideStore = $state(saved.bbHideStore ?? true);
  /** Buyback entries you say you already own (hangar name differs, got it another way) — hidden until unmarked. */
  let bbOwnedIds = $state<number[]>(saved.bbOwned ?? []);
  let bbShowOwned = $state(false);
  const bbOwned = (id: number) => bbOwnedIds.includes(id);
  const markOwned = (id: number, on: boolean) => (bbOwnedIds = on ? [...new Set([...bbOwnedIds, id])] : bbOwnedIds.filter((x) => x !== id));
  const bbKeep = (id: number, buyable: boolean) => (bbShowOwned ? bbOwned(id) : !bbOwned(id) && (!bbHideStore || !buyable));
  const bbMatch = (t: string) => !bbQ.trim() || t.toLowerCase().includes(bbQ.trim().toLowerCase());
  const bbMine = $derived(bbc.paintsForMyShips.filter((p) => bbKeep(p.item.id, p.buyableNow)));
  const bbOther = $derived(bbc.otherPaints.filter((p) => bbKeep(p.item.id, p.buyableNow)));
  const bbItems = $derived(bbc.missing.filter((m) => bbKeep(m.item.id, m.buyableNow)));
  const bbOwnedCount = $derived([...bbc.paintsForMyShips, ...bbc.otherPaints].filter((p) => bbOwned(p.item.id)).length + bbc.missing.filter((m) => bbOwned(m.item.id)).length);
  const bbHidden = $derived(bbc.paintsForMyShips.length + bbc.otherPaints.length + bbc.missing.length - bbMine.length - bbOther.length - bbItems.length - (bbShowOwned ? 0 : bbOwnedCount));

  // ---- confirm: read RSI's cart back and tick off the plan before anything is melted ----
  let rsiCart = $state<CartSnapshot | null>(null);
  let cartReadErr = $state('');
  let cartReading = $state(false);
  async function confirmCart() {
    cartReading = true;
    cartReadErr = '';
    try {
      rsiCart = await readCart();
    } catch (e) {
      cartReadErr = e instanceof CartError ? `${cartErrorLabel(e.code)} — ${e.message}` : (e as Error).message;
    } finally {
      cartReading = false;
    }
  }
  const check = $derived.by(() => {
    if (!rsiCart) return null;
    const inCart = new Map<number, { qty: number; line: CartSnapshot['lines'][number] }>();
    for (const l of rsiCart.lines) inCart.set(l.skuId, { qty: (inCart.get(l.skuId)?.qty ?? 0) + l.qty, line: l });
    const rows = cartLines.map((p) => {
      const got = inCart.get(p.paint.id);
      return { paint: p.paint, want: p.qty, got: got?.qty ?? 0, line: got?.line ?? null, ok: (got?.qty ?? 0) >= p.qty };
    });
    const planned = new Set(cartLines.map((p) => p.paint.id));
    const extra = rsiCart.lines.filter((l) => !planned.has(l.skuId));
    const missing = rows.filter((r) => !r.ok);
    const paintLines = rsiCart.lines.filter((l) => planned.has(l.skuId));
    const listSum = paintLines.reduce((a, l) => a + l.unit * l.qty, 0);
    const paySum = paintLines.reduce((a, l) => a + l.unitDiscounted * l.qty, 0);
    return { rows, extra, missing, ok: rows.length > 0 && !missing.length, listSum, paySum, rate: listSum ? 1 - paySum / listSum : 0 };
  });
  const firstError = $derived(cartLines.map((l) => cart.of(l.paint.id)).find((c): c is Extract<CartState, { st: 'error' }> => c?.st === 'error'));
  const pct = (r: number) => `${Math.round(r * 100)}%`;

  /** Store listing for a hangar title, if any (for images of paints that aren't rebuyable). */
  const listingOf = (title: string) => idx.get(paintKey(title)) ?? null;
  const signed = (c: number) => `${c >= 0 ? '+' : '−'}${usd(Math.abs(c))}`;
  // ---- section folds: a block folds itself once its part of the flow is done ----
  const allMelted = $derived(!!meltProgress && meltProgress.total > 0 && meltProgress.n === meltProgress.total);
  const planFrozen = $derived(!!meltList);
  const cartDone = $derived(cartLines.length === 0 ? planFrozen : !!check?.ok);
  // ---- guided flow: steps judged from the live state above; after the checklist starts, the snapshot is the anchor ----
  const guide = $derived.by((): WizardStep[] => {
    const planning = !meltList;
    const chosen = picks.length + meltOnly.length;
    const cartOk = cartLines.length === 0 || added === cartLines.length;
    const confirmedOk = cartLines.length === 0 || !!check?.ok;
    const melted = !!meltProgress && meltProgress.total > 0 && meltProgress.n === meltProgress.total;
    const allGone = !!meltList && meltList.items.every((it) => !hangarIds.has(it.id));
    const back = !!meltList && meltList.items.filter((it) => it.why === 'rebuy').every((it) => it.titles.every((t) => qtyOf(t) >= 1));
    return [
      {
        id: 'load',
        title: 'Load your hangar and the store paints',
        done: pledges.length > 0 && storePaints.length > 0,
        hint: !pledges.length ? 'The hangar is not loaded.' : !storePaints.length ? 'Store paints are not loaded — Paints by ship → Refresh store paints.' : `${pledges.length} pledges · ${storePaints.length} store paints`,
        action: !pledges.length ? { label: 'Load hangar', href: '#hangar' } : undefined,
      },
      {
        id: 'pick',
        title: 'Choose what to melt',
        done: planning ? chosen > 0 : true,
        hint: chosen ? `${picks.length} to rebuy + ${meltOnly.length} melt only — you end up ${signed(ahead)} ahead. Tick / untick rows in the candidates table to adjust.` : 'Auto-pick fills the biggest bundle that still gains credit; then tick or untick rows below.',
        warn: chosen && ahead < 0 ? `You would lose ${usd(-ahead)} — unpick until the number is positive.` : overCap ? `Over the cart cap: ${totals.lines} / ${limit} lines.` : undefined,
        action: { label: 'Auto-pick best', onclick: () => ((manual = null), (optionOf = {})), disabled: manual == null },
      },
      {
        id: 'cart',
        title: 'Put the rebuy paints in your RSI cart',
        done: planning ? chosen > 0 && cartOk : true,
        hint: cartLines.length ? `${added} / ${cartLines.length} lines in the cart — nothing is paid yet, RSI only holds them.` : 'Nothing to rebuy: these pledges are melt only.',
        warn: firstError ? `${cartErrorLabel(firstError.code)} — ${firstError.msg}` : undefined,
        action: cartLines.length ? { label: cartBusy ? 'Adding…' : added ? `Add the remaining ${cartLines.length - added}` : `Add ${cartLines.length} lines to the cart`, onclick: addAll, disabled: cartBusy || overCap, busy: cartBusy } : undefined,
      },
      {
        id: 'confirm',
        title: 'Confirm the cart with RSI',
        done: planning ? chosen > 0 && confirmedOk : true,
        hint: "Reads your RSI cart back: every planned paint must be in it, and you see RSI's real multi-paint discount. Only then is melting safe.",
        warn: check && !check.ok ? `${check.missing.length} of ${check.rows.length} planned lines are missing from the cart.` : cartReadErr || undefined,
        action: cartLines.length ? { label: cartReading ? 'Reading cart…' : rsiCart ? 'Re-check cart' : 'Confirm cart', onclick: confirmCart, disabled: cartReading, busy: cartReading } : undefined,
      },
      {
        id: 'melt',
        title: 'Melt the pledges on RSI',
        done: melted,
        blocked: planning && !confirmedOk ? 'Confirm the cart first — a melt cannot be undone, and a paint missing from the cart is a paint lost.' : undefined,
        hint: meltList
          ? `${meltProgress?.n ?? 0} / ${meltProgress?.total ?? 0} melted. The checklist below links each hangar page, last page first so nothing above shifts; RSI asks your password per melt. Tick as you go, or reload the hangar and vanished pledges tick themselves. Add or drop pledges with the per-row buttons.`
          : `Start the checklist: it freezes today's plan (${chosen} pledges) so the list survives the hangar changing under it.`,
        warn: meltList && meltList.confirmed === false ? 'This checklist was started before the cart was confirmed.' : undefined,
        action: meltList ? { label: reloadLabel, onclick: reloadHangar, busy: !!reloading } : { label: `Start checklist (${chosen})`, onclick: startMeltList, disabled: !chosen },
      },
      {
        id: 'pay',
        title: 'Pay with the credit, then reload the hangar',
        done: melted && allGone && back,
        hint: `Open the RSI cart and check out — the melt credit pays for the rebuy. Then reload the hangar: the paints show up again and this guide finishes.`,
        action: { label: 'Open RSI cart', href: CART_URL },
        extra: { label: reloadLabel, onclick: reloadHangar, busy: !!reloading },
      },
    ];
  });
  const PACK_TIER_LABEL: Record<PackTier, string> = { none: 'not in the tier (safe)', one: 'discounted, counts as 1 paint', each: 'discounted, counts each paint' };
  const link = 'text-primary hover:underline';
  const icon = 'inline-block size-3 align-[-2px]';
</script>

{#snippet pic(thumb: string | null, name: string, w = 48, h = 27)}
  <Thumb src={thumb} {name} width={w} height={h} class="mr-1.5" />
{/snippet}

{#snippet shipFilter()}
  {#if shipOptions.length}
    <Select.Root type="single" bind:value={() => candShip || '*', (v) => (candShip = v === '*' ? '' : v)}>
      <Select.Trigger size="sm" class="h-8 text-xs" aria-label="Ship">{candShip || 'Any ship'}</Select.Trigger>
      <Select.Content>
        <Select.Item value="*" label="Any ship" />
        {#each shipOptions as n (n)}<Select.Item value={n} label={n} />{/each}
      </Select.Content>
    </Select.Root>
  {/if}
{/snippet}

{#snippet fold(open: boolean, text: string)}
  {#if open}<ChevronDown class="size-3.5" />{:else}<ChevronRight class="size-3.5" />{/if}{text}
{/snippet}
<Card.Root>
  <Card.Header>
    <Card.Title>Rebuy paints with the bundle discount</Card.Title>
    <Card.Description class="text-xs">Melt → buy the same paints back in one cart at {PAINT_TIERS.map((t) => `${t.min}${t === PAINT_TIERS.at(-1) ? '+' : ''}→${pct(t.rate)}`).join(' · ')} off → keep the difference as store credit. Only paints you can melt <em>and</em> the store sells today count.</Card.Description>
    <Card.Action>
      <Button variant="outline" size="sm" aria-expanded={showOptions} aria-controls="paint-options" onclick={() => (showOptions = !showOptions)}>{@render fold(showOptions, 'Options')}</Button>
    </Card.Action>
  </Card.Header>

  <Card.Content class="grid gap-4">
  {#if showOptions}
      <div id="paint-options" class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2 text-xs">
        <label class="flex items-center gap-1.5">Cart cap <Input type="number" min="2" max="200" bind:value={limit} class="w-16 text-xs" aria-label="Paints per cart" /> paints</label>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <label {...props} class="flex items-center gap-1.5"><Checkbox bind:checked={meltNoShip} /> melt paints for ships I don't own</label>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Paints that fit only ships you don't own: melt them for credit, don't buy them back</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <label {...props} class="flex items-center gap-1.5"><Checkbox bind:checked={meltDups} /> melt surplus copies</label>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Copies beyond one per hull you own: melt the extras, keep (rebuy) one per ship</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger class="flex cursor-help items-center gap-1.5">Pack in the bundle</Tooltip.Trigger>
          <Tooltip.Content class="max-w-80">Unknown until tried: does a paint pack in the cart get the bundle discount and count toward it? 'Not in the tier' is the safe reading — the pack keeps its own price and adds nothing to the count.</Tooltip.Content>
        </Tooltip.Root>
        <Select.Root type="single" bind:value={() => packTier, (v) => v && (packTier = v as PackTier)}>
          <Select.Trigger size="sm" class="text-xs" aria-label="How a paint pack counts in the bundle">{PACK_TIER_LABEL[packTier]}</Select.Trigger>
          <Select.Content>
            {#each Object.entries(PACK_TIER_LABEL) as [v, label] (v)}
              <Select.Item value={v} {label}>{label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
  {/if}
  <Wizard title="Guided melt & rebuy" steps={guide} storageKey="paints" doneText="Melted, bought back, and the paints are back in your hangar." onReset={() => (meltList = null)} resetLabel="Clear the checklist" />
  {#if !storePaints.length}
    <Empty>Store paints not loaded yet — use <em>Refresh store paints</em> on Paints by ship.</Empty>
  {:else if !cands.length && !wanted.length && !meltOnly.length}
    <Empty>No paint in your hangar can be melted and bought back right now.</Empty>
  {/if}

  <!-- The numbers and the cart buttons stay in view under the hub header while the sections below scroll. -->
  <div class="bg-card/95 sticky top-14 z-10 -mx-6 grid gap-2 border-b px-6 pt-1 pb-2 backdrop-blur">
  <div class="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
    <Stat tone="credit" value={ownUsd(totals.credit + meltOnlyCredit)} label={`melt credit · ${picks.length + meltOnly.length} pledges`} delta={{ text: `${ownUsd(totals.credit)} to rebuy · ${ownUsd(meltOnlyCredit)} melt only`, tone: 'neutral' }} />
    <Stat
      value={usd(totals.pay)}
      label={`rebuy cost · ${cartLines.length} cart line${cartLines.length === 1 ? '' : 's'}`}
      delta={totals.list !== totals.pay ? { text: `bundle saves ${usd(totals.list - totals.pay)} vs list ${usd(totals.list)}`, tone: 'up' } : null}
    />
    <Stat
      tone="accent"
      value={signed(ahead)}
      valueTone={ahead > 0 ? 'ok' : ahead < 0 ? 'err' : null}
      label="credit you end up ahead"
      delta={{ text: `rebuy ${signed(totals.net)} · melt only ${signed(meltOnlyCredit)}`, tone: totals.net > 0 ? 'up' : totals.net < 0 ? 'down' : 'neutral' }}
    />
  </div>
  <div class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1.5 text-xs [&_b]:text-foreground">
    <span><b>{picks.length}</b> melt &amp; rebuy · <b>{meltOnly.length}</b> melt only · <b>{Math.max(0, cands.length - picks.length)}</b> kept</span>
    <span><b>{totals.lines}</b> paints in cart → <b>{pct(totals.rate)}</b> off{#if totals.next} · {totals.next.min - totals.lines} more → {pct(totals.next.rate)}{:else if totals.lines} · top tier{/if}</span>
    {#if wanted.length}<span>new paints: {usd(totals.wantedPay)}{#if totals.wantedAlone !== totals.wantedPay} (save {usd(totals.wantedAlone - totals.wantedPay)} vs alone){/if}</span>{/if}
    {#if overCap}<span class="text-destructive">over the cart cap: {totals.lines} / {limit}</span>{/if}
    <span>cap {limit}</span>
  </div>
  {#if cartLines.length || meltOnly.length}
    <div class="border-primary/30 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      {#if cartLines.length}
        <Button size="sm" disabled={cartBusy || overCap} onclick={addAll}><ShoppingCart />{cartBusy ? 'Adding…' : added ? `Add the remaining ${cartLines.length - added}` : `Add ${cartLines.length} line${cartLines.length === 1 ? '' : 's'} to RSI cart`}</Button>
        {#if added}<span class="text-success text-xs">{added}/{cartLines.length} in cart</span>{/if}
        {#if firstError}<span class="text-destructive text-xs">{cartErrorLabel(firstError.code)} — {firstError.msg}</span>{/if}
      {/if}
      <OpenCartButton always count={added} />
      <TipButton variant="outline" size="sm" disabled={cartReading} onclick={confirmCart} tip="Reads your RSI cart back and ticks off every planned line — do this before melting anything">{cartReading ? 'Reading cart…' : rsiCart ? 'Re-check cart' : 'Confirm cart'}</TipButton>
    </div>
  {/if}
  </div>
  {#if unmatchedShips.length}
    <p class="text-muted-foreground text-xs"><TriangleAlert class={cn(icon, 'text-warning')} /> Hangar ships the store catalog didn't match — paints for them may read as "no ship": {unmatchedShips.slice(0, 8).join(', ')}{unmatchedShips.length > 8 ? ` +${unmatchedShips.length - 8}` : ''}. Send me the exact hangar name if one of these is wrong.</p>
  {/if}

  <h3 class="text-muted-foreground m-0 text-[11px] font-semibold tracking-wide uppercase">1 · Plan what to melt and buy back</h3>
  {#if scenarios.length > 1 || (scenarios.length === 1 && scenarios[0]!.totals.net > 0)}
    <Section id="paints.scenarios" title="Best value by cart size" summary={`${scenarios.length} cart sizes`} done={planFrozen} doneText="plan frozen">
      <span class="text-muted-foreground text-xs">The best set of melts at each cart size — bigger cart, bigger discount, but the extra paints must each still gain. <Star class={cn(icon, 'text-warning')} /> = highest net. <em>Use</em> applies it.</span>
      <Table.Root>
        <Table.Header>
          <Table.Row><Table.Head>Cart</Table.Head><Table.Head>Discount</Table.Head><Table.Head>Melts</Table.Head><Table.Head>Melt credit</Table.Head><Table.Head>Cart total</Table.Head><Table.Head>Net gain</Table.Head><Table.Head>Per paint</Table.Head><Table.Head></Table.Head></Table.Row>
        </Table.Header>
        <Table.Body>
          {#each scenarios as s, i (s.limit)}
            {@const on = sameAs(s.picks)}
            <Table.Row class={cn(on && 'bg-primary/5', i === bestIdx && 'border-warning/40 border-y')}>
              <Table.Cell>{s.totals.lines} paint{s.totals.lines === 1 ? '' : 's'}{#if s.limit !== s.totals.lines}<span class="text-muted-foreground text-xs"> (cap {s.limit})</span>{/if}</Table.Cell>
              <Table.Cell>{pct(s.totals.rate)}</Table.Cell>
              <Table.Cell>{s.picks.length}{#if s.picks.some((p) => p.option.kind === 'pack')}<span class="text-muted-foreground text-xs"> · {s.picks.filter((p) => p.option.kind === 'pack').length} as pack</span>{/if}</Table.Cell>
              <Table.Cell>{ownUsd(s.totals.credit)}</Table.Cell>
              <Table.Cell>{usd(s.totals.pay)}</Table.Cell>
              <Table.Cell class={cn(s.totals.net > 0 && 'text-success', s.totals.net < 0 && 'text-destructive')}><strong>{signed(s.totals.net)}</strong>{#if i === bestIdx} <Star class={cn(icon, 'fill-warning text-warning')} aria-hidden="true" /><span class="sr-only">highest net</span>{/if}</Table.Cell>
              <Table.Cell class="text-muted-foreground">{signed(s.perPaint)}</Table.Cell>
              <Table.Cell><Button variant="outline" size="xs" disabled={on} onclick={() => applyPicks(s.picks)}>{on ? 'Current' : 'Use'}</Button></Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Section>
  {/if}

  {#if cands.length}
    <Section id="paints.cands" title="Rebuy candidates" summary={`${cands.length} pledges · ${paintsOf(cands)} paints · ${picks.length} picked`} done={planFrozen} doneText="plan frozen">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <TipButton variant="outline" size="sm" disabled={manual == null} onclick={() => ((manual = null), (optionOf = {}))} tip="Best set within the cap: every paint that gains, plus a small loss only when it unlocks a better tier">Auto-pick best</TipButton>
        <Button variant="outline" size="sm" disabled={!picks.length} onclick={() => ((manual = []), (optionOf = {}))}>Clear</Button>
        <Button variant="outline" size="sm" disabled={paintsOf(cands) + wanted.length > limit} onclick={() => ((manual = cands.map((c) => c.pledge.id)), (optionOf = {}))}>Pick all</Button>
        <TipButton variant="outline" size="sm" disabled={!candRows.length} onclick={() => { toManual(); manual = [...new Set([...(manual ?? []), ...candRows.map((r) => r.c.pledge.id)])]; }} tip="Tick every row the filter shows">Pick shown</TipButton>
        <TipButton variant="outline" size="sm" disabled={!candRows.length} onclick={() => { toManual(); const hide = new Set(candRows.map((r) => r.c.pledge.id)); manual = (manual ?? []).filter((id) => !hide.has(id)); }} tip="Untick every row the filter shows">Unpick shown</TipButton>
      </div>
      <span class="text-muted-foreground text-xs [&_b]:text-foreground"><b>Paid</b> = melt credit (−N% = how far under the singles' list price you got it) · <b>Alone</b> = cheapest rebuy today, no bundle · <b>Here</b> = in this cart at {pct(totals.rate)}.</span>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Input placeholder="Search paint, ship or pledge" bind:value={candQ} aria-label="Search candidates" class="w-64" />
      {#if candQ}<Button variant="outline" size="sm" onclick={() => (candQ = '')}><X />clear</Button>{/if}
      {@render shipFilter()}
      <span class="text-muted-foreground text-xs">Show:</span>
      <Segmented
        size="sm"
        ariaLabel="Show candidates"
        options={[
          { id: 'all', label: `All · ${cands.length}` },
          { id: 'picked', label: `Picked · ${candCounts.picked}` },
          { id: 'unpicked', label: 'Not picked' },
          { id: 'gain', label: `Gains · ${candCounts.gain}` },
          { id: 'keep', label: 'Keep (no gain)' },
          { id: 'packs', label: `Packs · ${candCounts.packs}` },
          { id: 'singles', label: 'Singles' },
          { id: 'partial', label: `Partly on store · ${candCounts.partial}` },
          { id: 'sale', label: `On sale · ${candCounts.sale}` },
          { id: 'dedupe', label: `Deduped · ${candCounts.dedupe}` },
        ]}
        bind:value={() => candShow || 'all', (v) => (candShow = (v === 'all' ? '' : v) as CandShow)}
      />
    </div>
    {#if !candRows.length}
      <Empty>No candidate matches.</Empty>
    {:else}
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head class="w-[110px]">Melt?</Table.Head>
          <SortTh key="paint" bind:sort={candSort}>Paint</SortTh>
          <SortTh key="ship" bind:sort={candSort}>Ship</SortTh>
          <SortTh key="pledge" bind:sort={candSort}>Hangar</SortTh>
          <SortTh key="paid" bind:sort={candSort} firstDir="desc">Paid</SortTh>
          <SortTh key="alone" bind:sort={candSort} firstDir="desc">Alone</SortTh>
          <SortTh key="here" bind:sort={candSort} firstDir="desc">Here</SortTh>
          <SortTh key="gainAlone" bind:sort={candSort} firstDir="desc">Gain alone</SortTh>
          <SortTh key="gainHere" bind:sort={candSort} firstDir="desc">Gain here</SortTh>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each candRows as r (r.c.pledge.id)}
          {@const { c, full, o, alone, g, on, isPack } = r}
          <Table.Row class={cn('align-top', on && 'bg-primary/5', !on && g <= 0 && 'text-muted-foreground')}>
            <Table.Cell class="align-top">
              <label class="flex cursor-pointer items-start gap-1.5">
                <Checkbox checked={on} onCheckedChange={() => toggle(c.pledge.id)} aria-label={`Melt and buy back ${c.titles.join(', ')}`} />
                {#if on}<Badge variant="success-soft">melt + rebuy</Badge>{:else}<Badge variant="muted">keep</Badge>{/if}
              </label>
            </Table.Cell>
            <Table.Cell class="min-w-[300px] pr-2 align-top whitespace-normal">
              <div class="grid gap-1">
              {#each full.lines as l (l.store.id)}
                {@const want = !dropSet(c.pledge.id).has(l.store.id)}
                {@const why = autoDrop.get(c.pledge.id)?.get(l.store.id)}
                <div class="flex flex-wrap items-center gap-1.5">
                  {#if full.kind === 'single' && isPack}
                    <LazyTip tip={why ? `Melted, not bought back: ${REDUNDANT_LABEL[why]}. Tick to buy it back anyway.` : 'Untick to melt this paint without buying it back'}>
                      {#snippet trigger({ props })}
                        <Checkbox {...props} checked={want} onCheckedChange={(v) => dropLine(c.pledge.id, l.store.id, v)} aria-label={`Buy back ${l.title}`} />
                      {/snippet}
                    </LazyTip>
                  {/if}
                  {@render pic(l.store.thumb, l.title)}
                  <strong class={cn(!want && 'text-muted-foreground line-through')}>{l.title}</strong>
                  <a class={cn(link, 'text-xs')} href={l.store.url} target="_blank" rel="noopener"><ShoppingCart class={icon} /> {usd(l.store.discounted)}</a>
                  {#if why && !want}
                    <HintBadge variant="secondary" hint={REDUNDANT_LABEL[why]}>{why === 'duplicate' ? 'owned elsewhere' : 'no ship'}</HintBadge>
                  {/if}
                </div>
              {/each}
              {#if full.kind === 'pack' && isPack}<div class="text-muted-foreground text-xs">holds {c.titles.join(', ')}</div>{/if}
              {#each c.missing as t, ti (`${t}#${ti}`)}
                {@const sp = listingOf(t)}
                <div class="flex flex-wrap items-center gap-1.5">
                  {@render pic(sp?.thumb ?? null, t)}
                  <strong class="text-destructive">{t}</strong>
                  {#if sp}<a class={cn(link, 'text-xs')} href={sp.url} target="_blank" rel="noopener"><ShoppingCart class={icon} /> out of stock</a>{:else}<span class="text-muted-foreground text-xs">not on the store</span>{/if}
                  <HintBadge variant="destructive" hint="Melting this pledge loses this paint — the store has no way to buy it back right now">lost if you melt</HintBadge>
                </div>
              {/each}
              {#if c.missing.length}<div class="text-destructive text-xs"><TriangleAlert class={icon} /> {c.missing.length} of {c.titles.length} can't be bought back today — melt only if you can live without {c.missing.length === 1 ? 'it' : 'them'}.</div>{/if}
              {#if isPack && g <= 0 && !on}
                <HintBadge variant="secondary" hint="Buying every paint in it back costs at least what it melts for — keep the pack">keep</HintBadge>
              {/if}
              {#if c.single && c.pack}
                {@const pack = c.pack}
                {@const single = c.single}
                <ToggleGroup.Root type="single" variant="outline" size="sm" class="mt-1" aria-label="Rebuy as" bind:value={() => o.kind, (v) => v && setOption(c.pledge.id, v as RebuyOption['kind'])}>
                  <LazyTip tip={pack.tiered ? `One listing, counts as ${pack.count} toward the tier` : "One listing at the pack's own price, outside the tier"}>
                    {#snippet trigger({ props })}<ToggleGroup.Item {...props} value="pack" class="h-6 px-2 text-[11px] font-semibold">pack {usd(pack.cost)}</ToggleGroup.Item>{/snippet}
                  </LazyTip>
                  <LazyTip tip="One listing per paint, each counts toward the tier">
                    {#snippet trigger({ props })}<ToggleGroup.Item {...props} value="single" class="h-6 px-2 text-[11px] font-semibold">{single.count} singles {usd(single.cost)}</ToggleGroup.Item>{/snippet}
                  </LazyTip>
                </ToggleGroup.Root>
              {:else if isPack}
                <Badge variant="secondary">{o.lines.length}{o.lines.length !== full.lines.length ? ` of ${full.lines.length}` : ''} paints back</Badge>
              {/if}
                          </div>
            </Table.Cell>
            <Table.Cell class="text-muted-foreground max-w-[160px] align-top text-xs whitespace-normal">
              <LazyTip tip={explain(r.ships)}>
                {#snippet trigger({ props })}<button type="button" {...props} class="cursor-help text-left">{r.ships.slice(0, 3).join(', ')}{r.ships.length > 3 ? ` +${r.ships.length - 3}` : ''}{#if !r.ships.length}—{/if}</button>{/snippet}
              </LazyTip>
              {#if variantsOwned(r.ships).length}
                <LazyTip tip="Named for another hull of the line — variants share paints">
                  {#snippet trigger({ props })}<button type="button" {...props} class="block cursor-help text-left">fits your {variantsOwned(r.ships).slice(0, 2).join(', ')}</button>{/snippet}
                </LazyTip>
              {:else if r.ships.length && !r.ships.some((n) => ownedLines.has(paintLine(n)))}<div class="text-destructive">no ship of this line</div>{/if}
            </Table.Cell>
            <Table.Cell class="max-w-[220px] align-top text-xs whitespace-normal">
              <div class="text-muted-foreground">{c.pledge.name}</div>
              <a class={link} href={hangarUrl(pledges, c.pledge.id, undefined, meltedIds)} target="_blank" rel="noopener"><House class={icon} /> #{c.pledge.id}</a>
              · <a class={link} href={hangarUrl(pledges, c.pledge.id, 'melt', meltedIds)} target="_blank" rel="noopener" title="Opens RSI's melt dialog for this pledge (password asked by RSI)">melt <ExternalLink class={icon} /></a>
              {#if meltList}
                <div class="mt-1">
                  {#if listed.has(c.pledge.id)}
                    <TipButton variant="outline" size="xs" class="text-success" onclick={() => dropFromList(c.pledge.id)} tip="On the checklist — click to drop it"><Check /> listed</TipButton>
                  {:else}
                    <TipButton variant="outline" size="xs" onclick={() => addCand(c)} tip="Add to the melt checklist (picks it for rebuy too, so its paints are in the cart plan)">+ checklist</TipButton>
                  {/if}
                </div>
              {/if}
            </Table.Cell>
            <Table.Cell class="align-top">
              {ownUsd(c.credit)}
              {#if paidOff(c) >= 0.05}
                <HintBadge variant="secondary" class="ml-1" hint={`You paid ${pct(paidOff(c))} under today's list price of the singles (${usd(c.single!.list)}) — a pack at its tier, or a sale`}>−{pct(paidOff(c))}</HintBadge>
              {/if}
            </Table.Cell>
            <Table.Cell class="align-top">
              {usd(alone)}
              {#if r.sale}
                <Tag kind="sale" label="sale" hint="On sale on the store today" class="ml-1" />
              {/if}
            </Table.Cell>
            <Table.Cell class="align-top">{usd(inCart(o))}</Table.Cell>
            <Table.Cell class={cn('align-top', r.gAlone > 0 ? 'text-success' : r.gAlone < 0 ? 'text-destructive' : 'text-muted-foreground')}>{signed(r.gAlone)}</Table.Cell>
            <Table.Cell class={cn('align-top', g > 0 && 'text-success', g < 0 && 'text-destructive')}><strong>{signed(g)}</strong></Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
    {/if}
    </Section>
  {/if}

  {#if meltOnly.length}
    <Section id="paints.meltonly" title="Melt only" summary={`${meltOnly.length} pledges · ${ownUsd(meltOnlyCredit)} credit`} done={planFrozen} doneText="plan frozen">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-muted-foreground text-xs">Not bought back: no ship of yours to put them on, or more copies than hulls. Pure credit.</span>
      <span class="flex-1"></span>
      {@render shipFilter()}
      <Segmented
        size="sm"
        ariaLabel="Why melt only"
        options={[
          { id: 'all', label: 'All' },
          { id: 'no-ship', label: `No ship · ${meltOnly.filter((m) => m.why === 'no-ship').length}` },
          { id: 'duplicate', label: `Surplus · ${meltOnly.filter((m) => m.why === 'duplicate').length}` },
        ]}
        bind:value={() => meltWhy || 'all', (v) => (meltWhy = (v === 'all' ? '' : v) as typeof meltWhy)}
      />
    </div>
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <SortTh key="paint" bind:sort={meltSort}>Paint</SortTh>
          <SortTh key="why" bind:sort={meltSort}>Why</SortTh>
          <SortTh key="pledge" bind:sort={meltSort}>Hangar</SortTh>
          <SortTh key="credit" bind:sort={meltSort} firstDir="desc">Melt credit</SortTh>
          <Table.Head></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each meltRows as m (m.pledge.id)}
          <Table.Row>
            <Table.Cell class="whitespace-normal">
              {#each m.titles as t, ti (`${t}#${ti}`)}
                {@const sp = listingOf(t)}
                <div class="flex flex-wrap items-center gap-1.5">{@render pic(sp?.thumb ?? null, t)}<strong>{t}</strong>{#if sp}<a class={cn(link, 'text-xs')} href={sp.url} target="_blank" rel="noopener"><ShoppingCart class={icon} /> {usd(sp.discounted)}</a>{/if}</div>
              {/each}
            </Table.Cell>
            <Table.Cell class="text-muted-foreground text-xs">
              <LazyTip tip={explain([...new Set(m.titles.flatMap((t) => fitsByKey.get(itemKey(t)) ?? []))])}>
                {#snippet trigger({ props })}<button type="button" {...props} class="cursor-help text-left">{MELT_ONLY_LABEL[m.why]}</button>{/snippet}
              </LazyTip>
            </Table.Cell>
            <Table.Cell class="text-xs">
              <div class="text-muted-foreground">{m.pledge.name}</div>
              <a class={link} href={hangarUrl(pledges, m.pledge.id, undefined, meltedIds)} target="_blank" rel="noopener"><House class={icon} /> #{m.pledge.id}</a>
              · <a class={link} href={hangarUrl(pledges, m.pledge.id, 'melt', meltedIds)} target="_blank" rel="noopener" title="Opens RSI's melt dialog for this pledge">melt <ExternalLink class={icon} /></a>
            </Table.Cell>
            <Table.Cell class="text-success">{ownUsd(m.credit)}</Table.Cell>
            <Table.Cell>
              <TipButton variant="outline" size="xs" onclick={() => (forceRebuy = [...forceRebuy, m.pledge.id])} tip="Treat it as a rebuy candidate instead (buy the paints back)">Rebuy instead</TipButton>
              {#if meltList}
                {#if listed.has(m.pledge.id)}
                  <TipButton variant="outline" size="xs" class="text-success ml-1" onclick={() => dropFromList(m.pledge.id)} tip="On the checklist — click to drop it"><Check /> listed</TipButton>
                {:else}
                  <TipButton variant="outline" size="xs" class="ml-1" onclick={() => addToList([itemOfMelt(m)])} tip="Add to the melt checklist">+ checklist</TipButton>
                {/if}
              {/if}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
    </Section>
  {/if}

  <h3 class="text-muted-foreground m-0 text-[11px] font-semibold tracking-wide uppercase">2 · Cart, then 3 · melt on RSI</h3>
  {#if cartLines.length || meltOnly.length}
  <Section id="paints.cart" title="Cart & confirm" summary={cartLines.length ? `${cartLines.length} line${cartLines.length === 1 ? '' : 's'} · ${usd(totals.pay)}` : 'nothing to buy back — melt only'} done={cartDone} doneText={cartLines.length ? 'cart confirmed' : 'nothing to add'}>
    <p class="text-muted-foreground m-0 text-xs [&_b]:text-foreground">1. add the lines · 2. <b>Confirm cart</b> (every paint in, RSI's real discount) · 3. melt the {picks.length + meltOnly.length} pledges on RSI (<em>melt ↗</em> per row) · 4. pay with credit. Nothing is paid or melted by RSI+.</p>
    {#if cartReadErr}<Alert.Root variant="destructive"><Alert.Description>Could not read the cart: {cartReadErr}</Alert.Description></Alert.Root>{/if}
    {#if check && rsiCart}
      <Card.Root size="sm" class={cn('shadow-none', check.ok ? 'ring-success/50' : 'ring-destructive/50')}>
        <Card.Header>
          <Card.Title class={cn('flex items-center gap-1.5 font-semibold', check.ok ? 'text-success' : check.rows.length ? 'text-destructive' : '')}>
            {#if check.ok}<Check class="size-4" />{:else if check.rows.length}<X class="size-4" />{/if}
            {check.ok ? `All ${check.rows.length} planned lines are in your RSI cart — safe to melt.` : check.rows.length ? `${check.missing.length} of ${check.rows.length} planned lines missing from the cart — don't melt yet.` : 'Nothing planned to check.'}
          </Card.Title>
          <Card.Description class="text-xs">read {new Date(rsiCart.at).toLocaleTimeString()} · {rsiCart.qty} items · RSI total {usd(rsiCart.total)}{rsiCart.subTotal !== rsiCart.total ? ` (subtotal ${usd(rsiCart.subTotal)})` : ''}</Card.Description>
        </Card.Header>
        <Card.Content class="grid gap-2">
          {#if check.listSum}
            <div class="text-xs">
              RSI's discount on the planned paints: <b>{pct(check.rate)}</b> ({usd(check.listSum)} → {usd(check.paySum)}); planner assumed {pct(totals.rate)} ≈ {usd(totals.pay)}.
              {#if Math.abs(check.paySum - totals.pay) > 100}<span class="text-destructive">Differs by {usd(Math.abs(check.paySum - totals.pay))} — trust the cart.</span>{:else}<span class="text-success">Matches.</span>{/if}
            </div>
          {/if}
          <Table.Root class="text-xs">
            <Table.Header>
              <Table.Row><Table.Head></Table.Head><Table.Head>Paint</Table.Head><Table.Head>Planned</Table.Head><Table.Head>In cart</Table.Head><Table.Head>RSI unit price</Table.Head><Table.Head>RSI discount</Table.Head></Table.Row>
            </Table.Header>
            <Table.Body>
              {#each check.rows as r (r.paint.id)}
                <Table.Row class={cn(r.ok && 'text-muted-foreground')}>
                  <Table.Cell class={r.ok ? 'text-success' : 'text-destructive'}>{#if r.ok}<Check class="size-3.5" aria-hidden="true" /><span class="sr-only">in cart</span>{:else}<X class="size-3.5" aria-hidden="true" /><span class="sr-only">missing</span>{/if}</Table.Cell>
                  <Table.Cell class="whitespace-normal">{@render pic(r.paint.thumb, r.paint.name, 40, 22)}{r.paint.name}</Table.Cell>
                  <Table.Cell>×{r.want}</Table.Cell>
                  <Table.Cell>{r.got ? `×${r.got}` : '—'}</Table.Cell>
                  <Table.Cell>{r.line ? (r.line.unitDiscounted !== r.line.unit ? `${usd(r.line.unitDiscounted)} (list ${usd(r.line.unit)})` : usd(r.line.unit)) : ''}</Table.Cell>
                  <Table.Cell class="text-muted-foreground whitespace-normal">{r.line ? [r.line.discount, ...r.line.discounts].filter(Boolean).join(' · ') || '—' : ''}</Table.Cell>
                </Table.Row>
              {/each}
              {#each check.extra as l (l.id)}
                <Table.Row>
                  <Table.Cell class="text-muted-foreground">+</Table.Cell>
                  <Table.Cell colspan={2} class="whitespace-normal">{l.title} <Badge variant="warning">not in the plan</Badge></Table.Cell>
                  <Table.Cell>×{l.qty}</Table.Cell>
                  <Table.Cell>{l.unitDiscounted !== l.unit ? `${usd(l.unitDiscounted)} (list ${usd(l.unit)})` : usd(l.unit)}</Table.Cell>
                  <Table.Cell class="text-muted-foreground whitespace-normal">{[l.discount, ...l.discounts].filter(Boolean).join(' · ') || '—'}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </Card.Content>
      </Card.Root>
    {/if}
  </Section>
  {/if}

  <Section id="paints.melt" title="Melt checklist" summary={meltProgress ? `${meltProgress.n}/${meltProgress.total} melted · ${ownUsd(meltProgress.credit)} of ${ownUsd(meltProgress.creditTotal)}` : 'not started'} done={allMelted} doneText="all melted">
    {#snippet actions()}
      {#if !meltList}
        <TipButton variant="outline" size="sm" disabled={!picks.length && !meltOnly.length} onclick={startMeltList} tip={`Freezes today's plan into a checklist: ${picks.length} to rebuy + ${meltOnly.length} melt only`}>Start checklist ({picks.length + meltOnly.length})</TipButton>
      {:else}
        <TipButton variant="outline" size="sm" disabled={!!reloading} onclick={reloadHangar} tip="Reads your hangar again right here: pledges that vanished get ticked automatically">{reloadLabel}</TipButton>
        <TipButton variant="outline" size="sm" disabled={!newFromPlan.length} onclick={() => addToList(newFromPlan)} tip="Add the picked and melt-only pledges that aren't on the checklist yet — nothing is removed">Add today's picks{newFromPlan.length ? ` (${newFromPlan.length})` : ''}</TipButton>
        <TipButton variant="outline" size="sm" onclick={startMeltList} tip="Replace the checklist with today's plan (ticks are kept for pledges still on it)">Replace with plan</TipButton>
        <Button variant="destructive" size="sm" onclick={() => (meltList = null)}>Clear</Button>
      {/if}
    {/snippet}
    {#if reloadErr}<Alert.Root variant="destructive"><Alert.Description>Could not reload the hangar: {reloadErr}</Alert.Description></Alert.Root>{/if}
    {#if !meltList}
      <p class="text-muted-foreground m-0 text-xs">Start the checklist once the cart is confirmed: it freezes the plan (rebuy picks + melt only) as a page-by-page list to tick off while you melt on RSI.</p>
    {:else}
      <div class="grid gap-2">
        {#if meltProgress}
          <Progress value={meltProgress.n} max={meltProgress.total || 1} class="h-1.5 *:data-[slot=progress-indicator]:bg-success" aria-label={`${meltProgress.n} of ${meltProgress.total} melted`} />
        {/if}
        <span class="text-muted-foreground text-xs">Snapshot from {new Date(meltList.at).toLocaleString()}. Tick as you melt (RSI asks your password each time); after <em>Reload hangar</em>, pledges that are gone tick themselves. Last hangar page first: melting from the bottom keeps the rows above (and their page numbers) in place; links also allow for the pledges you have ticked. <em>+ checklist</em> on any row below adds a pledge; <X class={icon} /> here drops one.</span>
        <div class="flex flex-wrap items-center gap-2">
          <Input placeholder="Search the checklist" bind:value={listQ} aria-label="Search checklist" class="w-56 text-xs" />
          <span class="text-muted-foreground text-xs">Show:</span>
          <Segmented
            size="sm"
            ariaLabel="Checklist filter"
            options={[
              { id: 'todo', label: `To melt · ${meltList.items.filter((it) => meltStatus(it) === 'todo').length}` },
              { id: 'done', label: `Melted · ${meltProgress?.n ?? 0}` },
              { id: 'all', label: `All · ${meltList.items.length}` },
              { id: 'rebuy', label: `Rebuy · ${meltList.items.filter((it) => it.why === 'rebuy').length}` },
              { id: 'melt-only', label: `Melt only · ${meltList.items.filter((it) => it.why === 'melt-only').length}` },
            ]}
            bind:value={listShow}
          />
        </div>
        {#each meltPages as [page, items] (page)}
          {@const left = items.filter((it) => meltStatus(it) === 'todo')}
          {@const shownItems = items.filter(listPass)}
          {#if shownItems.length}
            <div class="rounded-lg border px-2 pt-1 pb-1.5">
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <strong>Hangar page {page}</strong>
                <span class="text-muted-foreground">{items.length - left.length}/{items.length} done</span>
                <a class={link} href={`https://robertsspaceindustries.com/account/pledges?page=${page}&pagesize=${HANGAR_PAGE}`} target="_blank" rel="noopener">open page <ExternalLink class={icon} /></a>
              </div>
              <Table.Root class="table-fixed text-xs">
                <Table.Body>
                  {#each shownItems as it (it.id)}
                    {@const st = meltStatus(it)}
                    <Table.Row class={cn('border-t border-b-0', st !== 'todo' && 'text-muted-foreground')}>
                      <Table.Cell class="w-8"><Checkbox checked={st !== 'todo'} disabled={st === 'gone'} onCheckedChange={(v) => tickMelt(it.id, v)} aria-label={`Melted ${it.name}`} /></Table.Cell>
                      <Table.Cell class="whitespace-normal"><strong>{it.name}</strong> <span class="text-muted-foreground">#{it.id}</span>{#if it.titles.length > 1 || it.titles[0] !== it.name}<div class="text-muted-foreground">{it.titles.join(', ')}</div>{/if}</Table.Cell>
                      <Table.Cell class="w-[90px]"><Badge variant="secondary">{it.why === 'rebuy' ? 'rebuy' : 'melt only'}</Badge></Table.Cell>
                      <Table.Cell class="w-[80px]">{ownUsd(it.credit)}</Table.Cell>
                      <Table.Cell class="w-[150px]">{#if st === 'gone'}<span class="text-success"><Check class={icon} /> gone from hangar</span>{:else if st === 'done'}<span class="text-success"><Check class={icon} /> melted</span>{:else}<a class={link} href={hangarUrl(pledges, it.id, 'melt', meltedIds)} target="_blank" rel="noopener">melt <ExternalLink class={icon} /></a>{/if}</Table.Cell>
                      <Table.Cell class="w-8"><TipButton variant="ghost" size="icon-xs" class="text-muted-foreground hover:text-destructive" onclick={() => dropFromList(it.id)} aria-label={`Drop ${it.name} from the checklist`} tip="Drop from the checklist (nothing is melted)"><X /></TipButton></Table.Cell>
                    </Table.Row>
                  {/each}
                </Table.Body>
              </Table.Root>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </Section>

  <h3 class="text-muted-foreground m-0 text-[11px] font-semibold tracking-wide uppercase">Reference</h3>
  {#if !buyback.length}
    <p class="text-muted-foreground m-0 text-xs">
      <strong class="text-foreground font-semibold">From your buyback</strong> — paints for ships you own that you no longer have, other paints, items you don't have — needs your buyback list: open
      <a class="text-primary hover:underline" href="#buyback">Buyback</a> and load it, then come back.
    </p>
  {:else}
    <Collapsible.Root bind:open={showBb} class="grid gap-2">
      <Collapsible.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="link" size="sm" class="h-auto justify-start px-0 font-semibold whitespace-normal text-left">{@render fold(showBb, `From your buyback · ${bbMine.length} paints for ships you own · ${bbOther.length} other paints · ${bbItems.length} items you don't have${bbHidden ? ` · ${bbHidden} sold on the store (hidden)` : ''}${bbc.haveAgain ? ` · ${bbc.haveAgain} already in hangar` : ''}${bbc.unknown.length ? ` · ${bbc.unknown.length} contents not listed` : ''}`)}</Button>
        {/snippet}
      </Collapsible.Trigger>
      <Collapsible.Content class="grid gap-2">
        <span class="text-muted-foreground text-xs">Buyback list from the Buyback tab compared with your hangar: what you melted and no longer have. Buying back costs what you paid (store credit); the store price today is shown beside it. CCUs are in the planner, not here.</span>
        <div class="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            ariaLabel="Buyback view"
            options={[
              { id: 'mine', label: `Paints for ships I own · ${bbMine.length}` },
              { id: 'other', label: `Paints for ships I don't own · ${bbOther.length}` },
              { id: 'items', label: `Items I don't have · ${bbItems.length}` },
              { id: 'owned', label: `Already in hangar · ${bbc.ownedAgain.length}` },
            ]}
            bind:value={bbView}
          />
          <Input placeholder="Search" bind:value={bbQ} aria-label="Search buyback" class="w-48" />
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <label {...props} class="text-muted-foreground flex items-center gap-1.5 text-xs"><Checkbox bind:checked={bbHideStore} /> hide what the store sells today{bbHidden ? ` (${bbHidden})` : ''}</label>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content class="max-w-80">Skip buyback entries whose missing items the store sells right now (paint listing in stock, ship with a standalone on sale) — you can just buy those</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <label {...props} class="text-muted-foreground flex items-center gap-1.5 text-xs"><Checkbox bind:checked={bbShowOwned} /> show marked as owned{bbOwnedCount ? ` (${bbOwnedCount})` : ''}</label>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content class="max-w-80">Entries you marked as already owned (hangar name differs, got it another way)</Tooltip.Content>
          </Tooltip.Root>
        </div>
        {#if bbView === 'owned'}
          {@const list = bbc.ownedAgain.filter((b) => bbMatch(`${b.name} ${b.contained}`))}
          {#if !list.length}<Empty>Nothing here.</Empty>{:else}
            <Table.Root class="text-xs">
              <Table.Header><Table.Row><Table.Head>Buyback entry</Table.Head><Table.Head>In your hangar</Table.Head><Table.Head>Melted</Table.Head><Table.Head></Table.Head></Table.Row></Table.Header>
              <Table.Body>
                {#each list as b (b.id)}
                  <Table.Row>
                    <Table.Cell class="whitespace-normal"><strong>{b.name}</strong> <Badge variant="secondary">{b.type}</Badge></Table.Cell>
                    <Table.Cell class="whitespace-normal">{#each countTitles(buybackContents(b)) as g, ti (`${g.title}#${ti}`)}{#if ti}, {/if}{titleWithCount(g)} <HintBadge variant="outline" class="h-4 px-1 text-[10px]" hint="copies in your hangar">×{qtyOf(g.title)}</HintBadge>{/each}</Table.Cell>
                    <Table.Cell class="text-muted-foreground">{b.date}</Table.Cell>
                    <Table.Cell>{#if b.url}<a class={link} href={b.url} target="_blank" rel="noopener">buy back <ExternalLink class={icon} /></a>{/if}</Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {/if}
        {:else if bbView !== 'items'}
          {@const list = (bbView === 'mine' ? bbMine : bbOther).filter((p) => bbMatch(`${p.title} ${p.fits.map((s) => s.name).join(' ')}`))}
          {#if !list.length}<Empty>Nothing here.</Empty>{:else}
            <Table.Root class="text-xs">
              <Table.Header><Table.Row><Table.Head>Paint</Table.Head><Table.Head>Ship</Table.Head><Table.Head>Store today</Table.Head><Table.Head>Buyback</Table.Head></Table.Row></Table.Header>
              <Table.Body>
                {#each list as p, pi (`${p.title}#${pi}`)}
                  <Table.Row>
                    <Table.Cell class="whitespace-normal">{@render pic(p.store?.thumb ?? null, p.title)}<strong>{p.title}</strong>{#if p.copies > 1} <Badge variant="secondary">×{p.copies} in buyback</Badge>{/if}</Table.Cell>
                    <Table.Cell class="text-muted-foreground whitespace-normal">{p.fits.slice(0, 3).map((s) => s.name).join(', ')}{p.fits.length > 3 ? ` +${p.fits.length - 3}` : ''}{#if bbView === 'mine' && variantsOwned(p.fits.map((s) => s.name)).length}<div>fits your {variantsOwned(p.fits.map((s) => s.name)).slice(0, 2).join(', ')}</div>{/if}</Table.Cell>
                    <Table.Cell class="whitespace-normal">{#if p.store}<a class={link} href={p.store.url} target="_blank" rel="noopener"><ShoppingCart class={icon} /> {priceLabel(p.store.discounted, p.store.price)}</a> {#if !p.store.available}<Tag kind="oos" />{:else}<Badge variant="success-soft">buy on store</Badge>{/if}{:else}<span class="text-muted-foreground">not sold — buyback only</span>{/if}</Table.Cell>
                    <Table.Cell>
                      <div class="flex flex-wrap items-center gap-2">
                        {#if p.item.url}<a class={link} href={p.item.url} target="_blank" rel="noopener">buy back <ExternalLink class={icon} /></a>{:else}<span class="text-muted-foreground">#{p.item.id}</span>{/if}
                        <TipButton variant={bbOwned(p.item.id) ? 'secondary' : 'ghost'} size="xs" onclick={() => markOwned(p.item.id, !bbOwned(p.item.id))} tip={bbOwned(p.item.id) ? 'Marked as owned — click to put it back' : "I already own this (hangar lists it under another name, or I got it another way) — hide it"}>
                          <Check class={cn(bbOwned(p.item.id) && 'text-success')} /> {bbOwned(p.item.id) ? 'owned' : 'I own it'}
                        </TipButton>
                      </div>
                      {#if p.item.date}<div class="text-muted-foreground">{p.item.date}</div>{/if}
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {/if}
        {:else}
          {@const list = bbItems.filter((m) => bbMatch(`${m.item.name} ${m.titles.join(' ')}`))}
          {@const unk = bbc.unknown.filter((u) => bbKeep(u.item.id, false) && bbMatch(`${u.item.name} ${u.hull}`))}
          {#if unk.length}
            <div class="grid gap-1">
              <span class="text-muted-foreground text-xs">RSI lists these packs as "N items" only, so their paints can't be matched — here is what you own for that hull:</span>
              <Table.Root class="text-xs">
                <Table.Header><Table.Row><Table.Head>Pack</Table.Head><Table.Head>You own for that hull</Table.Head><Table.Head></Table.Head></Table.Row></Table.Header>
                <Table.Body>
                  {#each unk as u (u.item.id)}
                    <Table.Row>
                      <Table.Cell class="whitespace-normal"><strong>{u.item.name}</strong> <Badge variant="outline">{u.count} items</Badge>{#if u.item.date}<div class="text-muted-foreground">{u.item.date}</div>{/if}</Table.Cell>
                      <Table.Cell class="whitespace-normal">{#if u.ownedForHull.length}{u.ownedForHull.length} {u.hull} paint{u.ownedForHull.length === 1 ? '' : 's'}{u.ownedForHull.length >= u.count ? ' — at least as many as the pack holds' : ''}: <span class="text-muted-foreground">{u.ownedForHull.map((p) => `${p.title}${p.n > 1 ? ` ×${p.n}` : ''}`).join(', ')}</span>{:else if u.hull}<span class="text-destructive">no {u.hull} paints in your hangar</span>{:else}<span class="text-muted-foreground">—</span>{/if}</Table.Cell>
                      <Table.Cell>
                        <div class="flex flex-wrap items-center gap-2">
                          {#if u.item.url}<a class={link} href={u.item.url} target="_blank" rel="noopener">buy back <ExternalLink class={icon} /></a>{/if}
                          <Button variant={bbOwned(u.item.id) ? 'secondary' : 'ghost'} size="xs" onclick={() => markOwned(u.item.id, !bbOwned(u.item.id))}><Check class={bbOwned(u.item.id) ? 'text-success' : ''} /> {bbOwned(u.item.id) ? 'owned' : 'I own it'}</Button>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  {/each}
                </Table.Body>
              </Table.Root>
            </div>
          {/if}
          {#if !list.length && !unk.length}<Empty>Nothing here.</Empty>{:else}
            <Table.Root class="text-xs">
              <Table.Header><Table.Row><Table.Head>Buyback entry</Table.Head><Table.Head>You don't have</Table.Head><Table.Head>You still have</Table.Head><Table.Head></Table.Head></Table.Row></Table.Header>
              <Table.Body>
                {#each list as m (m.item.id)}
                  <Table.Row>
                    <Table.Cell class="whitespace-normal"><strong>{m.item.name}</strong> <Badge variant="secondary">{m.item.type}</Badge>{#if m.item.date}<div class="text-muted-foreground">{m.item.date}</div>{/if}</Table.Cell>
                    <Table.Cell class="whitespace-normal">
                      {#each countTitles(m.titles) as g, ti (`${g.title}#${ti}`)}
                        {@const l = m.store.find((x) => x.title === g.title)}
                        {#if ti}, {/if}
                        {#if l}<a href={l.url} target="_blank" rel="noopener" class="text-primary inline-flex items-center gap-1 no-underline hover:underline" title="On the store today — buy it instead of buying it back"><ShoppingCart class="size-3" aria-hidden="true" />{titleWithCount(g)}{#if l.price != null} <span class="text-muted-foreground">{usd(l.price)}</span>{/if}</a>{:else}<span class="text-destructive">{titleWithCount(g)}</span>{/if}
                      {/each}
                      {#if m.buyableNow}<Badge variant="success-soft" class="ml-1">all on store</Badge>{/if}
                    </Table.Cell>
                    <Table.Cell class="text-muted-foreground whitespace-normal">{#each countTitles(m.have) as g, ti (`${g.title}#${ti}`)}{#if ti}, {/if}{titleWithCount(g)} <HintBadge variant="outline" class="h-4 px-1 text-[10px]" hint="copies in your hangar">×{qtyOf(g.title)}</HintBadge>{:else}—{/each}</Table.Cell>
                    <Table.Cell>
                      <div class="flex flex-wrap items-center gap-2">
                        {#if m.item.url}<a class={link} href={m.item.url} target="_blank" rel="noopener">buy back <ExternalLink class={icon} /></a>{:else}<span class="text-muted-foreground">#{m.item.id}</span>{/if}
                        <TipButton variant={bbOwned(m.item.id) ? 'secondary' : 'ghost'} size="xs" onclick={() => markOwned(m.item.id, !bbOwned(m.item.id))} tip={bbOwned(m.item.id) ? 'Marked as owned — click to put it back' : "I already own this (hangar lists it under another name, or I got it another way) — hide it"}>
                          <Check class={cn(bbOwned(m.item.id) && 'text-success')} /> {bbOwned(m.item.id) ? 'owned' : 'I own it'}
                        </TipButton>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {/if}
        {/if}
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}

  {#if packs.length}
    <Collapsible.Root bind:open={showPacks} class="grid gap-2">
      <Collapsible.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="link" size="sm" class="h-auto justify-start px-0 font-semibold whitespace-normal text-left">{@render fold(showPacks, `Paint packs on the store (${packs.length}) — pack price vs singles vs bundle tiers`)}</Button>
        {/snippet}
      </Collapsible.Trigger>
      <Collapsible.Content class="grid gap-2">
        <Table.Root>
          <Table.Header><Table.Row><Table.Head>Pack</Table.Head><Table.Head>Pack today</Table.Head><Table.Head>Singles at list</Table.Head><Table.Head>Pack discount</Table.Head><Table.Head>Bundle beats it from</Table.Head><Table.Head>Contents</Table.Head></Table.Row></Table.Header>
          <Table.Body>
            {#each packs as pk (pk.pack.id)}
              {@const b = pk.singlesTotal ? beats(pk.impliedRate) : null}
              <Table.Row>
                <Table.Cell class="whitespace-normal"><a class={link} href={pk.pack.url} target="_blank" rel="noopener">{pk.pack.name}</a></Table.Cell>
                <Table.Cell>{usd(pk.pack.discounted)}{#if pk.pack.discounted < pk.pack.price}<span class="text-muted-foreground text-xs"> (list {usd(pk.pack.price)})</span>{/if}</Table.Cell>
                <Table.Cell>{pk.singlesTotal ? usd(pk.singlesTotal) : '—'}</Table.Cell>
                <Table.Cell>{pk.singlesTotal ? pct(pk.impliedRate) : '?'}</Table.Cell>
                <Table.Cell class="text-xs">{#if !pk.singlesTotal}unknown{:else if b}{b.min} singles in the cart ({pct(b.rate)}){:else}never — pack is the top tier{/if}</Table.Cell>
                <Table.Cell class="text-muted-foreground text-xs whitespace-normal">{pk.paints ? pk.paints.map((s) => `${s.name} ${usd(s.price)}`).join(' · ') : 'singles not on the store'}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
        <p class="text-muted-foreground text-xs">A pack is priced at the tier its paints would get on their own; in a bigger cart the same paints as singles get the bigger tier. Whether a pack line gets the bundle discount and counts toward it is unverified — set <em>Pack in the bundle</em> above to what your cart shows.</p>
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}

  <div class="grid gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <strong>New paints to buy in the same cart</strong>
      <span class="text-muted-foreground text-xs">They count toward the tier and get the same discount.</span>
    </div>
    {#if wanted.length}
      <div class="flex flex-wrap items-center gap-1.5">
        {#each wanted as w (w.id)}
          <Chip onremove={() => dropWanted(w.id)} removeLabel={`Remove ${w.name}`}>{w.name} · {usd(w.discounted)} → {usd(Math.round(w.discounted * (1 - totals.rate)))}</Chip>
        {/each}
      </div>
    {/if}
    <Command.Root shouldFilter={false} class="h-auto max-w-[480px] border">
      <Command.Input placeholder="Search store paints to add…" bind:value={q} aria-label="Add a store paint" />
      {#if matches.length}
        <Command.List>
          {#each matches as p (p.id)}
            <Command.Item value={String(p.id)} onSelect={() => addWanted(p.id)}>{@render pic(p.thumb, p.name, 40, 22)}<span>{p.name} <span class="text-muted-foreground">{priceLabel(p.discounted, p.price)} → {usd(Math.round(p.discounted * (1 - paintDiscount(totals.lines + 1))))} here</span></span></Command.Item>
          {/each}
        </Command.List>
      {:else if q.trim()}
        <span class="text-muted-foreground px-2.5 py-2 text-xs">No store paint matches (owned ones are not offered here).</span>
      {/if}
    </Command.Root>
  </div>

  {#if split.skipped.length}
    <Collapsible.Root bind:open={showSkipped} class="grid gap-2">
      <Collapsible.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="link" size="sm" class="h-auto justify-start px-0 font-semibold whitespace-normal text-left">{@render fold(showSkipped, `Not counted: ${split.skipped.length} paint pledge${split.skipped.length === 1 ? '' : 's'} you can't melt and rebuy today`)}</Button>
        {/snippet}
      </Collapsible.Trigger>
      <Collapsible.Content class="grid gap-2">
        {#each skippedBy as [why, list] (why)}
          <div class="grid gap-1">
            <div class="text-muted-foreground text-xs"><strong>{SKIP_LABEL[why]}</strong> · {list.length}</div>
            <div class="flex flex-wrap gap-1.5">
              {#each list as s (s.pledge.id)}
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <Badge {...props} variant="outline" href={hangarUrl(pledges, s.pledge.id)} target="_blank" rel="noopener">{s.pledge.name} #{s.pledge.id}{#if why === 'other-items' && s.titles.length}<span class="text-muted-foreground"> · also {s.titles.slice(0, 3).join(', ')}{s.titles.length > 3 ? ` +${s.titles.length - 3}` : ''}</span>{/if}</Badge>
                    {/snippet}
                  </Tooltip.Trigger>
                  <Tooltip.Content class="whitespace-pre-line">{s.titles.join('\n') || s.pledge.name}</Tooltip.Content>
                </Tooltip.Root>
              {/each}
            </div>
          </div>
        {/each}
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}
  </Card.Content>
</Card.Root>
