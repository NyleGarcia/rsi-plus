<script lang="ts">
  import { fetchLoaners, LOANER_ARTICLE, LOANER_MAX_AGE, matchLoaners, myLoaners, type LoanerMatrix } from '@/lib/loaners';
  import { loanersItem } from '@/lib/settings';
  import { ago, fmtDate } from '@/lib/dates';
  import { LINK } from '@/lib/ui';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import * as Collapsible from '@/components/ui/collapsible';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import { Input } from '@/components/ui/input';
  import Empty from './Empty.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';

  /** Ships you own: store hulls by id, and hangar ship titles the store catalog doesn't sell (negative ids). */
  let { owned }: { owned: { id: number; name: string }[] } = $props();

  let matrix = $state<LoanerMatrix | null>(null);
  let loading = $state(false);
  let error = $state('');
  let ctl: AbortController | null = null;

  async function refresh() {
    ctl?.abort();
    const c = (ctl = new AbortController());
    loading = true;
    error = '';
    try {
      const m = await fetchLoaners(c.signal);
      matrix = m;
      await loanersItem.setValue(m);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = `Loaner Ship Matrix: ${(e as Error).message}`;
    } finally {
      if (ctl === c) loading = false;
    }
  }
  $effect(() => {
    loanersItem.getValue().then((m) => {
      matrix = m;
      if (!m || Date.now() - m.at > LOANER_MAX_AGE) refresh();
    });
    return () => ctl?.abort();
  });

  const rows = $derived(matrix?.rows ?? []);
  const byShip = $derived(matchLoaners(rows, owned));
  const mine = $derived(owned.filter((s) => byShip.has(s.id)).sort((a, b) => a.name.localeCompare(b.name)));
  const yours = $derived(myLoaners(owned, byShip));
  const mineRows = $derived(new Set(mine.map((s) => byShip.get(s.id)!)));

  let q = $state('');
  let open = $state(false);
  const shown = $derived.by(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => `${r.ship} ${r.loaners.join(' ')}`.toLowerCase().includes(t)) : rows;
  });
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Loaners <span class="text-muted-foreground">({yours.length})</span></Card.Title>
    <Card.Description>
      What RSI lends you to fly while a ship you pledged for isn't flight ready, from RSI's Loaner Ship Matrix. Needs a game package on the account. Loaners don't stack: one of each, however many of your ships grant it.
    </Card.Description>
    <Card.Action class="flex items-center gap-2">
      <a class="{LINK} inline-flex items-center gap-1 text-xs" href={LOANER_ARTICLE} target="_blank" rel="noopener"><ExternalLink class="size-3" /> RSI article</a>
      <Button variant="outline" size="sm" disabled={loading} onclick={refresh}><RefreshCw class={loading ? 'size-3.5 animate-spin' : 'size-3.5'} /> Refresh</Button>
    </Card.Action>
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if error}<p class="text-destructive text-xs">{error}</p>{/if}
    {#if !matrix}
      <p class="text-muted-foreground text-sm">{loading ? 'Reading the Loaner Ship Matrix…' : 'Not loaded yet.'}</p>
    {:else}
      {#if yours.length}
        <div class="flex flex-wrap gap-1.5">
          {#each yours as l (l.name)}
            <Badge variant="secondary" title={`From: ${l.from.join(', ')}`}>{l.name}{#if l.from.length > 1}<span class="text-muted-foreground ml-1">×{l.from.length} ships</span>{/if}</Badge>
          {/each}
        </div>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Your ship</Table.Head>
              <Table.Head>Loaners</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each mine as s (s.id)}
              <Table.Row>
                <Table.Cell class="font-medium">{s.name}</Table.Cell>
                <Table.Cell>{byShip.get(s.id)!.loaners.join(', ')}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {:else}
        <p class="text-muted-foreground text-sm">{owned.length ? 'None of your ships are on the matrix: they are all flight ready.' : 'Load your hangar to see which loaners your ships get.'}</p>
      {/if}

      <Collapsible.Root bind:open class="rounded-lg border px-3 py-1.5">
        <Collapsible.Trigger class="focus-visible:ring-ring/50 flex w-full cursor-pointer items-center gap-2 rounded py-1 text-left text-[13px] font-semibold outline-none focus-visible:ring-2">
          <ChevronDown class={open ? 'size-3.5' : 'size-3.5 -rotate-90'} /> Full matrix <span class="text-muted-foreground font-normal">({rows.length} ships)</span>
        </Collapsible.Trigger>
        <Collapsible.Content class="grid gap-2 pt-2 pb-1">
          <Input class="w-64" placeholder="Search ship or loaner" bind:value={q} aria-label="Search the loaner matrix" />
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Ship</Table.Head>
                <Table.Head>Loaners</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each shown as r (r.ship)}
                <Table.Row class={mineRows.has(r) ? 'bg-primary/5' : ''}>
                  <Table.Cell class="font-medium">{r.ship}{#if mineRows.has(r)}<Badge variant="outline" class="ml-1.5 text-[10px]">yours</Badge>{/if}</Table.Cell>
                  <Table.Cell>{r.loaners.join(', ')}</Table.Cell>
                </Table.Row>
              {/each}
              {#if !shown.length}<Empty colspan={2}>Nothing matches.</Empty>{/if}
            </Table.Body>
          </Table.Root>
        </Collapsible.Content>
      </Collapsible.Root>
      <p class="text-muted-foreground text-[11px]">
        {matrix.updated ? `RSI updated the matrix ${fmtDate(new Date(matrix.updated))}` : 'From RSI support'} · read {ago(matrix.at)}. Not a 1:1 substitute, and RSI support can't swap loaners.
      </p>
    {/if}
  </Card.Content>
</Card.Root>
