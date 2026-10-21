<script lang="ts">
  /**
   * Store → Browse: every pledge-store listing that isn't the ship catalog — paints, packs, game packages, gear,
   * add-ons, the Subscribers Store and standalone ships — with two independent cuts: a category select and an
   * *audience* segmented control (Everyone / Concierge / Subscribers). Concierge and subscriber listings span ships
   * and items, so they are audiences, not categories: RSI only returns `isVip` rows on a Chairman's Club session and
   * the Subscribers Store (type 65) only to sessions with the subscriber badge. Hash: `#browse?who=concierge&cat=paints`.
   */
  import { conciergeItem, hangarItem, storeItemsItem } from '@/lib/settings';
  import { fetchStoreItems, paintKey, STORE_CATEGORIES, usd, type StoreCategory, type StoreItem, type StoreListing } from '@/lib/store';
  import type { Concierge } from '@/lib/concierge';
  import { sortBy, type SortState } from '@/lib/sort';
  import { listingEntries } from '@/lib/storelog';
  import { saveStoreCopy } from '@/lib/storelog-save';
  import SortTh from './SortTh.svelte';
  import StoreLog from './StoreLog.svelte';
  import Thumb from './Thumb.svelte';
  import Segmented from './Segmented.svelte';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import * as Select from '@/components/ui/select';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';

  const hashParam = (k: string) => new URLSearchParams(location.hash.split('?')[1] ?? '').get(k);
  type Who = 'all' | 'concierge' | 'subscribers';
  type Cat = StoreCategory | 'all';
  const CATS = new Set<string>(['all', ...STORE_CATEGORIES.map((c) => c.id)]);
  const WHO: { id: Who; label: string; hint: string }[] = [
    { id: 'all', label: 'Everyone', hint: 'Every listing the store shows your session' },
    { id: 'concierge', label: 'Concierge', hint: "Listings RSI flags Concierge-only (ships and items) plus the specials on your Chairman's Club page" },
    { id: 'subscribers', label: 'Subscribers', hint: 'The Subscribers Store — RSI only lists it to sessions with the subscriber badge' },
  ];
  let who = $state<Who>(hashParam('who') === 'concierge' || hashParam('who') === 'subscribers' ? (hashParam('who') as Who) : 'all');
  let icat = $state<Cat>(CATS.has(hashParam('cat') ?? '') ? (hashParam('cat') as Cat) : 'all');
  let items = $state<StoreListing | null>(null);
  let concierge = $state<Concierge | null>(null);
  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let loading = $state(false);
  let error = $state('');
  let q = $state('');
  let only = $state<'' | 'sale' | 'warbond' | 'owned' | 'stock'>('');
  type Col = 'name' | 'category' | 'price' | 'discount' | 'owned';
  let sort = $state<SortState<Col>>({ key: 'discount', dir: 'desc' });
  const STALE = 6 * 60 * 60_000;
  /** bits-ui Select treats '' as "nothing picked". */
  const ALL = 'all';

  $effect(() => {
    storeItemsItem.getValue().then((v) => {
      items = v;
      if (!v || Date.now() - v.at > STALE) refresh();
    });
    conciergeItem.getValue().then((v) => (concierge = v));
    hangarItem.getValue().then((h) => (hangar = h));
    const offs = [storeItemsItem.watch((v) => (items = v)), conciergeItem.watch((v) => (concierge = v)), hangarItem.watch((h) => (hangar = h))];
    return () => offs.forEach((o) => o());
  });
  /** Keep the hash in step so the page can be bookmarked / linked (`#browse?who=concierge`). */
  $effect(() => {
    const p = new URLSearchParams();
    if (who !== 'all') p.set('who', who);
    if (icat !== 'all') p.set('cat', icat);
    const hash = `#browse${p.size ? `?${p}` : ''}`;
    if (location.hash.startsWith('#browse') && location.hash !== hash) history.replaceState(null, '', hash);
  });
  async function refresh() {
    if (loading) return;
    loading = true;
    error = '';
    try {
      const v = await fetchStoreItems();
      await storeItemsItem.setValue(v);
      items = v;
      await saveStoreCopy('listing', listingEntries(v), v.at);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  /** Normalized title → copies in the hangar (pledge names and every item inside them). */
  const ownedKeys = $derived.by(() => {
    const m = new Map<string, number>();
    for (const p of hangar?.pledges ?? []) for (const t of new Set([p.name, ...p.items.map((i) => i.title)].map(paintKey))) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const ownedCount = (it: StoreItem) => ownedKeys.get(paintKey(it.name)) ?? 0;
  /** Listing + the Concierge page's *Exclusive Store* specials that the search didn't return (same SKU id). */
  const all = $derived.by(() => {
    const list = items?.items ?? [];
    const ids = new Set(list.map((i) => i.id));
    const extra: StoreItem[] = (concierge?.store ?? [])
      .filter((x) => !ids.has(x.sku))
      .map((x) => ({ id: x.sku, name: x.name, url: x.url, price: x.price, discounted: x.price, available: x.inStock, thumb: null, category: /ship/i.test(x.category) ? 'ships' : /pack/i.test(x.category) ? 'packages' : 'gear', subtitle: x.category, vip: true, warbond: /warbond/i.test(x.url) }));
    return [...list, ...extra];
  });
  const discountPct = (it: StoreItem) => (it.price > it.discounted ? Math.round((100 * (it.price - it.discounted)) / it.price) : 0);
  const forWho = (it: StoreItem, w: Who) => (w === 'all' ? true : w === 'concierge' ? it.vip : it.category === 'subscribers');
  const audience = $derived(all.filter((it) => forWho(it, who)));
  const whoCount = (w: Who) => all.filter((it) => forWho(it, w)).length;
  const catLabel = (c: Cat) => (c === 'all' ? 'All categories' : (STORE_CATEGORIES.find((x) => x.id === c)?.label ?? c));
  const catCount = (c: Cat) => audience.filter((it) => c === 'all' || it.category === c).length;
  const shown = $derived.by(() => {
    const query = q.trim().toLowerCase();
    const list = audience.filter(
      (it) =>
        (icat === 'all' || it.category === icat) &&
        (!query || `${it.name} ${it.subtitle}`.toLowerCase().includes(query)) &&
        (only === '' || (only === 'sale' && discountPct(it) > 0) || (only === 'warbond' && it.warbond) || (only === 'owned' && ownedCount(it) > 0) || (only === 'stock' && it.available)),
    );
    const byName = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return sortBy(byName, sort, {
      name: (it) => it.name,
      category: (it) => it.subtitle || it.category,
      price: (it) => it.discounted,
      discount: (it) => discountPct(it) || null,
      owned: (it) => ownedCount(it) || null,
    });
  });
  const ONLY: { value: typeof only; label: string }[] = [
    { value: '', label: 'Everything' },
    { value: 'sale', label: 'On sale (discounted)' },
    { value: 'warbond', label: 'Warbond' },
    { value: 'stock', label: 'In stock' },
    { value: 'owned', label: 'Already in my hangar' },
  ];
  /** Subscriber badge on this session: true / false / null (not logged in or not checked yet). */
  const subscriber = $derived(items?.subscriber ?? null);
</script>

<div class="grid gap-4">
  <StoreLog />
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-lg font-semibold">Browse</Card.Title>
      <Card.Description>
        {#if items}{all.length} listings · prices from {new Date(items.at).toLocaleString()}{#if concierge?.store.length} · {concierge.store.length} Concierge specials from your Chairman's Club page{/if}{:else if loading}Loading the store (one request per 100 listings per category)…{:else}Paints, packs, gear, game packages, add-ons, standalone ships, the Subscribers Store — and what the store only shows Concierge members.{/if}
      </Card.Description>
      <Card.Action class="flex flex-wrap items-center gap-2">
        <Button variant="outline" href="#paint-rebuy" title="Melt paints you own and buy them back together with RSI's multi-paint discount">Paint rebuy value →</Button>
        <Button variant="outline" disabled={loading} onclick={refresh}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </Card.Action>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if error}<span class="text-destructive">{error}</span>{/if}
      <div class="flex flex-wrap items-center gap-2">
        <Segmented options={WHO.map((w) => ({ id: w.id, label: `${w.label} · ${whoCount(w.id)}`, hint: w.hint }))} bind:value={who} ariaLabel="Audience" />
        <Select.Root type="single" value={icat} onValueChange={(v) => (icat = v as Cat)}>
          <Select.Trigger aria-label="Category" class="min-w-48">{catLabel(icat)} · {catCount(icat)}</Select.Trigger>
          <Select.Content>
            <Select.Item value="all" label={`All categories · ${catCount('all')}`} />
            {#each STORE_CATEGORIES as c (c.id)}<Select.Item value={c.id} label={`${c.label} · ${catCount(c.id)}`} />{/each}
          </Select.Content>
        </Select.Root>
        <Select.Root type="single" value={only || ALL} onValueChange={(v) => (only = v === ALL ? '' : (v as typeof only))}>
          <Select.Trigger aria-label="Show" class="min-w-44">{ONLY.find((o) => o.value === only)?.label}</Select.Trigger>
          <Select.Content>
            {#each ONLY as o (o.value)}<Select.Item value={o.value || ALL} label={o.label} />{/each}
          </Select.Content>
        </Select.Root>
        <Input class="w-60" placeholder="Search listings" bind:value={q} aria-label="Search listings" />
      </div>

      {#if who === 'concierge'}
        {#if !concierge && !whoCount('concierge')}<p class="text-muted-foreground m-0 text-xs">RSI only returns Concierge-only listings to a Chairman's Club session — your level is on <a class="text-primary hover:underline" href="#wallet">Wallet</a>; non-members see nothing here, by design.</p>{/if}
      {:else if who === 'subscribers'}
        <div class="flex flex-wrap items-center gap-2 text-xs">
          {#if subscriber === true}<Badge variant="outline" class="text-success">Subscriber</Badge><span class="text-muted-foreground">Your session has RSI's subscriber badge — the Subscribers Store lists for you.</span>
          {:else if subscriber === false}<Badge variant="outline" class="text-muted-foreground">Not a subscriber</Badge><span class="text-muted-foreground">RSI hides the Subscribers Store until you subscribe; the count above is what your session gets (usually nothing).</span>
          {:else}<span class="text-muted-foreground">Log in to RSI and refresh — the Subscribers Store only lists for sessions with the subscriber badge.</span>{/if}
          <a class="text-primary hover:underline" href="https://robertsspaceindustries.com/en/pledge/browse/extras/subscribers-store" target="_blank" rel="noopener">Open on RSI →</a>
        </div>
      {/if}

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <SortTh key="name" bind:sort>Listing</SortTh>
            <SortTh key="category" bind:sort>Category</SortTh>
            <SortTh key="price" bind:sort>Price</SortTh>
            <SortTh key="discount" bind:sort firstDir="desc">Discount</SortTh>
            <SortTh key="owned" bind:sort firstDir="desc">In hangar</SortTh>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each shown as it (it.id)}
            {@const off = discountPct(it)}
            {@const n = ownedCount(it)}
            <Table.Row>
              <Table.Cell>
                <div class="flex items-center gap-2.5">
                  <Thumb src={it.thumb} name={it.name} width={64} height={36} />
                  <div class="grid gap-0.5">
                    <a class="text-foreground no-underline hover:underline" href={it.url} target="_blank" rel="noopener"><strong>{it.name}</strong></a>
                    <div class="flex flex-wrap gap-1">
                      {#if it.vip}<Badge variant="outline" class="border-warning/40 text-warning">Concierge</Badge>{/if}
                      {#if it.category === 'subscribers'}<Badge variant="outline" class="border-primary/40 text-primary">Subscribers</Badge>{/if}
                      {#if it.warbond}<Badge variant="outline">Warbond</Badge>{/if}
                      {#if !it.available}<Badge variant="outline" class="text-muted-foreground">out of stock</Badge>{/if}
                    </div>
                  </div>
                </div>
              </Table.Cell>
              <Table.Cell class="text-muted-foreground">{it.subtitle || catLabel(it.category)}</Table.Cell>
              <Table.Cell class="tabular-nums">{usd(it.discounted)}{#if off}<span class="text-muted-foreground ml-1 text-xs">list {usd(it.price)}</span>{/if}</Table.Cell>
              <Table.Cell>{#if off}<span class="text-success">−{off}% · {usd(it.price - it.discounted)}</span>{:else}<span class="text-muted-foreground">—</span>{/if}</Table.Cell>
              <Table.Cell>{#if n}<Badge variant="outline" class="text-success">owned ×{n}</Badge>{/if}</Table.Cell>
            </Table.Row>
          {:else}
            <Table.Row><Table.Cell colspan={5} class="text-muted-foreground">{loading ? 'Loading…' : who === 'subscribers' && subscriber !== true ? 'Nothing listed for this session.' : 'Nothing matches.'}</Table.Cell></Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>
</div>
