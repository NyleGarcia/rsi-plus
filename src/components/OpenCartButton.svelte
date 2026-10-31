<script lang="ts">
  /** "Open RSI cart (n)" — shown once something was added (or always with `always`), one size everywhere. `total` = items in the RSI cart as last read (ledger `snapshot.qty`): shows the button too, with the count. */
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { Button } from '@/components/ui/button';
  import { CART_URL } from '@/lib/cart';

  let { count = 0, total = null, always = false, size = 'sm', class: className = '' }: { count?: number; total?: number | null; always?: boolean; size?: 'sm' | 'default'; class?: string } = $props();
  const label = $derived(count > 0 && total != null && total !== count ? `${count} added · ${total} in cart` : count > 0 ? `${count}` : total ? `${total} in cart` : '');
</script>

{#if always || count > 0 || (total ?? 0) > 0}
  <Button variant="outline" {size} href={CART_URL} target="_blank" rel="noopener" class={className}>Open RSI cart{label ? ` (${label})` : ''} <ExternalLink /></Button>
{/if}
