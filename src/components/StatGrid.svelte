<script lang="ts">
  /** The KPI-tile row: auto-fit grid of `Stat`s. `divided` rules the band above and below with hairlines between tiles (Stats Band look). */
  import type { Snippet } from 'svelte';
  import { cn } from '@/lib/utils';

  let { min = 140, layout = 'plain', class: className = '', children }: { min?: number; layout?: 'plain' | 'divided'; class?: string; children: Snippet } = $props();
</script>

<div class={cn('grid', layout === 'divided' ? 'gap-px border-y bg-border/60 py-px *:rounded-none *:border-0 *:bg-card' : 'gap-2', className)} style={`grid-template-columns: repeat(auto-fit, minmax(${min}px, 1fr))`}>{@render children()}</div>
