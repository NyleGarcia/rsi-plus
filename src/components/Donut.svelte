<script lang="ts">
  /** Donut (SVG stroke arcs) + legend with value and share. */
  interface Slice {
    label: string;
    value: number;
    count?: number;
  }
  let { slices, fmt = (n: number) => String(n), size = 120 }: { slices: Slice[]; fmt?: (n: number) => string; size?: number } = $props();
  const PALETTE = ['#4cc9f0', '#ffd166', '#ef476f', '#06d6a0', '#8338ec', '#fb8500', '#8ecae6', '#c77dff', '#ffafcc', '#b5e48c'];
  const total = $derived(slices.reduce((s, x) => s + x.value, 0));
  const R = 40;
  const C = 2 * Math.PI * R;
  /** Arcs as [offset, length] fractions of the circumference, in slice order. */
  const arcs = $derived.by(() => {
    let acc = 0;
    return slices.map((s) => {
      const f = total > 0 ? s.value / total : 0;
      const a = { off: acc, len: f };
      acc += f;
      return a;
    });
  });
  const pct = (v: number) => (total > 0 ? `${((100 * v) / total).toLocaleString('en-US', { maximumFractionDigits: 1 })}%` : '—');
</script>

{#if !slices.length || total <= 0}
  <div class="empty small">Nothing to chart.</div>
{:else}
  <div class="donut">
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={slices.map((s) => `${s.label} ${pct(s.value)}`).join(', ')}>
      <circle cx="50" cy="50" r={R} fill="none" stroke="rgb(255 255 255 / 0.06)" stroke-width="14" />
      {#each slices as s, i (s.label)}
        {@const a = arcs[i]!}
        <circle cx="50" cy="50" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} stroke-width="14" stroke-dasharray={`${a.len * C} ${C}`} stroke-dashoffset={-a.off * C} transform="rotate(-90 50 50)">
          <title>{s.label}: {fmt(s.value)} ({pct(s.value)})</title>
        </circle>
      {/each}
      <text x="50" y="54" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor">{fmt(total)}</text>
    </svg>
    <ul class="legend">
      {#each slices as s, i (s.label)}
        <li title={s.count != null ? `${s.count} pledge${s.count === 1 ? '' : 's'}` : ''}>
          <i style={`background:${PALETTE[i % PALETTE.length]}`}></i>
          <span class="name">{s.label}</span>
          <span class="muted">{fmt(s.value)}</span>
          <span class="muted pct">{pct(s.value)}</span>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .donut {
    display: flex;
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
  }
  svg {
    flex: 0 0 auto;
  }
  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
    font-size: 12px;
    min-width: 200px;
  }
  .legend li {
    display: grid;
    grid-template-columns: 10px 1fr auto auto;
    gap: 8px;
    align-items: center;
  }
  .legend i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    display: inline-block;
  }
  .name {
    text-transform: capitalize;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pct {
    min-width: 42px;
    text-align: right;
  }
  .muted {
    color: var(--muted);
  }
  .empty {
    color: var(--muted);
    padding: 12px 0;
  }
  .small {
    font-size: 12px;
  }
</style>
