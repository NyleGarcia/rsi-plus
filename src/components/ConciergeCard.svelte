<script lang="ts">
  /**
   * Chairman's Club status: level, since, RSI's "% until your next level" gauge, a rough "$ to go", the levels earned.
   * Lives on Wallet only (the one place your spend is shown). Reads `/account/concierge` once when
   * nothing is stored or it is older than 12 h; *Refresh* re-reads. Screenshare mode masks the level and the gauge.
   */
  import { fetchConcierge, usdToNext, type Concierge } from '@/lib/concierge';
  import { conciergeItem } from '@/lib/settings';
  import { usd } from '@/lib/store';
  import { own } from '@/lib/privacy.svelte';
  import Stat from './Stat.svelte';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Progress } from '@/components/ui/progress';
  import ExternalLink from '@lucide/svelte/icons/external-link';

  let c = $state<Concierge | null>(null);
  let known = $state(false); // storage read (null = not Concierge / never read)
  let busy = $state(false);
  let error = $state('');
  const STALE = 12 * 60 * 60_000;

  $effect(() => {
    conciergeItem.getValue().then((v) => {
      c = v;
      known = true;
      if (!v || Date.now() - v.at > STALE) refresh();
    });
    return conciergeItem.watch((v) => (c = v));
  });
  async function refresh() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const v = await fetchConcierge();
      await conciergeItem.setValue(v);
      c = v;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  const toGo = $derived(c ? usdToNext(c) : null);
  const gauge = $derived(c?.pct != null && c.next ? `${own(c.pct)}% to ${c.next}` : c?.next ? `next: ${c.next}` : 'top level');
</script>

  <div class="grid gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="grid leading-tight">
        <strong class="text-sm">Chairman's Club</strong>
        <span class="text-muted-foreground text-xs">
          {#if c}Read {new Date(c.at).toLocaleString()} from your Concierge page.{:else if !known || busy}Reading your Concierge page…{:else}No Chairman's Club status on your account (it starts at $1,000 total spend).{/if}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy} onclick={refresh}>{busy ? '…' : 'Refresh'}</Button>
        <Button variant="outline" size="sm" href="https://robertsspaceindustries.com/account/concierge" target="_blank" rel="noopener">Concierge <ExternalLink /></Button>
      </div>
    </div>
    {#if error}<span class="text-destructive text-xs">{error}</span>{/if}
    {#if c}
      <div class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
        <Stat value={own(c.level)} label={c.since ? `since ${c.since}` : 'current level'} tone="accent" />
        {#if c.next}
          <Stat value={c.pct != null ? `${own(c.pct)}%` : '—'} label={`of the way to ${c.next}`} class="col-span-2">
            {#if c.pct != null}<Progress value={c.pct} class="h-2 sens" aria-label={gauge} />{/if}
            {#if toGo != null}<span class="text-muted-foreground mt-1 block text-[11.5px]">≈ {own(usd(toGo * 100))} more to spend — RSI's gauge against its published tier thresholds (VAT, merch and subscriptions count; gifts received don't)</span>{/if}
          </Stat>
        {:else}
          <Stat value="Top level" label="nothing above this one" />
        {/if}
        {#if c.store.length}<Stat value={c.store.length} label="Concierge-only specials in the store"><a class="text-primary text-[11.5px]" href="#browse?who=concierge">See them in Store →</a></Stat>{/if}
      </div>
      {#if c.earned.length > 1}
        <div class="flex flex-wrap items-center gap-1 text-xs">
          <span class="text-muted-foreground">Earned:</span>
          {#each c.earned as lvl (lvl)}<Badge variant="outline" class={lvl === c.level ? 'border-primary/50 text-primary' : ''}>{lvl}</Badge>{/each}
        </div>
      {/if}
    {/if}
  </div>
