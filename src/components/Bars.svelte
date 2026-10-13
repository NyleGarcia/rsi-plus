<script lang="ts">
  /** Plain bar chart (HTML, no SVG scaling issues): one column per point, tallest = 100%. */
  interface Point {
    label: string;
    value: number;
    /** Tooltip detail (e.g. "3 pledges"). */
    hint?: string;
  }
  let { points, fmt = (n: number) => String(n), height = 140, highlightLast = false }: { points: Point[]; fmt?: (n: number) => string; height?: number; highlightLast?: boolean } = $props();
  const max = $derived(Math.max(0, ...points.map((p) => p.value)));
  /** Show every value label only when there's room; otherwise every k-th. */
  const every = $derived(points.length > 16 ? Math.ceil(points.length / 12) : 1);
</script>

{#if !points.length || max <= 0}
  <div class="empty small">No data for this range.</div>
{:else}
  <div class="bars" style={`--h:${height}px`} role="img" aria-label={points.map((p) => `${p.label}: ${fmt(p.value)}`).join(', ')}>
    {#each points as p, i (p.label + i)}
      <div class="col" title={`${p.label}: ${fmt(p.value)}${p.hint ? ` · ${p.hint}` : ''}`}>
        <span class="val" class:hide={i % every !== every - 1 && i !== points.length - 1}>{p.value ? fmt(p.value) : ''}</span>
        <div class="bar" class:last={highlightLast && i === points.length - 1} style={`height:${Math.max(p.value > 0 ? 2 : 0, (100 * p.value) / max)}%`}></div>
        <span class="lbl" class:hide={i % every !== every - 1 && i !== points.length - 1}>{p.label}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: calc(var(--h) + 40px);
    padding: 4px 0;
    min-width: 0;
    overflow: hidden;
  }
  .col {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    height: 100%;
  }
  .bar {
    width: 100%;
    max-width: 48px;
    border-radius: 4px 4px 0 0;
    background: var(--accent);
    opacity: 0.75;
    transition: height 0.3s;
  }
  .col:hover .bar {
    opacity: 1;
  }
  .bar.last {
    background: #ffd166;
  }
  /* width:0 + min-width:100% → the labels add nothing to the chart's min-content width, so 36 columns can't push the
     card wider than its grid cell; text may overlap its neighbour (hidden every k-th column when crowded). */
  .val,
  .lbl {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
    width: 0;
    min-width: 100%;
    text-align: center;
    height: 14px;
    line-height: 14px;
  }
  .val {
    margin-bottom: 2px;
  }
  .lbl {
    margin-top: 4px;
  }
  .hide {
    visibility: hidden;
  }
  .empty {
    color: var(--muted);
    padding: 12px 0;
  }
  .small {
    font-size: 12px;
  }
</style>
