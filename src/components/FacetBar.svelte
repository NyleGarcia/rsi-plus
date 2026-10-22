<script lang="ts" generics="T">
  /**
   * The filter bar every list page shares: each facet as a labelled row of chips with live counts ("LTI · 12" = rows
   * left if you pick it), ranges as min–max fields, a Reset and "n of m". `primary` facets sit in the open; the rest
   * fold under "More filters (n active)". Values live in the page (`bind:values`) so it can persist them.
   */
  import type { Snippet } from 'svelte';
  import * as Collapsible from '@/components/ui/collapsible';
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import X from '@lucide/svelte/icons/x';
  import { cn } from '@/lib/utils';
  import { CHIP } from './FilterChips.svelte';
  import { activeCount, clearFacets, facetCounts, toggleFacet, type Facet, type FacetValues, type RangeFacet, type RangeValue } from '@/lib/facets';

  let {
    facets,
    ranges = [],
    rows,
    shown,
    values = $bindable({}),
    primary = [],
    keep = [],
    hideEmpty = false,
    class: className = '',
    children,
  }: {
    facets: Facet<T>[];
    ranges?: RangeFacet<T>[];
    /** Every row before facets (for the counts). */
    rows: T[];
    /** Rows after the page applied everything (for "n of m"). */
    shown: number;
    values: FacetValues;
    /** Facet / range ids always visible; others fold. Empty = all visible. */
    primary?: string[];
    /** Value ids Reset leaves alone (a page's tab, search). */
    keep?: string[];
    /** Drop options no row would match. */
    hideEmpty?: boolean;
    class?: string;
    /** Extra controls on the first row (search, sort). */
    children?: Snippet;
  } = $props();

  const counts = $derived(facetCounts(rows, facets, values, ranges));
  const active = $derived(activeCount(values));
  const fold = $derived(primary.length ? [...facets.filter((f) => !primary.includes(f.id)).map((f) => f.id), ...ranges.filter((r) => !primary.includes(r.id)).map((r) => r.id)] : []);
  const foldActive = $derived(fold.filter((id) => values[id] != null && (Array.isArray(values[id]) ? (values[id] as string[]).length : typeof values[id] === 'object' ? (values[id] as RangeValue).min != null || (values[id] as RangeValue).max != null : true)).length);
  let more = $state(false);
  const sel = (f: Facet<T>) => (f.multiple ? ((values[f.id] as string[] | undefined) ?? []) : ((values[f.id] as string | null | undefined) ?? ''));
  const rangeVal = (id: string): RangeValue => (values[id] as RangeValue | undefined) ?? { min: null, max: null };
  const unit = (r: RangeFacet<T>) => (r.unit === 'usd' ? '$' : '');
  function setRange(id: string, k: 'min' | 'max', raw: string) {
    const n = raw.trim() === '' ? null : Number(raw.replace(/[^0-9.]/g, ''));
    values = { ...values, [id]: { ...rangeVal(id), [k]: n == null || Number.isNaN(n) ? null : n } };
  }
</script>

{#snippet facetRow(f: Facet<T>)}
  {@const opts = hideEmpty ? f.options.filter((o) => (counts[f.id]?.[o.id] ?? 0) > 0 || (Array.isArray(sel(f)) ? (sel(f) as string[]).includes(o.id) : sel(f) === o.id)) : f.options}
  {#if opts.length}
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-muted-foreground w-24 shrink-0 text-xs">{f.label}</span>
      <ToggleGroup.Root type={f.multiple ? 'multiple' : 'single'} variant="outline" size="sm" spacing={1} class="flex-wrap" aria-label={f.label} value={sel(f) as never} onValueChange={() => {}}>
        {#each opts as o (o.id)}
          {@const n = counts[f.id]?.[o.id] ?? 0}
          {#if o.hint}
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <ToggleGroup.Item {...props} value={o.id} class={cn(CHIP, !n && 'opacity-50')} onclick={() => (values = toggleFacet(values, f, o.id))}>{o.label} <span class="opacity-70">· {n}</span></ToggleGroup.Item>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content class="max-w-80">{o.hint}</Tooltip.Content>
            </Tooltip.Root>
          {:else}
            <ToggleGroup.Item value={o.id} class={cn(CHIP, !n && 'opacity-50')} onclick={() => (values = toggleFacet(values, f, o.id))}>{o.label} <span class="opacity-70">· {n}</span></ToggleGroup.Item>
          {/if}
        {/each}
      </ToggleGroup.Root>
    </div>
  {/if}
{/snippet}
{#snippet rangeRow(r: RangeFacet<T>)}
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="text-muted-foreground w-24 shrink-0 text-xs">{r.label}</span>
    <Input class="w-24" inputmode="decimal" placeholder={`${unit(r)}min`} aria-label={`${r.label} minimum`} value={rangeVal(r.id).min ?? ''} onchange={(e) => setRange(r.id, 'min', (e.currentTarget as HTMLInputElement).value)} />
    <span class="text-muted-foreground text-xs">–</span>
    <Input class="w-24" inputmode="decimal" placeholder={`${unit(r)}max`} aria-label={`${r.label} maximum`} value={rangeVal(r.id).max ?? ''} onchange={(e) => setRange(r.id, 'max', (e.currentTarget as HTMLInputElement).value)} />
  </div>
{/snippet}

<div class={cn('grid gap-2', className)}>
  {#if children}<div class="flex flex-wrap items-center gap-2">{@render children()}</div>{/if}
  {#each facets.filter((f) => !fold.includes(f.id)) as f (f.id)}{@render facetRow(f)}{/each}
  {#each ranges.filter((r) => !fold.includes(r.id)) as r (r.id)}{@render rangeRow(r)}{/each}
  {#if fold.length}
    <Collapsible.Root bind:open={more} class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <Collapsible.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="xs" class="text-muted-foreground">
              {#if more}<ChevronDown />{:else}<ChevronRight />{/if}
              More filters{foldActive ? ` · ${foldActive} active` : ''}
            </Button>
          {/snippet}
        </Collapsible.Trigger>
        <span class="text-muted-foreground ml-auto text-xs tabular-nums">{shown} of {rows.length}</span>
        {#if active}<Button variant="ghost" size="xs" onclick={() => (values = clearFacets(values, keep))}><X /> Reset{active > 1 ? ` (${active})` : ''}</Button>{/if}
      </div>
      <Collapsible.Content class="grid gap-2">
        {#each facets.filter((f) => fold.includes(f.id)) as f (f.id)}{@render facetRow(f)}{/each}
        {#each ranges.filter((r) => fold.includes(r.id)) as r (r.id)}{@render rangeRow(r)}{/each}
      </Collapsible.Content>
    </Collapsible.Root>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-muted-foreground ml-auto text-xs tabular-nums">{shown} of {rows.length}</span>
      {#if active}<Button variant="ghost" size="xs" onclick={() => (values = clearFacets(values, keep))}><X /> Reset{active > 1 ? ` (${active})` : ''}</Button>{/if}
    </div>
  {/if}
</div>
