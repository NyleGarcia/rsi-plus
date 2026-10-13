<script lang="ts" generics="K extends string">
  // Sortable table header: click to sort, click again to flip. aria-sort for screen readers.
  import { nextSort, type Dir, type SortState } from '@/lib/sort';
  import type { Snippet } from 'svelte';

  let {
    key,
    sort = $bindable(),
    firstDir = 'asc',
    children,
  }: { key: K; sort: SortState<K>; firstDir?: Dir; children: Snippet } = $props();

  const active = $derived(sort.key === key);
</script>

<th aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
  <button type="button" class:active onclick={() => (sort = nextSort(sort, key, firstDir))}>
    {@render children()}
    <span class="arrow" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
  </button>
</th>

<style>
  button {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    gap: 5px;
    align-items: center;
    color: var(--muted);
    font-weight: 600;
    font-size: 12px;
    white-space: nowrap;
  }
  button:hover,
  button.active {
    color: var(--text);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .arrow {
    font-size: 10px;
    opacity: 0.45;
  }
  .active .arrow {
    opacity: 1;
    color: var(--accent);
  }
</style>
