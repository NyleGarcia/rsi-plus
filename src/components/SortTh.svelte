<script lang="ts" generics="K extends string">
  // Sortable table header: click to sort, click again to flip. aria-sort for screen readers.
  import { nextSort, type Dir, type SortState } from '@/lib/sort';
  import type { Snippet } from 'svelte';
  import * as Table from '@/components/ui/table';
  import { Button } from '@/components/ui/button';
  import { cn } from '@/lib/utils';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';

  let {
    key,
    sort = $bindable(),
    firstDir = 'asc',
    children,
  }: { key: K; sort: SortState<K>; firstDir?: Dir; children: Snippet } = $props();

  const active = $derived(sort.key === key);
</script>

<Table.Head aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
  <Button
    variant="ghost"
    size="xs"
    class={cn('-ml-2 font-semibold text-muted-foreground hover:text-foreground', active && 'text-foreground')}
    onclick={() => (sort = nextSort(sort, key, firstDir))}
  >
    {@render children()}
    {#if active && sort.dir === 'asc'}
      <ArrowUp class="text-primary" aria-hidden="true" />
    {:else if active}
      <ArrowDown class="text-primary" aria-hidden="true" />
    {:else}
      <ArrowUpDown class="opacity-45" aria-hidden="true" />
    {/if}
  </Button>
</Table.Head>
