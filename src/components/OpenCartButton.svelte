<script lang="ts">
  /** "Open RSI cart (n)" — shown once something was added (or always with `always`), one size everywhere. */
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { Button } from '@/components/ui/button';
  import { CART_URL } from '@/lib/cart';

  let { count = 0, always = false, size = 'sm', class: className = '' }: { count?: number; always?: boolean; size?: 'sm' | 'default'; class?: string } = $props();
</script>

{#if always || count > 0}
  <Button variant="outline" {size} href={CART_URL} target="_blank" rel="noopener" class={className}>Open RSI cart{count > 0 ? ` (${count})` : ''} <ExternalLink /></Button>
{/if}
