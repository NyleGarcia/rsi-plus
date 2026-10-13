<script lang="ts">
  import { loadBuyback } from '@/lib/account';
  import type { BuybackItem, PledgeType } from '@/lib/hangar';
  import { buybackItem } from '@/lib/settings';
  import { dateValue, sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';

  type Saved = NonNullable<Awaited<ReturnType<typeof buybackItem.getValue>>>;
  let data = $state<Saved | null>(null);
  let loading = $state<{ page: number; count: number; pages?: number } | null>(null);
  let error = $state('');
  let q = $state('');
  let type = $state<PledgeType | 'all'>('all');
  type Col = 'name' | 'type' | 'date';
  let sort = $state<SortState<Col>>({ key: 'date', dir: 'desc' });
  let ctrl: AbortController | null = null;

  $effect(() => {
    buybackItem.getValue().then((v) => (data = v)).catch((e) => (error = `Couldn't read saved buyback: ${(e as Error).message}`));
    return () => ctrl?.abort();
  });

  async function save(v: Saved) {
    await buybackItem.setValue(JSON.parse(JSON.stringify(v)));
    data = v;
  }

  async function load(resume = false) {
    error = '';
    ctrl = new AbortController();
    const from = resume && data && !data.complete ? { page: data.page ?? 0, items: $state.snapshot(data.items) as BuybackItem[] } : undefined;
    loading = { page: from?.page ?? 0, count: from?.items.length ?? 0 };
    try {
      const items = await loadBuyback(
        async ({ page, pages, items }) => {
          loading = { page, pages, count: items.length };
          await save({ at: Date.now(), items, complete: false, page });
        },
        ctrl.signal,
        from,
      );
      await save({ at: Date.now(), items, complete: true });
      if (!items.length) error = 'No buyback items found. If you do have some, the page layout may have changed — please report it.';
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = `${(e as Error).message}${data?.items.length ? ' — what was read so far is kept; Resume to continue.' : ''}`;
    } finally {
      loading = null;
    }
  }

  const all = $derived(data?.items ?? []);
  const types = $derived([...new Set(all.map((i) => i.type))]);
  const shown = $derived(
    sortBy(
      all.filter((i) => (type === 'all' || i.type === type) && (!q.trim() || `${i.name} ${i.contained}`.toLowerCase().includes(q.trim().toLowerCase()))),
      sort,
      { name: (i) => i.name, type: (i) => i.type, date: (i) => dateValue(i.date) },
    ),
  );
</script>

<section class="card stack">
  <div class="row spread">
    <div>
      <h2>Buyback</h2>
      <span class="muted">
        {#if loading}Loading page {loading.page}{loading.pages ? ` / ${loading.pages}` : ''}… {loading.count} items
        {:else if data}{all.length} items · {data.complete === false ? `partial (stopped after page ${data.page})` : 'loaded'} {new Date(data.at).toLocaleString()}
        {:else}Not loaded yet.{/if}
      </span>
    </div>
    {#if loading}
      <button class="btn" onclick={() => ctrl?.abort()}>Stop</button>
    {:else}
      <div class="row">
        {#if data && data.complete === false}
          <button class="btn primary" onclick={() => load(true)}>Resume from page {(data.page ?? 0) + 1}</button>
        {/if}
        <button class="btn" class:primary={!data} onclick={() => load(false)}>{data ? 'Reload all' : 'Load buyback'}</button>
      </div>
    {/if}
  </div>
  {#if error}<span class="err">{error}</span>{/if}
  {#if all.length}
    <div class="row">
      <input placeholder="Search" bind:value={q} aria-label="Search buyback" />
      <select bind:value={type} aria-label="Type">
        <option value="all">All types</option>
        {#each types as t (t)}<option value={t}>{t}</option>{/each}
      </select>
      <span class="muted">{shown.length} shown · buyback CCUs can be used by the CCU planner</span>
    </div>
    <table>
      <thead>
        <tr>
          <SortTh key="name" bind:sort>Item</SortTh>
          <SortTh key="type" bind:sort>Type</SortTh>
          <SortTh key="date" bind:sort firstDir="desc">Melted</SortTh>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each shown as b, i (`${b.id}:${i}`)}
          <tr>
            <td>
              <strong>{b.name}</strong>
              {#if b.contained}<div class="muted small">{b.contained}</div>{/if}
            </td>
            <td>{b.type}</td>
            <td class="muted small">{b.date}</td>
            <td>{#if b.url}<a class="btn small" href={b.url} target="_blank" rel="noopener">Buy back</a>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .small {
    font-size: 11px;
  }
</style>
