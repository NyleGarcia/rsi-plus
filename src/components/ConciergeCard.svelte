<script lang="ts">
  /**
   * Chairman's Club status: level, since, RSI's "% until your next level" gauge, a rough "$ to go", the levels earned.
   * Lives on Wallet only (the one place your spend is shown). Reads `/account/concierge` once when
   * nothing is stored or it is older than 12 h; *Refresh* re-reads. Screenshare mode masks the level and the gauge.
   */
  import { clubFromSpend, fetchConcierge, usdToNext, type Concierge } from '@/lib/concierge';
  import { clubSpend, type ClubSpend } from '@/lib/orders';
  import { conciergeItem, ordersItem } from '@/lib/settings';
  import { usd } from '@/lib/store';
  import { own } from '@/lib/privacy.svelte';
  import Stat from './Stat.svelte';
  import StatGrid from './StatGrid.svelte';
  import * as Alert from '@/components/ui/alert';
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
  // ---- the exact figure: cash on every order + subscription payments, from the imported order history (Wallet → Your spend) ----
  let spend = $state<ClubSpend | null>(null);
  $effect(() => {
    const read = (o: Awaited<ReturnType<typeof ordersItem.getValue>>) => (spend = o?.orders.length && o.orders.every((x) => Array.isArray(x.lines)) ? clubSpend(o.orders, o.subs ?? []) : null);
    ordersItem.getValue().then(read);
    return ordersItem.watch(read);
  });
  const calc = $derived(spend ? clubFromSpend(spend.total) : null);
  /** RSI's level and the one the order history gives differ: a page in Billing is missing, or RSI counts something else (VAT, old storefronts). */
  const mismatch = $derived(!!c && !!calc && calc.level !== null && calc.level.toLowerCase() !== c.level.toLowerCase());
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
        <Button variant="outline" disabled={busy} onclick={refresh}>{busy ? '…' : 'Refresh'}</Button>
        <Button variant="outline" href="https://robertsspaceindustries.com/account/concierge" target="_blank" rel="noopener">Concierge <ExternalLink /></Button>
      </div>
    </div>
    {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
    {#if c}
      <StatGrid>
        <Stat value={own(c.level)} label={c.since ? `since ${c.since}` : 'current level'} tone="accent" />
        {#if c.next}
          <Stat value={c.pct != null ? `${own(c.pct)}%` : '—'} label={`of the way to ${c.next}`} class="col-span-2">
            {#if c.pct != null}<Progress value={c.pct} class="h-2 sens" aria-label={gauge} />{/if}
            {#if calc?.toGo != null && !mismatch}
              <span class="text-muted-foreground mt-1 block text-[11.5px]">{own(usd(calc.toGo * 100))} more to spend by the order history ({own(usd(spend!.total * 100))} counted: {own(usd(spend!.orders * 100))} cash on orders{spend!.subs ? ` + ${own(usd(spend!.subs * 100))} subscriptions` : ''}{spend!.refunds ? ` − ${own(usd(spend!.refunds * 100))} refunded` : ''}){#if toGo != null} · RSI's gauge says ≈ {own(usd(toGo * 100))}{/if}</span>
            {:else if toGo != null}
              <span class="text-muted-foreground mt-1 block text-[11.5px]">≈ {own(usd(toGo * 100))} more to spend — RSI's gauge against its published tier thresholds (VAT, merch and subscriptions count; gifts received don't). Import the order history on Wallet for the exact figure.</span>
            {/if}
          </Stat>
        {:else}
          <Stat value="Top level" label="nothing above this one" />
        {/if}
        {#if spend}<Stat value={own(usd(spend.total * 100))} label="counted spend (order history)" hint="Cash charged on every order plus subscription payments, refunds taken off — what RSI's Chairman's Club counts. Store credit spent again and gifts received don't add." />{/if}
        {#if c.store.length}<Stat value={c.store.length} label="Concierge-only specials in the store"><a class="text-primary text-[11.5px]" href="#browse?who=concierge">See them in Store →</a></Stat>{/if}
      </StatGrid>
      {#if mismatch && spend && calc}
        <Alert.Root variant="warning"><Alert.Description class="text-xs">The order history adds up to {own(usd(spend.total * 100))}, which is {calc.level} by RSI's thresholds, but RSI shows {c.level}. Re-import the order history (a Billing page may have been skipped), or RSI counts something the page doesn't list (VAT, older storefronts).</Alert.Description></Alert.Root>
      {/if}
      {#if c.earned.length > 1}
        <div class="flex flex-wrap items-center gap-1 text-xs">
          <span class="text-muted-foreground">Earned:</span>
          {#each c.earned as lvl (lvl)}<Badge variant={lvl === c.level ? 'info' : 'outline'}>{lvl}</Badge>{/each}
        </div>
      {/if}
    {/if}
  </div>
