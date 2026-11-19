<script lang="ts">
  import { addable, addStep, batchPlan, CART_URL, verifyUpgrade, type WantedLine } from '@/lib/cart';
  import { createCartLedger } from '@/lib/cart-ui.svelte';
  import { transient } from '@/lib/flash.svelte';
  import { lastSaleLabel, shipName, uid } from '@/lib/ccu-ui';
  import { applyAlternative, DEFAULT_PLAN_OPTIONS, savedVsMsrp, farthestReachable, ownedCcus, ownedHulls, ownedShips, plan, planGraph, plannerExclude, reservedRefs, STORE_START, type Objective, type OpenedLeg, type PlanOptions, type SavedChain, type Step } from '@/lib/ccu';
  import { hangarState, hangarUrl } from '@/lib/hangar';
  import { bg } from '@/lib/messages';
  import { buybackItem, catalogItem, ccuChainsItem, hangarItem, pledgeLabelsItem, priceHistoryItem, saleHistoryItem, storeItemsItem } from '@/lib/settings';
  import { withArchive, withExpected, type PriceHistory } from '@/lib/price-history';
  import { cleanLabels, idsWith, KEEP, PREFER, type Labels } from '@/lib/labels';
  import { refreshHangar, type HangarProgress } from '@/lib/hangar-refresh';
  import { matchShip, usd, type Catalog, type SaleHistory, type StoreItem } from '@/lib/store';
  import { packOffersByShip, priceIndex } from '@/lib/bundle';
  import { ownUsd } from '@/lib/privacy.svelte';
  import Wizard, { type WizardStep } from './Wizard.svelte';
  import Segmented from './Segmented.svelte';
  import Tag from './Tag.svelte';
  import ShipSelect from './ShipSelect.svelte';
  import Stat from './Stat.svelte';
  import CcuChains from './CcuChains.svelte';
  import CcuAlternatives from './CcuAlternatives.svelte';
  import CcuTransfer from './CcuTransfer.svelte';
  import { encodeCcuLink, linkToPlanner, watchCcuLink, type CcuLink } from '@/lib/ccu-link';
  import { untrack } from 'svelte';
  import StatGrid from './StatGrid.svelte';
  import Section from './Section.svelte';
  import Chip from './Chip.svelte';
  import TipButton from './TipButton.svelte';
  import HintBadge from './HintBadge.svelte';
  import LazyTip from './LazyTip.svelte';
  import SwitchRow from './SwitchRow.svelte';
  import CartButton from './CartButton.svelte';
  import OpenCartButton from './OpenCartButton.svelte';
  import CartView from './CartView.svelte';
  import SortTh from './SortTh.svelte';
  import { sortBy, type SortState } from '@/lib/sort';
  import * as Alert from '@/components/ui/alert';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import { Badge, type BadgeVariant } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { cn } from '@/lib/utils';
  import { LINK } from '@/lib/ui';
  import { fmtDate } from '@/lib/dates';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import Ban from '@lucide/svelte/icons/ban';


  let cat = $state<Catalog | null>(null);
  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let buyback = $state<Awaited<ReturnType<typeof buybackItem.getValue>>>(null);
  let chains = $state<SavedChain[]>([]);
  let sales = $state<SaleHistory>({});
  let prices = $state<PriceHistory>({});
  let labels = $state<Labels>({});
  let error = $state('');
  /** Browse's saved listing (never fetched here): packs / game packages that grant the target. */
  let storeAll = $state<StoreItem[]>([]);
  /**
   * The target's packs, best share first — shown when no CCU or standalone to it is on sale today (an Eclipse, an
   * Idris): buying the pack now vs waiting for the CCU to return.
   */
  const targetPacks = $derived.by(() => {
    const t = toId == null ? null : (cat?.ships ?? []).find((s) => s.id === toId);
    if (!t || t.ccu.some((k) => k.available) || t.standalone.some((k) => k.available)) return [];
    return packOffersByShip(storeAll, priceIndex(storeAll, cat?.ships ?? [])).get(t.id) ?? [];
  });

  type Mode = 'store' | 'hangar' | 'any';
  let mode = $state<Mode>('hangar');
  let fromId = $state<number | null>(null);
  let toId = $state<number | null>(null); // set from the hash link (`#ccu?to=`, watchCcuLink below)
  let opt = $state<PlanOptions>({ ...DEFAULT_PLAN_OPTIONS, include: [], exclude: [], via: [], skip: [] });
  let excludeSaved = $state(true);
  let chainsLoaded = $state(false);
  let buybackLoaded = $state(false);
  /** A chain of *My chains* opened here (`openChain`): planned without the CCUs the chains above it took. */
  let openedLeg = $state<OpenedLeg | null>(null);
  let chainName = $state('');
  /** Name of the chain just saved, shown for a moment. */
  const saved = transient(2500);

  $effect(() => {
    hangarItem.getValue().then((h) => (hangar = h));
    buybackItem.getValue().then((b) => ((buyback = b), (buybackLoaded = true)));
    catalogItem.getValue().then((c) => (cat = c));
    ccuChainsItem.getValue().then((c) => ((chains = c), (chainsLoaded = true)));
    saleHistoryItem.getValue().then((h) => (sales = h));
    priceHistoryItem.getValue().then(async (h) => (prices = await withArchive(h)));
    pledgeLabelsItem.getValue().then((l) => (labels = cleanLabels(l)));
    storeItemsItem.getValue().then((v) => (storeAll = v?.items ?? []));
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch((e) => (error = (e as Error).message));
    const offs = [
      hangarItem.watch((h) => (hangar = h)),
      pledgeLabelsItem.watch((l) => (labels = cleanLabels(l))),
      storeItemsItem.watch((v) => (storeAll = v?.items ?? [])),
      buybackItem.watch((b) => (buyback = b)),
      // Another hub tab (or an account switch) changed the list: follow it, so this page never writes an old copy back.
      ccuChainsItem.watch((c) => {
        const next = c ?? [];
        if (JSON.stringify(next) !== JSON.stringify($state.snapshot(chains))) chains = next;
      }),
    ];
    return () => offs.forEach((o) => o());
  });
  /** Load the hangar right here (same pages and storage as the Hangar tab). */
  let hangarLoading = $state<HangarProgress | null>(null);
  async function loadHangarHere() {
    if (hangarLoading) return;
    hangarLoading = { page: 0, count: 0 };
    try {
      await refreshHangar((p) => (hangarLoading = p));
    } catch (e) {
      error = `Hangar: ${(e as Error).message}`;
    } finally {
      hangarLoading = null;
    }
  }

  // `expect` = the last sale price seen per hull, for steps that wait for a sale (today's store always wins over it)
  const ships = $derived(withExpected((cat?.ships ?? []).filter((s) => s.msrp > 0).sort((a, b) => a.msrp - b.msrp), prices));
  const byId = $derived(new Map(ships.map((s) => [s.id, s])));
  const mine = $derived(ownedShips(hangar?.pledges ?? [], ships));
  // A shared route in the hash (`#ccu?from=…&to=…`, `lib/ccu-link.ts`): applied once the catalog is in, and on every hash change.
  const catalogReady = $derived(ships.length > 0);
  $effect(() => {
    if (!catalogReady) return;
    return watchCcuLink((l) => untrack(() => applyLink(l)));
  });
  /** A chain code / link → the planner on screen (ids checked against the catalog). */
  function applyLink(l: CcuLink) {
    const r = linkToPlanner(l, (id) => byId.has(id), (id) => mine.some((m) => m.id === id));
    if (r.mode) (mode = r.mode), (fromId = r.fromId ?? null);
    if (r.toId != null) toId = r.toId;
    Object.assign(opt, r.opt);
    if (l.name) chainName = l.name;
    openedLeg = null;
  }
  /** Hull copies a chain may upgrade: pledges labelled *Keep* are left out (`lib/labels.ts`). */
  const keepIds = $derived(idsWith(labels, KEEP));
  const hulls = $derived(ownedHulls((hangar?.pledges ?? []).filter((p) => !keepIds.has(p.id)), ships));
  /** Hulls on pledges labelled *LTI token* / *CCU fodder*: Auto upgrades them first. */
  const labelPrefer = $derived(ownedHulls((hangar?.pledges ?? []).filter((p) => idsWith(labels, PREFER).has(p.id)), ships).map((h) => h.id));
  /** Hulls on LTI pledges (LTI tokens): one click to prefer them for auto chains. */
  const ltiHulls = $derived(ownedHulls((hangar?.pledges ?? []).filter((p) => p.lti), ships).map((h) => h.id));
  /**
   * Source insurance: a CCU keeps the pledge's insurance, so an LTI chain starts from a hull on an LTI pledge. `true`
   * narrows *Ship in my hangar* to those hulls (an LTI token, an LTI starter).
   */
  let ltiOnly = $state(false);
  const ltiSet = $derived(new Set(ltiHulls));
  const mineSrc = $derived(ltiOnly ? mine.filter((s) => ltiSet.has(s.id)) : mine);
  $effect(() => {
    if (ltiOnly && mode === 'hangar' && fromId != null && !ltiSet.has(fromId)) fromId = null;
  });
  let stopPick = $state<number | null>(null);
  /** The target picker hides ships you already own unless asked. */
  let targetOwned = $state(false);
  const targetable = $derived(targetOwned ? ships : ships.filter((s) => !mine.some((m) => m.id === s.id) || s.id === toId));
  const sortedShips = $derived([...ships].sort((a, b) => a.name.localeCompare(b.name)));
  const ccus = $derived(ownedCcus(hangar?.pledges ?? [], buyback?.items ?? [], ships));
  const buybackUrl = $derived(new Map((buyback?.items ?? []).map((b) => [b.id, b.url])));

  /** Which chain of My chains holds each CCU ref. */
  const reservedBy = $derived(new Map(chains.flatMap((c) => reservedRefs([c]).map((r) => [r, c] as const))));
  const startId = $derived(mode === 'store' ? STORE_START : fromId);
  // A chain saved for this very route keeps its CCUs: saving must not re-plan the chain on screen without them.
  const effective = $derived<PlanOptions>({ ...opt, exclude: plannerExclude(opt.exclude, chains, excludeSaved, startId, toId, openedLeg) });
  // The opened chain ends when the route on screen is no longer its route.
  $effect(() => {
    if (openedLeg && (openedLeg.startId !== startId || openedLeg.targetId !== toId)) openedLeg = null;
  });
  /** Chain with today's sales; when there is none (target not on sale — Orion, Arrastra…) plan ahead without asking. */
  // Graphs for the current options, kept while only the source / target change (the ahead one is built on demand).
  const graphNow = $derived(planGraph(ships, ccus.owned, effective));
  const aheadOpt = $derived<PlanOptions>({ ...effective, planAhead: true });
  const graphAhead = $derived(planGraph(ships, ccus.owned, aheadOpt));
  const planned = $derived.by(() => {
    if (startId == null || toId == null) return { result: null, ahead: false };
    const r = plan(ships, ccus.owned, startId, toId, effective, graphNow);
    if (r || effective.planAhead) return { result: r, ahead: false };
    const a = plan(ships, ccus.owned, startId, toId, aheadOpt, graphAhead);
    return { result: a, ahead: !!a };
  });
  const result = $derived(planned.result);
  /**
   * No chain: the priciest hull below the target that today's sales reach (else planning ahead). Only offered when the
   * planner can actually plan to it with the stops / forced CCUs on screen (when those are the blocker, none is).
   */
  const reach = $derived.by(() => {
    if (result || startId == null || toId == null) return null;
    for (const [g, o] of [[graphNow, effective], [graphAhead, aheadOpt]] as const) {
      const r = farthestReachable(g, startId, toId);
      if (r != null) return plan(ships, ccus.owned, startId, r, o, g) ? r : null;
    }
    return null;
  });
  /** The options the shown chain was planned with (saved with it). */
  const used = $derived<PlanOptions>(planned.ahead ? { ...effective, planAhead: true } : effective);
  /** Running spend after each step. */
  const running = $derived(result ? result.steps.reduce<number[]>((acc, s) => [...acc, (acc.at(-1) ?? 0) + s.cost], []) : []);
  const creditCents = $derived(hangar?.credits ? Math.round(hangar.credits.usd * 100) : null);
  const cashNeeded = $derived(result && creditCents != null ? result.cash + Math.max(0, result.total - result.cash - creditCents) : null);

  // ---- RSI cart ----
  const cart = createCartLedger();
  const cartKey = (s: Step) => `${s.kind}:${s.fromId}>${s.toId}:${s.skuId ?? s.ref ?? ''}`;
  /** The SKU a step puts in the cart (what RSI's cart lines are keyed by), for *in cart ×n*. */
  const skuOfStep = (s: Step): number | null => {
    const a = addable(s, byId);
    return a.kind === 'standalone' ? a.skuId : a.kind === 'upgrade' ? a.ref.toSkuId : null;
  };
  // A new plan = a new cart ledger (state is per step identity, so a re-plan with the same steps keeps it).
  const addableSteps = $derived(result ? result.steps.filter((s) => addable(s, byId).kind !== 'none') : []);
  const hasBuyback = $derived(addableSteps.some((s) => s.kind === 'buyback'));
  const addOne = (s: Step) => cart.add(cartKey(s), () => addStep(s, byId), skuOfStep(s));
  /**
   * Store lines of one or several chains → the RSI cart. The cart is read first: a line it already holds is left alone
   * (each copy in the cart covers one line), the rest go in one after another. A line RSI refuses (some CCUs go in a
   * cart only once) is marked and the batch carries on. Buy-backs check out alone, so they are never part of it.
   */
  type BatchLine = WantedLine & { step: Step };
  const lineOf = (s: Step, prefix = ''): BatchLine | null => {
    if (s.kind === 'buyback') return null;
    const a = addable(s, byId);
    if (a.kind === 'none') return null;
    return a.kind === 'standalone' ? { key: prefix + cartKey(s), step: s, skuId: a.skuId, fromName: null } : { key: prefix + cartKey(s), step: s, skuId: a.ref.toSkuId, fromName: byId.get(s.fromId)?.name ?? null };
  };
  async function addLines(lines: BatchLine[]): Promise<{ added: number; held: number; limit: number; failed: number }> {
    await cart.sync();
    const held = new Set(batchPlan(lines, cart.snapshot?.lines ?? []).held);
    const before = new Set(lines.filter((l) => cart.of(l.key)?.st === 'added').map((l) => l.key));
    for (const l of lines) if (held.has(l.key)) cart.hold(l.key);
    await cart.addAll(
      lines.filter((l) => !held.has(l.key)).map((l) => ({ key: l.key, sku: l.skuId, task: () => addStep(l.step, byId) })),
      400,
      ['limit', 'refused'],
    );
    const out = { added: 0, held: 0, limit: 0, failed: 0 };
    for (const l of lines) {
      const c = cart.of(l.key);
      if (c?.st === 'added') {
        if (c.held) out.held++;
        else if (!before.has(l.key)) out.added++;
      } else if (c?.st === 'error') {
        if (c.code === 'limit') out.limit++;
        else out.failed++;
      }
    }
    return out;
  }
  // ---- verify against RSI: is each step really on offer from that ship, at that price? ----
  type VerifyState = { st: 'checking' } | { st: 'ok'; price: number | null; note?: string } | { st: 'wait' } | { st: 'price'; price: number } | { st: 'no'; why: string } | { st: 'error'; msg: string };
  let verify = $state<Record<string, VerifyState>>({});
  let verifying = $state(false);
  const verified = $derived(result ? result.steps.map((s) => verify[cartKey(s)]).filter((v): v is VerifyState => !!v) : []);
  const confirmed = $derived(verified.filter((v) => v.st === 'ok' || v.st === 'wait').length);
  async function verifyChain() {
    if (!result) return;
    verifying = true;
    verify = {};
    try {
      for (const s of result.steps) {
        const k = cartKey(s);
        verify = { ...verify, [k]: { st: 'checking' } };
        try {
          if (s.kind === 'owned') {
            const have = ccus.owned.some((o) => o.source === 'hangar' && o.ref === s.ref);
            verify = { ...verify, [k]: have ? { st: 'ok', price: null, note: 'in your hangar' } : { st: 'no', why: 'not in your hangar any more — reload it' } };
            continue;
          }
          if (s.kind === 'future') {
            verify = { ...verify, [k]: { st: 'wait' } }; // nothing to ask RSI yet; the feed alerts when it is on sale
            continue;
          }
          const a = addable(s, byId);
          if (a.kind === 'none') {
            verify = { ...verify, [k]: { st: 'no', why: a.why } };
            continue;
          }
          if (a.kind === 'standalone') {
            const sku = byId.get(s.toId)?.standalone.find((x) => x.id === a.skuId);
            verify = { ...verify, [k]: sku?.available ? { st: 'ok', price: sku.price, note: 'catalog' } : { st: 'no', why: 'standalone SKU no longer on sale' } };
            continue;
          }
          const v = await verifyUpgrade(a.ref);
          if (!v.eligible) verify = { ...verify, [k]: { st: 'no', why: `RSI does not sell this CCU from the ${name(s.fromId)}` } };
          else if (v.price != null && v.price !== s.cost) verify = { ...verify, [k]: { st: 'price', price: v.price } };
          else verify = { ...verify, [k]: { st: 'ok', price: v.price } };
          await new Promise((ok) => setTimeout(ok, 300));
        } catch (e) {
          verify = { ...verify, [k]: { st: 'error', msg: (e as Error).message } };
        }
      }
    } finally {
      verifying = false;
    }
  }

  /** Store steps one after another (RSI is polite about it; a buy-back goes alone, so it is skipped here). */
  const addAll = () => addLines(addableSteps.map((s) => lineOf(s)).filter((l): l is BatchLine => !!l));

  // ---- ignore a step: the planner routes around that CCU (owned / buyback: its ref; store: that SKU) ----
  // a waiting step can be skipped too (the chain then never waits for that hull) — except the target itself
  const canIgnore = (s: Step) => ((s.kind === 'owned' || s.kind === 'buyback') && s.ref != null) || (s.kind === 'future' && s.toId !== toId) || (s.kind !== 'future' && s.kind !== 'owned' && s.kind !== 'buyback' && s.skuId != null);
  /** What was ignored from the chain, newest last, for *Undo* (the step as it read when ignored). */
  let ignoredLog = $state<{ kind: 'exclude' | 'noWait' | 'skip'; id: number; label: string; forced: boolean }[]>([]);
  function ignoreStep(s: Step) {
    const label = `${s.fromId === STORE_START ? 'Store' : name(s.fromId)} → ${name(s.toId)}`;
    if ((s.kind === 'owned' || s.kind === 'buyback') && s.ref != null) {
      const ref = s.ref;
      const forced = opt.include.includes(ref);
      opt.include = opt.include.filter((r) => r !== ref);
      if (!opt.exclude.includes(ref)) (opt.exclude = [...opt.exclude, ref]), (ignoredLog = [...ignoredLog, { kind: 'exclude', id: ref, label, forced }]);
    } else if (s.kind === 'future') {
      if (!(opt.noWait ?? []).includes(s.toId)) (opt.noWait = [...(opt.noWait ?? []), s.toId]), (ignoredLog = [...ignoredLog, { kind: 'noWait', id: s.toId, label, forced: false }]);
    } else if (s.skuId != null && !(opt.skip ?? []).includes(s.skuId)) (opt.skip = [...(opt.skip ?? []), s.skuId]), (ignoredLog = [...ignoredLog, { kind: 'skip', id: s.skuId, label, forced: false }]);
  }
  /** Entries of the log that are still ignored (a chip may have brought one back already). */
  const undoable = $derived(ignoredLog.filter((x) => (x.kind === 'exclude' ? opt.exclude.includes(x.id) : x.kind === 'noWait' ? (opt.noWait ?? []).includes(x.id) : (opt.skip ?? []).includes(x.id))));
  function undoAll() {
    for (let n = undoable.length; n > 0; n--) undoIgnore();
  }
  /** Bring back the step ignored last: the chain is planned with it again. */
  function undoIgnore() {
    const last = undoable.at(-1);
    if (!last) return;
    if (last.kind === 'exclude') (opt.exclude = opt.exclude.filter((r) => r !== last.id)), last.forced && (opt.include = [...opt.include, last.id]);
    else if (last.kind === 'noWait') opt.noWait = (opt.noWait ?? []).filter((h) => h !== last.id);
    else opt.skip = (opt.skip ?? []).filter((k) => k !== last.id);
    ignoredLog = ignoredLog.filter((x) => x !== last);
  }
  /** Name of a store SKU ("600i Touring · Warbond Edition") for the ignored chips. */
  const skuLabel = $derived.by(() => {
    const m = new Map<number, string>();
    for (const sh of ships) {
      for (const k of sh.ccu) m.set(k.id, `${sh.name} · ${k.title || 'Standard'} CCU`);
      for (const k of sh.standalone) m.set(k.id, `${sh.name} · ${k.title || 'Standalone'}`);
    }
    return m;
  });
  const ownedLabelOf = (ref: number) => {
    const o = ccus.owned.find((x) => x.ref === ref);
    return o ? `${name(o.fromId)} → ${name(o.toId)} · ${o.source === 'hangar' ? 'owned' : 'buyback'}` : `CCU #${ref}`;
  };
  /** Under the MSRP gap of the step, counting what an owned CCU cost you. */
  const stepSaved = (s: Step): { saved: number; pct: number } | null => {
    const gap = (byId.get(s.toId)?.msrp ?? 0) - (s.fromId === STORE_START ? 0 : (byId.get(s.fromId)?.msrp ?? 0));
    if (gap <= 0 || (s.kind === 'future' && !s.est)) return null; // a wait at MSRP saves nothing by definition
    const saved = gap - s.cost - s.paid;
    return { saved, pct: Math.round((100 * saved) / gap) };
  };
  /** A step's figures. An owned CCU costs what you paid for it (nothing more to pay now); a gifted one is free. */
  const figures = (s: Step, i: number): { dt: string; dd: string; cls: string }[] => {
    const sv = stepSaved(s);
    return [
      s.kind === 'owned'
        ? { dt: 'Cost', dd: s.paid ? `${ownUsd(s.paid)} · already paid` : 'free · gift', cls: '' }
        : { dt: 'Cost', dd: s.cost ? usd(s.cost) : 'free', cls: '' },
      { dt: 'New money', dd: s.cash ? usd(s.cash) : '—', cls: s.cash > 0 ? 'text-warning' : '' },
      ...(sv ? [{ dt: 'Saved', dd: `${usd(sv.saved)} · ${sv.pct}%`, cls: sv.saved > 0 ? 'text-success' : sv.saved < 0 ? 'text-destructive' : 'text-muted-foreground' }] : []),
      { dt: 'To pay so far', dd: usd(running[i] ?? 0), cls: '' },
      { dt: 'Hull value', dd: usd(byId.get(s.toId)?.msrp ?? 0), cls: 'text-muted-foreground' },
    ];
  };

  const name = (id: number) => shipName(byId, id);
  const KIND: Record<string, string> = { warbond: 'Warbond CCU', standard: 'Standard CCU', limited: 'Limited CCU', owned: 'You own it', buyback: 'Buyback', standalone: 'Buy ship', future: 'Later · wait for a sale' };
  const kindVariant = (k: string): BadgeVariant => (k === 'owned' ? 'success' : k === 'standalone' ? 'info' : k === 'warbond' || k === 'future' ? 'warning' : 'outline');
  const seen = (id: number) => lastSaleLabel(sales, id);
  const OBJECTIVES: { id: Objective; label: string; hint: string }[] = [
    { id: 'spend', label: 'Current highest savings', hint: 'least to pay now — CCUs you own are free' },
    { id: 'cash', label: 'Lowest new money', hint: 'least that store credit cannot cover, then least to pay' },
    { id: 'longterm', label: 'Long-term highest savings', hint: 'owned CCUs count at what you paid for them' },
  ];
  const UPGRADES = 'https://robertsspaceindustries.com/pledge/ship-upgrades';
  function link(s: Step): string | null {
    if (s.kind === 'owned' && hangar && s.ref != null) return hangarUrl(hangar.pledges, s.ref);
    if (s.kind === 'buyback' && s.ref != null) return buybackUrl.get(s.ref) ?? null;
    if (s.kind === 'standalone' || s.kind === 'future') return byId.get(s.toId)?.msrpSource ? null : (byId.get(s.toId)?.link ?? null);
    return UPGRADES;
  }
  const forceOf = (ref: number): 'include' | 'exclude' | '' => (opt.include.includes(ref) ? 'include' : opt.exclude.includes(ref) ? 'exclude' : '');
  /** neutral → force include → force exclude → neutral */
  function cycleForce(ref: number) {
    const f = forceOf(ref);
    opt.include = opt.include.filter((r) => r !== ref);
    opt.exclude = opt.exclude.filter((r) => r !== ref);
    if (f === '') opt.include = [...opt.include, ref];
    else if (f === 'include') opt.exclude = [...opt.exclude, ref];
  }

  async function persist(next: SavedChain[]) {
    chains = next;
    await ccuChainsItem.setValue(JSON.parse(JSON.stringify(next)));
  }
  /** The chain of *My chains* on screen (opened from the list, route unchanged), if any. */
  /**
   * Plans may be written back to the chains only on complete data: the whole hangar (not a load in progress or one that
   * stopped part-way) and the buyback list as saved. On less, owned CCUs are missing and every chain would be re-planned
   * without them.
   */
  const plansReady = $derived(chainsLoaded && buybackLoaded && ships.length > 0 && hangarState(hangar) === 'complete' && !hangarLoading && buyback?.complete !== false);
  const openedChain = $derived(openedLeg?.chainId ? (chains.find((c) => c.id === openedLeg!.chainId) ?? null) : null);
  /** The options a chain keeps: yours (not the CCUs other chains hold), with Plan ahead on when that is how it was planned. */
  const ownOpt = (): PlanOptions => ({ ...$state.snapshot(opt), ...(planned.ahead ? { planAhead: true } : {}) });
  /** Save the chain on screen: update the opened chain in place (its priority stays), or add a new one at the end. */
  /**
   * Keep the plans `CcuChains` worked out with their chains. Unlike an edit this is not something the user did, so it
   * must never win over a newer list: when storage holds other chains (another tab added one, the account changed),
   * that list is taken over instead and nothing is written.
   */
  async function persistPlans(next: SavedChain[]) {
    const stored = (await ccuChainsItem.getValue()) ?? [];
    const ids = (l: SavedChain[]) => l.map((c) => c.id).join('|');
    if (ids(stored) !== ids(next)) {
      chains = stored;
      return;
    }
    await persist(next);
  }
  async function saveChain(asNew = false) {
    if (!result || startId == null || toId == null) return;
    const label = chainName.trim() || `${name(startId)} → ${name(toId)}`;
    const plan = { steps: $state.snapshot(result.steps), total: result.total, cash: result.cash };
    const cur = asNew ? null : openedChain;
    if (cur) {
      const start = startId;
      await persist(($state.snapshot(chains) as SavedChain[]).map((c) => (c.id === cur.id ? { ...c, name: label, opt: ownOpt(), ...(c.auto ? {} : { startId: start }), ...plan } : c)));
    } else {
      await persist([...($state.snapshot(chains) as SavedChain[]), { id: uid(), name: label, at: Date.now(), startId, targetId: toId, opt: ownOpt(), ...plan }]);
      chainName = '';
    }
    saved.show(label);
  }
  // ---- export / import as text (`CcuTransfer`): the route on screen and My chains as codes ----
  const routeCode = $derived(toId != null ? encodeCcuLink({ from: startId, to: toId, via: opt.via, opt, name: chainName }) : null);
  const savedCodes = $derived(chains.map((c) => codeOf(c)));
  /**
   * Imported codes → My chains, appended in order (lowest priority). A code with a source is planned now, to be sure it
   * works on this hangar and today's store; one without (an auto chain) lets the list pick the source.
   */
  async function importChains(links: CcuLink[]): Promise<{ added: number; failed: number }> {
    const next = [...$state.snapshot(chains)] as SavedChain[];
    let failed = 0;
    for (const l of links) {
      const r = linkToPlanner(l, (id) => byId.has(id), (id) => mine.some((m) => m.id === id));
      const start = r.mode === 'store' ? STORE_START : (r.fromId ?? null);
      if (r.toId == null) {
        failed++;
        continue;
      }
      const o: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, ...r.opt, include: [], skip: [], exclude: [], via: r.opt.via ?? [] };
      if (start == null && l.from != null) {
        failed++; // the code names a source hull this catalog does not have
        continue;
      }
      if (start == null) {
        next.push({ id: uid(), name: l.name || name(r.toId), at: Date.now(), startId: STORE_START, targetId: r.toId, steps: [], total: 0, cash: 0, opt: o, auto: true, storeStart: false, lti: 'any' });
        continue;
      }
      const held = reservedRefs(next);
      const p = plan(ships, ccus.owned, start, r.toId, { ...o, exclude: held }) ?? plan(ships, ccus.owned, start, r.toId, { ...o, planAhead: true, exclude: held });
      if (!p) {
        failed++;
        continue;
      }
      next.push({ id: uid(), name: l.name || `${name(start)} → ${name(r.toId)}`, at: Date.now(), startId: start, targetId: r.toId, steps: p.steps, total: p.total, cash: p.cash, opt: p.waits ? { ...o, planAhead: true } : o });
    }
    if (next.length !== chains.length) await persist(next);
    return { added: next.length - chains.length, failed };
  }
  const codeOf = (c: SavedChain) => encodeCcuLink({ from: c.auto ? null : c.startId, to: c.targetId, via: c.opt.via, opt: c.opt, name: c.name });
  /**
   * A chain of *My chains* → the planner (verify, cart, change it). It is planned as the list plans it: with its own
   * options and without the CCUs the chains above it took (`exclude`, kept in `openedLeg`, not in the options).
   */
  function openChain(c: SavedChain, start: number, exclude: number[]) {
    mode = start === STORE_START ? 'store' : mine.some((s) => s.id === start) ? 'hangar' : 'any';
    fromId = start === STORE_START ? null : start;
    toId = c.targetId;
    opt = { ...DEFAULT_PLAN_OPTIONS, ...$state.snapshot(c.opt), include: [...c.opt.include], exclude: [...c.opt.exclude], via: [...(c.opt.via ?? [])], skip: [...(c.opt.skip ?? [])] };
    chainName = c.name;
    openedLeg = { startId: start, targetId: c.targetId, exclude: [...exclude], chainId: c.id };
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  // ---- Your CCUs: show hangar / buyback, sort by any column, exclude or reset everything shown ----
  type OwnedCol = 'from' | 'to' | 'qty' | 'source' | 'paid' | 'gain' | 'reserved' | 'force';
  let ownedSort = $state<SortState<OwnedCol>>({ key: 'from', dir: 'asc' });
  let ownedShow = $state<'all' | 'hangar' | 'buyback'>('all');
  const gainOf = (o: { fromId: number; toId: number }) => (byId.get(o.toId)?.msrp ?? 0) - (byId.get(o.fromId)?.msrp ?? 0);
  const copyKey = (o: { source: string; fromId: number; toId: number; value: number; price?: number; gifted: boolean }) => `${o.source}:${o.fromId}>${o.toId}:${o.value}:${o.price ?? ''}:${o.gifted}`;
  const copies = $derived(ccus.owned.reduce((m, o) => m.set(copyKey(o), (m.get(copyKey(o)) ?? 0) + 1), new Map<string, number>()));
  const ownedCount = (src: 'hangar' | 'buyback') => ccus.owned.filter((o) => o.source === src).length;
  /** Melt value of the cheapest pledge holding each hull: the source-ship part of a chain's *Already spent*. */
  const sourceValue = $derived.by(() => {
    const m = new Map<number, number>();
    for (const pl of hangar?.pledges ?? []) {
      if (pl.upgrade || !pl.value) continue;
      for (const t of pl.ships) {
        const id = matchShip(t, ships)?.id;
        const v = Math.round(pl.value * 100);
        if (id != null && (!m.has(id) || v < m.get(id)!)) m.set(id, v);
      }
    }
    return m;
  });
  const ownedSorted = $derived(
    sortBy(
      // natural order: cheapest source hull first (ties in a sorted column keep it)
      [...ccus.owned].filter((o) => ownedShow === 'all' || o.source === ownedShow).sort((a, b) => (byId.get(a.fromId)?.msrp ?? 0) - (byId.get(b.fromId)?.msrp ?? 0)),
      ownedSort,
      {
        from: (o) => byId.get(o.fromId)?.msrp ?? 0, // hull price, the order a chain climbs in
        to: (o) => name(o.toId),
        qty: (o) => copies.get(copyKey(o)) ?? 1,
        source: (o) => `${o.source}${o.gifted ? ' gift' : ''}`,
        paid: (o) => (o.source === 'hangar' ? o.value : (o.price ?? null)),
        gain: (o) => gainOf(o),
        reserved: (o) => reservedBy.get(o.ref)?.name ?? '',
        force: (o) => forceOf(o.ref),
      },
    ),
  );
  /** Copies of the same CCU (same hulls, place and price) are one row with a quantity. */
  const ownedGroups = $derived.by(() => {
    const m = new Map<string, { key: string; first: (typeof ownedSorted)[number]; refs: number[] }>();
    for (const o of ownedSorted) {
      const key = copyKey(o);
      const g = m.get(key);
      if (g) g.refs.push(o.ref);
      else m.set(key, { key, first: o, refs: [o.ref] });
    }
    return [...m.values()];
  });
  /** A row's force state: `mixed` when its copies differ. */
  const groupForce = (refs: number[]): 'include' | 'exclude' | '' | 'mixed' => {
    const st = new Set(refs.map(forceOf));
    return st.size > 1 ? 'mixed' : [...st][0]!;
  };
  /** auto → require one copy → keep every copy out → auto (a chain uses a CCU once, so one copy is what "require" means). */
  function cycleGroup(refs: number[]) {
    const f = groupForce(refs);
    const mine = new Set(refs);
    opt.include = opt.include.filter((r) => !mine.has(r));
    opt.exclude = opt.exclude.filter((r) => !mine.has(r));
    if (f === '') opt.include = [...opt.include, refs[0]!];
    else if (f === 'include' || f === 'mixed') opt.exclude = [...opt.exclude, ...refs];
  }
  /** Which chains hold copies of a row, and how many are free: "Arrastra, liby · 1 free". */
  const heldBy = (refs: number[]): string => {
    const names = [...new Set(refs.map((r) => reservedBy.get(r)?.name).filter((n): n is string => !!n))];
    const free = refs.filter((r) => !reservedBy.has(r)).length;
    if (!names.length) return '';
    return refs.length > 1 ? `${names.join(', ')} · ${free} free` : names[0]!;
  };
  const shownExcluded = $derived(ownedSorted.filter((o) => opt.exclude.includes(o.ref)).length);
  const shownForced = $derived(ownedSorted.filter((o) => forceOf(o.ref) !== '').length);
  /** Keep every CCU shown out of the chain / back to auto. */
  function forceShown(to: 'exclude' | '') {
    const refs = new Set(ownedSorted.map((o) => o.ref));
    opt.include = opt.include.filter((r) => !refs.has(r));
    opt.exclude = to === 'exclude' ? [...new Set([...opt.exclude, ...refs])] : opt.exclude.filter((r) => !refs.has(r));
  }
  const OPTIONS: { key: 'warbond' | 'buyback' | 'inStockOnly' | 'storeCredit' | 'excludeGifted' | 'planAhead' | 'lastSeen' | 'useOwned'; label: string; hint?: string }[] = [
    { key: 'useOwned', label: 'Use CCUs I own', hint: 'Off: the route as if you owned no CCU — what it costs bought fresh today, leaving your own CCUs free for other chains. Show other routes always compares the two.' },
    { key: 'warbond', label: 'Warbond CCUs' },
    { key: 'buyback', label: 'Buyback CCUs' },
    { key: 'inStockOnly', label: 'Skip sold-out limited' },
    { key: 'storeCredit', label: 'Pay with store credit' },
    { key: 'excludeGifted', label: 'Exclude gifted CCUs' },
    { key: 'planAhead', label: 'Plan ahead (ships not on sale)', hint: 'Route through hulls nobody sells a CCU to today, at MSRP, to buy when they return (IAE, Invictus, the maker\'s showcase). Save the chain and the Feed tells you when such a CCU is in the store.' },
    { key: 'lastSeen', label: 'Last seen sale prices', hint: 'A step that waits for a sale is priced at the last CCU price RSI+ saw for that hull (warbond included when warbond CCUs are on) instead of MSRP. What the store sells today is always taken at today\'s price.' },
  ];
  /** Headline saving: the MSRP gap minus what is still to pay and what the owned CCUs in the chain cost. */
  const savedReal = $derived(result ? savedVsMsrp(result) : 0);
  const payNow = $derived(result ? result.total - result.later : 0);
  const storeSteps = $derived(addableSteps.filter((s) => s.kind !== 'buyback').length);
  // ---- guided flow: each step judged from the state above (verify, save, cart, hangar reload) ----
  const HANGAR = 'https://robertsspaceindustries.com/account/pledges';
  const guide = $derived.by((): WizardStep[] => {
    const steps = result?.steps ?? [];
    const store = steps.filter((s) => s.kind !== 'owned' && s.kind !== 'buyback' && s.kind !== 'future');
    const waits = steps.filter((s) => s.kind === 'future').length;
    const inCart = store.filter((s) => cart.of(cartKey(s))?.st === 'added').length;
    const allVerified = steps.length > 0 && confirmed === steps.length;
    const savedThis = startId != null && toId != null && chains.some((c) => c.startId === startId && c.targetId === toId);
    const ownedNow = (s: Step) => (s.kind === 'standalone' ? mine.some((m) => m.id === s.toId) : ccus.owned.some((o) => o.source === 'hangar' && o.fromId === s.fromId && o.toId === s.toId));
    const fromPledge = fromId != null && hangar ? hangar.pledges.find((p) => p.ships.some((t) => matchShip(t, ships)?.id === fromId)) : null;
    const order = steps.map((s) => `${name(s.fromId)} → ${name(s.toId)}`).join(' · ');
    return [
      {
        id: 'load',
        title: 'Load the store catalog and your hangar',
        done: !!cat && !!hangar,
        hint: !cat ? 'Fetching the store catalog…' : !hangar ? 'Without the hangar the planner cannot use the CCUs you already own (free steps) or your store credit.' : `${ccus.owned.filter((o) => o.source === 'hangar').length} owned CCUs · ${mine.length} ships`,
        action: !hangar ? { label: hangarLoading ? `Loading page ${hangarLoading.page}${hangarLoading.pages ? ` / ${hangarLoading.pages}` : ''}…` : 'Load hangar', onclick: loadHangarHere, busy: !!hangarLoading } : undefined,
      },
      {
        id: 'route',
        title: 'Pick the source and the target',
        done: !!result,
        hint: result
          ? `${steps.length} steps · pay ${usd(payNow)} now${waits ? ` · ${usd(result.later)} later (${waits} step${waits === 1 ? '' : 's'} wait for a sale)` : ''} · ${usd(savedReal)} under MSRP`
          : 'Source = a ship you own (or buy the cheapest from the store), target = the ship you want. Then pick what to optimise for.',
        warn: startId != null && toId != null && !result ? 'No chain found, not even planning ahead through ships not on sale — allow buyback / warbond CCUs, or pick a cheaper source.' : undefined,
      },
      {
        id: 'verify',
        title: 'Verify every step with RSI',
        done: allVerified,
        hint: 'Asks RSI, step by step, whether it really sells that CCU from that ship and at what price — stock and prices change daily.',
        warn: verified.length && !verifying && confirmed < steps.length ? `${steps.length - confirmed} step${steps.length - confirmed === 1 ? '' : 's'} not confirmed — fix the chain (force-exclude that CCU) before buying.` : undefined,
        action: result ? { label: verifying ? 'Checking with RSI…' : verified.length ? 'Re-check with RSI' : 'Verify chain with RSI', onclick: verifyChain, disabled: verifying || cart.busy, busy: verifying } : undefined,
      },
      {
        id: 'save',
        title: 'Save the chain',
        done: savedThis,
        hint: 'Keeps the step list for applying later and reserves its CCUs so your other chains cannot plan with the same ones.',
        action: result ? { label: openedChain ? 'Update chain' : 'Save chain', onclick: () => saveChain() } : undefined,
      },
      {
        id: 'cart',
        title: 'Add the store steps to your RSI cart',
        done: store.length === 0 ? !!result : inCart === store.length,
        hint: store.length ? `${inCart} / ${store.length} store steps in the cart — nothing is paid here.${waits ? ` ${waits} step${waits === 1 ? '' : 's'} wait for a sale and cannot be added yet.` : ''}` : waits ? 'Nothing to buy today: the remaining steps wait for a sale.' : 'Nothing to buy: every step is a CCU you already own.',
        warn: hasBuyback ? 'A buy-back checks out alone: add it from its row and pay it in a cart of its own.' : undefined,
        action: store.length ? { label: cart.busy ? 'Adding…' : `Add ${storeSteps} store step${storeSteps === 1 ? '' : 's'}`, onclick: addAll, disabled: cart.busy, busy: cart.busy } : undefined,
      },
      {
        id: 'pay',
        title: 'Check out on RSI, then reload the hangar',
        done: store.length === 0 ? !!result : store.every(ownedNow),
        hint: `Pay in the RSI cart (store credit applies there). After a hangar reload the bought CCUs show up as owned and this step ticks itself.${waits ? ' Steps waiting for a sale: save the chain — the Feed alerts you when their CCU is in the store, then re-plan and buy that leg.' : ''}`,
        action: { label: 'Open RSI cart', href: CART_URL },
      },
      {
        id: 'apply',
        title: 'Apply the CCUs in order',
        done: toId != null && mine.some((s) => s.id === toId),
        hint: `In the hangar open the pledge holding the source ship → Upgrade → apply the CCUs one after another, cheapest hull first: ${order || '—'}. Each apply changes that pledge's ship; the next CCU starts from it. Reload the hangar when the target is in.`,
        action: { label: fromPledge ? `Open pledge #${fromPledge.id}` : 'Open hangar', href: fromPledge && hangar ? hangarUrl(hangar.pledges, fromPledge.id) : HANGAR },
      },
    ];
  });
</script>

<div class="grid gap-4">
  <Card.Root>
    <Card.Header>
      <Card.Description>Cheapest path using CCUs on sale now, the CCUs in your hangar (free) and, optionally, buyback. Warbond steps need new money. <em>Plan ahead</em> adds hulls nobody sells a CCU to today (at MSRP, bought when they return) for long-term goals. <em>My chains</em> below holds every ship you are working towards, planned together so no CCU or hull is used twice.</Card.Description>
      <Card.Action class="flex flex-wrap items-center gap-2">
        <CcuTransfer code={routeCode} saved={savedCodes} onopen={applyLink} onadd={importChains} />
      </Card.Action>
    </Card.Header>
    <Card.Content class="grid gap-4">
      {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}

      <Wizard title="Guided CCU chain" steps={guide} storageKey="ccu" doneText="The target ship is in your hangar." />

      <fieldset class="border-border m-0 grid min-w-0 gap-2 rounded-lg border px-3 py-2.5">
        <legend class="text-muted-foreground px-1 text-xs">1 · Optimise for</legend>
        <Segmented options={OBJECTIVES} bind:value={opt.objective} ariaLabel="Optimisation target" />
        <span class="text-muted-foreground text-[11px]">{OBJECTIVES.find((o) => o.id === opt.objective)?.hint}</span>
      </fieldset>

      <fieldset class="border-border m-0 grid min-w-0 gap-2 rounded-lg border px-3 py-2.5">
        <legend class="text-muted-foreground px-1 text-xs">2 · Options</legend>
        {#snippet optRow(o: (typeof OPTIONS)[number])}
          <SwitchRow id={`ccu-opt-${o.key}`} size="sm" label={o.label} hint={o.hint} checked={o.key === 'lastSeen' || o.key === 'useOwned' ? opt[o.key] !== false : !!opt[o.key]} onchange={(v) => (opt[o.key] = v)} />
        {/snippet}
        <!-- Short toggles in an even grid; the options that need a sentence get their own two-column block below. -->
        <div class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-4">
          {#each OPTIONS.filter((o) => !o.hint) as o (o.key)}{@render optRow(o)}{/each}
          <SwitchRow id="ccu-opt-exclude-saved" size="sm" label={`Leave my chains' CCUs alone${chains.length ? ` (${reservedBy.size})` : ''}`} checked={excludeSaved} disabled={!chains.length} onchange={(v) => ((excludeSaved = v), (openedLeg = null))} />
        </div>
        <div class="border-border grid gap-x-6 gap-y-1 border-t pt-2 md:grid-cols-2">
          {#each OPTIONS.filter((o) => o.hint) as o (o.key)}{@render optRow(o)}{/each}
          <SwitchRow id="ccu-opt-steps" size="sm" label="Prefer more steps" hint="When two chains cost the same, show the one with more steps that save money (a CCU you own or one below the MSRP difference): each is a ship you can stop at and fly. A step at the plain MSRP difference saves nothing and is left out. Off: the one with fewer steps." checked={opt.steps === 'more'} onchange={(v) => (opt.steps = v ? 'more' : 'fewer')} />
        </div>
        <span class="text-muted-foreground text-[11px]">
          {hangar ? `${ccus.owned.filter((o) => o.source === 'hangar').length} owned CCUs` : 'Load your hangar to use owned CCUs'}
          {buyback ? ` · ${ccus.owned.filter((o) => o.source === 'buyback').length} buyback CCUs` : ''}
          {creditCents != null ? ` · store credit ${ownUsd(creditCents)}` : ''}
        </span>
        {#if (opt.skip ?? []).length || opt.exclude.length || (opt.noWait ?? []).length}
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-muted-foreground">Ignored</span>
            {#each opt.skip ?? [] as k (k)}
              <Chip removeLabel="Use this offer again" onremove={() => (opt.skip = (opt.skip ?? []).filter((x) => x !== k))}>{skuLabel.get(k) ?? `SKU ${k}`}</Chip>
            {/each}
            {#each opt.noWait ?? [] as h (h)}
              <Chip removeLabel="Wait for this hull again" onremove={() => (opt.noWait = (opt.noWait ?? []).filter((x) => x !== h))}>waiting for {name(h)}</Chip>
            {/each}
            {#each opt.exclude as r (r)}
              <Chip removeLabel="Use this CCU again" onremove={() => (opt.exclude = opt.exclude.filter((x) => x !== r))}>{ownedLabelOf(r)}</Chip>
            {/each}
            <Button variant="link" size="xs" class="h-auto p-0 text-[11px]" onclick={() => ((opt.skip = []), (opt.exclude = []), (opt.noWait = []))}>clear</Button>
          </div>
        {/if}
      </fieldset>

      <div class="flex flex-wrap gap-4">
        <fieldset class="border-border m-0 grid min-w-0 flex-[1_1_300px] gap-2 rounded-lg border px-3 py-2.5">
          <legend class="text-muted-foreground px-1 text-xs">3 · Source</legend>
          <Segmented
            options={[
              { id: 'hangar', label: 'Ship in my hangar' },
              { id: 'store', label: 'Buy from the store', hint: 'No ship to pick: the planner starts from whichever standalone ship on sale makes the cheapest chain' },
              { id: 'any', label: 'Any ship' },
            ]}
            bind:value={mode}
            ariaLabel="Source"
          />
          {#if mode === 'store'}
            <span class="text-muted-foreground text-[11px]">Picked for you: the standalone ship on sale that makes the cheapest chain to the target. A new ship comes with its own insurance (rarely LTI): for an LTI result, start from an LTI ship in your hangar.</span>
          {:else}
            {#if mode === 'hangar'}
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-muted-foreground text-xs">Insurance</span>
                <Segmented
                  options={[
                    { id: 'any', label: 'Any copy', hint: 'Any ship in your hangar' },
                    { id: 'lti', label: `LTI only · ${ltiHulls.length}`, hint: 'Only hulls on an LTI pledge: a CCU keeps the pledge\'s insurance, so the target ends with LTI' },
                  ]}
                  value={ltiOnly ? 'lti' : 'any'}
                  onchange={(v) => (ltiOnly = v === 'lti')}
                  ariaLabel="Source insurance"
                  size="sm"
                />
              </div>
            {/if}
            <ShipSelect {ships} mine={mode === 'hangar' ? mineSrc : mine} bind:value={fromId} onlyMine={mode === 'hangar'} ariaLabel="From ship" placeholder={mode === 'hangar' ? (ltiOnly ? 'Pick an LTI ship you own…' : 'Pick a ship you own…') : 'Pick a ship…'} />
            {#if fromId != null && ltiSet.has(fromId)}
              <span class="text-muted-foreground text-[11px]"><Tag kind="insurance" value="LTI" size="xs" /> You have the {name(fromId)} on an LTI pledge: apply the CCUs to that copy and the {toId != null ? name(toId) : 'target'} keeps LTI.</span>
            {:else if ltiOnly && mode === 'hangar' && !ltiHulls.length}
              <span class="text-muted-foreground text-[11px]">{hangar ? 'No ship on an LTI pledge in your hangar.' : 'Load your hangar to see your LTI ships.'}</span>
            {/if}
          {/if}
        </fieldset>
        <fieldset class="border-border m-0 grid min-w-0 flex-[1_1_300px] gap-2 rounded-lg border px-3 py-2.5">
          <legend class="text-muted-foreground px-1 text-xs">4 · Target</legend>
          <ShipSelect ships={targetable} mine={targetOwned ? mine : []} saleTag bind:value={toId} ariaLabel="Target ship" placeholder="Pick a target…" />
          <SwitchRow id="ccu-target-owned" size="sm" class="text-xs" label="Include ships I own" hint="List the ships already in your hangar too" checked={targetOwned} onchange={(v) => (targetOwned = v)} />
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <LazyTip tip="Hulls the chain must pass through — to fly them for a while on the way to the target">
              {#snippet trigger({ props })}<button type="button" {...props} class="text-muted-foreground cursor-help">Stops</button>{/snippet}
            </LazyTip>
            {#each opt.via ?? [] as v (v)}
              <Chip removeLabel={`Remove stop ${name(v)}`} onremove={() => (opt.via = (opt.via ?? []).filter((x) => x !== v))}>{name(v)}</Chip>
            {/each}
            <div class="w-[200px]"><ShipSelect ships={sortedShips} bind:value={stopPick} price={false} onpick={(id) => (id != null && !(opt.via ?? []).includes(id) && (opt.via = [...(opt.via ?? []), id]), (stopPick = null))} ariaLabel="Add a stop" placeholder="+ ship to fly on the way" /></div>
          </div>
        </fieldset>
      </div>

      {#if undoable.length}
        <div class="border-border bg-muted/30 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-xs" role="status">
          <span>Ignored <strong>{undoable.at(-1)!.label}</strong>{undoable.length > 1 ? ` and ${undoable.length - 1} more` : ''}: the chain is planned without {undoable.length > 1 ? 'them' : 'it'}.</span>
          <Button variant="outline" size="xs" onclick={undoIgnore}>Undo</Button>
          {#if undoable.length > 1}<Button variant="ghost" size="xs" onclick={undoAll}>Undo all</Button>{/if}
          <span class="text-muted-foreground">Everything ignored is listed under Options.</span>
        </div>
      {/if}
      {#if startId != null && toId != null}
        {#if targetPacks.length}
          <Alert.Root>
            <Alert.Description>
              <span><strong>Or buy it now in a pack.</strong> No CCU or standalone to the {name(toId)} is on sale, but {targetPacks.length === 1 ? 'a pack grants it' : `${targetPacks.length} packs grant it`}:</span>
              <ul class="m-0 mt-1 grid list-none gap-0.5 p-0">
                {#each targetPacks.slice(0, 5) as o (o.item.id)}
                  <li>
                    <a href={`#browse?${new URLSearchParams({ item: String(o.item.id), q: o.item.name })}`}>{o.item.name}</a>
                    <span class="tabular-nums">{usd(o.item.discounted)}</span>{#if o.hulls > 1}<span class="text-muted-foreground"> · {o.hulls} hulls</span>{/if}{#if o.share != null && o.share < o.item.discounted}<span class="text-muted-foreground"> · ≈ {usd(o.share)} for the {name(toId)}</span>{/if}{#if o.item.vip}<span class="text-muted-foreground"> · Concierge</span>{/if}{#if o.item.warbond}<span class="text-muted-foreground"> · warbond</span>{/if}
                  </li>
                {/each}
              </ul>
              <span class="text-muted-foreground text-xs">The share splits the pack price by each piece's separate price (MSRP for hulls); you pay the whole pack. From Browse's saved listing.</span>
            </Alert.Description>
          </Alert.Root>
        {/if}
        {#if !result}
          <Alert.Root variant="destructive">
            <Alert.Description>
              No chain found — {mode === 'store' ? 'no standalone ship on sale leads there, ' : ''}the target isn't sold as a CCU right now and you own no CCU leading to it, a forced CCU can't be reached, or
              it's not pricier than the start.
              Ships not on sale were tried too (Plan ahead) — pick a cheaper source or allow buyback / warbond CCUs.
              {#if reach != null}
                <span class="mt-1.5 flex flex-wrap items-center gap-2">The chain can reach {name(reach)} ({usd(byId.get(reach)?.msrp ?? 0)}). <Button variant="outline" size="xs" onclick={() => (toId = reach)}>Plan to {name(reach)} instead</Button></span>
              {/if}
            </Alert.Description>
          </Alert.Root>
        {:else}
          {#if planned.ahead}
            <Alert.Root variant="warning">
              <Alert.Description>
              <strong>Planned ahead.</strong> Nothing on sale today gets to the {name(toId)} — {byId.get(toId)?.msrpSource ? `RSI's upgrade catalog doesn't list it at all (MSRP ${usd(byId.get(toId)?.msrp ?? 0)} from starcitizen.tools; RSI sells it in rare packages / events)` : byId.get(toId)?.ccu.length ? 'its CCUs are sold out or excluded' : 'RSI sells no CCU to it right now'}{byId.get(toId)?.flyable === 'Concept' ? ' (concept ship: CCUs and sales come with events)' : ''}. Steps marked <em>Later</em> are priced at MSRP, to buy when the CCU returns ({seen(toId)}). Save the chain and the Feed tells you when it is in the store.
              </Alert.Description>
            </Alert.Root>
          {/if}
          <StatGrid>
            <Stat value={usd(payNow)} label="to pay now" />
            {#if result.waits}<Stat value={usd(result.later)} label={`later · ${result.waits} step${result.waits === 1 ? '' : 's'} wait for a sale`} tone="accent" />{/if}
            <Stat value={usd(result.cash)} label="new money" />
            {#if cashNeeded != null}<Stat value={ownUsd(cashNeeded)} label="cash after store credit" valueTone={cashNeeded === 0 ? 'ok' : null} />{/if}
            {#if result.paid}<Stat value={ownUsd(result.paid)} label="already paid (owned CCUs)" />{/if}
            <Stat value={usd(result.msrpDiff)} label={mode === 'store' ? 'target MSRP' : 'MSRP difference'} />
            <Stat
              value={usd(savedReal)}
              label="saved vs MSRP"
              valueTone={savedReal > 0 ? 'ok' : savedReal < 0 ? 'err' : null}
              delta={result.msrpDiff > 0
                ? { text: `${savedReal >= 0 ? '▼' : '▲'} ${Math.abs((100 * savedReal) / result.msrpDiff).toFixed(0)}%`, tone: savedReal > 0 ? 'up' : savedReal < 0 ? 'down' : 'neutral' }
                : null}
            />
          </StatGrid>
          <ol class="m-0 grid list-none p-0" aria-label="Chain steps">
            {#each result.steps as s, i (i)}
              {@const a = addable(s, byId)}
              {@const c = cart.of(cartKey(s))}
              {@const done = s.kind === 'owned' || c?.st === 'added'}
              {@const v = verify[cartKey(s)]}
              {@const bad = c?.st === 'error' || v?.st === 'no'}
              <li class="grid grid-cols-[28px_1fr] gap-3">
                <div class="grid grid-rows-[auto_1fr] justify-items-center">
                  <span
                    class={cn(
                      'bg-popover text-foreground border-border grid size-[26px] place-items-center rounded-full border text-xs font-bold transition-colors',
                      done && 'border-success/60 bg-success/15 text-success',
                      (c?.st === 'adding' || v?.st === 'checking') && 'border-primary ring-primary/20 ring-3',
                      bad && 'border-destructive text-destructive',
                    )}>{#if done}<Check class="size-3.5" />{:else if bad}!{:else}{i + 1}{/if}</span
                  >
                  {#if i < result.steps.length - 1}<span class={cn('my-1 min-h-4 w-0.5 rounded-[1px]', done ? 'bg-success/45' : 'from-border to-border/35 bg-linear-to-b')}></span>{/if}
                </div>
                <div class="min-w-0 pt-0.5 pb-4">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-1.5 text-sm">
                      {#if s.fromId !== STORE_START}<span class="text-muted-foreground">{name(s.fromId)}</span> <span class="text-muted-foreground">→</span> {/if}<strong>{name(s.toId)}</strong>
                      <Badge variant={kindVariant(s.kind)}>{KIND[s.kind]}</Badge>
                      {#if s.label && s.kind !== 'owned' && s.kind !== 'buyback' && s.kind !== 'future'}<span class="text-muted-foreground text-[11px]">{s.label}</span>{/if}
                      {#if s.kind === 'future'}<span class="text-muted-foreground text-[11px]">{s.est ? `priced at the last ${s.est.wb ? 'warbond ' : ''}sale price seen, ${fmtDate(s.est.at)}` : seen(s.toId)}</span>{/if}
                      {#if v?.st === 'checking'}<Badge variant="secondary" class="text-muted-foreground">checking…</Badge>
                      {:else if v?.st === 'wait'}<Badge variant="warning-soft">waits for a sale</Badge>
                      {:else if v?.st === 'ok'}<Badge variant="success-soft"><Check />RSI confirmed{v.note ? ` · ${v.note}` : ''}</Badge>
                      {:else if v?.st === 'price'}<Badge variant="warning-soft"><TriangleAlert />RSI price {usd(v.price)}</Badge>
                      {:else if v?.st === 'no'}<Badge variant="destructive"><X />{v.why}</Badge>
                      {:else if v?.st === 'error'}<HintBadge variant="destructive" hint={v.msg}>? could not check</HintBadge>{/if}
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5">
                      {#if a.kind === 'none'}
                        {#if s.kind !== 'owned'}<span class="text-muted-foreground text-[11px]">{a.why}</span>{/if}
                      {:else if c?.st === 'adding'}
                        <span class="text-muted-foreground text-[11px]">Adding…</span>
                      {:else if c?.st === 'added'}
                        <Badge variant="success-soft"><ShoppingCart />In cart{c.price != null && c.price !== s.cost ? ` · RSI says ${usd(c.price)}` : ''}</Badge>
                      {:else}
                        <CartButton
                          text
                          state={c}
                          inCart={cart.qtyOf(skuOfStep(s))}
                          busy={cart.busy}
                          onadd={() => addOne(s)}
                          label={s.kind === 'buyback' ? 'Add buy-back' : 'Add to cart'}
                          hint={s.kind === 'buyback' ? 'Buy-backs check out alone: one per cart, nothing else in it.' : 'Adds this CCU to your RSI cart (nothing is paid)'}
                        />
                      {/if}
                      {#if canIgnore(s)}
                        <TipButton variant="ghost" size="icon-xs" class="text-muted-foreground size-6" onclick={() => ignoreStep(s)} tip={s.kind === 'future' ? 'Skip this step: plan the chain without waiting for this hull (Undo appears above the chain)' : 'Ignore this step: plan the chain without this CCU (Undo appears above the chain)'} aria-label={`Ignore ${name(s.fromId)} → ${name(s.toId)}`}><Ban class="size-3.5" /></TipButton>
                      {/if}
                      {#if link(s)}
                        <Button variant="ghost" size="xs" href={link(s)} target="_blank" rel="noopener">{s.kind === 'owned' ? 'Hangar' : s.kind === 'buyback' ? 'Buy back' : s.kind === 'standalone' || s.kind === 'future' ? 'Store' : 'Upgrades'} <ExternalLink /></Button>
                      {/if}
                    </div>
                  </div>
                  {#if c?.st === 'error'}<div class="text-destructive mt-1 text-[11px]">{c.msg}</div>{/if}
                  <dl class="mt-1.5 mb-0 flex flex-wrap gap-x-[18px] gap-y-1.5">
                    {#each figures(s, i) as m (m.dt)}
                      <div class="flex items-baseline gap-1.5">
                        <dt class="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">{m.dt}</dt>
                        <dd class={cn('m-0 tabular-nums', m.cls)}>{m.dd}</dd>
                      </div>
                    {/each}
                  </dl>
                </div>
              </li>
            {/each}
          </ol>
          <CcuAlternatives {ships} owned={ccus.owned} {startId} targetId={toId} opt={used} best={result} onuse={(a) => Object.assign(opt, applyAlternative(opt, a))} />
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <TipButton variant="outline" size="sm" disabled={verifying || cart.busy} onclick={verifyChain} tip="Asks RSI, step by step, whether it sells each CCU from that ship and at what price. Read-only.">
                {verifying ? 'Checking with RSI…' : verified.length ? 'Re-check with RSI' : 'Verify chain with RSI'}
              </TipButton>
              {#if verified.length && !verifying}
                <Badge variant={confirmed === result.steps.length ? 'success-soft' : 'warning-soft'}>{confirmed}/{result.steps.length} steps confirmed</Badge>
              {/if}
              {#if storeSteps > 0}
                <Button size="sm" disabled={cart.busy} onclick={addAll}><ShoppingCart />{cart.busy ? 'Adding…' : `Add ${storeSteps} store step${storeSteps === 1 ? '' : 's'} to RSI cart`}</Button>
              {/if}
              <OpenCartButton always size="sm" count={cart.added} total={cart.snapshot?.qty ?? null} />
              <span class="text-muted-foreground text-[11px]">
                Lines are added to your RSI cart in your signed-in session; nothing is paid here. Check the cart before checkout.
                {#if hasBuyback} A buy-back must be the only line in the cart — add it separately and check it out alone.{/if}
              </span>
            </div>
            <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), saveChain())}>
              <Input class="w-52" placeholder="Chain name (optional)" bind:value={chainName} aria-label="Chain name" />
              <TipButton variant="outline" size="sm" type="submit" tip={openedChain ? `Keeps these options and stops for “${openedChain.name}” in My chains (its priority stays)` : 'Adds this chain to My chains, at the end of the list (lowest priority)'}>{openedChain ? 'Update chain' : 'Save chain'}</TipButton>
              {#if openedChain}<TipButton variant="outline" size="sm" type="button" onclick={() => saveChain(true)} tip="Adds it to My chains as another chain instead of changing the opened one">Save as new</TipButton>{/if}
              {#if saved.text}<span class="text-success text-[11px]">Saved “{saved.text}”</span>{/if}
            </form>
          </div>
          <span class="text-muted-foreground text-[11px]">Or buy by hand on the RSI <a class={LINK} href={UPGRADES} target="_blank" rel="noopener">ship upgrades page</a>. Prices change during sales — refresh in Store.</span>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Content>
      <Section id="ccu-cart" title="RSI cart" summary={cart.snapshot ? `(${cart.snapshot.qty} item${cart.snapshot.qty === 1 ? '' : 's'} · ${usd(cart.snapshot.total)})` : '(not read)'} defaultOpen={false}>
        <CartView {cart} />
      </Section>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Content>
      <CcuChains
        {ships}
        {mine}
        {hulls}
        {labelPrefer}
        keptByLabel={keepIds.size}
        lti={ltiHulls}
        owned={ccus.owned}
        pledges={hangar?.pledges ?? []}
        {sales}
        {chains}
        {persist}
        loaded={chainsLoaded && ships.length > 0}
        ready={plansReady}
        {persistPlans}
        {sourceValue}
        {cart}
        {lineOf}
        {addLines}
        onopen={openChain}
        onlink={applyLink}
        onimport={importChains}
      />
    </Card.Content>
  </Card.Root>

  {#if ccus.owned.length}
    <Card.Root>
      <Card.Content>
        <Section id="ccu-owned" title="Your CCUs" summary={`(${ccus.owned.length})`}>
            <p class="text-muted-foreground m-0 text-sm">Copies of the same CCU share a row. Click <em>Force</em> to require a CCU in the chain (include), click again to keep it out (exclude), again to reset. Click a column to sort.</p>
            <div class="flex flex-wrap items-center gap-2">
              <Segmented
                options={[
                  { id: 'all', label: `All · ${ccus.owned.length}` },
                  { id: 'hangar', label: `Hangar · ${ownedCount('hangar')}` },
                  { id: 'buyback', label: `Buyback · ${ownedCount('buyback')}` },
                ]}
                bind:value={ownedShow}
                ariaLabel="Show CCUs"
                size="sm"
              />
              {#snippet what()}{ownedShow === 'all' ? 'all' : `all ${ownedShow}`}{/snippet}
              <TipButton variant="outline" size="sm" disabled={!ownedSorted.length || shownExcluded === ownedSorted.length} onclick={() => forceShown('exclude')} tip="Keep every CCU listed below out of the chain">Exclude {@render what()} ({ownedSorted.length})</TipButton>
              <TipButton variant="outline" size="sm" disabled={!shownForced} onclick={() => forceShown('')} tip="Set every CCU listed below back to auto">Reset {@render what()}</TipButton>
              {#if shownForced}<span class="text-muted-foreground text-[11px]">{shownExcluded} excluded · {shownForced - shownExcluded} required</span>{/if}
            </div>
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <SortTh key="from" bind:sort={ownedSort}>From</SortTh>
                  <SortTh key="to" bind:sort={ownedSort}>→ To</SortTh>
                  <SortTh key="qty" bind:sort={ownedSort} firstDir="desc" numeric>Qty</SortTh>
                  <SortTh key="source" bind:sort={ownedSort}>Source</SortTh>
                  <SortTh key="paid" bind:sort={ownedSort} firstDir="desc" numeric>Paid / buy-back</SortTh>
                  <SortTh key="gain" bind:sort={ownedSort} firstDir="desc" numeric>Upgrade value</SortTh>
                  <SortTh key="reserved" bind:sort={ownedSort}>Reserved by</SortTh>
                  <SortTh key="force" bind:sort={ownedSort} firstDir="desc">Force</SortTh>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each ownedGroups as g (g.key)}
                  {@const o = g.first}
                  {@const gain = gainOf(o)}
                  {@const f = groupForce(g.refs)}
                  {@const cost = o.source === 'hangar' ? o.value : (o.price ?? 0)}
                  <Table.Row>
                    <Table.Cell class="text-muted-foreground">{name(o.fromId)}</Table.Cell>
                    <Table.Cell><strong>{name(o.toId)}</strong></Table.Cell>
                    <Table.Cell class="text-right tabular-nums">{#if g.refs.length > 1}<strong>×{g.refs.length}</strong>{:else}<span class="text-muted-foreground">1</span>{/if}</Table.Cell>
                    <Table.Cell>{o.source}{o.gifted ? ' · gift' : ''}</Table.Cell>
                    <Table.Cell class="text-right tabular-nums">
                      {#if o.source === 'hangar'}{o.value ? ownUsd(o.value) : '—'}{#if g.refs.length > 1 && o.value}<span class="text-muted-foreground ml-1 text-[11px]">each</span>{/if}
                      {:else if o.price != null}{usd(o.price)}<span class="text-muted-foreground ml-1 text-[11px]">to buy back</span>
                      {:else}<HintBadge variant="muted" size="xs" hint="RSI shows a buy-back's price only on its own page. Open the Buyback page and use “Load contents & prices”; until then the planner assumes the MSRP difference.">?</HintBadge>{/if}
                    </Table.Cell>
                    <Table.Cell class={cn('text-right tabular-nums', cost > 0 && gain > cost && 'text-success')}>{usd(gain)}</Table.Cell>
                    <Table.Cell class="text-[11px] whitespace-normal">{heldBy(g.refs)}</Table.Cell>
                    <Table.Cell>
                      <TipButton variant="outline" size="xs" class={cn('min-w-16', f === 'include' && 'text-success', f === 'exclude' && 'text-destructive')} onclick={() => cycleGroup(g.refs)} tip={g.refs.length > 1 ? 'auto → require one copy in the chain → keep every copy out → auto' : 'auto → require it in the chain → keep it out → auto'}>{f === 'include' && g.refs.length > 1 ? 'include 1' : f || 'auto'}</TipButton>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
        </Section>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if ccus.unmapped.length}
    <Card.Root>
      <Card.Content>
        <Section id="ccu-unmapped" title="CCUs not matched to a ship" summary={`(${ccus.unmapped.length})`}>
          <p class="text-muted-foreground m-0 text-sm">Ignored by the planner (name didn't match a store ship).</p>
          <div class="flex flex-wrap gap-1.5">
            {#each ccus.unmapped as u, i (i)}<Badge variant="secondary">{u.name} · {u.source}</Badge>{/each}
          </div>
        </Section>
      </Card.Content>
    </Card.Root>
  {/if}
</div>

