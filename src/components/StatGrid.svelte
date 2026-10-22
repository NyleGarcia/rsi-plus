<script lang="ts">
  /** The KPI-tile row: auto-fit grid of `Stat`s (one min width everywhere). */
  import type { Snippet } from 'svelte';
  import { cn } from '@/lib/utils';

  let { min = 140, class: className = '', children }: { min?: number; class?: string; children: Snippet } = $props();
</script>

<div class={cn('grid gap-2', className)} style={`grid-template-columns: repeat(auto-fit, minmax(${min}px, 1fr))`}>{@render children()}</div>
