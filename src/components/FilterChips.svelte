<script lang="ts" module>
  /** The one filter-chip look (FilterChips, FacetBar). */
  export const CHIP = 'h-6 rounded-full px-2.5 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary';
</script>

<script lang="ts" generics="V extends string">
  /** Filter chips (pledge types, item categories): a rounded ToggleGroup with one look; `multiple` binds a Set. */
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import LazyTip from './LazyTip.svelte';
  import { cn } from '@/lib/utils';

  let {
    options,
    value = $bindable(),
    multiple = false,
    ariaLabel,
    class: className = '',
  }: {
    /** `hint` = tooltip (mounted on first hover); `count` = a muted number after the label (0 keeps the chip but dims it). */
    options: { id: V; label: string; hint?: string; count?: number }[];
    /** single: the id or `null`; multiple: a Set of ids. */
    value: V | null | Set<V>;
    multiple?: boolean;
    ariaLabel: string;
    class?: string;
  } = $props();
</script>

{#snippet chip(o: { id: V; label: string; hint?: string; count?: number })}
  <LazyTip tip={o.hint}>
    {#snippet trigger({ props })}
      <ToggleGroup.Item {...props} value={o.id} class={cn(CHIP, o.count === 0 && 'opacity-60')}>
        {o.label}{#if o.count != null}<span class="text-muted-foreground ml-1 tabular-nums">{o.count}</span>{/if}
      </ToggleGroup.Item>
    {/snippet}
  </LazyTip>
{/snippet}

{#if multiple}
  <ToggleGroup.Root type="multiple" variant="outline" size="sm" spacing={1} class={cn('flex-wrap', className)} aria-label={ariaLabel} bind:value={() => [...((value as Set<V>) ?? [])], (v) => (value = new Set(v as V[]))}>
    {#each options as o (o.id)}{@render chip(o)}{/each}
  </ToggleGroup.Root>
{:else}
  <ToggleGroup.Root type="single" variant="outline" size="sm" spacing={1} class={cn('flex-wrap', className)} aria-label={ariaLabel} bind:value={() => (value as V | null) ?? '', (v) => (value = (v || null) as V | null)}>
    {#each options as o (o.id)}{@render chip(o)}{/each}
  </ToggleGroup.Root>
{/if}
