<script lang="ts">
  /**
   * The "Loading page 3 / 12… 240 pledges" / "240 pledges · loaded <date>" / "Not loaded yet" line under a page title,
   * with a progress bar while loading (Pledges, Buyback, …). Goes in `Card.Header` under `Card.Title`.
   */
  import type { Snippet } from 'svelte';
  import { Progress } from '@/components/ui/progress';

  let {
    loading,
    data,
    count,
    noun,
    empty = 'Not loaded yet.',
    children,
  }: {
    loading: { page: number; count: number; pages?: number | null } | null;
    data: { at: number; complete?: boolean; page?: number } | null;
    /** Rows loaded, for the `n <noun>` text. */
    count: number;
    noun: string;
    empty?: string;
    /** Extra text after the status (owned counts, last-checked notes). */
    children?: Snippet;
  } = $props();
  const pct = $derived(loading?.pages ? Math.min(100, Math.round((100 * loading.page) / loading.pages)) : null);
</script>

<div class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
  {#if loading}
    <span>Loading page {loading.page}{loading.pages ? ` / ${loading.pages}` : ''}… {loading.count} {noun}</span>
    {#if pct != null}<Progress value={pct} class="h-1.5 w-[140px]" aria-label={`${pct}% loaded`} />{/if}
  {:else if data}
    <span>{count} {noun} · {data.complete === false ? `partial (stopped after page ${data.page})` : 'loaded'} {new Date(data.at).toLocaleString()}</span>
  {:else}
    <span>{empty}</span>
  {/if}
  {@render children?.()}
</div>
