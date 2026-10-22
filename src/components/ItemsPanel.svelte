<script lang="ts">
  import { hangarUrl } from '@/lib/hangar';
  import { CATEGORY_LABEL, line, familyLabel, inventory, itemsCsv, ownedShipsWithPaints, paintStatus, seriesOf, storePaintFor, storePaintIndex, type Category, type GameShip, type ItemRow } from '@/lib/items';
  import { bg } from '@/lib/messages';
  import { catalogItem, gameShipsItem, hangarItem, paintCatalogItem } from '@/lib/settings';
  import { sortBy, type SortState } from '@/lib/sort';
  import type { Catalog, PaintCatalog } from '@/lib/store';
  import { ownDollars } from '@/lib/privacy.svelte';
  import { dateStamp, downloadFile } from '@/lib/download';
  import SortTh from './SortTh.svelte';
  import FilterChips from './FilterChips.svelte';
  import HintBadge from './HintBadge.svelte';
  import Empty from './Empty.svelte';
  import * as Alert from '@/components/ui/alert';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import * as Select from '@/components/ui/select';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import { Input } from '@/components/ui/input';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import House from '@lucide/svelte/icons/house';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import X from '@lucide/svelte/icons/x';

  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let cat = $state<Catalog | null>(null);
  let storePaints = $state<PaintCatalog | null>(null);
  let game = $state<GameShip[]>([]);
  let error = $state('');

  $effect(() => {
    hangarItem.getValue().then((h) => (hangar = h));
    catalogItem.getValue().then((c) => (cat = c));
    paintCatalogItem.getValue().then((p) => (storePaints = p));
    gameShipsItem.getValue().then((g) => (game = g));
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch((e) => (error = `Store catalog: ${(e as Error).message} (needed to match paints to ships)`));
    bg({ type: 'paints:get' })
      .then((p) => (storePaints = p))
      .catch(() => {}); // store links are a bonus
    const offs = [hangarItem.watch((h) => (hangar = h)), catalogItem.watch((c) => (cat = c)), paintCatalogItem.watch((p) => (storePaints = p)), gameShipsItem.watch((g) => (game = g ?? []))];
    return () => offs.forEach((o) => o());
  });

  const ships = $derived(cat?.ships ?? []);
  const rows = $derived(inventory(hangar?.pledges ?? [], ships));
  const fleet = $derived(ownedShipsWithPaints(rows, game, ships));
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
    const fams = [...new Set(r.fits.map((s) => line(s.name, ships)))];
    return fams
      .map((f) => {
        const inFam = ships.filter((s) => line(s.name, ships) === f).length;
        const hit = r.fits.filter((s) => line(s.name, ships) === f);
        return hit.length >= inFam && inFam > 1 ? `All ${familyLabel(f, hit)}` : hit.map((s) => s.name).join(', ');
      })
      .join(' · ');
  };
  const qty = (list: ItemRow[]) => list.reduce((n, r) => n + r.count, 0);
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
        for (const f of new Set(hulls.map((s) => line(s.name, ships)))) {
          const own = fleet.filter((o) => line(o.ship.name, ships) === f);
          add(`i|f:${f}`, familyLabel(f, hulls), own.length ? `you own ${own.map((o) => o.ship.name).join(', ')}` : 'no ship owned', r);
        }
      } else for (const p of new Map(r.pledges.map((p) => [p.id, p])).values()) add(`i|p:${p.id}`, p.name, `${ownDollars(p.value)} · #${p.id}`, r);
    }
    const order = Object.keys(CATEGORY_LABEL);
    return [...m.values()].sort((a, b) =>
      groupBy === 'category'
        ? order.indexOf(a.key.slice(2)) - order.indexOf(b.key.slice(2))
        : Number(a.key === 'i|~') - Number(b.key === 'i|~') || a.label.localeCompare(b.label),
    );
  });
  const groupKeys = $derived(groups.map((g) => g.key));

  /** Category chips with counts (only categories you have). */
  const catOptions = $derived(
    (Object.entries(CATEGORY_LABEL) as [Category, string][]).filter(([c]) => counts.get(c)).map(([c, label]) => ({ id: c, label: `${label} · ${counts.get(c)}` })),
  );

  const SHOW: { value: Show; label: string }[] = [
    { value: '', label: 'All items' },
    { value: 'paint-no-ship', label: "Paints for ships I don't own" },
    { value: 'paint-owned', label: 'Paints for ships I own' },
    { value: 'paint-unknown', label: 'Paints with unknown ship' },
    { value: 'dupes', label: 'Duplicate items (×2 or more) — melt decisions are per pledge, see Hangar' },
    { value: 'giftable', label: 'Giftable' },
  ];
  const GROUP_BY: { value: GroupBy; label: string }[] = [
    { value: 'category', label: 'Group: category' },
    { value: 'series', label: 'Group: event / collection' },
    { value: 'ship', label: 'Group: ship' },
    { value: 'pledge', label: 'Group: pledge / pack' },
    { value: 'none', label: 'No grouping' },
  ];
  /** bits-ui Select treats '' as "nothing picked", so "All items" travels as a sentinel. */
  const ALL = 'all';
  const linkCls = 'text-primary mr-2 inline-flex items-center gap-1 no-underline hover:underline';
</script>

{#if !hangar}
  <Card.Root><Card.Content><Empty>Load your hangar first (<a class="text-primary hover:underline" href="#hangar">Pledges</a>) — items are built from it.</Empty></Card.Content></Card.Root>
{:else}
  <div class="grid gap-4">
    {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}

    <Card.Root>
      <Card.Header>
        <Card.Title>All items <span class="text-muted-foreground">({qty(rows)} across {hangar.pledges.length} pledges)</span></Card.Title>
        <Card.Description>Every item in every pledge, same items merged. <ShoppingCart class="inline size-3.5 align-[-2px]" aria-label="Store" /> store page · <House class="inline size-3.5 align-[-2px]" aria-label="Hangar" /> hangar page holding it (gift / melt). Ships and paints per ship: <a class="text-primary hover:underline" href="#ships">Ships & paints</a>.</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <FilterChips options={catOptions} bind:value={cats} multiple ariaLabel="Categories" />
          {#if cats.size}<Button variant="ghost" size="xs" onclick={() => (cats = new Set())}><X /> clear</Button>{/if}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Input class="w-72" placeholder="Search items, ships, events, pledges" bind:value={q} aria-label="Search items" />
          <Select.Root type="single" bind:value={() => show || ALL, (v) => (show = (v === ALL ? '' : v) as Show)}>
            <Select.Trigger aria-label="Show">{SHOW.find((o) => o.value === show)?.label}</Select.Trigger>
            <Select.Content>
              {#each SHOW as o (o.value)}<Select.Item value={o.value || ALL} label={o.label} />{/each}
            </Select.Content>
          </Select.Root>
          <Select.Root type="single" bind:value={() => groupBy, (v) => (groupBy = v as GroupBy)}>
            <Select.Trigger aria-label="Group by">{GROUP_BY.find((o) => o.value === groupBy)?.label}</Select.Trigger>
            <Select.Content>
              {#each GROUP_BY as o (o.value)}<Select.Item value={o.value} label={o.label} />{/each}
            </Select.Content>
          </Select.Root>
          {#if q || show || cats.size}<Button variant="outline" size="sm" onclick={() => ((q = ''), (show = ''), (cats = new Set()))}>Reset filters</Button>{/if}
          <span class="text-muted-foreground">{filtered.length} shown</span>
          <span class="flex-1"></span>
          {#if groupBy !== 'none'}
            <Button variant="outline" size="sm" onclick={() => setAll(groupKeys, false)}>Expand all</Button>
            <Button variant="outline" size="sm" onclick={() => setAll(groupKeys, true)}>Collapse all</Button>
          {/if}
          <Button variant="outline" size="sm" disabled={!filtered.length} onclick={() => downloadFile(`rsi-items-${dateStamp()}.csv`, itemsCsv(filtered))}>CSV</Button>
        </div>

        {#if !filtered.length}
          <Empty>Nothing matches.</Empty>
        {:else}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <SortTh key="title" bind:sort>Item</SortTh>
                <SortTh key="category" bind:sort>Category</SortTh>
                <SortTh key="count" bind:sort firstDir="desc">Qty</SortTh>
                <SortTh key="fits" bind:sort>Ship</SortTh>
                <SortTh key="value" bind:sort firstDir="desc">In pledges</SortTh>
                <Table.Head>Links</Table.Head>
              </Table.Row>
            </Table.Header>
            {#each groups as g (g.key)}
              <Table.Body>
                {#if g.label}
                  <Table.Row class="hover:bg-transparent">
                    <Table.Head colspan={6} class="h-auto pt-3.5">
                      <!-- Table row group: a Collapsible can't wrap <tr>s, so this stays a disclosure button. -->
                      <Button variant="ghost" size="sm" class="aria-expanded:bg-transparent h-auto w-full flex-wrap justify-start gap-2 px-1 py-1.5 text-left text-[13px] font-normal whitespace-normal" aria-expanded={!collapsed.has(g.key)} onclick={() => toggle(g.key)}>
                        {#if collapsed.has(g.key)}<ChevronRight class="text-muted-foreground size-3.5" aria-hidden="true" />{:else}<ChevronDown class="text-muted-foreground size-3.5" aria-hidden="true" />{/if}
                        <strong>{g.label}</strong>
                        {#if g.note}<span class="text-muted-foreground text-[11px]">{g.note}</span>{/if}
                        <span class="text-muted-foreground text-[11px]">· {qty(g.items)} item{qty(g.items) === 1 ? '' : 's'}</span>
                      </Button>
                    </Table.Head>
                  </Table.Row>
                {/if}
                {#if !collapsed.has(g.key)}
                  {#each g.items as r (r.key)}
                    {@const ps = r.category === 'paint' ? paintStatus(r, ownedIds) : null}
                    {@const store = storeUrl(r)}
                    <Table.Row>
                      <Table.Cell class="whitespace-normal">
                        <strong>{r.title}</strong>
                        {#if r.giftable}<Badge variant="secondary" class="m-px">gift</Badge>{/if}
                        {#if r.fitsVia === 'pledge'}<HintBadge variant="secondary" class="m-px" hint="Name doesn't say which ship — matched to the ship(s) in the same pledge">from pack</HintBadge>{/if}
                        {#if ps === 'no-ship'}<HintBadge variant="warning" class="m-px" hint="You don't own a ship this paint fits">no ship</HintBadge>{/if}
                      </Table.Cell>
                      <Table.Cell class="text-muted-foreground text-[11px]">{CATEGORY_LABEL[r.category]}{#if series.get(r.key) && groupBy !== 'series'}<br /><span class="text-primary">{series.get(r.key)}</span>{/if}</Table.Cell>
                      <Table.Cell>{r.count > 1 ? `×${r.count}` : '1'}</Table.Cell>
                      <Table.Cell class="text-[11px] whitespace-normal">{fitsLabel(r) || '—'}</Table.Cell>
                      <Table.Cell class="text-[11px] whitespace-normal">
                        {#each r.pledges.slice(0, 3) as p, i (i)}<div>{p.name} <span class="text-muted-foreground">#{p.id}</span></div>{/each}
                        {#if r.pledges.length > 3}<div class="text-muted-foreground">+{r.pledges.length - 3} more</div>{/if}
                      </Table.Cell>
                      <Table.Cell class="text-[11px]">
                        {#if store}<a class={linkCls} href={store} target="_blank" rel="noopener" title="Store page"><ShoppingCart class="size-3" /> store</a>{/if}
                        {#each [...new Map(r.pledges.map((p) => [p.id, p])).values()].slice(0, 3) as p (p.id)}
                          <a class={linkCls} href={hangarUrl(hangar.pledges, p.id)} target="_blank" rel="noopener" title={`Hangar page with ${p.name} (gift / melt)`}><House class="size-3" /> #{p.id}</a>
                        {/each}
                      </Table.Cell>
                    </Table.Row>
                  {/each}
                {/if}
              </Table.Body>
            {/each}
          </Table.Root>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
{/if}
