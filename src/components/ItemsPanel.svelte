<script lang="ts">
  import { hangarUrl } from '@/lib/hangar';
  import { CATEGORY_LABEL, family, familyLabel, inventory, itemsCsv, ownedShipsWithPaints, paintStatus, seriesOf, storePaintFor, storePaintIndex, type Category, type ItemRow } from '@/lib/items';
  import { bg } from '@/lib/messages';
  import { catalogItem, hangarItem, paintCatalogItem } from '@/lib/settings';
  import { sortBy, type SortState } from '@/lib/sort';
  import { usd, type Catalog, type PaintCatalog } from '@/lib/store';
  import SortTh from './SortTh.svelte';

  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let cat = $state<Catalog | null>(null);
  let storePaints = $state<PaintCatalog | null>(null);
  let error = $state('');

  $effect(() => {
    hangarItem.getValue().then((h) => (hangar = h));
    catalogItem.getValue().then((c) => (cat = c));
    paintCatalogItem.getValue().then((p) => (storePaints = p));
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch((e) => (error = `Store catalog: ${(e as Error).message} (needed to match paints to ships)`));
    bg({ type: 'paints:get' })
      .then((p) => (storePaints = p))
      .catch(() => {}); // store links are a bonus
    const offs = [hangarItem.watch((h) => (hangar = h)), catalogItem.watch((c) => (cat = c)), paintCatalogItem.watch((p) => (storePaints = p))];
    return () => offs.forEach((o) => o());
  });

  const ships = $derived(cat?.ships ?? []);
  const rows = $derived(inventory(hangar?.pledges ?? [], ships));
  const fleet = $derived(ownedShipsWithPaints(rows));
  const ownedIds = $derived(new Set(fleet.map((f) => f.ship.id)));
  const series = $derived(seriesOf(rows));
  const storeIdx = $derived(storePaintIndex(storePaints?.paints ?? []));
  const storeUrl = (r: ItemRow) => (r.ship ? r.ship.link || null : r.category === 'paint' ? (storePaintFor(r, storeIdx)?.url ?? null) : null);

  // ---- prefs ----
  type Show = '' | 'paint-no-ship' | 'paint-owned' | 'paint-unknown' | 'dupes' | 'giftable';
  type GroupBy = 'category' | 'series' | 'ship' | 'pledge' | 'none';
  const PREFS = 'rsiplus:items';
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<{ show: Show; groupBy: GroupBy; cats: Category[] }>;
    } catch {
      return {};
    }
  })();
  let show = $state<Show>(saved.show ?? '');
  let groupBy = $state<GroupBy>(saved.groupBy ?? 'category');
  let cats = $state<Set<Category>>(new Set(saved.cats ?? []));
  $effect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ show, groupBy, cats: [...cats] }));
    } catch {
      /* no persistence — fine */
    }
  });

  // ---- helpers ----
  const fitsLabel = (r: ItemRow) => {
    if (r.ship) return r.ship.name;
    if (!r.fits.length) return '';
    if (r.fits.length === 1) return r.fits[0]!.name;
    const fams = [...new Set(r.fits.map((s) => family(s.name)))];
    return fams
      .map((f) => {
        const inFam = ships.filter((s) => family(s.name) === f).length;
        const hit = r.fits.filter((s) => family(s.name) === f);
        return hit.length >= inFam && inFam > 1 ? `All ${familyLabel(f, hit)}` : hit.map((s) => s.name).join(', ');
      })
      .join(' · ');
  };
  const qty = (list: ItemRow[]) => list.reduce((n, r) => n + r.count, 0);
  function download(name: string, body: string) {
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  let collapsed = $state<Set<string>>(new Set());
  const toggle = (k: string) => {
    const s = new Set(collapsed);
    s.has(k) ? s.delete(k) : s.add(k);
    collapsed = s;
  };
  const setAll = (keys: string[], close: boolean) => (collapsed = close ? new Set([...collapsed, ...keys]) : new Set([...collapsed].filter((k) => !keys.includes(k))));

  // ---- list ----
  let q = $state('');
  let sort = $state<SortState<'title' | 'category' | 'count' | 'fits' | 'value'>>({ key: 'title', dir: 'asc' });
  const counts = $derived(rows.reduce((m, r) => m.set(r.category, (m.get(r.category) ?? 0) + r.count), new Map<Category, number>()));
  const value = (r: ItemRow) => r.pledges.reduce((n, p) => n + p.value, 0);

  const filtered = $derived.by(() => {
    const query = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (r.category === 'insurance' && !cats.has('insurance')) return false;
      if (cats.size && !cats.has(r.category)) return false;
      if (show.startsWith('paint-') && r.category !== 'paint') return false;
      if (show === 'paint-no-ship' && paintStatus(r, ownedIds) !== 'no-ship') return false;
      if (show === 'paint-owned' && paintStatus(r, ownedIds) !== 'owned-ship') return false;
      if (show === 'paint-unknown' && paintStatus(r, ownedIds) !== 'unknown') return false;
      if (show === 'dupes' && r.count < 2) return false;
      if (show === 'giftable' && !r.giftable) return false;
      return !query || [r.title, fitsLabel(r), series.get(r.key) ?? '', ...r.pledges.map((p) => p.name)].some((s) => s.toLowerCase().includes(query));
    });
    return sortBy(list, sort, {
      title: (r) => r.title,
      category: (r) => CATEGORY_LABEL[r.category],
      count: (r) => r.count,
      fits: (r) => fitsLabel(r) || null,
      value: (r) => value(r),
    });
  });

  interface Group {
    key: string;
    label: string;
    note: string;
    items: ItemRow[];
  }
  const groups = $derived.by((): Group[] => {
    if (groupBy === 'none') return [{ key: 'i|all', label: '', note: '', items: filtered }];
    const m = new Map<string, Group>();
    const add = (key: string, label: string, note: string, r: ItemRow) => {
      const g = m.get(key) ?? { key, label, note, items: [] };
      if (!g.items.includes(r)) g.items.push(r);
      m.set(key, g);
    };
    for (const r of filtered) {
      if (groupBy === 'category') add(`i|${r.category}`, CATEGORY_LABEL[r.category], '', r);
      else if (groupBy === 'series') {
        const sr = series.get(r.key);
        if (sr) add(`i|s:${sr.toLowerCase()}`, sr, '', r);
        else add('i|~', 'No event / collection', '', r);
      } else if (groupBy === 'ship') {
        const hulls = r.ship ? [r.ship] : r.fits;
        if (!hulls.length) add('i|~', 'Not ship-specific / unknown ship', '', r);
        for (const f of new Set(hulls.map((s) => family(s.name)))) {
          const own = fleet.filter((o) => family(o.ship.name) === f);
          add(`i|f:${f}`, familyLabel(f, hulls), own.length ? `you own ${own.map((o) => o.ship.name).join(', ')}` : 'no ship owned', r);
        }
      } else for (const p of new Map(r.pledges.map((p) => [p.id, p])).values()) add(`i|p:${p.id}`, p.name, `${usd(p.value * 100)} · #${p.id}`, r);
    }
    const order = Object.keys(CATEGORY_LABEL);
    return [...m.values()].sort((a, b) =>
      groupBy === 'category'
        ? order.indexOf(a.key.slice(2)) - order.indexOf(b.key.slice(2))
        : Number(a.key === 'i|~') - Number(b.key === 'i|~') || a.label.localeCompare(b.label),
    );
  });
  const groupKeys = $derived(groups.map((g) => g.key));

  function toggleCat(c: Category) {
    const s = new Set(cats);
    s.has(c) ? s.delete(c) : s.add(c);
    cats = s;
  }
</script>

{#if !hangar}
  <section class="card"><p class="empty">Load your hangar first (Hangar tab) — items are built from it.</p></section>
{:else}
  <div class="stack">
    {#if error}<section class="card"><span class="err">{error}</span></section>{/if}

    <section class="card stack">
      <div>
        <h2>All items <span class="muted">({qty(rows)} across {hangar.pledges.length} pledges)</span></h2>
        <span class="muted">Every item in every pledge, same items merged. 🛒 store page · 🏠 hangar page holding it (gift / melt). Ships and paints per ship: <a href="#ships">Ships & paints</a>.</span>
      </div>
      <div class="row">
        {#each Object.entries(CATEGORY_LABEL) as [c, label] (c)}
          {#if counts.get(c as Category)}
            <button class="chip" class:on={cats.has(c as Category)} onclick={() => toggleCat(c as Category)}>{label} · {counts.get(c as Category)}</button>
          {/if}
        {/each}
        {#if cats.size}<button class="chip" onclick={() => (cats = new Set())}>× clear</button>{/if}
      </div>
      <div class="row">
        <input placeholder="Search items, ships, events, pledges" bind:value={q} aria-label="Search items" />
        <select bind:value={show} aria-label="Show">
          <option value="">All items</option>
          <option value="paint-no-ship">Paints for ships I don't own</option>
          <option value="paint-owned">Paints for ships I own</option>
          <option value="paint-unknown">Paints with unknown ship</option>
          <option value="dupes">Duplicate items (×2 or more) — melt decisions are per pledge, see Hangar</option>
          <option value="giftable">Giftable</option>
        </select>
        <select bind:value={groupBy} aria-label="Group by">
          <option value="category">Group: category</option>
          <option value="series">Group: event / collection</option>
          <option value="ship">Group: ship</option>
          <option value="pledge">Group: pledge / pack</option>
          <option value="none">No grouping</option>
        </select>
        {#if q || show || cats.size}<button class="btn small" onclick={() => ((q = ''), (show = ''), (cats = new Set()))}>Reset filters</button>{/if}
        <span class="muted">{filtered.length} shown</span>
        <span class="spacer"></span>
        {#if groupBy !== 'none'}
          <button class="btn small" onclick={() => setAll(groupKeys, false)}>Expand all</button>
          <button class="btn small" onclick={() => setAll(groupKeys, true)}>Collapse all</button>
        {/if}
        <button class="btn small" disabled={!filtered.length} onclick={() => download(`rsi-items-${stamp()}.csv`, itemsCsv(filtered))}>CSV</button>
      </div>

      {#if !filtered.length}
        <p class="empty">Nothing matches.</p>
      {:else}
        <table>
          <thead>
            <tr>
              <SortTh key="title" bind:sort>Item</SortTh>
              <SortTh key="category" bind:sort>Category</SortTh>
              <SortTh key="count" bind:sort firstDir="desc">Qty</SortTh>
              <SortTh key="fits" bind:sort>Ship</SortTh>
              <SortTh key="value" bind:sort firstDir="desc">In pledges</SortTh>
              <th>Links</th>
            </tr>
          </thead>
          {#each groups as g (g.key)}
            <tbody>
              {#if g.label}
                <tr class="group">
                  <th colspan="6">
                    <button class="grp-head" aria-expanded={!collapsed.has(g.key)} onclick={() => toggle(g.key)}>
                      <span class="caret" aria-hidden="true">{collapsed.has(g.key) ? '▸' : '▾'}</span>
                      <strong>{g.label}</strong>
                      {#if g.note}<span class="muted small">{g.note}</span>{/if}
                      <span class="muted small">· {qty(g.items)} item{qty(g.items) === 1 ? '' : 's'}</span>
                    </button>
                  </th>
                </tr>
              {/if}
              {#if !collapsed.has(g.key)}
                {#each g.items as r (r.key)}
                  {@const ps = r.category === 'paint' ? paintStatus(r, ownedIds) : null}
                  {@const store = storeUrl(r)}
                  <tr>
                    <td>
                      <strong>{r.title}</strong>
                      {#if r.giftable}<span class="chip">gift</span>{/if}
                      {#if r.fitsVia === 'pledge'}<span class="chip" title="Name doesn't say which ship — matched to the ship(s) in the same pledge">from pack</span>{/if}
                      {#if ps === 'no-ship'}<span class="chip warn" title="You don't own a ship this paint fits">no ship</span>{/if}
                    </td>
                    <td class="muted small">{CATEGORY_LABEL[r.category]}{#if series.get(r.key) && groupBy !== 'series'}<br /><span class="series">{series.get(r.key)}</span>{/if}</td>
                    <td>{r.count > 1 ? `×${r.count}` : '1'}</td>
                    <td class="small">{fitsLabel(r) || '—'}</td>
                    <td class="small">
                      {#each r.pledges.slice(0, 3) as p, i (i)}<div>{p.name} <span class="muted">#{p.id}</span></div>{/each}
                      {#if r.pledges.length > 3}<div class="muted">+{r.pledges.length - 3} more</div>{/if}
                    </td>
                    <td class="small links">
                      {#if store}<a href={store} target="_blank" rel="noopener" title="Store page">🛒 store</a>{/if}
                      {#each [...new Map(r.pledges.map((p) => [p.id, p])).values()].slice(0, 3) as p (p.id)}
                        <a href={hangarUrl(hangar.pledges, p.id)} target="_blank" rel="noopener" title={`Hangar page with ${p.name} (gift / melt)`}>🏠 #{p.id}</a>
                      {/each}
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          {/each}
        </table>
      {/if}
    </section>
  </div>
{/if}

<style>
  .series {
    color: var(--accent);
  }
  .spacer {
    flex: 1;
  }
  .small {
    font-size: 11px;
  }
  button.chip {
    cursor: pointer;
    color: var(--text);
  }
  .chip.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.warn {
    color: #ffb547;
    border-color: rgb(255 181 71 / 0.4);
  }
  td .chip {
    margin: 1px;
  }
  .links {
    white-space: nowrap;
  }
  .links a {
    color: var(--accent);
    text-decoration: none;
    margin-right: 8px;
  }
  .links a:hover {
    text-decoration: underline;
  }
  .grp-head {
    all: unset;
    cursor: pointer;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    width: 100%;
    padding: 6px 0;
    color: var(--text);
    font-size: 13px;
  }
  .grp-head:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .caret {
    width: 10px;
    color: var(--muted);
  }
  tr.group th {
    padding-top: 14px;
  }
</style>
