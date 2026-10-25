<script lang="ts">
  /**
   * Fleet plan: several CCU goals planned together (`planFleet`) — each goal a target, an optional source (auto picks
   * the best free hull copy) and stops on the way. Goals are priority-ordered: an earlier goal gets first pick of your
   * owned CCUs and hulls. Pay-now vs later totals over the whole plan, a list of the CCUs still waiting for a sale, and
   * Save plan → one saved chain per goal (grouped), which the Feed watches like any saved chain.
   */
  import { planFleet, STORE_START, type Goal, type OwnedCcu, type PlanOptions, type SavedChain } from '@/lib/ccu';
  import { ccuGoalsItem } from '@/lib/settings';
  import { usd, type CatalogShip, type SaleHistory } from '@/lib/store';
  import { ownUsd } from '@/lib/privacy.svelte';
  import { transient } from '@/lib/flash.svelte';
  import { lastSaleLabel, shipName, uid } from '@/lib/ccu-ui';
  import ShipSelect from './ShipSelect.svelte';
  import Segmented from './Segmented.svelte';
  import Stat from './Stat.svelte';
  import StatGrid from './StatGrid.svelte';
  import Chip from './Chip.svelte';
  import HintBadge from './HintBadge.svelte';
  import LazyTip from './LazyTip.svelte';
  import SwitchRow from './SwitchRow.svelte';
  import TipButton from './TipButton.svelte';
  import Tag from './Tag.svelte';
  import * as Alert from '@/components/ui/alert';
  import * as Table from '@/components/ui/table';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { cn } from '@/lib/utils';
  import { fmtDate } from '@/lib/dates';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';

  let {
    ships,
    mine,
    hulls,
    lti = [],
    labelPrefer = [],
    keptByLabel = 0,
    owned,
    opt,
    sales,
    chains,
    persist,
    onopen,
  }: {
    ships: CatalogShip[];
    /** Ships you own (for the pickers). */
    mine: CatalogShip[];
    /** Hull copies you own (`ownedHulls`). */
    hulls: { id: number; count: number }[];
    /** Hulls you own on an LTI pledge — offered as "prefer" in one click (LTI tokens). */
    lti?: number[];
    /** Hulls on pledges labelled *LTI token* / *CCU fodder* — preferred on top of the list here. */
    labelPrefer?: number[];
    /** Pledges labelled *Keep* (left out of `hulls`), for the note. */
    keptByLabel?: number;
    owned: OwnedCcu[];
    /** Planner options (objective, warbond, buyback…, saved-chain exclusions) shared with the single planner. */
    opt: PlanOptions;
    sales: SaleHistory;
    chains: SavedChain[];
    persist: (next: SavedChain[]) => Promise<void>;
    /** Open one goal's chain in the single planner (verify, cart). */
    onopen: (startId: number, targetId: number, via: number[]) => void;
  } = $props();

  let goals = $state<Goal[]>([]);
  let keep = $state<number[]>([]);
  let prefer = $state<number[]>([]);
  let loaded = $state(false);
  $effect(() => {
    ccuGoalsItem.getValue().then((v) => {
      // The store-start option used to be plan-wide: carry it into each goal that has none of its own.
      goals = v.goals.map((g) => (g.storeStart === undefined ? { ...g, storeStart: v.storeStart } : g));
      keep = v.keep;
      prefer = v.prefer ?? [];
      loaded = true;
    });
  });
  $effect(() => {
    const v = { goals: $state.snapshot(goals), keep: $state.snapshot(keep), prefer: $state.snapshot(prefer), storeStart: false };
    if (loaded) ccuGoalsItem.setValue(v);
  });

  const byId = $derived(new Map(ships.map((s) => [s.id, s])));
  const name = (id: number | null) => shipName(byId, id);
  const fleet = $derived(planFleet(ships, owned, goals, opt, { hulls, keep, prefer: [...new Set([...prefer, ...labelPrefer])] }));
  const payNow = $derived(fleet.total - fleet.later);
  /** Every CCU the plan waits for, cheapest first: hull, which goal, planned cost, when last seen on sale. */
  const waiting = $derived(
    fleet.legs
      .flatMap((l, i) => (l.plan?.steps ?? []).filter((s) => s.kind === 'future').map((s) => ({ s, goal: i + 1 })))
      .sort((a, b) => a.s.cost - b.s.cost),
  );
  const seen = (id: number) => lastSaleLabel(sales, id);

  // ---- editing goals ----
  let addTo = $state<number | null>(null);
  /** The goal picker hides ships you already own unless asked (a goal is usually a ship you don't have yet). */
  let wantOwned = $state(false);
  const wantable = $derived(wantOwned ? ships : ships.filter((s) => !mine.some((m) => m.id === s.id)));
  /** One-shot pickers (stops, keep): bound here and cleared after each pick so they read empty again. */
  let picks = $state<Record<string, number | null>>({});
  function addGoal(id: number | null) {
    if (id == null) return;
    goals = [...goals, { id: uid(), fromId: null, targetId: id, via: [], storeStart: false, lti: 'any' }];
    addTo = null;
  }
  const edit = (i: number, g: Partial<Goal>) => (goals = goals.map((x, j) => (j === i ? { ...x, ...g } : x)));
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= goals.length) return;
    const next = [...goals];
    [next[i], next[j]] = [next[j]!, next[i]!];
    goals = next;
  }
  type Src = 'auto' | 'store' | 'ship';
  const srcOf = (g: Goal): Src => (g.fromId == null ? 'auto' : g.fromId === STORE_START ? 'store' : 'ship');
  function setSrc(i: number, s: Src) {
    const g = goals[i]!;
    if (s === srcOf(g)) return;
    edit(i, { fromId: s === 'auto' ? null : s === 'store' ? STORE_START : (mine.find((m) => m.msrp < (byId.get(g.targetId)?.msrp ?? 0))?.id ?? mine[0]?.id ?? null) });
  }
  const sortedShips = $derived([...ships].sort((a, b) => a.name.localeCompare(b.name)));
  // A hull is in at most one of the two lists: adding it to one takes it out of the other.
  const keepable = $derived(mine.filter((m) => !keep.includes(m.id)));
  const preferable = $derived(mine.filter((m) => !prefer.includes(m.id)));
  const addKeep = (id: number) => ((keep = [...keep, id]), (prefer = prefer.filter((x) => x !== id)));
  const addPrefer = (ids: number[]) => ((prefer = [...new Set([...prefer, ...ids])]), (keep = keep.filter((x) => !ids.includes(x))));
  const ltiToAdd = $derived(lti.filter((id) => !prefer.includes(id) && mine.some((m) => m.id === id)));

  // ---- save ----
  let planName = $state('');
  const savedMsg = transient(3000);
  async function savePlan() {
    const group = planName.trim() || `Fleet plan ${fmtDate(Date.now())}`;
    const now = Date.now();
    const made: SavedChain[] = fleet.legs
      .filter((l) => l.plan && l.startId != null)
      .map((l, i) => ({
        id: `${uid()}${i}`,
        name: `${name(l.startId)} → ${name(l.goal.targetId)}`,
        group,
        at: now,
        startId: l.startId!,
        targetId: l.goal.targetId,
        steps: $state.snapshot(l.plan!.steps),
        total: l.plan!.total,
        cash: l.plan!.cash,
        opt: { ...$state.snapshot(opt), via: [...l.goal.via] },
      }));
    // Saving under an existing plan name replaces that plan's chains.
    await persist([...chains.filter((c) => c.group !== group), ...made]);
    savedMsg.show(`Saved “${group}” · ${made.length} chain${made.length === 1 ? '' : 's'}`);
  }
</script>

<div class="grid gap-4">
  <fieldset class="border-border m-0 grid min-w-0 gap-3 rounded-lg border px-3 py-2.5">
    <legend class="text-muted-foreground px-1 text-xs">3 · Goals — top first: an earlier goal gets first pick of your CCUs and hulls</legend>
    {#if !goals.length}
      <p class="text-muted-foreground m-0 text-sm">Add the ships you want, near-term and long-term. Each gets its own chain; <em>Auto</em> picks which of your hulls (or a store ship) to upgrade.</p>
    {/if}
    {#each goals as g, i (g.id)}
      {@const leg = fleet.legs[i]}
      <div class="bg-muted/30 grid gap-2 rounded-lg border p-2.5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="bg-background grid size-6 place-items-center rounded-full border text-xs font-bold">{i + 1}</span>
          <strong class="text-sm">{name(g.targetId)}</strong>
          <span class="text-muted-foreground text-xs">{usd(byId.get(g.targetId)?.msrp ?? 0)}</span>
          <span class="flex-1"></span>
          <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0} onclick={() => move(i, -1)}><ArrowUp /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === goals.length - 1} onclick={() => move(i, 1)}><ArrowDown /></Button>
          <Button variant="ghost" size="icon-xs" aria-label={`Remove ${name(g.targetId)}`} onclick={() => (goals = goals.filter((x) => x.id !== g.id))}><X /></Button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-muted-foreground text-xs">From</span>
          <Segmented
            options={[
              { id: 'auto', label: 'Auto', hint: 'Best free hull you own (or the store, if allowed) — most saved vs MSRP' },
              { id: 'ship', label: 'My ship', hint: 'Upgrade a ship you pick' },
              { id: 'store', label: 'Store', hint: 'Buy the cheapest standalone ship on sale first' },
            ]}
            value={srcOf(g)}
            onchange={(v) => setSrc(i, v as Src)}
            ariaLabel={`Source for ${name(g.targetId)}`}
            size="sm"
          />
          {#if srcOf(g) === 'ship'}
            <div class="w-[230px]"><ShipSelect {ships} {mine} value={g.fromId} onpick={(id) => id != null && edit(i, { fromId: id })} ariaLabel={`From ship for ${name(g.targetId)}`} placeholder="Pick a ship…" /></div>
          {/if}
          <span class="text-muted-foreground ml-2 text-xs">Stops</span>
          {#each g.via as v (v)}
            <Chip removeLabel={`Remove stop ${name(v)}`} onremove={() => edit(i, { via: g.via.filter((x) => x !== v) })}>{name(v)}</Chip>
          {/each}
          <div class="w-[190px]"><ShipSelect ships={sortedShips} bind:value={() => picks[`via${g.id}`] ?? null, (v) => (picks[`via${g.id}`] = v)} price={false} onpick={(id) => (id != null && !g.via.includes(id) && edit(i, { via: [...g.via, id] }), (picks[`via${g.id}`] = null))} ariaLabel={`Add a stop for ${name(g.targetId)}`} placeholder="+ ship to fly on the way" /></div>
        </div>
        {#if srcOf(g) !== 'store'}
          <div class="flex flex-wrap items-center gap-2">
            <LazyTip tip="A CCU keeps the pledge's insurance: upgrade an LTI copy to end with an LTI ship">
              {#snippet trigger({ props })}<button type="button" {...props} class="text-muted-foreground cursor-help text-xs">Insurance</button>{/snippet}
            </LazyTip>
            <Segmented
              options={[
                { id: 'any', label: 'Any', hint: 'Any copy; a non-LTI copy is used first so LTI copies stay free for LTI goals' },
                { id: 'prefer', label: 'Prefer LTI', hint: 'Upgrade an LTI copy when one gets there, else any' },
                { id: 'only', label: 'LTI only', hint: 'Only LTI copies (no store start — a new ship has no LTI)' },
              ]}
              value={g.lti ?? 'any'}
              onchange={(v) => edit(i, { lti: v as Goal['lti'] })}
              ariaLabel={`Insurance for ${name(g.targetId)}`}
              size="sm"
            />
            {#if srcOf(g) === 'auto'}
              <SwitchRow
                id={`fleet-store-${g.id}`}
                size="sm"
                class={cn('text-xs', g.lti === 'only' && 'opacity-50')}
                label="May start from a store ship"
                hint="Buy a standalone ship on sale instead of upgrading one of yours"
                checked={!!g.storeStart && g.lti !== 'only'}
                disabled={g.lti === 'only'}
                onchange={(v) => edit(i, { storeStart: v })}
              />
            {/if}
          </div>
        {/if}
        {#if leg}
          {#if !leg.plan}
            <Alert.Root variant="destructive"><Alert.Description class="text-xs">No chain, even planning ahead — {leg.auto ? `no free ${g.lti === 'only' ? 'LTI ' : ''}hull of yours is cheaper than the target` : 'not reachable from that source'}, or a stop is not between source and target.</Alert.Description></Alert.Root>
          {:else}
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              {#if leg.auto}<Badge variant="info">auto: {name(leg.startId)}</Badge>{/if}
              {#if leg.lti}<Tag kind="insurance" value="LTI" hint="Upgrades a copy on an LTI pledge — the target keeps LTI" />{:else if g.lti === 'prefer' && leg.startId !== STORE_START}<HintBadge variant="muted" hint="No free LTI copy gets there — a non-LTI copy is used">no LTI copy</HintBadge>{/if}
              {#if leg.ahead}<HintBadge variant="warning" hint="Nothing on sale today gets there — planned through CCUs at MSRP, bought when they return">planned ahead</HintBadge>{/if}
              <span class="text-muted-foreground">{name(leg.startId)}</span>
              {#each leg.plan.steps as s, k (k)}
                <span class="text-muted-foreground">→</span>
                <LazyTip tip={`${s.label} · ${s.cost ? usd(s.cost) : 'free'}`}>
                  {#snippet trigger({ props })}<button type="button" {...props} class={cn('cursor-help', s.kind === 'future' && 'text-warning', s.kind === 'owned' && 'text-success', g.via.includes(s.toId) && 'font-semibold')}>{name(s.toId)}{s.kind === 'future' ? ' ⏳' : ''}</button>{/snippet}
                </LazyTip>
              {/each}
              <span class="flex-1"></span>
              <span class="tabular-nums">{usd(leg.plan.total - leg.plan.later)} now{leg.plan.later ? ` · ${usd(leg.plan.later)} later` : ''} · <span class={cn(leg.plan.savings > 0 && 'text-success')}>{usd(leg.plan.savings)} saved</span></span>
              <TipButton variant="outline" size="xs" onclick={() => leg.startId != null && onopen(leg.startId, g.targetId, g.via)} tip="Open this chain in the single planner to verify it with RSI and add it to the cart">Open</TipButton>
            </div>
          {/if}
        {/if}
      </div>
    {/each}
    <div class="flex flex-wrap items-center gap-2">
      <div class="w-[260px]"><ShipSelect ships={wantable} mine={wantOwned ? mine : []} saleTag bind:value={addTo} onpick={addGoal} ariaLabel="Add a goal ship" placeholder="+ Add a ship you want…" /></div>
      <SwitchRow id="fleet-want-owned" size="sm" class="text-xs" label="Include ships I own" hint="List the ships already in your hangar too (another copy, or a goal you already reached)" checked={wantOwned} onchange={(v) => (wantOwned = v)} />
    </div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-muted-foreground">Never auto-upgrade</span>
      {#each keep as k (k)}
        <Chip removeLabel={`Allow ${name(k)}`} onremove={() => (keep = keep.filter((x) => x !== k))}>{name(k)}</Chip>
      {/each}
      <div class="w-[220px]"><ShipSelect ships={keepable} mine={keepable} onlyMine bind:value={() => picks.keep ?? null, (v) => (picks.keep = v)} price={false} onpick={(id) => (id != null && addKeep(id), (picks.keep = null))} ariaLabel="Ship to keep" placeholder="+ ship to keep flying" /></div>
      {#if keep.length}<Button variant="ghost" size="xs" onclick={() => (keep = [])}><X /> Clear all</Button>{/if}
    </div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <LazyTip tip="Auto upgrades one of these first whenever it gets to the target — cheap LTI tokens, ships you don't fly">
        {#snippet trigger({ props })}<button type="button" {...props} class="text-muted-foreground cursor-help">Prefer to upgrade</button>{/snippet}
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
    <span class="text-muted-foreground text-xs">{hulls.reduce((n, h) => n + h.count, 0)} hull copies in your hangar · each starts at most one chain · Auto tries preferred hulls first, never the kept ones{keptByLabel ? ` · ${keptByLabel} pledge${keptByLabel === 1 ? '' : 's'} labelled Keep left out` : ''}</span>
  </fieldset>

  {#if goals.length}
    <StatGrid>
      <Stat value={usd(payNow)} label="to pay now" />
      {#if fleet.waits}<Stat value={usd(fleet.later)} label={`later · ${fleet.waits} CCU${fleet.waits === 1 ? '' : 's'} wait for a sale`} tone="accent" />{/if}
      <Stat value={usd(fleet.cash)} label="new money" />
      {#if fleet.paid}<Stat value={ownUsd(fleet.paid)} label="already paid (owned CCUs)" />{/if}
      <Stat value={usd(fleet.savings)} label="saved vs MSRP" valueTone={fleet.savings > 0 ? 'ok' : fleet.savings < 0 ? 'err' : null} />
      <Stat value={`${goals.length - fleet.failed} / ${goals.length}`} label="goals with a chain" valueTone={fleet.failed ? 'warn' : 'ok'} />
    </StatGrid>

    {#if waiting.length}
      <div class="grid gap-1.5">
        <span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Waiting for a sale · the Feed alerts once the plan is saved</span>
        <Table.Root>
          <Table.Header>
            <Table.Row><Table.Head>CCU</Table.Head><Table.Head>Goal</Table.Head><Table.Head class="text-right">Planned</Table.Head><Table.Head>History</Table.Head></Table.Row>
          </Table.Header>
          <Table.Body>
            {#each waiting as w, i (i)}
              <Table.Row>
                <Table.Cell><span class="text-muted-foreground">{name(w.s.fromId)} →</span> <strong>{name(w.s.toId)}</strong></Table.Cell>
                <Table.Cell>#{w.goal} {name(goals[w.goal - 1]?.targetId ?? null)}</Table.Cell>
                <Table.Cell class="text-right tabular-nums">{usd(w.s.cost)}</Table.Cell>
                <Table.Cell class="text-muted-foreground text-[11px]">{seen(w.s.toId)}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {/if}

    <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), savePlan())}>
      <Input class="w-56" placeholder="Plan name (optional)" bind:value={planName} aria-label="Plan name" />
      <Button size="sm" type="submit" disabled={fleet.failed === goals.length}><Plus /> Save plan</Button>
      <span class="text-muted-foreground text-[11px]">One saved chain per goal; saving again under the same name replaces them. Saved chains keep their CCUs out of new plans.</span>
      {#if savedMsg.text}<span class="text-success text-[11px]">{savedMsg.text}</span>{/if}
    </form>
  {/if}
</div>
