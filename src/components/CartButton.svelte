<script lang="ts">
  /**
   * The "+ cart" control in its three states (button / adding… / in cart) with the error label under it — one look on
   * every page (ghost icon button; `text` for a labelled button). State comes from a `createCartLedger()`.
   * `inCart` = copies already in the RSI cart (the ledger's `qtyOf`): shown as a badge, and the first click then only
   * asks *Add another?* — a second click within 5 s adds, so a duplicate is a choice, not an accident.
   */
  import Check from '@lucide/svelte/icons/check';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import TipButton from './TipButton.svelte';
  import HintBadge from './HintBadge.svelte';
  import { cartErrorLabel, type CartState } from '@/lib/cart-ui.svelte';
  import { cn } from '@/lib/utils';

  let {
    state: entry, // `state` as a local name would shadow the `$state` rune
    onadd,
    name = '',
    available = true,
    busy = false,
    qty = 1,
    inCart = 0,
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
    /** Copies already in the RSI cart (0 = none / unknown). */
    inCart?: number;
    /** Labelled outline button instead of the icon. */
    text?: boolean;
    label?: string;
    hint?: string | null;
    class?: string;
  } = $props();
  const tip = $derived(hint ?? (available ? `Add ${qty > 1 ? `${qty}× ` : ''}${name ? `${name} ` : ''}to your RSI cart (nothing is paid)` : 'Out of stock'));
  // Already in the cart: the first click arms the button, the second (within 5 s) adds one more.
  let armed = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  function click() {
    if (inCart > 0 && !armed) {
      armed = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (armed = false), 5000);
      return;
    }
    if (timer) clearTimeout(timer);
    armed = false;
    onadd();
  }
  const inTip = $derived(`Already in your RSI cart ×${inCart}`);
</script>

{#if entry?.st === 'added'}
  <span class={cn('text-success inline-flex items-center gap-0.5 text-[11px]', className)}><Check class="size-3" /> in cart{inCart > 1 ? ` ×${inCart}` : ''}{entry.price != null ? ` · ${entry.price}` : ''}</span>
{:else if entry?.st === 'adding'}
  <span class={cn('text-muted-foreground text-[11px]', className)}>adding…</span>
{:else}
  <span class={cn('inline-flex flex-wrap items-center gap-1', className)}>
    {#if armed}
      <TipButton variant="outline" size="xs" class="border-warning/60 text-warning" disabled={busy || !available} onclick={click} tip={`${inTip} — click again to add one more`}><ShoppingCart />Add another?</TipButton>
    {:else if text}
      <TipButton variant="outline" size="xs" disabled={busy || !available} onclick={click} {tip}><ShoppingCart />{label}</TipButton>
    {:else}
      <TipButton variant="ghost" size="icon-xs" class="text-primary size-6" disabled={busy || !available} onclick={click} {tip} aria-label={`${label}${name ? `: ${name}` : ''}`}><ShoppingCart class="size-3.5" /></TipButton>
    {/if}
    {#if inCart > 0 && !armed}<HintBadge variant="info" hint={inTip} class="h-5 text-[11px]">in cart ×{inCart}</HintBadge>{/if}
    {#if entry?.st === 'error'}<HintBadge variant="destructive" hint={entry.msg} class="h-5 text-[11px]">{cartErrorLabel(entry.code)}</HintBadge>{/if}
  </span>
{/if}
