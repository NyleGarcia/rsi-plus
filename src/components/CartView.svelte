<script lang="ts">
  /**
   * The RSI cart as last read by a cart ledger: lines, quantity, unit price (RSI's discount struck through), total,
   * with *Check cart* to read it again. Read-only — changing or paying the cart happens on RSI.
   */
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import type { CartLedger } from '@/lib/cart-ui.svelte';
  import { fmtWhen } from '@/lib/fmt';
  import { usd } from '@/lib/store';
  import { cn } from '@/lib/utils';
  import Empty from './Empty.svelte';
  import OpenCartButton from './OpenCartButton.svelte';
  import * as Table from '@/components/ui/table';
  import { Button } from '@/components/ui/button';

  let { cart }: { cart: CartLedger } = $props();
  const snap = $derived(cart.snapshot);
</script>

<div class="grid gap-2">
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="outline" size="sm" disabled={cart.syncing} onclick={() => cart.sync()}><RefreshCw class={cn(cart.syncing && 'animate-spin')} />{cart.syncing ? 'Reading…' : 'Check cart'}</Button>
    <OpenCartButton always size="sm" />
    <span class="text-muted-foreground text-[11px]">
      {#if snap}Read {fmtWhen(snap.at, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}. {/if}Read-only: remove lines and pay on RSI.
    </span>
  </div>
  {#if cart.syncError && !cart.syncing}
    <span class="text-destructive text-[11px]">Could not read the cart: {cart.syncError}</span>
  {/if}
  {#if !snap}
    <Empty>{cart.syncing ? 'Reading your RSI cart…' : 'Cart not read yet. Sign in on robertsspaceindustries.com in this browser, then Check cart.'}</Empty>
  {:else if !snap.lines.length}
    <Empty>Your RSI cart is empty.</Empty>
  {:else}
    <Table.Root>
      <Table.Header>
        <Table.Row><Table.Head>Line</Table.Head><Table.Head class="text-right">Qty</Table.Head><Table.Head class="text-right">Unit</Table.Head><Table.Head class="text-right">Total</Table.Head></Table.Row>
      </Table.Header>
      <Table.Body>
        {#each snap.lines as l (l.id)}
          <Table.Row>
            <Table.Cell class="whitespace-normal">
              <strong>{l.upgrade ?? l.title}</strong>
              {#if l.upgrade && l.title && l.title !== l.upgrade}<br /><span class="text-muted-foreground text-[11px]">{l.title}</span>{/if}
              {#if l.discount || l.discounts.length}<br /><span class="text-success text-[11px]">{[l.discount, ...l.discounts].filter(Boolean).join(' · ')}</span>{/if}
            </Table.Cell>
            <Table.Cell class="text-right tabular-nums">{l.qty}</Table.Cell>
            <Table.Cell class="text-right tabular-nums">
              {#if l.unitDiscounted !== l.unit}<span class="text-muted-foreground mr-1 line-through">{usd(l.unit)}</span>{/if}{usd(l.unitDiscounted)}
            </Table.Cell>
            <Table.Cell class="text-right tabular-nums">{usd(l.unitDiscounted * l.qty)}</Table.Cell>
          </Table.Row>
        {/each}
        <Table.Row>
          <Table.Cell><strong>Total</strong>{#if snap.subTotal !== snap.total}<span class="text-muted-foreground ml-1.5 text-[11px]">subtotal {usd(snap.subTotal)}</span>{/if}</Table.Cell>
          <Table.Cell class="text-right tabular-nums">{snap.qty}</Table.Cell>
          <Table.Cell></Table.Cell>
          <Table.Cell class="text-right tabular-nums"><strong>{usd(snap.total)}</strong></Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table.Root>
  {/if}
</div>
