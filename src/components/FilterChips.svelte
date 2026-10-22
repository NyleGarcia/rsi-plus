<script lang="ts" generics="V extends string">
  /** Filter chips (pledge types, item categories): a rounded ToggleGroup with one look; `multiple` binds a Set. */
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import { cn } from '@/lib/utils';

  export const CHIP = 'h-6 rounded-full px-2.5 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary';

  let {
    options,
    value = $bindable(),
    multiple = false,
    ariaLabel,
    class: className = '',
  }: {
    options: { id: V; label: string; hint?: string }[];
    /** single: the id or `null`; multiple: a Set of ids. */
    value: V | null | Set<V>;
    multiple?: boolean;
    ariaLabel: string;
    class?: string;
  } = $props();
</script>

{#if multiple}
  <ToggleGroup.Root type="multiple" variant="outline" size="sm" spacing={1} class={cn('flex-wrap', className)} aria-label={ariaLabel} bind:value={() => [...((value as Set<V>) ?? [])], (v) => (value = new Set(v as V[]))}>
    {#each options as o (o.id)}<ToggleGroup.Item value={o.id} class={CHIP}>{o.label}</ToggleGroup.Item>{/each}
  </ToggleGroup.Root>
{:else}
  <ToggleGroup.Root type="single" variant="outline" size="sm" spacing={1} class={cn('flex-wrap', className)} aria-label={ariaLabel} bind:value={() => (value as V | null) ?? '', (v) => (value = (v || null) as V | null)}>
    {#each options as o (o.id)}<ToggleGroup.Item value={o.id} class={CHIP}>{o.label}</ToggleGroup.Item>{/each}
  </ToggleGroup.Root>
{/if}
