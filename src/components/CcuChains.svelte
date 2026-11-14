<script lang="ts">
  /**
   * My chains: every ship you are working towards, in one list planned together (`planChains`). Top first — an earlier
   * chain gets first pick of your CCUs and hull copies; move a chain up to give it priority. Each row is priced on
   * today's store and hangar. From here: open a chain in the planner above (verify, tweak), add the store steps of the
   * ticked chains to the RSI cart, export / import chains as text. The plan of each chain is written back to the saved
   * list whenever it changes, so the Feed, Pledges and CCUs pages know which CCUs a chain uses.
   */
  import { untrack } from 'svelte';
  import { dropBakedExcludes, legExclude, mergeGoals, planChains, savedVsMsrp, STORE_START, withPlans, type FleetLeg, type OwnedCcu, type SavedChain, type Step } from '@/lib/ccu';
  import { ccuCodesText, encodeCcuLink, type CcuLink } from '@/lib/ccu-link';
  import type { CartLedger } from '@/lib/cart-ui.svelte';
  import type { WantedLine } from '@/lib/cart';
  import { ccuGoalsItem } from '@/lib/settings';
  import { usd, type CatalogShip, type SaleHistory } from '@/lib/store';
  import { ownUsd } from '@/lib/privacy.svelte';
  import { transient } from '@/lib/flash.svelte';
  import { lastSaleLabel, shipName, uid } from '@/lib/ccu-ui';
  import { dateStamp, downloadFile } from '@/lib/download';
  import { fmtDate } from '@/lib/dates';
  import { DEFAULT_PLAN_OPTIONS } from '@/lib/ccu';
  import ShipSelect from './ShipSelect.svelte';
  import Segmented from './Segmented.svelte';
  import Section from './Section.svelte';
  import Stat from './Stat.svelte';
  import StatGrid from './StatGrid.svelte';
  import Chip from './Chip.svelte';
  import HintBadge from './HintBadge.svelte';
  import LazyTip from './LazyTip.svelte';
  import SwitchRow from './SwitchRow.svelte';
  import TipButton from './TipButton.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import CcuTransfer from './CcuTransfer.svelte';
  import Empty from './Empty.svelte';
  import Tag from './Tag.svelte';
  import * as Table from '@/components/ui/table';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import { cn } from '@/lib/utils';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Copy from '@lucide/svelte/icons/copy';
  import Plus from '@lucide/svelte/icons/plus';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import X from '@lucide/svelte/icons/x';

  type BatchLine = WantedLine & { step: Step };
  const OBJECTIVE = { spend: 'least to pay now', cash: 'least new money', longterm: 'long-term saving' } as const;

  let {
    ships,
    mine,
    hulls,
    lti = [],
    labelPrefer = [],
    keptByLabel = 0,
    owned,
    sales,
    chains,
    persist,
    persistPlans,
    loaded = false,
    ready = false,
    sourceValue,
    cart,
    lineOf,
    addLines,
    onopen,
    onlink,
    onimport,
  }: {
    ships: CatalogShip[];
    /** Ships you own (for the pickers). */
    mine: CatalogShip[];
    /** Hull copies you own that a chain may upgrade (`ownedHulls`). */
    hulls: { id: number; count: number; lti?: number }[];
    /** Hulls you own on an LTI pledge — offered as "prefer" in one click (LTI tokens). */
    lti?: number[];
    /** Hulls on pledges labelled *LTI token* / *CCU fodder* — preferred on top of the list here. */
    labelPrefer?: number[];
    /** Pledges labelled *Keep* (left out of `hulls`), for the note. */
    keptByLabel?: number;
    owned: OwnedCcu[];
    sales: SaleHistory;
    chains: SavedChain[];
    persist: (next: SavedChain[]) => Promise<void>;
    /** Write the plans back (`withPlans`): gives way to a newer list in storage instead of overwriting it. */
    persistPlans: (next: SavedChain[]) => Promise<void>;
    /** The saved chains and the catalog are in: old fleet goals can be folded in. */
    loaded?: boolean;
    /** The whole hangar and the buyback list are in too: plans are real, so they may be written back to the chains. */
    ready?: boolean;
    /** Melt value (cents) of the cheapest pledge holding each hull — the "ship" part of *Already spent*. */
    sourceValue: Map<number, number>;
    cart: CartLedger;
    /** A chain step as a cart line (null: nothing to add — owned, waiting, a buy-back). */
    lineOf: (s: Step, prefix: string) => BatchLine | null;
    addLines: (lines: BatchLine[]) => Promise<{ added: number; held: number; limit: number; failed: number }>;
    /** Open a chain in the planner, with the CCUs the chains above it took kept out. */
    onopen: (c: SavedChain, startId: number, exclude: number[]) => void;
    /** Import dialog: open a code in the planner / add codes to the list. */
    onlink: (l: CcuLink) => void;
    onimport: (l: CcuLink[]) => Promise<{ added: number; failed: number }>;
  } = $props();

  const byId = $derived(new Map(ships.map((s) => [s.id, s])));
  const name = (id: number | null) => shipName(byId, id);

  // ---- hulls an auto chain never / preferably upgrades (kept with the old fleet-plan settings) ----
  let keep = $state<number[]>([]);
  let prefer = $state<number[]>([]);
  let rulesLoaded = $state(false);
  $effect(() => {
    if (!loaded || rulesLoaded) return;
    untrack(() => {
      ccuGoalsItem.getValue().then(async (v) => {
        keep = v.keep;
        prefer = v.prefer ?? [];
        // Once: the goals of the old fleet plan become chains of this list.
        if (!v.merged) {
          const goals = v.goals.map((g) => (g.storeStart === undefined ? { ...g, storeStart: v.storeStart } : g));
          const next = dropBakedExcludes(mergeGoals($state.snapshot(chains) as SavedChain[], goals, name, Date.now()));
          await persist(next);
          await ccuGoalsItem.setValue({ goals: [], keep: v.keep, prefer: v.prefer ?? [], storeStart: false, merged: true });
        }
        rulesLoaded = true;
      });
    });
  });
  $effect(() => {
    const v = { goals: [], keep: $state.snapshot(keep), prefer: $state.snapshot(prefer), storeStart: false, merged: true };
    if (rulesLoaded) ccuGoalsItem.setValue(v);
  });

  // ---- the plan ----
  const fleet = $derived(planChains(ships, owned, chains, { hulls, keep, prefer: [...new Set([...prefer, ...labelPrefer])] }));
  const payNow = $derived(fleet.total - fleet.later);
  // Keep each chain's plan with it (Feed alerts, the Pledges badge and the CCUs page read it) — only once the hangar is in.
  $effect(() => {
    if (!ready || !rulesLoaded) return;
    const next = withPlans(chains, fleet);
    if (next !== chains) untrack(() => void persistPlans($state.snapshot(next) as SavedChain[]));
  });
  const waiting = $derived(
    fleet.legs
      .flatMap((l, i) => (l.plan?.steps ?? []).filter((s) => s.kind === 'future').map((s) => ({ s, i })))
      .sort((a, b) => a.s.cost - b.s.cost),
  );
  const spent = (c: SavedChain, leg: FleetLeg | undefined) => {
    const ccu = leg?.plan?.paid ?? 0;
    const start = leg?.startId ?? c.startId;
    const ship = !leg?.plan || start === STORE_START ? 0 : (sourceValue.get(start) ?? 0);
    return { ccu, ship, total: ccu + ship };
  };

  // ---- editing the list ----
  const update = (id: string, f: (c: SavedChain) => SavedChain) => persist(($state.snapshot(chains) as SavedChain[]).map((c) => (c.id === id ? f(c) : c)));
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= chains.length) return;
    const next = [...($state.snapshot(chains) as SavedChain[])];
    [next[i], next[j]] = [next[j]!, next[i]!];
    void persist(next);
  }
  let addTo = $state<number | null>(null);
  /** The picker hides ships you already own unless asked (a chain is usually to a ship you don't have yet). */
  let wantOwned = $state(false);
  const wantable = $derived(wantOwned ? ships : ships.filter((s) => !mine.some((m) => m.id === s.id)));
  function addShip(id: number | null) {
    addTo = null;
    if (id == null) return;
    const c: SavedChain = { id: uid(), name: name(id), at: Date.now(), startId: STORE_START, targetId: id, steps: [], total: 0, cash: 0, opt: { ...DEFAULT_PLAN_OPTIONS, include: [], exclude: [], skip: [], via: [] }, auto: true, storeStart: false, lti: 'any' };
    void persist([...($state.snapshot(chains) as SavedChain[]), c]);
  }
  /** Rows with their settings open. */
  let editing = $state(new Set<string>());
  const toggleEdit = (id: string) => (editing = new Set(editing.has(id) ? [...editing].filter((x) => x !== id) : [...editing, id]));
  type Src = 'auto' | 'store' | 'ship';
  const srcOf = (c: SavedChain): Src => (c.auto ? 'auto' : c.startId === STORE_START ? 'store' : 'ship');
  function setSrc(c: SavedChain, s: Src) {
    if (s === srcOf(c)) return;
    const mineBelow = mine.find((m) => m.msrp < (byId.get(c.targetId)?.msrp ?? 0))?.id ?? mine[0]?.id;
    void update(c.id, (x) => (s === 'auto' ? { ...x, auto: true } : s === 'store' ? { ...x, auto: false, startId: STORE_START } : { ...x, auto: false, startId: x.startId !== STORE_START && mine.some((m) => m.id === x.startId) ? x.startId : (mineBelow ?? x.startId) }));
  }
  const setVia = (c: SavedChain, via: number[]) => update(c.id, (x) => ({ ...x, opt: { ...x.opt, via } }));
  let picks = $state<Record<string, number | null>>({});
  const sortedShips = $derived([...ships].sort((a, b) => a.name.localeCompare(b.name)));
  const keepable = $derived(mine.filter((m) => !keep.includes(m.id)));
  const preferable = $derived(mine.filter((m) => !prefer.includes(m.id)));
  const addKeep = (id: number) => ((keep = [...keep, id]), (prefer = prefer.filter((x) => x !== id)));
  const addPrefer = (ids: number[]) => ((prefer = [...new Set([...prefer, ...ids])]), (keep = keep.filter((x) => !ids.includes(x))));
  const ltiToAdd = $derived(lti.filter((id) => !prefer.includes(id) && mine.some((m) => m.id === id)));
  const anyAuto = $derived(chains.some((c) => c.auto));

  // ---- cart: the store steps of the ticked chains ----
  let pick = $state(new Set<string>());
  const togglePick = (id: string, on: boolean) => (pick = new Set(on ? [...pick, id] : [...pick].filter((x) => x !== id)));
  const linesOf = (c: SavedChain, leg: FleetLeg | undefined) => (leg?.plan?.steps ?? []).map((s) => lineOf(s, `chain:${c.id}:`)).filter((l): l is BatchLine => !!l);
  const rows = $derived(chains.map((c, i) => ({ c, i, leg: fleet.legs[i] })));
  const pickedRows = $derived(rows.filter((r) => pick.has(r.c.id) && r.leg?.plan));
  const pickedLines = $derived(pickedRows.flatMap((r) => linesOf(r.c, r.leg)));
  let batchNote = $state('');
  async function addPicked() {
    if (cart.busy || !pickedLines.length) return;
    batchNote = '';
    const r = await addLines(pickedLines);
    const buybacks = pickedRows.reduce((n, x) => n + (x.leg?.plan?.steps ?? []).filter((s) => s.kind === 'buyback').length, 0);
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
  const cartOf = (c: SavedChain, leg: FleetLeg | undefined) => {
    const lines = linesOf(c, leg);
    const st = lines.map((l) => cart.of(l.key));
    return {
      total: lines.length,
      inCart: st.filter((x) => x?.st === 'added').length,
      adding: st.some((x) => x?.st === 'adding'),
      errors: lines.flatMap((l) => {
        const x = cart.of(l.key);
        return x?.st === 'error' ? [`${name(l.step.fromId)} → ${name(l.step.toId)}: ${x.msg}`] : [];
      }),
    };
  };

  // ---- export ----
  const codeOf = (c: SavedChain) => encodeCcuLink({ from: c.auto ? null : c.startId, to: c.targetId, via: c.opt.via, opt: c.opt, name: c.name });
  const exportRows = $derived(pick.size ? chains.filter((c) => pick.has(c.id)) : chains);
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
</script>

<Section id="ccu-my-chains" title="My chains" summary={chains.length ? `(${chains.length} · ${usd(payNow)} to pay now${fleet.later ? ` · ${usd(fleet.later)} later` : ''})` : '(none yet)'}>
  <p class="text-muted-foreground m-0 text-sm">
    Every ship you are working towards, planned together on today's store and your hangar. Top first: a chain higher up gets first pick of your CCUs and hull copies, so move the one you care about most to the top. <em>Open</em> puts a chain in the planner above to verify it with RSI or change it.
  </p>
  <div class="flex flex-wrap items-center gap-2">
    <div class="w-[260px]"><ShipSelect ships={wantable} mine={wantOwned ? mine : []} saleTag bind:value={addTo} onpick={addShip} ariaLabel="Add a ship you want" placeholder="+ Add a ship you want…" /></div>
    <SwitchRow id="chains-want-owned" size="sm" class="text-xs" label="Include ships I own" hint="List the ships already in your hangar too (another copy)" checked={wantOwned} onchange={(v) => (wantOwned = v)} />
    <span class="flex-1"></span>
    {#if exported.text}<span class="text-success text-[11px]" role="status">{exported.text}</span>{/if}
    {#if chains.length}
      <TipButton size="sm" disabled={cart.busy || !pickedLines.length} onclick={addPicked} tip="Adds the store steps of every ticked chain, as it prices today. Lines your cart already holds are skipped; buy-backs are left out.">
        <ShoppingCart />{cart.busy ? 'Adding…' : pickedRows.length ? `Add ${pickedRows.length} chain${pickedRows.length === 1 ? '' : 's'} to RSI cart (${pickedLines.length} line${pickedLines.length === 1 ? '' : 's'})` : 'Tick chains to add them to the RSI cart'}
      </TipButton>
      <TipButton variant="outline" size="sm" onclick={() => copyCodes(exportRows)} tip="Copies the chains as text codes, one per line (the ticked chains, or all of them when none is ticked). A code holds the route and options, not your own CCUs."><Copy />Copy {pick.size ? `${exportRows.length} ticked` : `all ${chains.length}`}</TipButton>
      <TipButton variant="outline" size="sm" onclick={downloadCodes} tip="The same codes as a text file">Download file</TipButton>
    {/if}
    <CcuTransfer label="Import" code={null} saved={chains.map(codeOf)} onopen={onlink} onadd={onimport} />
    {#if batchNote}<span class="text-muted-foreground basis-full text-[11px]">{batchNote}</span>{/if}
  </div>

  {#if !chains.length}
    <Empty>No chains yet. Add a ship you want here (the planner picks which of your hulls to upgrade), or plan one above and press Save chain.</Empty>
  {:else}
    <StatGrid>
      <Stat value={usd(payNow)} label="to pay now" />
      {#if fleet.waits}<Stat value={usd(fleet.later)} label={`later · ${fleet.waits} CCU${fleet.waits === 1 ? '' : 's'} wait for a sale`} tone="accent" />{/if}
      <Stat value={usd(fleet.cash)} label="new money" />
      {#if fleet.paid}<Stat value={ownUsd(fleet.paid)} label="already paid (owned CCUs)" />{/if}
      <Stat value={usd(savedVsMsrp(fleet))} label="saved vs MSRP" valueTone={savedVsMsrp(fleet) > 0 ? 'ok' : savedVsMsrp(fleet) < 0 ? 'err' : null} />
      {#if fleet.failed}<Stat value={`${fleet.failed} of ${chains.length}`} label={`chain${fleet.failed === 1 ? ' has' : 's have'} no route today`} valueTone="warn" />{/if}
    </StatGrid>

    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head class="w-8"><span class="sr-only">Tick for the cart or export</span></Table.Head>
          <Table.Head class="w-20">Priority</Table.Head>
          <Table.Head>Chain</Table.Head>
          <Table.Head class="text-right">Already spent</Table.Head>
          <Table.Head class="text-right">To pay</Table.Head>
          <Table.Head class="text-right">Saved vs MSRP</Table.Head>
          <Table.Head class="text-right"><span class="sr-only">Actions</span></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each rows as { c, i, leg } (c.id)}
          {@const p = leg?.plan ?? null}
          {@const cc = cartOf(c, leg)}
          {@const sp = spent(c, leg)}
          {@const open = editing.has(c.id)}
          <Table.Row class={cn(open && 'border-b-0')}>
            <Table.Cell><Checkbox checked={pick.has(c.id)} onCheckedChange={(v) => togglePick(c.id, !!v)} aria-label={`Tick ${c.name}`} /></Table.Cell>
            <Table.Cell>
              <div class="flex items-center gap-0.5">
                <span class="bg-background mr-1 grid size-6 place-items-center rounded-full border text-xs font-bold">{i + 1}</span>
                <Button variant="ghost" size="icon-xs" aria-label={`Move ${c.name} up`} disabled={i === 0} onclick={() => move(i, -1)}><ArrowUp /></Button>
                <Button variant="ghost" size="icon-xs" aria-label={`Move ${c.name} down`} disabled={i === chains.length - 1} onclick={() => move(i, 1)}><ArrowDown /></Button>
              </div>
            </Table.Cell>
            <Table.Cell class="whitespace-normal">
              <div class="flex flex-wrap items-center gap-1.5">
                <strong>{c.name}</strong>
                {#if p}<span class="text-muted-foreground text-[11px]">{p.steps.length} step{p.steps.length === 1 ? '' : 's'} · {OBJECTIVE[c.opt.objective]}</span>{/if}
                {#if leg?.auto && p}<Badge variant="info">auto: {name(leg.startId)}</Badge>{/if}
                {#if leg?.lti}<Tag kind="insurance" value="LTI" hint="Upgrades a copy on an LTI pledge — the target keeps LTI" />{:else if c.lti === 'prefer' && p && leg?.startId !== STORE_START}<HintBadge variant="muted" hint="No free LTI copy gets there — a non-LTI copy is used">no LTI copy</HintBadge>{/if}
                {#if p?.waits}<Badge variant="warning">{p.waits} waiting</Badge>{/if}
                {#if leg?.ahead}<HintBadge variant="warning" hint="Nothing on sale today gets there: planned through CCUs bought when they return. The Feed tells you when one is in the store.">planned ahead</HintBadge>{/if}
              </div>
              {#if !p}
                <span class="text-destructive text-xs">No chain today, even planning ahead: {c.auto ? `no free ${c.lti === 'only' ? 'LTI ' : ''}hull of yours is cheaper than the ${name(c.targetId)}` : `the ${name(c.targetId)} is not reachable from the ${name(c.startId)}`}, a stop is not on the way, or a chain above took the CCU it needs.</span>
              {:else}
                <div class="flex flex-wrap items-center gap-1 text-xs">
                  <span class="text-muted-foreground">{name(leg!.startId)}</span>
                  {#each p.steps as s, k (k)}
                    <span class="text-muted-foreground">→</span>
                    <LazyTip tip={`${s.label} · ${s.kind === 'owned' ? (s.paid ? `${ownUsd(s.paid)} already paid` : 'free (gift)') : s.cost ? usd(s.cost) : 'free'}`}>
                      {#snippet trigger({ props })}<button type="button" {...props} class={cn('cursor-help', s.kind === 'future' && 'text-warning', s.kind === 'owned' && 'text-success', (c.opt.via ?? []).includes(s.toId) && 'font-semibold')}>{name(s.toId)}{s.kind === 'future' ? ' ⏳' : ''}</button>{/snippet}
                    </LazyTip>
                  {/each}
                </div>
              {/if}
              {#if cc.inCart || cc.adding || cc.errors.length}
                <div class="flex flex-wrap items-center gap-1.5">
                  {#if cc.adding}<span class="text-muted-foreground text-[11px]">adding…</span>
                  {:else if cc.inCart}<span class={cn('text-[11px]', cc.inCart === cc.total ? 'text-success' : 'text-muted-foreground')}>{cc.inCart}/{cc.total} in cart</span>{/if}
                  {#if cc.errors.length}<HintBadge variant="destructive" hint={cc.errors.join('\n')} class="h-5 text-[11px]">{cc.errors.length} not added</HintBadge>{/if}
                </div>
              {/if}
            </Table.Cell>
            <Table.Cell class="text-right tabular-nums">
              {#if sp.total}{ownUsd(sp.total)}<br /><span class="text-muted-foreground text-[11px]">{[sp.ccu ? `${ownUsd(sp.ccu)} CCUs` : '', sp.ship ? `${ownUsd(sp.ship)} ship` : ''].filter(Boolean).join(' + ')}</span>{:else}<span class="text-muted-foreground">—</span>{/if}
            </Table.Cell>
            <Table.Cell class="text-right tabular-nums">
              {#if p}{usd(p.total - p.later)}<span class="text-muted-foreground ml-1 text-[11px]">now</span>{#if p.later}<br /><span class="text-warning text-[11px]">{usd(p.later)} later</span>{/if}{#if p.cash}<br /><span class="text-muted-foreground text-[11px]">{usd(p.cash)} new money</span>{/if}{:else}<span class="text-muted-foreground">—</span>{/if}
            </Table.Cell>
            <Table.Cell class={cn('text-right tabular-nums', p && savedVsMsrp(p) > 0 && 'text-success', p && savedVsMsrp(p) < 0 && 'text-destructive')}>
              {#if p}{usd(savedVsMsrp(p))}{#if p.msrpDiff > 0}<br /><span class="text-[11px]">{Math.round((100 * savedVsMsrp(p)) / p.msrpDiff)}%</span>{/if}{:else}<span class="text-muted-foreground">—</span>{/if}
            </Table.Cell>
            <Table.Cell class="text-right">
              <div class="flex items-center justify-end gap-1">
                <TipButton variant={open ? 'secondary' : 'ghost'} size="icon-xs" onclick={() => toggleEdit(c.id)} tip="Source, stops, insurance, name" aria-label={`Settings of ${c.name}`} aria-expanded={open}><Settings2 /></TipButton>
                <TipButton variant="ghost" size="icon-xs" onclick={() => copyCodes([c])} tip="Copy this chain as a text code" aria-label={`Copy ${c.name} as a code`}><Copy /></TipButton>
                <TipButton variant="outline" size="xs" onclick={() => onopen(c, leg?.startId ?? c.startId, legExclude(fleet, i, []))} tip={p ? 'Open this chain in the planner above: verify it with RSI, add it to the cart, change it' : 'Open it in the planner above to see why there is no chain and change its options (buyback, warbond, stops), then Update chain'}>Open</TipButton>
                <ConfirmButton onconfirm={() => persist(($state.snapshot(chains) as SavedChain[]).filter((x) => x.id !== c.id))}>Delete</ConfirmButton>
              </div>
            </Table.Cell>
          </Table.Row>
          {#if open}
            <Table.Row class="hover:bg-transparent">
              <Table.Cell colspan={7} class="whitespace-normal">
                <div class="bg-muted/30 grid gap-2 rounded-lg border p-2.5">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-muted-foreground text-xs">Name</span>
                    <Input class="h-7 w-56 text-xs" value={c.name} aria-label="Chain name" onchange={(e) => update(c.id, (x) => ({ ...x, name: (e.currentTarget as HTMLInputElement).value.trim() || x.name }))} />
                    <span class="text-muted-foreground text-[11px]">added {fmtDate(c.at)}</span>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-muted-foreground text-xs">From</span>
                    <Segmented
                      options={[
                        { id: 'auto', label: 'Auto', hint: 'Best free hull you own (or the store, if allowed): most saved vs MSRP' },
                        { id: 'ship', label: 'My ship', hint: 'Upgrade a ship you pick' },
                        { id: 'store', label: 'Store', hint: 'Buy the cheapest standalone ship on sale first' },
                      ]}
                      value={srcOf(c)}
                      onchange={(v) => setSrc(c, v as Src)}
                      ariaLabel={`Source for ${c.name}`}
                      size="sm"
                    />
                    {#if srcOf(c) === 'ship'}
                      <div class="w-[230px]"><ShipSelect {ships} {mine} value={c.startId} onpick={(id) => id != null && update(c.id, (x) => ({ ...x, startId: id }))} ariaLabel={`From ship for ${c.name}`} placeholder="Pick a ship…" /></div>
                    {/if}
                    <span class="text-muted-foreground ml-2 text-xs">Stops</span>
                    {#each c.opt.via ?? [] as v (v)}
                      <Chip removeLabel={`Remove stop ${name(v)}`} onremove={() => setVia(c, (c.opt.via ?? []).filter((x) => x !== v))}>{name(v)}</Chip>
                    {/each}
                    <div class="w-[190px]"><ShipSelect ships={sortedShips} bind:value={() => picks[`via${c.id}`] ?? null, (v) => (picks[`via${c.id}`] = v)} price={false} onpick={(id) => (id != null && !(c.opt.via ?? []).includes(id) && setVia(c, [...(c.opt.via ?? []), id]), (picks[`via${c.id}`] = null))} ariaLabel={`Add a stop for ${c.name}`} placeholder="+ ship to fly on the way" /></div>
                  </div>
                  {#if srcOf(c) !== 'store'}
                    <div class="flex flex-wrap items-center gap-2">
                      <LazyTip tip="A CCU keeps the pledge's insurance: upgrade an LTI copy to end with an LTI ship">
                        {#snippet trigger({ props })}<button type="button" {...props} class="text-muted-foreground cursor-help text-xs">Insurance</button>{/snippet}
                      </LazyTip>
                      <Segmented
                        options={[
                          { id: 'any', label: 'Any', hint: 'Any copy; a non-LTI copy is used first so LTI copies stay free for the chains that want them' },
                          { id: 'prefer', label: 'Prefer LTI', hint: 'Upgrade an LTI copy when one gets there, else any' },
                          { id: 'only', label: 'LTI only', hint: 'Only LTI copies (no store start: a new ship has no LTI)' },
                        ]}
                        value={c.lti ?? 'any'}
                        onchange={(v) => update(c.id, (x) => ({ ...x, lti: v as SavedChain['lti'] }))}
                        ariaLabel={`Insurance for ${c.name}`}
                        size="sm"
                      />
                      {#if srcOf(c) === 'auto'}
                        <SwitchRow
                          id={`chain-store-${c.id}`}
                          size="sm"
                          class={cn('text-xs', c.lti === 'only' && 'opacity-50')}
                          label="May start from a store ship"
                          hint="Buy a standalone ship on sale instead of upgrading one of yours"
                          checked={!!c.storeStart && c.lti !== 'only'}
                          disabled={c.lti === 'only'}
                          onchange={(v) => update(c.id, (x) => ({ ...x, storeStart: v }))}
                        />
                      {/if}
                    </div>
                  {/if}
                  <span class="text-muted-foreground text-[11px]">Objective, warbond / buyback and the other options are the chain's own: <em>Open</em> it in the planner, change them there and press <em>Update chain</em>.</span>
                </div>
              </Table.Cell>
            </Table.Row>
          {/if}
        {/each}
      </Table.Body>
    </Table.Root>

    {#if anyAuto}
      <div class="grid gap-1.5 text-xs">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-muted-foreground">Auto never upgrades</span>
          {#each keep as k (k)}
            <Chip removeLabel={`Allow ${name(k)}`} onremove={() => (keep = keep.filter((x) => x !== k))}>{name(k)}</Chip>
          {/each}
          <div class="w-[220px]"><ShipSelect ships={keepable} mine={keepable} onlyMine bind:value={() => picks.keep ?? null, (v) => (picks.keep = v)} price={false} onpick={(id) => (id != null && addKeep(id), (picks.keep = null))} ariaLabel="Ship to keep" placeholder="+ ship to keep flying" /></div>
          {#if keep.length}<Button variant="ghost" size="xs" onclick={() => (keep = [])}><X /> Clear all</Button>{/if}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <LazyTip tip="Auto upgrades one of these first whenever it gets to the target: cheap LTI tokens, ships you don't fly">
            {#snippet trigger({ props })}<button type="button" {...props} class="text-muted-foreground cursor-help">Auto upgrades first</button>{/snippet}
          </LazyTip>
          {#each prefer as k (k)}
            <Chip variant="success-soft" removeLabel={`Stop preferring ${name(k)}`} onremove={() => (prefer = prefer.filter((x) => x !== k))}>{name(k)}</Chip>
          {/each}
          <div class="w-[220px]"><ShipSelect ships={preferable} mine={preferable} onlyMine bind:value={() => picks.prefer ?? null, (v) => (picks.prefer = v)} price={false} onpick={(id) => (id != null && addPrefer([id]), (picks.prefer = null))} ariaLabel="Ship to upgrade first" placeholder="+ ship to upgrade first" /></div>
          {#if ltiToAdd.length}<TipButton variant="outline" size="xs" onclick={() => addPrefer(ltiToAdd)} tip={ltiToAdd.map((id) => name(id)).join(', ')}><Plus /> my LTI hulls ({ltiToAdd.length})</TipButton>{/if}
          {#if prefer.length}<Button variant="ghost" size="xs" onclick={() => (prefer = [])}><X /> Clear all</Button>{/if}
          {#if labelPrefer.length}
            <LazyTip tip="Pledges you labelled LTI token / CCU fodder on the Pledges page">
              {#snippet trigger({ props })}<button type="button" {...props} class="text-muted-foreground cursor-help text-left">+ from labels: {labelPrefer.map((id) => name(id)).join(', ')}</button>{/snippet}
            </LazyTip>
          {/if}
        </div>
        <span class="text-muted-foreground">{hulls.reduce((n, h) => n + h.count, 0)} hull copies in your hangar · each starts at most one chain{keptByLabel ? ` · ${keptByLabel} pledge${keptByLabel === 1 ? '' : 's'} labelled Keep left out` : ''}</span>
      </div>
    {/if}

    {#if waiting.length}
      <div class="grid gap-1.5">
        <span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Waiting for a sale · the Feed alerts when one is in the store</span>
        <Table.Root>
          <Table.Header>
            <Table.Row><Table.Head>CCU</Table.Head><Table.Head>Chain</Table.Head><Table.Head class="text-right">Planned</Table.Head><Table.Head>History</Table.Head></Table.Row>
          </Table.Header>
          <Table.Body>
            {#each waiting as w, k (k)}
              <Table.Row>
                <Table.Cell><span class="text-muted-foreground">{name(w.s.fromId)} →</span> <strong>{name(w.s.toId)}</strong></Table.Cell>
                <Table.Cell>#{w.i + 1} {chains[w.i]?.name ?? ''}</Table.Cell>
                <Table.Cell class="text-right tabular-nums">{usd(w.s.cost)}{#if w.s.est}<span class="text-muted-foreground ml-1 text-[11px]">last {w.s.est.wb ? 'warbond ' : ''}price, {fmtDate(w.s.est.at)}</span>{/if}</Table.Cell>
                <Table.Cell class="text-muted-foreground text-[11px]">{lastSaleLabel(sales, w.s.toId)}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {/if}
  {/if}
</Section>
