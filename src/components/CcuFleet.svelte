<script lang="ts">
  /**
   * Fleet plan: several CCU goals planned together (`planFleet`) — each goal a target, an optional source (auto picks
   * the best free hull copy) and stops on the way. Goals are priority-ordered: an earlier goal gets first pick of your
   * owned CCUs and hulls. Pay-now vs later totals over the whole plan, a list of the CCUs still waiting for a sale, and
   * Save plan → one saved chain per goal (grouped), which the Feed watches like any saved chain.
   */
  import { planFleet, STORE_START, type Goal, type OwnedCcu, type PlanOptions, type SavedChain } from '@/lib/ccu';
  import { ccuGoalsItem } from '@/lib/settings';
  import { lastSale, usd, type CatalogShip, type SaleHistory } from '@/lib/store';
  import { ownUsd } from '@/lib/privacy.svelte';
  import ShipSelect from './ShipSelect.svelte';
  import Segmented from './Segmented.svelte';
  import Stat from './Stat.svelte';
  import * as Table from '@/components/ui/table';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import { cn } from '@/lib/utils';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';

  let {
    ships,
    mine,
    hulls,
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
  let storeStart = $state(false);
  let loaded = $state(false);
  $effect(() => {
    ccuGoalsItem.getValue().then((v) => {
      goals = v.goals;
      keep = v.keep;
      storeStart = v.storeStart;
      loaded = true;
    });
  });
  $effect(() => {
    const v = { goals: $state.snapshot(goals), keep: $state.snapshot(keep), storeStart };
    if (loaded) ccuGoalsItem.setValue(v);
  });

  const byId = $derived(new Map(ships.map((s) => [s.id, s])));
  const name = (id: number | null) => (id == null ? 'Auto' : id === STORE_START ? 'Store' : (byId.get(id)?.name ?? `#${id}`));
  const fleet = $derived(planFleet(ships, owned, goals, opt, { hulls, keep, storeStart }));
  const payNow = $derived(fleet.total - fleet.later);
  /** Every CCU the plan waits for, cheapest first: hull, which goal, planned cost, when last seen on sale. */
  const waiting = $derived(
    fleet.legs
      .flatMap((l, i) => (l.plan?.steps ?? []).filter((s) => s.kind === 'future').map((s) => ({ s, goal: i + 1 })))
      .sort((a, b) => a.s.cost - b.s.cost),
  );
  const seen = (id: number) => {
    const t = lastSale(sales, id);
    return t ? `last on sale ${new Date(t).toLocaleDateString()}` : 'not seen on sale yet';
  };

  // ---- editing goals ----
  let addTo = $state<number | null>(null);
  /** One-shot pickers (stops, keep): bound here and cleared after each pick so they read empty again. */
  let picks = $state<Record<string, number | null>>({});
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  function addGoal(id: number | null) {
    if (id == null) return;
    goals = [...goals, { id: uid(), fromId: null, targetId: id, via: [] }];
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
  const keepable = $derived(mine.filter((m) => !keep.includes(m.id)));

  // ---- save ----
  let planName = $state('');
  let savedMsg = $state('');
  async function savePlan() {
    const group = planName.trim() || `Fleet plan ${new Date().toLocaleDateString()}`;
    const now = Date.now();
    const made: SavedChain[] = fleet.legs
      .filter((l) => l.plan && l.startId != null)
      .map((l, i) => ({
        id: `${now.toString(36)}${i}${Math.random().toString(36).slice(2, 5)}`,
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
    savedMsg = `Saved “${group}” · ${made.length} chain${made.length === 1 ? '' : 's'}`;
    setTimeout(() => (savedMsg = ''), 3000);
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
            <Badge variant="secondary" class="gap-1 pr-0.5">{name(v)}<Button variant="ghost" size="icon-xs" class="size-4" aria-label={`Remove stop ${name(v)}`} onclick={() => edit(i, { via: g.via.filter((x) => x !== v) })}><X /></Button></Badge>
          {/each}
          <div class="w-[190px]"><ShipSelect ships={sortedShips} bind:value={() => picks[`via${g.id}`] ?? null, (v) => (picks[`via${g.id}`] = v)} price={false} onpick={(id) => (id != null && !g.via.includes(id) && edit(i, { via: [...g.via, id] }), (picks[`via${g.id}`] = null))} ariaLabel={`Add a stop for ${name(g.targetId)}`} placeholder="+ ship to fly on the way" /></div>
        </div>
        {#if leg}
          {#if !leg.plan}
            <span class="text-destructive text-xs">No chain, even planning ahead — {leg.auto ? 'no free hull of yours is cheaper than the target' : 'not reachable from that source'}, or a stop is not between source and target.</span>
          {:else}
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              {#if leg.auto}<Badge variant="outline" class="text-primary">auto: {name(leg.startId)}</Badge>{/if}
              {#if leg.ahead}<Badge variant="outline" class="border-warning/40 text-warning" title="Nothing on sale today gets there — planned through CCUs at MSRP, bought when they return">planned ahead</Badge>{/if}
              <span class="text-muted-foreground">{name(leg.startId)}</span>
              {#each leg.plan.steps as s, k (k)}
                <span class="text-muted-foreground">→</span>
                <span class={cn(s.kind === 'future' && 'text-warning', s.kind === 'owned' && 'text-success', g.via.includes(s.toId) && 'font-semibold')} title={`${s.label} · ${s.cost ? usd(s.cost) : 'free'}`}>{name(s.toId)}{s.kind === 'future' ? ' ⏳' : ''}</span>
              {/each}
              <span class="flex-1"></span>
              <span class="tabular-nums">{usd(leg.plan.total - leg.plan.later)} now{leg.plan.later ? ` · ${usd(leg.plan.later)} later` : ''} · <span class={cn(leg.plan.savings > 0 && 'text-success')}>{usd(leg.plan.savings)} saved</span></span>
              <Button variant="outline" size="xs" onclick={() => leg.startId != null && onopen(leg.startId, g.targetId, g.via)} title="Open this chain in the single planner to verify it with RSI and add it to the cart">Open</Button>
            </div>
          {/if}
        {/if}
      </div>
    {/each}
    <div class="flex flex-wrap items-center gap-2">
      <div class="w-[260px]"><ShipSelect {ships} {mine} saleTag bind:value={addTo} onpick={addGoal} ariaLabel="Add a goal ship" placeholder="+ Add a ship you want…" /></div>
      <label class="text-muted-foreground flex items-center gap-2 text-xs" title="An Auto goal may start by buying a standalone ship on sale instead of upgrading one of yours"><Checkbox bind:checked={storeStart} /> Auto may start from a store ship</label>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-muted-foreground">Never auto-upgrade</span>
      {#each keep as k (k)}
        <Badge variant="secondary" class="gap-1 pr-0.5">{name(k)}<Button variant="ghost" size="icon-xs" class="size-4" aria-label={`Allow ${name(k)}`} onclick={() => (keep = keep.filter((x) => x !== k))}><X /></Button></Badge>
      {/each}
      <div class="w-[220px]"><ShipSelect ships={keepable} mine={keepable} onlyMine bind:value={() => picks.keep ?? null, (v) => (picks.keep = v)} price={false} onpick={(id) => (id != null && (keep = [...keep, id]), (picks.keep = null))} ariaLabel="Ship to keep" placeholder="+ ship to keep flying" /></div>
      <span class="text-muted-foreground">{hulls.reduce((n, h) => n + h.count, 0)} hull copies in your hangar · each starts at most one chain</span>
    </div>
  </fieldset>

  {#if goals.length}
    <div class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
      <Stat value={usd(payNow)} label="to pay now" />
      {#if fleet.waits}<Stat value={usd(fleet.later)} label={`later · ${fleet.waits} CCU${fleet.waits === 1 ? '' : 's'} wait for a sale`} tone="accent" />{/if}
      <Stat value={usd(fleet.cash)} label="new money" />
      {#if fleet.paid}<Stat value={ownUsd(fleet.paid)} label="already paid (owned CCUs)" />{/if}
      <Stat value={usd(fleet.savings)} label="saved vs MSRP" valueTone={fleet.savings > 0 ? 'ok' : fleet.savings < 0 ? 'err' : null} />
      <Stat value={`${goals.length - fleet.failed} / ${goals.length}`} label="goals with a chain" valueTone={fleet.failed ? 'warn' : 'ok'} />
    </div>

    {#if waiting.length}
      <div class="grid gap-1.5">
        <span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Waiting for a sale · the Feed alerts once the plan is saved</span>
        <Table.Root>
          <Table.Header>
            <Table.Row><Table.Head>CCU</Table.Head><Table.Head>Goal</Table.Head><Table.Head>Planned</Table.Head><Table.Head>History</Table.Head></Table.Row>
          </Table.Header>
          <Table.Body>
            {#each waiting as w, i (i)}
              <Table.Row>
                <Table.Cell><span class="text-muted-foreground">{name(w.s.fromId)} →</span> <strong>{name(w.s.toId)}</strong></Table.Cell>
                <Table.Cell>#{w.goal} {name(goals[w.goal - 1]?.targetId ?? null)}</Table.Cell>
                <Table.Cell class="tabular-nums">{usd(w.s.cost)}</Table.Cell>
                <Table.Cell class="text-muted-foreground text-[11px]">{seen(w.s.toId)}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {/if}

    <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), savePlan())}>
      <Input class="h-7 w-56" placeholder="Plan name (optional)" bind:value={planName} aria-label="Plan name" />
      <Button size="sm" type="submit" disabled={fleet.failed === goals.length}><Plus /> Save plan</Button>
      <span class="text-muted-foreground text-[11px]">One saved chain per goal; saving again under the same name replaces them. Saved chains keep their CCUs out of new plans.</span>
      {#if savedMsg}<span class="text-success text-[11px]">{savedMsg}</span>{/if}
    </form>
  {/if}
</div>
