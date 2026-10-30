<script lang="ts">
  /**
   * Icon-only link to an item's Star Citizen Wiki page (`lib/wiki.ts` builds the URL; null → renders nothing).
   * Pass the catalog / RSI item name, never a custom ship name — the tooltip and label show it.
   */
  import TipButton from './TipButton.svelte';
  import Globe from '@lucide/svelte/icons/globe';
  import { cn } from '@/lib/utils';

  let { href, name, class: className = '' }: { href: string | null | undefined; name: string; class?: string } = $props();
  const label = $derived(`${name} on the Star Citizen Wiki`);
</script>

{#if href}
  <TipButton variant="ghost" size="icon-xs" class={cn('text-muted-foreground hover:text-primary shrink-0 align-middle', className)} {href} target="_blank" rel="noopener" tip={label} aria-label={label}><Globe /></TipButton>
{/if}
