<script lang="ts">
  /** A removable chip: Badge + the × button (saved stops, tags, excluded hulls). */
  import type { Snippet } from 'svelte';
  import X from '@lucide/svelte/icons/x';
  import { Badge, type BadgeVariant } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { cn } from '@/lib/utils';

  let {
    onremove = null,
    removeLabel = 'Remove',
    variant = 'secondary',
    class: className = '',
    children,
  }: { onremove?: (() => void) | null; removeLabel?: string; variant?: BadgeVariant; class?: string; children: Snippet } = $props();
</script>

<Badge {variant} class={cn('gap-1 pr-1', className)}>
  {@render children()}
  {#if onremove}<Button variant="ghost" size="icon-xs" class="size-4 rounded-full" onclick={onremove} aria-label={removeLabel}><X class="size-3" /></Button>{/if}
</Badge>
