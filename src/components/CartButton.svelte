<script lang="ts">
  /**
   * The "+ cart" control in its three states (button / adding… / in cart) with the error label under it — one look on
   * every page (ghost icon button; `text` for a labelled button). State comes from a `createCartLedger()`.
   */
  import Check from '@lucide/svelte/icons/check';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import TipButton from './TipButton.svelte';
  import HintBadge from './HintBadge.svelte';
  import { cartErrorLabel, type CartState } from '@/lib/cart-ui.svelte';
  import { cn } from '@/lib/utils';

  let {
    state,
    onadd,
    name = '',
    available = true,
    busy = false,
    qty = 1,
    text = false,
    label = 'Add to cart',
    hint = null,
    class: className = '',
  }: {
    state?: CartState;
    onadd: () => void;
    name?: string;
    available?: boolean;
    busy?: boolean;
    qty?: number;
    /** Labelled outline button instead of the icon. */
    text?: boolean;
    label?: string;
    hint?: string | null;
    class?: string;
  } = $props();
  const tip = $derived(hint ?? (available ? `Add ${qty > 1 ? `${qty}× ` : ''}${name ? `${name} ` : ''}to your RSI cart (nothing is paid)` : 'Out of stock'));
</script>

{#if state?.st === 'added'}
  <span class={cn('text-success inline-flex items-center gap-0.5 text-[11px]', className)}><Check class="size-3" /> in cart{state.price != null ? ` · ${state.price}` : ''}</span>
{:else if state?.st === 'adding'}
  <span class={cn('text-muted-foreground text-[11px]', className)}>adding…</span>
{:else}
  <span class={cn('inline-flex flex-wrap items-center gap-1', className)}>
    {#if text}
      <TipButton variant="outline" size="xs" disabled={busy || !available} onclick={onadd} {tip}><ShoppingCart />{label}</TipButton>
    {:else}
      <TipButton variant="ghost" size="icon-xs" class="text-primary size-6" disabled={busy || !available} onclick={onadd} {tip} aria-label={`${label}${name ? `: ${name}` : ''}`}><ShoppingCart class="size-3.5" /></TipButton>
    {/if}
    {#if state?.st === 'error'}<HintBadge variant="destructive" hint={state.msg} class="h-5 text-[11px]">{cartErrorLabel(state.code)}</HintBadge>{/if}
  </span>
{/if}
