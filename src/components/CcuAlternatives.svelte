<script lang="ts">
  /**
   * "Other routes" under the single chain: up to three chains that differ from the one shown (`planAlternatives`).
   * Planned only once asked for (a button), then kept up to date while open. *Use this route* hands what that route
   * takes out (SKUs to skip, CCUs to exclude) to the panel, which re-plans; they show in its *Ignored* chips.
   */
  import { planAlternatives, STORE_START, type Alternative, type OwnedCcu, type Plan, type PlanOptions } from '@/lib/ccu';
  import { shipName } from '@/lib/ccu-ui';
  import { usd, type CatalogShip } from '@/lib/store';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import TipButton from './TipButton.svelte';
  import Route from '@lucide/svelte/icons/route';

  let {
    ships,
    owned,
    startId,
    targetId,
    opt,
    best,
    onuse,
  }: {
    ships: CatalogShip[];
    owned: OwnedCcu[];
    startId: number;
    targetId: number;
    /** The options the shown chain was planned with. */
    opt: PlanOptions;
    best: Plan;
    onuse: (alt: Alternative) => void;
  } = $props();

  let open = $state(false);
  const byId = $derived(new Map(ships.map((s) => [s.id, s])));
  const alts = $derived(open ? planAlternatives(ships, owned, startId, targetId, opt, 3) : []);
  const route = (p: Plan) => [startId === STORE_START ? null : startId, ...p.steps.map((s) => s.toId)].filter((id): id is number => id != null).map((id) => shipName(byId, id)).join(' → ');
  const diff = (p: Plan) => p.total - best.total;
</script>

<div class="grid gap-2">
  {#if !open}
    <div>
      <TipButton variant="outline" size="sm" onclick={() => (open = true)} tip="Other chains to the same target: each without one step of this chain (a waiting step included), plus the route without the CCUs you own"><Route />Show other routes</TipButton>
    </div>
  {:else}
    <div class="flex items-center gap-2">
      <span class="text-sm font-medium">Other routes</span>
      <Button variant="link" size="xs" class="h-auto p-0 text-[11px]" onclick={() => (open = false)}>hide</Button>
    </div>
    {#if !alts.length}
      <p class="text-muted-foreground m-0 text-[11px]">No other route: every other way to the target needs a step of this chain.</p>
    {:else}
      <ol class="m-0 grid list-none gap-1.5 p-0" aria-label="Other routes">
        {#each alts as a, i (i)}
          <li class="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
            <div class="grid min-w-0 gap-0.5">
              <span class="text-sm">
                <span class="text-muted-foreground tabular-nums">{i + 1}.</span>
                {#if a.tag === 'without-owned'}<Badge variant="info" class="mr-1">without my CCUs</Badge>{:else if a.tag === 'with-owned'}<Badge variant="success" class="mr-1">with my CCUs</Badge>{:else if a.noWait.length}<Badge variant="warning" class="mr-1">no wait</Badge>{/if}
                {route(a.plan)}
              </span>
              <span class="text-muted-foreground text-[11px] tabular-nums">
                {usd(a.plan.total)} total · {usd(a.plan.cash)} new money{a.plan.paid ? ` · ${usd(a.plan.paid)} of your CCUs used` : ''}{a.plan.waits ? ` · ${a.plan.waits} waiting` : ''} ·
                {#if diff(a.plan) > 0}<span class="text-warning">+{usd(diff(a.plan))} more than this chain</span>{:else if diff(a.plan) < 0}<span class="text-success">{usd(-diff(a.plan))} less than this chain</span>{:else}same price{/if}
              </span>
            </div>
            <TipButton variant="outline" size="xs" onclick={() => onuse(a)} tip={a.useOwned === false ? "Plan this route instead: switches off Use CCUs I own (under Options)" : a.useOwned ? "Plan this route instead: switches Use CCUs I own back on" : "Plan this route instead: the step it leaves out is ignored (undo under Options)"}>Use this route</TipButton>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</div>
