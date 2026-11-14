<script lang="ts">
  import { addable, addStep, batchPlan, CART_URL, verifyUpgrade, type WantedLine } from '@/lib/cart';
  import { createCartLedger } from '@/lib/cart-ui.svelte';
  import { transient } from '@/lib/flash.svelte';
  import { lastSaleLabel, shipName, uid } from '@/lib/ccu-ui';
  import { applyAlternative, DEFAULT_PLAN_OPTIONS, savedVsMsrp, farthestReachable, ownedCcus, ownedHulls, excludeReserved, ownedShips, plan, planGraph, plannerExclude, reservedRefs, STORE_START, type Objective, type OpenedLeg, type PlanOptions, type SavedChain, type Step } from '@/lib/ccu';
  import { hangarUrl } from '@/lib/hangar';
  import { bg } from '@/lib/messages';
  import { buybackItem, catalogItem, ccuChainsItem, ccuGoalsItem, hangarItem, pledgeLabelsItem, priceHistoryItem, saleHistoryItem } from '@/lib/settings';
  import { withArchive, withExpected, type PriceHistory } from '@/lib/price-history';
  import { cleanLabels, idsWith, KEEP, PREFER, type Labels } from '@/lib/labels';
  import { refreshHangar, type HangarProgress } from '@/lib/hangar-refresh';
  import { matchShip, usd, type Catalog, type SaleHistory } from '@/lib/store';
  import { ownUsd } from '@/lib/privacy.svelte';
  import Wizard, { type WizardStep } from './Wizard.svelte';
  import Segmented from './Segmented.svelte';
  import ShipSelect from './ShipSelect.svelte';
  import Stat from './Stat.svelte';
  import CcuFleet from './CcuFleet.svelte';
  import CcuAlternatives from './CcuAlternatives.svelte';
  import CcuTransfer from './CcuTransfer.svelte';
  import { ccuCodesText, encodeCcuLink, linkToPlanner, watchCcuLink, type CcuLink } from '@/lib/ccu-link';
  import { dateStamp, downloadFile } from '@/lib/download';
  import Copy from '@lucide/svelte/icons/copy';
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
  import ConfirmButton from './ConfirmButton.svelte';
  import * as Alert from '@/components/ui/alert';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import { Badge, type BadgeVariant } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Checkbox } from '@/components/ui/checkbox';
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

  type Mode = 'store' | 'hangar' | 'any';
  let mode = $state<Mode>('hangar');
  let fromId = $state<number | null>(null);
  let toId = $state<number | null>(null); // set from the hash link (`#ccu?to=`, watchCcuLink below)
  let opt = $state<PlanOptions>({ ...DEFAULT_PLAN_OPTIONS, include: [], exclude: [], via: [], skip: [] });
  /** One chain (verify, cart) or a fleet plan (several goals at once, `CcuFleet`). */
  let planner = $state<'one' | 'fleet'>((() => {
    try {
      return localStorage.getItem('rsiplus:ccu:planner') === 'fleet' ? 'fleet' : 'one';
    } catch {
      return 'one';
    }
  })());
  $effect(() => {
    try {
      localStorage.setItem('rsiplus:ccu:planner', planner);
    } catch {
      /* no persistence — fine */
    }
  });
  let excludeSaved = $state(true);
  /** Fleet goal opened here (`openGoal`); its exclusions stay out of `opt`, which `CcuFleet` plans with too. */
  let openedLeg = $state<OpenedLeg | null>(null);
  let chainName = $state('');
  /** Name of the chain just saved, shown for a moment. */
  const saved = transient(2500);

  $effect(() => {
    hangarItem.getValue().then((h) => (hangar = h));
    buybackItem.getValue().then((b) => (buyback = b));
    catalogItem.getValue().then((c) => (cat = c));
    ccuChainsItem.getValue().then((c) => (chains = c));
    saleHistoryItem.getValue().then((h) => (sales = h));
    priceHistoryItem.getValue().then(async (h) => (prices = await withArchive(h)));
    pledgeLabelsItem.getValue().then((l) => (labels = cleanLabels(l)));
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch((e) => (error = (e as Error).message));
    const offs = [hangarItem.watch((h) => (hangar = h)), pledgeLabelsItem.watch((l) => (labels = cleanLabels(l)))];
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
    if (r.toId != null) (toId = r.toId), (planner = 'one');
    Object.assign(opt, r.opt);
    if (l.name) chainName = l.name;
    openedLeg = null;
  }
  /** Hull copies a fleet plan may upgrade: pledges labelled *Keep* are left out (`lib/labels.ts`). */
  const keepIds = $derived(idsWith(labels, KEEP));
  const hulls = $derived(ownedHulls((hangar?.pledges ?? []).filter((p) => !keepIds.has(p.id)), ships));
  /** Hulls on pledges labelled *LTI token* / *CCU fodder*: Auto upgrades them first. */
  const labelPrefer = $derived(ownedHulls((hangar?.pledges ?? []).filter((p) => idsWith(labels, PREFER).has(p.id)), ships).map((h) => h.id));
  /** Hulls on LTI pledges (LTI tokens): one click to prefer them in a fleet plan. */
  const ltiHulls = $derived(ownedHulls((hangar?.pledges ?? []).filter((p) => p.lti), ships).map((h) => h.id));
  let stopPick = $state<number | null>(null);
  /** The target picker hides ships you already own unless asked. */
  let targetOwned = $state(false);
  const targetable = $derived(targetOwned ? ships : ships.filter((s) => !mine.some((m) => m.id === s.id) || s.id === toId));
  const sortedShips = $derived([...ships].sort((a, b) => a.name.localeCompare(b.name)));
  const ccus = $derived(ownedCcus(hangar?.pledges ?? [], buyback?.items ?? [], ships));
  const buybackUrl = $derived(new Map((buyback?.items ?? []).map((b) => [b.id, b.url])));

  /** Which saved chain holds each CCU ref. */
  const reservedBy = $derived(new Map(chains.flatMap((c) => reservedRefs([c]).map((r) => [r, c] as const))));
  const startId = $derived(mode === 'store' ? STORE_START : fromId);
  // A chain saved for this very route keeps its CCUs: saving must not re-plan the chain on screen without them.
  const effective = $derived<PlanOptions>({ ...opt, exclude: plannerExclude(opt.exclude, chains, excludeSaved, startId, toId, openedLeg) });
  // The opened leg ends when the route changes or the fleet plan is back on screen.
  $effect(() => {
    if (openedLeg && (planner === 'fleet' || openedLeg.startId !== startId || openedLeg.targetId !== toId)) openedLeg = null;
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
  const canIgnore = (s: Step) => ((s.kind === 'owned' || s.kind === 'buyback') && s.ref != null) || (s.kind !== 'future' && s.kind !== 'owned' && s.kind !== 'buyback' && s.skuId != null);
  function ignoreStep(s: Step) {
    if ((s.kind === 'owned' || s.kind === 'buyback') && s.ref != null) {
      const ref = s.ref;
      opt.include = opt.include.filter((r) => r !== ref);
      if (!opt.exclude.includes(ref)) opt.exclude = [...opt.exclude, ref];
    } else if (s.skuId != null && !(opt.skip ?? []).includes(s.skuId)) opt.skip = [...(opt.skip ?? []), s.skuId];
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
    return { saved, pct: Math.round((100 * savedReal) / gap) };
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
  async function saveChain() {
    if (!result || startId == null || toId == null) return;
    const c: SavedChain = {
      id: uid(),
      name: chainName.trim() || `${name(startId)} → ${name(toId)}`,
      at: Date.now(),
      startId,
      targetId: toId,
      steps: $state.snapshot(result.steps),
      total: result.total,
      cash: result.cash,
      opt: $state.snapshot(used),
    };
    await persist([...chains, c]);
    chainName = '';
    saved.show(c.name);
  }
  // ---- export / import as text (`CcuTransfer`): the route on screen and the saved chains as codes ----
  const routeCode = $derived(toId != null ? encodeCcuLink({ from: startId, to: toId, via: opt.via, opt, name: chainName }) : null);
  const savedCodes = $derived(chains.map((c) => codeOf(c)));
  /** Imported codes → saved chains, each planned now on this hangar and today's store (other saved chains' CCUs left alone). */
  async function importChains(links: CcuLink[]): Promise<{ added: number; failed: number }> {
    const next = [...$state.snapshot(chains)] as SavedChain[];
    let failed = 0;
    for (const l of links) {
      const r = linkToPlanner(l, (id) => byId.has(id), (id) => mine.some((m) => m.id === id));
      const start = r.mode === 'store' ? STORE_START : (r.fromId ?? null);
      if (start == null || r.toId == null) {
        failed++;
        continue;
      }
      const o: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, ...r.opt, include: [], skip: [], exclude: [], via: r.opt.via ?? [] };
      const p = plan(ships, ccus.owned, start, r.toId, { ...o, exclude: reservedRefs(next) }) ?? plan(ships, ccus.owned, start, r.toId, { ...o, planAhead: true, exclude: reservedRefs(next) });
      if (!p) {
        failed++;
        continue;
      }
      next.push({ id: uid(), name: l.name || `${name(start)} → ${name(r.toId)}`, at: Date.now(), startId: start, targetId: r.toId, steps: p.steps, total: p.total, cash: p.cash, opt: p.waits ? { ...o, planAhead: true } : o });
    }
    if (next.length !== chains.length) await persist(next);
    return { added: next.length - chains.length, failed };
  }
  /** Saved chains → codes: the ticked ones, or all of them when none is ticked. */
  const codeOf = (c: SavedChain) => encodeCcuLink({ from: c.startId, to: c.targetId, via: c.opt.via, opt: c.opt, name: c.name });
  const exported = transient(2500);
  async function copyCodes(list: SavedChain[]) {
    try {
      await navigator.clipboard.writeText(ccuCodesText(list.map(codeOf)));
      exported.show(list.length === 1 ? `Copied “${list[0]!.name}”` : `Copied ${list.length} chains`);
    } catch {
      exported.show('Could not copy: use Download instead');
    }
  }
  const downloadCodes = () => downloadFile(`rsi-plus-ccu-chains-${dateStamp()}.txt`, ccuCodesText(exportRows.map(codeOf)), 'text/plain');
  function loadChain(c: SavedChain) {
    mode = c.startId === STORE_START ? 'store' : mine.some((s) => s.id === c.startId) ? 'hangar' : 'any';
    fromId = c.startId === STORE_START ? null : c.startId;
    toId = c.targetId;
    opt = { ...DEFAULT_PLAN_OPTIONS, ...c.opt, include: [...c.opt.include], exclude: [...c.opt.exclude], via: [...(c.opt.via ?? [])], skip: [...(c.opt.skip ?? [])] };
    excludeSaved = false;
    openedLeg = null;
    planner = 'one';
  }
  /** This chain's source / target / stops as a new fleet-plan goal (last = lowest priority). */
  const addedToFleet = transient(4000);
  async function addToFleet() {
    if (startId == null || toId == null) return;
    const v = await ccuGoalsItem.getValue();
    const goal = { id: uid(), fromId: startId, targetId: toId, via: [...(opt.via ?? [])], storeStart: false, lti: 'any' as const };
    await ccuGoalsItem.setValue({ ...v, goals: [...v.goals, goal] });
    addedToFleet.show('Added');
  }
  /**
   * A fleet goal → the single planner (same options; verify + cart live there). `exclude` is what the fleet planned
   * that leg with (saved chains, the goals above it), so the chain shown is the leg's, not one using their CCUs. It goes
   * in `openedLeg`, not `opt` / `excludeSaved`, which the fleet plan shares.
   */
  function openGoal(start: number, target: number, via: number[], exclude: number[]) {
    mode = start === STORE_START ? 'store' : mine.some((s) => s.id === start) ? 'hangar' : 'any';
    fromId = start === STORE_START ? null : start;
    toId = target;
    opt.via = [...via];
    opt.include = [];
    openedLeg = { startId: start, targetId: target, exclude: [...exclude] };
    planner = 'one';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  /** What the same chain settings cost today (other saved chains' CCUs excluded, this one's own allowed). */
  function now(c: SavedChain) {
    return plan(ships, ccus.owned, c.startId, c.targetId, { ...c.opt, exclude: excludeReserved(c.opt.exclude, chains, (x) => x.id === c.id) });
  }
  /** Saved chains (grouped) with today's price, planned once per change instead of per render. */
  const savedRows = $derived([...chains].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '')).map((c) => ({ c, p: now(c) })));
  // ---- several saved chains → the cart in one go (each chain as it prices today) ----
  let pick = $state(new Set<string>());
  const exportRows = $derived(pick.size ? chains.filter((c) => pick.has(c.id)) : chains);
  const togglePick = (id: string, on: boolean) => (pick = new Set(on ? [...pick, id] : [...pick].filter((x) => x !== id)));
  const chainLines = (c: SavedChain, p: ReturnType<typeof plan>) => (p?.steps ?? []).map((s) => lineOf(s, `chain:${c.id}:`)).filter((l): l is BatchLine => !!l);
  const pickedRows = $derived(savedRows.filter((r) => pick.has(r.c.id) && r.p));
  const pickedLines = $derived(pickedRows.flatMap((r) => chainLines(r.c, r.p)));
  let batchNote = $state('');
  async function addChains() {
    if (cart.busy || !pickedLines.length) return;
    batchNote = '';
    const r = await addLines(pickedLines);
    const buybacks = pickedRows.reduce((n, x) => n + (x.p?.steps ?? []).filter((s) => s.kind === 'buyback').length, 0);
    batchNote = [
      `${r.added} added`,
      r.held ? `${r.held} already in the cart` : '',
      r.limit ? `${r.limit} refused as a second copy (RSI takes some CCUs once per cart): check out, then add again` : '',
      r.failed ? `${r.failed} failed (see the chain)` : '',
      buybacks ? `${buybacks} buy-back${buybacks === 1 ? '' : 's'} left out (each checks out alone)` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  /** A saved chain's lines in the cart ledger: how many are in, and what went wrong. */
  const chainCart = (c: SavedChain, p: ReturnType<typeof plan>) => {
    const lines = chainLines(c, p);
    const st = lines.map((l) => cart.of(l.key));
    return { total: lines.length, inCart: st.filter((x) => x?.st === 'added').length, adding: st.some((x) => x?.st === 'adding'), errors: lines.flatMap((l) => { const x = cart.of(l.key); return x?.st === 'error' ? [`${name(l.step.fromId)} → ${name(l.step.toId)}: ${x.msg}`] : []; }) };
  };
  // ---- Your CCUs: show hangar / buyback, sort by any column, exclude or reset everything shown ----
  type OwnedCol = 'from' | 'to' | 'source' | 'paid' | 'gain' | 'reserved' | 'force';
  let ownedSort = $state<SortState<OwnedCol>>({ key: 'from', dir: 'asc' });
  let ownedShow = $state<'all' | 'hangar' | 'buyback'>('all');
  const gainOf = (o: { fromId: number; toId: number }) => (byId.get(o.toId)?.msrp ?? 0) - (byId.get(o.fromId)?.msrp ?? 0);
  const ownedCount = (src: 'hangar' | 'buyback') => ccus.owned.filter((o) => o.source === src).length;
  /**
   * What a saved chain has already cost you: the CCUs of yours it uses (what you paid for them) and the pledge holding
   * its source ship (the cheapest one when you have several). Today's plan when the chain still works, else as saved.
   */
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
  const spentOn = (c: SavedChain, p: ReturnType<typeof plan>) => {
    const ccu = p ? p.paid : c.steps.reduce((n, st) => n + st.paid, 0);
    const ship = c.startId === STORE_START ? 0 : (sourceValue.get(c.startId) ?? 0);
    return { ccu, ship, total: ccu + ship };
  };
  const ownedSorted = $derived(
    sortBy(
      // natural order: cheapest source hull first (ties in a sorted column keep it)
      [...ccus.owned].filter((o) => ownedShow === 'all' || o.source === ownedShow).sort((a, b) => (byId.get(a.fromId)?.msrp ?? 0) - (byId.get(b.fromId)?.msrp ?? 0)),
      ownedSort,
      {
        from: (o) => byId.get(o.fromId)?.msrp ?? 0, // hull price, the order a chain climbs in
        to: (o) => name(o.toId),
        source: (o) => `${o.source}${o.gifted ? ' gift' : ''}`,
        paid: (o) => (o.source === 'hangar' ? o.value : (o.price ?? null)),
        gain: (o) => gainOf(o),
        reserved: (o) => reservedBy.get(o.ref)?.name ?? '',
        force: (o) => forceOf(o.ref),
      },
    ),
  );
  const shownExcluded = $derived(ownedSorted.filter((o) => opt.exclude.includes(o.ref)).length);
  const shownForced = $derived(ownedSorted.filter((o) => forceOf(o.ref) !== '').length);
  /** Keep every CCU shown out of the chain / back to auto. */
  function forceShown(to: 'exclude' | '') {
    const refs = new Set(ownedSorted.map((o) => o.ref));
    opt.include = opt.include.filter((r) => !refs.has(r));
    opt.exclude = to === 'exclude' ? [...new Set([...opt.exclude, ...refs])] : opt.exclude.filter((r) => !refs.has(r));
  }
  const OPTIONS: { key: 'warbond' | 'buyback' | 'inStockOnly' | 'storeCredit' | 'excludeGifted' | 'planAhead' | 'lastSeen'; label: string; hint?: string }[] = [
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
        action: result ? { label: 'Save chain', onclick: saveChain } : undefined,
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
  const changed = (c: SavedChain, p: ReturnType<typeof plan>) =>
    !p || p.total !== c.total || p.steps.length !== c.steps.length || p.steps.some((s, i) => s.toId !== c.steps[i]?.toId || s.kind !== c.steps[i]?.kind);
</script>

<div class="grid gap-4">
  <Card.Root>
    <Card.Header>
      <Card.Description>Cheapest path using CCUs on sale now, the CCUs in your hangar (free) and, optionally, buyback. Warbond steps need new money. <em>Plan ahead</em> adds hulls nobody sells a CCU to today (at MSRP, bought when they return) for long-term goals. <em>Fleet plan</em> plans several ships at once without using a CCU or hull twice.</Card.Description>
      <Card.Action class="flex flex-wrap items-center gap-2">
        <CcuTransfer code={planner === 'one' ? routeCode : null} saved={savedCodes} onopen={applyLink} onadd={importChains} />
        <Segmented
          options={[
            { id: 'one', label: 'One chain', hint: 'One source → one target: verify with RSI, add to cart' },
            { id: 'fleet', label: 'Fleet plan', hint: 'Several goals at once, near-term and long-term, sharing your CCUs and hulls' },
          ]}
          bind:value={planner}
          ariaLabel="Planner"
          size="sm"
        />
      </Card.Action>
    </Card.Header>
    <Card.Content class="grid gap-4">
      {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}

      {#if planner === 'one'}<Wizard title="Guided CCU chain" steps={guide} storageKey="ccu" doneText="The target ship is in your hangar." />{/if}

      <fieldset class="border-border m-0 grid min-w-0 gap-2 rounded-lg border px-3 py-2.5">
        <legend class="text-muted-foreground px-1 text-xs">1 · Optimise for</legend>
        <Segmented options={OBJECTIVES} bind:value={opt.objective} ariaLabel="Optimisation target" />
        <span class="text-muted-foreground text-[11px]">{OBJECTIVES.find((o) => o.id === opt.objective)?.hint}</span>
      </fieldset>

      <fieldset class="border-border m-0 grid min-w-0 gap-2 rounded-lg border px-3 py-2.5">
        <legend class="text-muted-foreground px-1 text-xs">2 · Options</legend>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          {#each OPTIONS as o (o.key)}
            <SwitchRow id={`ccu-opt-${o.key}`} size="sm" label={o.label} hint={o.hint} checked={o.key === 'lastSeen' ? opt.lastSeen !== false : !!opt[o.key]} onchange={(v) => (opt[o.key] = v)} />
          {/each}
          <SwitchRow id="ccu-opt-steps" size="sm" label="Prefer more steps" hint="When two chains cost the same, show the one with more steps: each extra step is a ship you can stop at and fly. Off: the one with fewer steps." checked={opt.steps === 'more'} onchange={(v) => (opt.steps = v ? 'more' : 'fewer')} />
          <SwitchRow id="ccu-opt-exclude-saved" size="sm" label={`Exclude saved chains${chains.length ? ` (${reservedBy.size} CCUs)` : ''}`} checked={excludeSaved} disabled={!chains.length} onchange={(v) => ((excludeSaved = v), (openedLeg = null))} />
        </div>
        <span class="text-muted-foreground text-[11px]">
          {hangar ? `${ccus.owned.filter((o) => o.source === 'hangar').length} owned CCUs` : 'Load your hangar to use owned CCUs'}
          {buyback ? ` · ${ccus.owned.filter((o) => o.source === 'buyback').length} buyback CCUs` : ''}
          {creditCents != null ? ` · store credit ${ownUsd(creditCents)}` : ''}
        </span>
        {#if (opt.skip ?? []).length || opt.exclude.length}
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-muted-foreground">Ignored</span>
            {#each opt.skip ?? [] as k (k)}
              <Chip removeLabel="Use this offer again" onremove={() => (opt.skip = (opt.skip ?? []).filter((x) => x !== k))}>{skuLabel.get(k) ?? `SKU ${k}`}</Chip>
            {/each}
            {#each opt.exclude as r (r)}
              <Chip removeLabel="Use this CCU again" onremove={() => (opt.exclude = opt.exclude.filter((x) => x !== r))}>{ownedLabelOf(r)}</Chip>
            {/each}
            <Button variant="link" size="xs" class="h-auto p-0 text-[11px]" onclick={() => ((opt.skip = []), (opt.exclude = []))}>clear</Button>
          </div>
        {/if}
      </fieldset>

      {#if planner === 'fleet'}
        <CcuFleet {ships} {mine} {hulls} {labelPrefer} keptByLabel={keepIds.size} lti={ltiHulls} owned={ccus.owned} {opt} {excludeSaved} {sales} {chains} {persist} onopen={openGoal} />
      {:else}
      <div class="flex flex-wrap gap-4">
        <fieldset class="border-border m-0 grid min-w-0 flex-[1_1_300px] gap-2 rounded-lg border px-3 py-2.5">
          <legend class="text-muted-foreground px-1 text-xs">3 · Source</legend>
          <Segmented
            options={[
              { id: 'hangar', label: 'Ship in my hangar' },
              { id: 'store', label: 'Buy from the store', hint: 'Start by buying the cheapest standalone ship on sale' },
              { id: 'any', label: 'Any ship' },
            ]}
            bind:value={mode}
            ariaLabel="Source"
          />
          {#if mode === 'store'}
            <span class="text-muted-foreground text-[11px]">Picks the cheapest standalone ship on sale to start from.</span>
          {:else}
            <ShipSelect {ships} {mine} bind:value={fromId} onlyMine={mode === 'hangar'} ariaLabel="From ship" placeholder={mode === 'hangar' ? 'Pick a ship you own…' : 'Pick a ship…'} />
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

      {#if startId != null && toId != null}
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
                        <TipButton variant="ghost" size="icon-xs" class="text-muted-foreground size-6" onclick={() => ignoreStep(s)} tip="Ignore this step: plan the chain without this CCU (undo under Options)" aria-label={`Ignore ${name(s.fromId)} → ${name(s.toId)}`}><Ban class="size-3.5" /></TipButton>
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
              <Button variant="outline" size="sm" type="submit">Save chain</Button>
              <TipButton variant="outline" size="sm" type="button" onclick={addToFleet} tip="Add this source → target (with its stops) as a goal at the end of your fleet plan">Add to fleet plan</TipButton>
              {#if saved.text}<span class="text-success text-[11px]">Saved “{saved.text}”</span>{/if}
              {#if addedToFleet.text}<span class="text-success text-[11px]">{addedToFleet.text} — <Button variant="link" size="xs" class="h-auto p-0 text-[11px]" onclick={() => (planner = 'fleet')}>open Fleet plan</Button></span>{/if}
            </form>
          </div>
          <span class="text-muted-foreground text-[11px]">Or buy by hand on the RSI <a class={LINK} href={UPGRADES} target="_blank" rel="noopener">ship upgrades page</a>. Prices change during sales — refresh in Store.</span>
        {/if}
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

  {#if chains.length}
    <Card.Root>
      <Card.Content>
        <Section id="ccu-saved-chains" title="Saved chains" summary={`(${chains.length})`}>
            <div class="flex flex-wrap items-center gap-2">
              <TipButton size="sm" disabled={cart.busy || !pickedLines.length} onclick={addChains} tip="Adds the store steps of every ticked chain, as it prices today (the Now column). Lines your cart already holds are skipped; buy-backs are left out.">
                <ShoppingCart />{cart.busy ? 'Adding…' : pickedRows.length ? `Add ${pickedRows.length} chain${pickedRows.length === 1 ? '' : 's'} to RSI cart (${pickedLines.length} line${pickedLines.length === 1 ? '' : 's'})` : 'Tick chains to add them to the RSI cart'}
              </TipButton>
              <span class="flex-1"></span>
              {#if exported.text}<span class="text-success text-[11px]" role="status">{exported.text}</span>{/if}
              <TipButton variant="outline" size="sm" onclick={() => copyCodes(exportRows)} tip="Copies the chains as text codes, one per line (the ticked chains, or all of them when none is ticked). A code holds the route and options, not your own CCUs."><Copy />Copy {pick.size ? `${exportRows.length} ticked` : `all ${chains.length}`}</TipButton>
              <TipButton variant="outline" size="sm" onclick={downloadCodes} tip="The same codes as a text file">Download file</TipButton>
              <CcuTransfer label="Import" code={null} saved={savedCodes} onopen={applyLink} onadd={importChains} />
              {#if batchNote}<span class="text-muted-foreground basis-full text-[11px]">{batchNote}</span>{/if}
            </div>
            <p class="text-muted-foreground m-0 text-sm">Their CCUs stay out of new plans while <em>Exclude saved chains</em> is on. <em>Already spent</em> is what you paid for the CCUs of yours the chain uses, plus the pledge holding its source ship. <em>Saved</em> is what was left to pay when you saved it; “Now” re-prices each chain on today's store + hangar; a chain with steps waiting for a sale is a long-term goal — the Feed alerts when one of those CCUs is in the store.</p>
            <Table.Root>
              <Table.Header>
                <Table.Row><Table.Head class="w-8"><span class="sr-only">Add to cart</span></Table.Head><Table.Head>Name</Table.Head><Table.Head>Chain</Table.Head><Table.Head class="text-right">Already spent</Table.Head><Table.Head class="text-right">Saved</Table.Head><Table.Head class="text-right">Now</Table.Head><Table.Head><span class="sr-only">Actions</span></Table.Head></Table.Row>
              </Table.Header>
              <Table.Body>
                {#each savedRows as { c, p } (c.id)}
                  <Table.Row>
                    {@const savedWaits = c.steps.filter((s) => s.kind === 'future').length}
                    {@const cc = chainCart(c, p)}
                    <Table.Cell><Checkbox checked={pick.has(c.id)} disabled={!cc.total} onCheckedChange={(v) => togglePick(c.id, !!v)} aria-label={`Add ${c.name} to the cart`} /></Table.Cell>
                    <Table.Cell>{#if c.group}<span class="text-primary text-[11px]">{c.group}</span><br />{/if}<strong>{c.name}</strong>{#if savedWaits}<Badge variant="warning" class="ml-1.5">{savedWaits} waiting</Badge>{/if}<br /><span class="text-muted-foreground text-[11px]">{fmtDate(c.at)} · {c.steps.length} steps · {OBJECTIVES.find((o) => o.id === c.opt.objective)?.label}</span></Table.Cell>
                    <Table.Cell class="text-[11px] whitespace-normal">{[name(c.startId), ...c.steps.map((s) => name(s.toId))].join(' → ')}</Table.Cell>
                    {@const sp = spentOn(c, p)}
                    <Table.Cell class="text-right tabular-nums">
                      {#if sp.total}{ownUsd(sp.total)}<br /><span class="text-muted-foreground text-[11px]">{[sp.ccu ? `${ownUsd(sp.ccu)} CCUs` : '', sp.ship ? `${ownUsd(sp.ship)} ship` : ''].filter(Boolean).join(' + ')}</span>{:else}<span class="text-muted-foreground">—</span>{/if}
                    </Table.Cell>
                    <Table.Cell class="text-right tabular-nums">{usd(c.total)}<br /><span class="text-muted-foreground text-[11px]">{usd(c.cash)} new money</span></Table.Cell>
                    <Table.Cell class="text-right tabular-nums">
                      {#if !p}<HintBadge variant="destructive" hint="A step is no longer on sale or in your hangar, or its CCU is now reserved by another saved chain">no longer possible</HintBadge>
                      {:else}<span class={cn(p.total < c.total && 'text-success', p.total > c.total && 'text-warning')}>{usd(p.total)}</span>{#if savedWaits && p.waits < savedWaits}<br /><span class="text-success text-[11px]">on sale now — {savedWaits - p.waits} waiting step{savedWaits - p.waits === 1 ? '' : 's'} buyable</span>{:else if changed(c, p)}<br /><span class="text-muted-foreground text-[11px]">chain changed</span>{/if}{/if}
                      {#if cc.inCart || cc.adding || cc.errors.length}
                        <br />
                        {#if cc.adding}<span class="text-muted-foreground text-[11px]">adding…</span>
                        {:else if cc.inCart}<span class={cn('text-[11px]', cc.inCart === cc.total ? 'text-success' : 'text-muted-foreground')}>{cc.inCart}/{cc.total} in cart</span>{/if}
                        {#if cc.errors.length}<HintBadge variant="destructive" hint={cc.errors.join('\n')} class="h-5 text-[11px]">{cc.errors.length} not added</HintBadge>{/if}
                      {/if}
                    </Table.Cell>
                    <Table.Cell class="text-right">
                      <div class="flex items-center justify-end gap-1.5">
                        <TipButton variant="ghost" size="icon-xs" onclick={() => copyCodes([c])} tip="Copy this chain as a text code" aria-label={`Copy ${c.name} as a code`}><Copy /></TipButton>
                        <Button variant="outline" size="xs" onclick={() => loadChain(c)}>Load</Button>
                        <ConfirmButton onconfirm={() => persist(chains.filter((x) => x.id !== c.id))}>Delete</ConfirmButton>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
        </Section>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if ccus.owned.length}
    <Card.Root>
      <Card.Content>
        <Section id="ccu-owned" title="Your CCUs" summary={`(${ccus.owned.length})`}>
            <p class="text-muted-foreground m-0 text-sm">Click <em>Force</em> to require a CCU in the chain (include), click again to keep it out (exclude), again to reset. Click a column to sort.</p>
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
                  <SortTh key="source" bind:sort={ownedSort}>Source</SortTh>
                  <SortTh key="paid" bind:sort={ownedSort} firstDir="desc" numeric>Paid / buy-back</SortTh>
                  <SortTh key="gain" bind:sort={ownedSort} firstDir="desc" numeric>Upgrade value</SortTh>
                  <SortTh key="reserved" bind:sort={ownedSort}>Reserved by</SortTh>
                  <SortTh key="force" bind:sort={ownedSort} firstDir="desc">Force</SortTh>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each ownedSorted as o (o.source + o.ref)}
                  {@const gain = gainOf(o)}
                  {@const f = forceOf(o.ref)}
                  <Table.Row>
                    <Table.Cell class="text-muted-foreground">{name(o.fromId)}</Table.Cell>
                    <Table.Cell><strong>{name(o.toId)}</strong></Table.Cell>
                    <Table.Cell>{o.source}{o.gifted ? ' · gift' : ''}</Table.Cell>
                    <Table.Cell class="text-right tabular-nums">
                      {#if o.source === 'hangar'}{o.value ? ownUsd(o.value) : '—'}
                      {:else if o.price != null}{usd(o.price)}<span class="text-muted-foreground ml-1 text-[11px]">to buy back</span>
                      {:else}<HintBadge variant="muted" size="xs" hint="RSI shows a buy-back's price only on its own page. Open the Buyback page and use “Load contents & prices”; until then the planner assumes the MSRP difference.">?</HintBadge>{/if}
                    </Table.Cell>
                    {@const cost = o.source === 'hangar' ? o.value : (o.price ?? 0)}
                    <Table.Cell class={cn('text-right tabular-nums', cost > 0 && gain > cost && 'text-success')}>{usd(gain)}</Table.Cell>
                    <Table.Cell class="text-[11px]">{reservedBy.get(o.ref)?.name ?? ''}</Table.Cell>
                    <Table.Cell>
                      <Button variant="outline" size="xs" class={cn('min-w-16', f === 'include' && 'text-success', f === 'exclude' && 'text-destructive')} onclick={() => cycleForce(o.ref)}>{f || 'auto'}</Button>
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

