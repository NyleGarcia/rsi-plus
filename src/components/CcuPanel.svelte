<script lang="ts">
  import { addable, addStep, CART_URL, verifyUpgrade } from '@/lib/cart';
  import { createCartLedger } from '@/lib/cart-ui.svelte';
  import { transient } from '@/lib/flash.svelte';
  import { lastSaleLabel, shipName, uid } from '@/lib/ccu-ui';
  import { DEFAULT_PLAN_OPTIONS, ownedCcus, ownedHulls, ownedShips, plan, planGraph, reservedRefs, STORE_START, type Objective, type PlanOptions, type SavedChain, type Step } from '@/lib/ccu';
  import { hangarUrl } from '@/lib/hangar';
  import { bg } from '@/lib/messages';
  import { buybackItem, catalogItem, ccuChainsItem, ccuGoalsItem, hangarItem, pledgeLabelsItem, saleHistoryItem } from '@/lib/settings';
  import { cleanLabels, idsWith, KEEP, PREFER, type Labels } from '@/lib/labels';
  import { refreshHangar, type HangarProgress } from '@/lib/hangar-refresh';
  import { matchShip, usd, type Catalog, type SaleHistory } from '@/lib/store';
  import { ownUsd } from '@/lib/privacy.svelte';
  import Wizard, { type WizardStep } from './Wizard.svelte';
  import Segmented from './Segmented.svelte';
  import ShipSelect from './ShipSelect.svelte';
  import Stat from './Stat.svelte';
  import CcuFleet from './CcuFleet.svelte';
  import StatGrid from './StatGrid.svelte';
  import Section from './Section.svelte';
  import Chip from './Chip.svelte';
  import TipButton from './TipButton.svelte';
  import HintBadge from './HintBadge.svelte';
  import LazyTip from './LazyTip.svelte';
  import SwitchRow from './SwitchRow.svelte';
  import CartButton from './CartButton.svelte';
  import OpenCartButton from './OpenCartButton.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
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

  let { initialTo = null, initialAhead = false }: { initialTo?: number | null; initialAhead?: boolean } = $props();

  let cat = $state<Catalog | null>(null);
  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let buyback = $state<Awaited<ReturnType<typeof buybackItem.getValue>>>(null);
  let chains = $state<SavedChain[]>([]);
  let sales = $state<SaleHistory>({});
  let labels = $state<Labels>({});
  let error = $state('');

  type Mode = 'store' | 'hangar' | 'any';
  let mode = $state<Mode>('hangar');
  let fromId = $state<number | null>(null);
  let toId = $state<number | null>(null); // set from initialTo by the effect below
  let opt = $state<PlanOptions>({ ...DEFAULT_PLAN_OPTIONS, include: [], exclude: [], via: [] });
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
  let chainName = $state('');
  /** Name of the chain just saved, shown for a moment. */
  const saved = transient(2500);

  $effect(() => {
    hangarItem.getValue().then((h) => (hangar = h));
    buybackItem.getValue().then((b) => (buyback = b));
    catalogItem.getValue().then((c) => (cat = c));
    ccuChainsItem.getValue().then((c) => (chains = c));
    saleHistoryItem.getValue().then((h) => (sales = h));
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
  $effect(() => {
    if (initialTo != null) toId = initialTo;
    if (initialAhead) opt.planAhead = true;
  });

  const ships = $derived((cat?.ships ?? []).filter((s) => s.msrp > 0).sort((a, b) => a.msrp - b.msrp));
  const byId = $derived(new Map(ships.map((s) => [s.id, s])));
  const mine = $derived(ownedShips(hangar?.pledges ?? [], ships));
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
  const effective = $derived<PlanOptions>({
    ...opt,
    exclude: excludeSaved ? [...new Set([...opt.exclude, ...reservedBy.keys()])] : opt.exclude,
  });
  const startId = $derived(mode === 'store' ? STORE_START : fromId);
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
  /** The options the shown chain was planned with (saved with it). */
  const used = $derived<PlanOptions>(planned.ahead ? { ...effective, planAhead: true } : effective);
  /** Running spend after each step. */
  const running = $derived(result ? result.steps.reduce<number[]>((acc, s) => [...acc, (acc.at(-1) ?? 0) + s.cost], []) : []);
  const creditCents = $derived(hangar?.credits ? Math.round(hangar.credits.usd * 100) : null);
  const cashNeeded = $derived(result && creditCents != null ? result.cash + Math.max(0, result.total - result.cash - creditCents) : null);

  // ---- RSI cart ----
  const cart = createCartLedger();
  const cartKey = (s: Step) => `${s.kind}:${s.fromId}>${s.toId}:${s.skuId ?? s.ref ?? ''}`;
  // A new plan = a new cart ledger (state is per step identity, so a re-plan with the same steps keeps it).
  const addableSteps = $derived(result ? result.steps.filter((s) => addable(s, byId).kind !== 'none') : []);
  const hasBuyback = $derived(addableSteps.some((s) => s.kind === 'buyback'));
  const addOne = (s: Step) => cart.add(cartKey(s), () => addStep(s, byId));
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
  const addAll = () => cart.addAll(addableSteps.filter((s) => s.kind !== 'buyback').map((s) => ({ key: cartKey(s), task: () => addStep(s, byId) })));

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
  function loadChain(c: SavedChain) {
    mode = c.startId === STORE_START ? 'store' : mine.some((s) => s.id === c.startId) ? 'hangar' : 'any';
    fromId = c.startId === STORE_START ? null : c.startId;
    toId = c.targetId;
    opt = { ...DEFAULT_PLAN_OPTIONS, ...c.opt, include: [...c.opt.include], exclude: [...c.opt.exclude], via: [...(c.opt.via ?? [])] };
    excludeSaved = false;
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
  /** A fleet goal → the single planner (same options; verify + cart live there). */
  function openGoal(start: number, target: number, via: number[]) {
    mode = start === STORE_START ? 'store' : mine.some((s) => s.id === start) ? 'hangar' : 'any';
    fromId = start === STORE_START ? null : start;
    toId = target;
    opt.via = [...via];
    opt.include = [];
    planner = 'one';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  /** What the same chain settings cost today (other saved chains' CCUs excluded, this one's own allowed). */
  function now(c: SavedChain) {
    const others = reservedRefs(chains.filter((x) => x.id !== c.id));
    return plan(ships, ccus.owned, c.startId, c.targetId, { ...c.opt, exclude: [...new Set([...c.opt.exclude, ...others])] });
  }
  /** Saved chains (grouped) with today's price, planned once per change instead of per render. */
  const savedRows = $derived([...chains].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '')).map((c) => ({ c, p: now(c) })));
  const ownedSorted = $derived([...ccus.owned].sort((a, b) => (byId.get(a.fromId)?.msrp ?? 0) - (byId.get(b.fromId)?.msrp ?? 0)));
  const OPTIONS: { key: 'warbond' | 'buyback' | 'inStockOnly' | 'storeCredit' | 'excludeGifted' | 'planAhead'; label: string; hint?: string }[] = [
    { key: 'warbond', label: 'Warbond CCUs' },
    { key: 'buyback', label: 'Buyback CCUs' },
    { key: 'inStockOnly', label: 'Skip sold-out limited' },
    { key: 'storeCredit', label: 'Pay with store credit' },
    { key: 'excludeGifted', label: 'Exclude gifted CCUs' },
    { key: 'planAhead', label: 'Plan ahead (ships not on sale)', hint: 'Route through hulls nobody sells a CCU to today, at MSRP, to buy when they return (IAE, Invictus, the maker\'s showcase). Save the chain and the Feed tells you when such a CCU is in the store.' },
  ];
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
          ? `${steps.length} steps · pay ${usd(payNow)} now${waits ? ` · ${usd(result.later)} later (${waits} step${waits === 1 ? '' : 's'} wait for a sale)` : ''} · ${usd(result.savings)} under MSRP`
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
      <Card.Action>
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
            <SwitchRow id={`ccu-opt-${o.key}`} size="sm" label={o.label} hint={o.hint} checked={!!opt[o.key]} onchange={(v) => (opt[o.key] = v)} />
          {/each}
          <SwitchRow id="ccu-opt-exclude-saved" size="sm" label={`Exclude saved chains${chains.length ? ` (${reservedBy.size} CCUs)` : ''}`} checked={excludeSaved} disabled={!chains.length} onchange={(v) => (excludeSaved = v)} />
        </div>
        <span class="text-muted-foreground text-[11px]">
          {hangar ? `${ccus.owned.filter((o) => o.source === 'hangar').length} owned CCUs` : 'Load your hangar to use owned CCUs'}
          {buyback ? ` · ${ccus.owned.filter((o) => o.source === 'buyback').length} buyback CCUs` : ''}
          {creditCents != null ? ` · store credit ${ownUsd(creditCents)}` : ''}
        </span>
      </fieldset>

      {#if planner === 'fleet'}
        <CcuFleet {ships} {mine} {hulls} {labelPrefer} keptByLabel={keepIds.size} lti={ltiHulls} owned={ccus.owned} opt={effective} {sales} {chains} {persist} onopen={openGoal} />
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
              value={usd(result.savings)}
              label="saved vs MSRP"
              valueTone={result.savings > 0 ? 'ok' : result.savings < 0 ? 'err' : null}
              delta={result.msrpDiff > 0
                ? { text: `${result.savings >= 0 ? '▼' : '▲'} ${Math.abs((100 * result.savings) / result.msrpDiff).toFixed(0)}%`, tone: result.savings > 0 ? 'up' : result.savings < 0 ? 'down' : 'neutral' }
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
                      {#if s.kind === 'future'}<span class="text-muted-foreground text-[11px]">{seen(s.toId)}</span>{/if}
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
                          busy={cart.busy}
                          onadd={() => addOne(s)}
                          label={s.kind === 'buyback' ? 'Add buy-back' : 'Add to cart'}
                          hint={s.kind === 'buyback' ? 'Buy-backs check out alone: one per cart, nothing else in it.' : 'Adds this CCU to your RSI cart (nothing is paid)'}
                        />
                      {/if}
                      {#if link(s)}
                        <Button variant="ghost" size="xs" href={link(s)} target="_blank" rel="noopener">{s.kind === 'owned' ? 'Hangar' : s.kind === 'buyback' ? 'Buy back' : s.kind === 'standalone' || s.kind === 'future' ? 'Store' : 'Upgrades'} <ExternalLink /></Button>
                      {/if}
                    </div>
                  </div>
                  {#if c?.st === 'error'}<div class="text-destructive mt-1 text-[11px]">{c.msg}</div>{/if}
                  <dl class="mt-1.5 mb-0 flex flex-wrap gap-x-[18px] gap-y-1.5">
                    {#each [{ dt: 'Cost', dd: `${s.cost ? usd(s.cost) : 'free'}${s.paid ? ` · paid ${ownUsd(s.paid)}` : ''}`, cls: '' }, { dt: 'New money', dd: s.cash ? usd(s.cash) : '—', cls: s.cash > 0 ? 'text-warning' : '' }, { dt: 'Running', dd: usd(running[i] ?? 0), cls: '' }, { dt: 'Hull value', dd: usd(byId.get(s.toId)?.msrp ?? 0), cls: 'text-muted-foreground' }] as m (m.dt)}
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
              <OpenCartButton always size="sm" count={cart.added} />
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

  {#if chains.length}
    <Card.Root>
      <Card.Content>
        <Section id="ccu-saved-chains" title="Saved chains" summary={`(${chains.length})`}>
            <p class="text-muted-foreground m-0 text-sm">Their CCUs stay out of new plans while <em>Exclude saved chains</em> is on. “Now” re-prices each chain on today's store + hangar; a chain with steps waiting for a sale is a long-term goal — the Feed alerts when one of those CCUs is in the store.</p>
            <Table.Root>
              <Table.Header>
                <Table.Row><Table.Head>Name</Table.Head><Table.Head>Chain</Table.Head><Table.Head class="text-right">Saved</Table.Head><Table.Head class="text-right">Now</Table.Head><Table.Head><span class="sr-only">Actions</span></Table.Head></Table.Row>
              </Table.Header>
              <Table.Body>
                {#each savedRows as { c, p } (c.id)}
                  <Table.Row>
                    {@const savedWaits = c.steps.filter((s) => s.kind === 'future').length}
                    <Table.Cell>{#if c.group}<span class="text-primary text-[11px]">{c.group}</span><br />{/if}<strong>{c.name}</strong>{#if savedWaits}<Badge variant="warning" class="ml-1.5">{savedWaits} waiting</Badge>{/if}<br /><span class="text-muted-foreground text-[11px]">{fmtDate(c.at)} · {c.steps.length} steps · {OBJECTIVES.find((o) => o.id === c.opt.objective)?.label}</span></Table.Cell>
                    <Table.Cell class="text-[11px] whitespace-normal">{[name(c.startId), ...c.steps.map((s) => name(s.toId))].join(' → ')}</Table.Cell>
                    <Table.Cell class="text-right tabular-nums">{usd(c.total)}<br /><span class="text-muted-foreground text-[11px]">{usd(c.cash)} new money</span></Table.Cell>
                    <Table.Cell class="text-right tabular-nums">
                      {#if !p}<HintBadge variant="destructive" hint="A step is no longer on sale or in your hangar, or its CCU is now reserved by another saved chain">no longer possible</HintBadge>
                      {:else}<span class={cn(p.total < c.total && 'text-success', p.total > c.total && 'text-warning')}>{usd(p.total)}</span>{#if savedWaits && p.waits < savedWaits}<br /><span class="text-success text-[11px]">on sale now — {savedWaits - p.waits} waiting step{savedWaits - p.waits === 1 ? '' : 's'} buyable</span>{:else if changed(c, p)}<br /><span class="text-muted-foreground text-[11px]">chain changed</span>{/if}{/if}
                    </Table.Cell>
                    <Table.Cell class="text-right">
                      <div class="flex items-center justify-end gap-1.5">
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
            <p class="text-muted-foreground m-0 text-sm">Click <em>Force</em> to require a CCU in the chain (include), click again to keep it out (exclude), again to reset.</p>
            <Table.Root>
              <Table.Header>
                <Table.Row><Table.Head>CCU</Table.Head><Table.Head>Source</Table.Head><Table.Head class="text-right">Paid</Table.Head><Table.Head class="text-right">Upgrade value</Table.Head><Table.Head>Reserved by</Table.Head><Table.Head>Force</Table.Head></Table.Row>
              </Table.Header>
              <Table.Body>
                {#each ownedSorted as o (o.source + o.ref)}
                  {@const gain = (byId.get(o.toId)?.msrp ?? 0) - (byId.get(o.fromId)?.msrp ?? 0)}
                  {@const f = forceOf(o.ref)}
                  <Table.Row>
                    <Table.Cell><span class="text-muted-foreground">{name(o.fromId)} →</span> <strong>{name(o.toId)}</strong></Table.Cell>
                    <Table.Cell>{o.source}{o.gifted ? ' · gift' : ''}</Table.Cell>
                    <Table.Cell class="text-right tabular-nums">{o.value ? ownUsd(o.value) : o.source === 'hangar' ? '—' : '?'}</Table.Cell>
                    <Table.Cell class={cn('text-right tabular-nums', o.value && gain > o.value && 'text-success')}>{usd(gain)}</Table.Cell>
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

