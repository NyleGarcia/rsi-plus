<script lang="ts" generics="T">
  /**
   * The filter bar every list page shares — a toolbar of filter buttons, like a data table's: each facet is a button
   * that opens a list of its options with live counts ("how many rows if I pick this"), ranges open a slider with
   * min / max fields, the rest hide behind *+ Filter*. What is applied shows as removable chips underneath with
   * *Clear all*; *n of m* on the right. Values live in the page (`bind:values`) so it can persist them.
   */
  import type { Snippet } from 'svelte';
  import * as Popover from '@/components/ui/popover';
  import * as DropdownMenu from '@/components/ui/dropdown-menu';
  import { Button } from '@/components/ui/button';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import { Slider } from '@/components/ui/slider';
  import Chip from './Chip.svelte';
  import Empty from './Empty.svelte';
  import LazyTip from './LazyTip.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import Check from '@lucide/svelte/icons/check';
  import { cn } from '@/lib/utils';
  import { usd0 } from '@/lib/money';
  import { indexFor, clearFacets, facetCounts, isActive, toggleFacet, type Facet, type FacetValues, type RangeFacet, type RangeValue } from '@/lib/facets';

  let {
    facets,
    ranges = [],
    rows,
    shown,
    values = $bindable({}),
    primary = [],
    keep = [],
    defaults = {},
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
    /** Facet / range ids always shown as buttons; others sit under "+ Filter" until used. Empty = all shown. */
    primary?: string[];
    /** Value ids Reset leaves alone (a page's tab, search). */
    keep?: string[];
    /** What Reset returns to (e.g. `{ stock: 'in' }`); a value equal to its default does not count as active. */
    defaults?: FacetValues;
    /** Drop options no row would match. */
    hideEmpty?: boolean;
    class?: string;
    /** Leading controls (search, sort). */
    children?: Snippet;
  } = $props();

  /** Predicates run once per rows / facets change; every click after that is bit tests. */
  const index = $derived(indexFor(rows, facets, ranges));
  const counts = $derived(facetCounts(rows, facets, values, ranges, index));
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const deviates = (id: string) => !same(values[id], defaults[id]) && (isActive(values[id]) || isActive(defaults[id]));
  const active = $derived([...new Set([...Object.keys(values), ...Object.keys(defaults)])].filter(deviates).length);
  /** Buttons on the bar: the primary ones, plus any other facet that is in use (added through + Filter). */
  let added = $state<string[]>([]);
  const visibleIds = $derived(primary.length ? [...primary, ...added, ...[...facets.map((f) => f.id), ...ranges.map((r) => r.id)].filter((id) => !primary.includes(id) && !added.includes(id) && isActive(values[id]))] : []);
  const isVisible = (id: string) => !primary.length || visibleIds.includes(id);
  const hidden = $derived([...facets.filter((f) => !isVisible(f.id)).map((f) => ({ id: f.id, label: f.label })), ...ranges.filter((r) => !isVisible(r.id)).map((r) => ({ id: r.id, label: r.label }))]);
  let openId = $state<string | null>(null);
  function addFilter(id: string) {
    added = [...added, id];
    openId = id;
  }

  const sel = (f: Facet<T>): string[] => {
    const v = values[f.id];
    return Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [];
  };
  const optLabel = (f: Facet<T>, id: string) => f.options.find((o) => o.id === id)?.label ?? id;
  const summary = (f: Facet<T>) => {
    const s = sel(f);
    return s.length === 0 ? '' : s.length === 1 ? optLabel(f, s[0]!) : `${optLabel(f, s[0]!)} +${s.length - 1}`;
  };
  const rangeVal = (id: string): RangeValue => (values[id] as RangeValue | undefined) ?? { min: null, max: null };
  const money = (r: RangeFacet<T>, n: number) => (r.unit === 'usd' ? usd0(n) : String(Math.round(n)));
  const rangeText = (r: RangeFacet<T>) => {
    const v = rangeVal(r.id);
    if (v.min == null && v.max == null) return '';
    return `${v.min != null ? money(r, v.min) : '…'} – ${v.max != null ? money(r, v.max) : '…'}`;
  };
  /** Slider domain from the rows (rounded out), so the thumbs start at the data's edges. */
  const domain = (r: RangeFacet<T>): [number, number] => {
    let lo = Infinity,
      hi = -Infinity;
    for (const row of rows) {
      const n = r.get(row);
      if (n == null) continue;
      if (n < lo) lo = n;
      if (n > hi) hi = n;
    }
    if (lo === Infinity) return [0, 0];
    const step = r.unit === 'usd' ? 5 : 1;
    return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
  };
  function setRange(id: string, v: RangeValue) {
    values = { ...values, [id]: v.min == null && v.max == null ? undefined : v };
  }
  function removeOption(f: Facet<T>, id: string) {
    values = toggleFacet(values, f, id);
  }
  const resetAll = () => {
    values = { ...clearFacets(values, keep), ...defaults };
    added = [];
  };
  /** Chips: one per picked option, one per bounded range. */
  const chips = $derived([
    ...facets.flatMap((f) => (deviates(f.id) ? sel(f).map((id) => ({ key: `${f.id}:${id}`, label: f.label, value: optLabel(f, id), remove: () => removeOption(f, id) })) : [])),
    ...ranges.filter((r) => deviates(r.id)).map((r) => ({ key: r.id, label: r.label, value: rangeText(r), remove: () => setRange(r.id, { min: null, max: null }) })),
  ]);
</script>

{#snippet facetButton(f: Facet<T>)}
  {@const picked = sel(f)}
  {@const opts = hideEmpty ? f.options.filter((o) => (counts[f.id]?.[o.id] ?? 0) > 0 || picked.includes(o.id)) : f.options}
  <Popover.Root open={openId === f.id} onOpenChange={(o) => (openId = o ? f.id : openId === f.id ? null : openId)}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="outline" size="sm" class={cn('gap-1', picked.length && 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')} aria-label={`${f.label} filter${picked.length ? `: ${summary(f)}` : ''}`}>
          {f.label}{#if picked.length}<span class="font-normal opacity-80">: {summary(f)}</span>{/if}
          <ChevronDown class="opacity-60" />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content align="start" class="w-64 p-1.5">
      {#if f.hint}<p class="text-muted-foreground m-0 px-1.5 pt-1 pb-2 text-xs">{f.hint}</p>{/if}
      <div class="grid max-h-80 gap-0.5 overflow-y-auto" role="group" aria-label={f.label}>
        {#each opts as o (o.id)}
          {@const n = counts[f.id]?.[o.id] ?? 0}
          {@const on = picked.includes(o.id)}
          <LazyTip tip={o.hint} side="right" class="w-full">
            {#snippet trigger({ props })}
              <label {...props} class={cn('hover:bg-muted flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm', !n && !on && 'opacity-50')}>
                {#if f.multiple}
                  <Checkbox checked={on} onCheckedChange={() => (values = toggleFacet(values, f, o.id))} aria-label={o.label} />
                {:else}
                  <button type="button" class={cn('border-input flex size-4 shrink-0 items-center justify-center rounded-full border', on && 'border-primary bg-primary text-primary-foreground')} role="radio" aria-checked={on} aria-label={o.label} onclick={() => (values = toggleFacet(values, f, o.id))}>{#if on}<Check class="size-3" />{/if}</button>
                {/if}
                <span class="min-w-0 flex-1 truncate">{o.label}</span>
                <span class="text-muted-foreground text-xs tabular-nums">{n}</span>
              </label>
            {/snippet}
          </LazyTip>
        {:else}
          <Empty class="py-3 text-xs">Nothing to pick here.</Empty>
        {/each}
      </div>
      {#if picked.length}
        <div class="mt-1 border-t pt-1">
          <Button variant="ghost" size="xs" class="w-full justify-start" onclick={() => (values = { ...values, [f.id]: f.multiple ? [] : null })}><X /> Clear {f.label.toLowerCase()}</Button>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/snippet}

{#snippet rangeButton(r: RangeFacet<T>)}
  {@const v = rangeVal(r.id)}
  {@const [lo, hi] = domain(r)}
  {@const on = v.min != null || v.max != null}
  <Popover.Root open={openId === r.id} onOpenChange={(o) => (openId = o ? r.id : openId === r.id ? null : openId)}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="outline" size="sm" class={cn('gap-1', on && 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')} aria-label={`${r.label} range${on ? `: ${rangeText(r)}` : ''}`}>
          {r.label}{#if on}<span class="font-normal opacity-80">: {rangeText(r)}</span>{/if}
          <ChevronDown class="opacity-60" />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content align="start" class="w-72 p-3">
      <div class="grid gap-3">
        <div class="text-muted-foreground flex justify-between text-xs tabular-nums"><span>{money(r, lo)}</span><span>{money(r, hi)}</span></div>
        {#if hi > lo}
          <Slider type="multiple" min={lo} max={hi} step={r.unit === 'usd' ? 1 : 1} value={[v.min ?? lo, v.max ?? hi]} onValueCommit={(val: number[]) => setRange(r.id, { min: val[0]! <= lo ? null : val[0]!, max: val[1]! >= hi ? null : val[1]! })} aria-label={`${r.label} range`} />
        {/if}
        <div class="flex items-center gap-2">
          <Input class="w-full" inputmode="decimal" placeholder={r.unit === 'usd' ? '$ min' : 'min'} aria-label={`${r.label} minimum`} value={v.min ?? ''} onchange={(e) => setRange(r.id, { ...v, min: Number((e.currentTarget as HTMLInputElement).value.replace(/[^0-9.]/g, '')) || null })} />
          <span class="text-muted-foreground">–</span>
          <Input class="w-full" inputmode="decimal" placeholder={r.unit === 'usd' ? '$ max' : 'max'} aria-label={`${r.label} maximum`} value={v.max ?? ''} onchange={(e) => setRange(r.id, { ...v, max: Number((e.currentTarget as HTMLInputElement).value.replace(/[^0-9.]/g, '')) || null })} />
        </div>
        {#if on}<Button variant="ghost" size="xs" class="justify-start" onclick={() => setRange(r.id, { min: null, max: null })}><X /> Clear {r.label.toLowerCase()}</Button>{/if}
      </div>
    </Popover.Content>
  </Popover.Root>
{/snippet}

<div class={cn('grid gap-2', className)}>
  <div class="flex flex-wrap items-center gap-2">
    {@render children?.()}
    {#each facets.filter((f) => isVisible(f.id)) as f (f.id)}{@render facetButton(f)}{/each}
    {#each ranges.filter((r) => isVisible(r.id)) as r (r.id)}{@render rangeButton(r)}{/each}
    {#if hidden.length}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="sm" class="text-muted-foreground gap-1"><Plus /> Filter</Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="w-56">
          {#each hidden as h (h.id)}<DropdownMenu.Item onSelect={() => addFilter(h.id)}>{h.label}</DropdownMenu.Item>{/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
    <span class="text-muted-foreground ml-auto text-xs tabular-nums whitespace-nowrap">{shown} of {rows.length}</span>
  </div>
  {#if chips.length}
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active filters">
      {#each chips as c (c.key)}
        <Chip variant="outline" onremove={c.remove} removeLabel={`Remove ${c.label}: ${c.value}`}><span class="text-muted-foreground">{c.label}:</span> {c.value}</Chip>
      {/each}
      {#if active}<Button variant="ghost" size="xs" class="text-muted-foreground" onclick={resetAll}>Clear all{active > 1 ? ` (${active})` : ''}</Button>{/if}
    </div>
  {/if}
</div>
