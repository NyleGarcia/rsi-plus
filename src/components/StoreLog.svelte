<script lang="ts">
  /**
   * Store changes (ccugame-style): what the pledge store added and removed between two copies RSI+ read — CCUs and
   * standalone ships from the upgrade catalog, paints / packs / gear … from the listing. Newest first, one group per
   * check and action. Built only from copies read since this log existed, so it starts empty.
   */
  import Plus from '@lucide/svelte/icons/plus';
  import Minus from '@lucide/svelte/icons/minus';
  import { storeLogItem, storeSnapshotItem } from '@/lib/settings';
  import { STORE_CATEGORIES, usd } from '@/lib/store';
  import type { EntryKind, StoreChange, StoreSnapshot } from '@/lib/storelog';
  import Segmented from './Segmented.svelte';
  import * as Card from '@/components/ui/card';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';

  let log = $state<StoreChange[]>([]);
  let snap = $state<StoreSnapshot>({});
  type Show = 'all' | 'add' | 'remove';
  let show = $state<Show>('all');
  let limit = $state(4);
  /** Groups opened past their first few entries. */
  let open = $state(new Set<string>());

  $effect(() => {
    storeLogItem.getValue().then((v) => (log = v));
    storeSnapshotItem.getValue().then((v) => (snap = v));
    const offs = [storeLogItem.watch((v) => (log = v ?? [])), storeSnapshotItem.watch((v) => (snap = v ?? {}))];
    return () => offs.forEach((o) => o());
  });

  const KIND: Record<string, string> = { ccu: 'CCU', ship: 'Ship', ...Object.fromEntries(STORE_CATEGORIES.map((c) => [c.id, c.label])) };
  const kindLabel = (k: EntryKind) => KIND[k] ?? k;
  const shown = $derived(log.filter((c) => show === 'all' || c.action === show));
  const count = (s: Show) => log.filter((c) => s === 'all' || c.action === s).length;
  const since = $derived(Math.min(...[snap.catalog?.at, snap.listing?.at].filter((n): n is number => !!n)));
  const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const FIRST = 6;
  /** A catalog check and a listing check can both log a group of the same kind at the same moment. */
  const groupId = (c: StoreChange) => `${c.at}:${c.action}:${c.entries[0]?.key ?? ''}`;
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">Store changes</Card.Title>
    <Card.Description>
      What the pledge store added and removed: CCUs and standalone ships, paints, packs, gear, game packages, add-ons.
      {#if Number.isFinite(since)}Watching since {when(since)}.{/if} Checked when RSI+ polls (catalog every 30 min with a wishlist, else 6 h; the listing hourly) and when you refresh Browse.
    </Card.Description>
    {#if log.length}
      <Card.Action>
        <Segmented
          size="sm"
          options={[
            { id: 'all', label: `All · ${count('all')}`, hint: 'Every change' },
            { id: 'add', label: `Added · ${count('add')}`, hint: 'New in the store' },
            { id: 'remove', label: `Removed · ${count('remove')}`, hint: 'Gone from the store' },
          ]}
          bind:value={show}
          ariaLabel="Show changes"
        />
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content>
    {#if !log.length}
      <p class="text-muted-foreground m-0 text-sm">
        {Number.isFinite(since) ? 'No changes yet: the store looks the same as at the first check.' : 'Nothing recorded yet: the first check sets the baseline, changes after it show up here.'}
      </p>
    {:else}
      <ol class="m-0 grid list-none gap-2 p-0">
        {#each shown.slice(0, limit) as c (groupId(c))}
          {@const id = groupId(c)}
          {@const all = open.has(id)}
          {@const add = c.action === 'add'}
          <li class="rounded-lg border px-3 py-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class={['inline-flex size-5 items-center justify-center rounded-full', add ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive']} aria-hidden="true">
                {#if add}<Plus class="size-3.5" />{:else}<Minus class="size-3.5" />{/if}
              </span>
              <strong class="text-sm">{add ? 'Added' : 'Removed'} · {c.entries.length === 1 ? c.entries[0]!.name : `${c.entries.length} items`}</strong>
              <span class="text-muted-foreground ml-auto text-xs">{when(c.at)}</span>
            </div>
            {#if c.entries.length > 1 || add}
              <ul class="m-0 mt-1.5 grid list-none gap-0.5 p-0 pl-7 text-[13px]">
                {#each all ? c.entries : c.entries.slice(0, FIRST) as e (e.key)}
                  <li class="flex flex-wrap items-baseline gap-x-2">
                    <span class={add ? '' : 'text-muted-foreground'}>{e.name}</span>
                    <Badge variant="outline" class="text-muted-foreground h-4 px-1 text-[10px]">{kindLabel(e.kind)}</Badge>
                    {#if e.price > 0}<span class="text-muted-foreground tabular-nums text-xs">{usd(e.price)}</span>{/if}
                  </li>
                {/each}
              </ul>
              {#if c.entries.length > FIRST}
                <Button variant="link" size="xs" class="ml-5 h-6" onclick={() => (open = new Set(all ? [...open].filter((x) => x !== id) : [...open, id]))}>
                  {all ? 'Show fewer' : `+${c.entries.length - FIRST} more`}
                </Button>
              {/if}
            {/if}
          </li>
        {/each}
      </ol>
      {#if shown.length > limit}
        <Button variant="outline" size="sm" class="mt-2" onclick={() => (limit += 20)}>Show older ({shown.length - limit} more)</Button>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>
