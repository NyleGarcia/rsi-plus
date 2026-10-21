<script lang="ts">
  /**
   * Store → Browse: every pledge-store listing that isn't the ship catalog — paints, packs, game packages, gear,
   * add-ons, the Subscribers Store and standalone ships. Category *tabs* (All / Ships / Paints / Packs …) cut one
   * product type; an *audience* segmented control (Everyone / Concierge / Subscribers) cuts by who the store shows it
   * to — Concierge and subscriber listings span ships and items, so they are audiences, not categories: RSI only returns
   * `isVip` rows on a Chairman's Club session and the Subscribers Store (type 65) only to sessions with the subscriber
   * badge. Filters (`lib/browse.ts`) default to what the store sells now: in stock only; out-of-stock rows are a switch.
   * Bundles (two or more pieces — ship packs, game packages, career kits, paint collections, weapon kits) expand to
   * their contents, each priced as the store sells it alone (`lib/bundle.ts`), with what the pack saves against that.
   * Hash: `#browse?who=concierge&cat=paints`.
   */
  import { catalogItem, conciergeItem, hangarItem, storeItemsItem } from '@/lib/settings';
  import { fetchStoreItems, paintKey, STORE_CATEGORIES, usd, type CatalogShip, type StoreItem, type StoreListing } from '@/lib/store';
  import { activeFilters, DEFAULT_FILTER, discountPct, filterItems, forWho, isAudience, isBundle, isCat, matchesFilter, parseUsd, type Audience, type BrowseFilter, type Cat, type Edition, type Owned } from '@/lib/browse';
  import { addStandalone, CART_URL, CartError } from '@/lib/cart';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import Check from '@lucide/svelte/icons/check';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { bundleValue, hasContents, insuranceOf, priceIndex, type BundleValue } from '@/lib/bundle';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { cn } from '@/lib/utils';
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
  import { Toggle } from '@/components/ui/toggle';

  const hashParam = (k: string) => new URLSearchParams(location.hash.split('?')[1] ?? '').get(k);
  const WHO: { id: Audience; label: string; hint: string }[] = [
    { id: 'all', label: 'Everyone', hint: 'Every listing the store shows your session' },
    { id: 'concierge', label: 'Concierge', hint: "Listings RSI flags Concierge-only (ships and items) plus the specials on your Chairman's Club page" },
    { id: 'subscribers', label: 'Subscribers', hint: 'The Subscribers Store — RSI only lists it to sessions with the subscriber badge' },
  ];
  const EDITION: { id: Edition; label: string; hint: string }[] = [
    { id: 'any', label: 'Any edition', hint: 'Warbond and standard' },
    { id: 'warbond', label: 'Warbond', hint: 'New money only (no store credit), usually cheaper' },
    { id: 'standard', label: 'Standard', hint: 'Store credit welcome' },
  ];
  const OWNED: { value: Owned; label: string }[] = [
    { value: 'any', label: 'Hangar: any' },
    { value: 'owned', label: 'In my hangar' },
    { value: 'missing', label: 'Not in my hangar' },
  ];
  const whoParam = hashParam('who');
  const catParam = hashParam('cat');
  let f = $state<BrowseFilter>({ ...DEFAULT_FILTER, who: isAudience(whoParam) ? whoParam : 'all', cat: isCat(catParam) ? catParam : 'all' });
  /** Price bounds as typed (dollars); parsed into `f.min` / `f.max` on change. */
  let minText = $state('');
  let maxText = $state('');
  let items = $state<StoreListing | null>(null);
  let concierge = $state<Concierge | null>(null);
  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  /** Ship catalog, for pricing the hulls inside packs (MSRP). */
  let ships = $state<CatalogShip[]>([]);
  /** Bundles opened to show their contents. */
  let open = $state(new Set<number>());
  let loading = $state(false);
  let error = $state('');
  type Col = 'name' | 'bundle' | 'price' | 'discount' | 'owned';
  let sort = $state<SortState<Col>>({ key: 'discount', dir: 'desc' });
  const STALE = 6 * 60 * 60_000;

  $effect(() => {
    storeItemsItem.getValue().then((v) => {
      items = v;
      if (!v || Date.now() - v.at > STALE) refresh();
    });
    conciergeItem.getValue().then((v) => (concierge = v));
    hangarItem.getValue().then((h) => (hangar = h));
    catalogItem.getValue().then((c) => (ships = c?.ships ?? []));
    const offs = [storeItemsItem.watch((v) => (items = v)), conciergeItem.watch((v) => (concierge = v)), hangarItem.watch((h) => (hangar = h)), catalogItem.watch((c) => (ships = c?.ships ?? []))];
    return () => offs.forEach((o) => o());
  });
  /** Keep the hash in step so the page can be bookmarked / linked (`#browse?who=concierge&cat=paints`). */
  $effect(() => {
    const p = new URLSearchParams();
    if (f.who !== 'all') p.set('who', f.who);
    if (f.cat !== 'all') p.set('cat', f.cat);
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
  const ownedPiece = (name: string) => ownedKeys.get(paintKey(name)) ?? 0;
  /** Listing + the Concierge page's *Exclusive Store* specials that the search didn't return (same SKU id). */
  const all = $derived.by(() => {
    const list = items?.items ?? [];
    const ids = new Set(list.map((i) => i.id));
    const extra: StoreItem[] = (concierge?.store ?? [])
      .filter((x) => !ids.has(x.sku))
      .map((x) => ({ id: x.sku, name: x.name, url: x.url, price: x.price, discounted: x.price, available: x.inStock, thumb: null, category: /ship/i.test(x.category) ? 'ships' : /pack/i.test(x.category) ? 'packages' : 'gear', subtitle: x.category, vip: true, warbond: /warbond/i.test(x.url) }));
    return [...list, ...extra];
  });
  const whoCount = (w: Audience) => all.filter((it) => forWho(it, w)).length;
  /** Breakdown per listing id with two or more contents, priced against the whole store + ship catalog. */
  const values = $derived.by(() => {
    const idx = priceIndex(all, ships);
    const m = new Map<number, BundleValue>();
    for (const it of all) {
      const v = hasContents(it) ? bundleValue(it, idx) : null;
      if (v) m.set(it.id, v);
    }
    return m;
  });
  const toggle = (id: number) => (open = new Set(open.has(id) ? [...open].filter((x) => x !== id) : [...open, id]));
  /** "saves $25 (20%)" / "$25 more than apart" / "$100 apart" — null when no piece is priced. */
  const valueLine = (v: BundleValue) => (!v.priced ? null : v.savings > 0 ? `saves ${usd(v.savings)} · ${v.pct}%` : v.savings < 0 ? `${usd(-v.savings)} more than apart` : 'same as apart');
  /** Rows that pass every filter but the category — what each tab would show. */
  const filtered = $derived.by(() => {
    const query = f.q.trim().toLowerCase();
    return all.filter((it) => matchesFilter(it, f, ownedCount(it), query));
  });
  const bundleCount = $derived(filtered.filter((it) => isBundle(it) && (f.cat === 'all' || it.category === f.cat)).length);
  const catCount = $derived.by(() => {
    const m = new Map<Cat, number>([['all', filtered.length]]);
    for (const it of filtered) m.set(it.category, (m.get(it.category) ?? 0) + 1);
    return m;
  });
  const catLabel = (c: Cat) => (c === 'all' ? 'All' : (STORE_CATEGORIES.find((x) => x.id === c)?.label ?? c));
  const TABS = $derived<{ id: Cat; label: string; hint: string }[]>([
    { id: 'all', label: `All · ${catCount.get('all') ?? 0}`, hint: 'Every category' },
    ...STORE_CATEGORIES.map((c) => ({ id: c.id as Cat, label: `${c.label} · ${catCount.get(c.id) ?? 0}`, hint: `${c.label} the store lists` })),
  ]);
  const shown = $derived.by(() => {
    const list = filterItems(all, f, ownedCount);
    const byName = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return sortBy(byName, sort, {
      name: (it) => it.name,
      bundle: (it) => (isBundle(it) ? (values.get(it.id)?.savings ?? null) : null),
      price: (it) => it.discounted,
      discount: (it) => discountPct(it) || null,
      owned: (it) => ownedCount(it) || null,
    });
  });
  /**
   * Rows on screen: the first 40 paint with the click, the rest follow 40 a frame — 556 listings in one go blocked the
   * page for ~0.9 s on *All* (measured headless). Starts over whenever the list changes (tab, filter, search, sort).
   */
  let budget = $derived.by(() => (void shown, 40));
  $effect(() => {
    if (budget >= shown.length) return;
    const t = setTimeout(() => (budget += 40), 16);
    return () => clearTimeout(t);
  });
  const outOfStock = $derived(all.filter((it) => !it.available && matchesFilter(it, { ...f, inStock: false }, ownedCount(it)) && (f.cat === 'all' || it.category === f.cat)).length);
  const active = $derived(activeFilters(f));
  function reset() {
    f = { ...DEFAULT_FILTER, who: f.who, cat: f.cat };
    minText = maxText = '';
  }
  // ---- add a listing to the RSI cart (same call as Buyback / the paint planner; never retried, nothing paid) ----
  type CartState = { st: 'adding' } | { st: 'added' } | { st: 'error'; msg: string };
  let cart = $state<Record<number, CartState>>({});
  async function addOne(sku: number) {
    if (cart[sku]?.st === 'adding') return;
    cart = { ...cart, [sku]: { st: 'adding' } };
    try {
      await addStandalone(sku, 1);
      cart = { ...cart, [sku]: { st: 'added' } };
    } catch (e) {
      const ce = e instanceof CartError ? e : new CartError('refused', (e as Error).message);
      cart = { ...cart, [sku]: { st: 'error', msg: ce.code === 'signed-out' ? 'Sign in to RSI' : ce.code === 'conflict' ? 'Cart busy' : ce.code === 'network' ? 'No answer — check your cart' : ce.message } };
    }
  }
  const inCart = $derived(Object.values(cart).filter((c) => c.st === 'added').length);
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
        {#if inCart}<Button variant="outline" href={CART_URL} target="_blank" rel="noopener">Open RSI cart ({inCart}) <ExternalLink /></Button>{/if}
      </Card.Action>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if error}<span class="text-destructive">{error}</span>{/if}
      <Segmented options={TABS} bind:value={f.cat} ariaLabel="Category" />
      <div class="flex flex-wrap items-center gap-2">
        <Segmented size="sm" options={WHO.map((w) => ({ id: w.id, label: `${w.label} · ${whoCount(w.id)}`, hint: w.hint }))} bind:value={f.who} ariaLabel="Audience" />
        <Segmented size="sm" options={EDITION} bind:value={f.edition} ariaLabel="Edition" />
        <Toggle variant="outline" size="sm" pressed={f.sale} onPressedChange={(v) => (f.sale = v)} title="Discounted below list price" aria-label="On sale">On sale</Toggle>
        <Toggle variant="outline" size="sm" pressed={f.bundles} onPressedChange={(v) => (f.bundles = v)} title="Packs, kits and collections — two or more pieces; open one to see what each would cost apart" aria-label="Bundles">{f.bundles || !bundleCount ? 'Bundles' : `Bundles · ${bundleCount}`}</Toggle>
        <Toggle variant="outline" size="sm" pressed={!f.inStock} onPressedChange={(v) => (f.inStock = !v)} title="Also list what the store reports out of stock" aria-label="Include out of stock">{f.inStock && outOfStock ? `Out of stock · ${outOfStock}` : 'Out of stock'}</Toggle>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Select.Root type="single" value={f.owned} onValueChange={(v) => (f.owned = v as Owned)}>
          <Select.Trigger aria-label="Hangar" size="sm" class="min-w-36">{OWNED.find((o) => o.value === f.owned)?.label}</Select.Trigger>
          <Select.Content>
            {#each OWNED as o (o.value)}<Select.Item value={o.value} label={o.label} />{/each}
          </Select.Content>
        </Select.Root>
        <div class="flex items-center gap-1 text-xs text-muted-foreground">
          <Input class="h-8 w-20 text-xs" inputmode="decimal" placeholder="$ min" aria-label="Minimum price" bind:value={minText} oninput={() => (f.min = parseUsd(minText))} />
          –
          <Input class="h-8 w-20 text-xs" inputmode="decimal" placeholder="$ max" aria-label="Maximum price" bind:value={maxText} oninput={() => (f.max = parseUsd(maxText))} />
        </div>
        <Input class="h-8 w-52" placeholder="Search listings" bind:value={f.q} aria-label="Search listings" />
        {#if active}<Button variant="ghost" size="sm" onclick={reset}>Reset{active > 1 ? ` (${active})` : ''}</Button>{/if}
      </div>

      {#if f.who === 'concierge'}
        {#if !concierge && !whoCount('concierge')}<p class="text-muted-foreground m-0 text-xs">RSI only returns Concierge-only listings to a Chairman's Club session — your level is on <a class="text-primary hover:underline" href="#wallet">Wallet</a>; non-members see nothing here, by design.</p>{/if}
      {:else if f.who === 'subscribers'}
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
            <SortTh key="bundle" bind:sort firstDir="desc">Contents</SortTh>
            <SortTh key="price" bind:sort>Price</SortTh>
            <SortTh key="discount" bind:sort firstDir="desc">Discount</SortTh>
            <SortTh key="owned" bind:sort firstDir="desc"><span class="sr-only">In hangar / cart</span></SortTh>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each shown.slice(0, budget) as it (it.id)}
            {@const off = discountPct(it)}
            {@const n = ownedCount(it)}
            {@const v = values.get(it.id)}
            {@const bundle = !!v && isBundle(it)}
            {@const isOpen = !!v && open.has(it.id)}
            {@const ins = insuranceOf(it)}
            <Table.Row>
              <Table.Cell class="w-full whitespace-normal">
                <div class="flex min-w-[240px] items-center gap-2.5">
                  <Thumb src={it.thumb} name={it.name} width={64} height={36} />
                  <div class="grid gap-0.5">
                    <a class="text-foreground no-underline hover:underline" href={it.url} target="_blank" rel="noopener"><strong>{it.name}</strong></a>
                    <div class="flex flex-wrap items-center gap-1">
                      <span class="text-muted-foreground mr-1 text-[11px]">{it.subtitle || catLabel(it.category)}</span>
                      {#if it.vip}<Badge variant="outline" class="border-warning/40 text-warning">Concierge</Badge>{/if}
                      {#if it.category === 'subscribers'}<Badge variant="outline" class="border-primary/40 text-primary">Subscribers</Badge>{/if}
                      {#if it.warbond}<Badge variant="outline" class="border-warning/40 text-warning" title="Warbond: new money only, no store credit">Warbond</Badge>{:else}<Badge variant="outline" class="text-muted-foreground" title="Standard: store credit welcome">Standard</Badge>{/if}
                      {#if ins}<Badge variant="outline" class={ins === 'LTI' ? 'border-warning/40 text-warning' : 'text-muted-foreground'} title={ins === 'LTI' ? 'Lifetime insurance on the hull(s)' : `${ins.replace(' mo', ' months')} of insurance on the hull(s)`}>{ins === 'LTI' ? 'LTI' : `${ins} insurance`}</Badge>{/if}
                      {#if !it.available}<Badge variant="outline" class="text-muted-foreground">out of stock</Badge>{/if}
                      {#if n}<Badge variant="outline" class="text-success">owned ×{n}</Badge>{/if}
                    </div>
                  </div>
                </div>
              </Table.Cell>
              <Table.Cell class="align-top">
                {#if v}
                  <button type="button" class="text-foreground inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 text-left text-[12.5px] hover:underline" onclick={() => toggle(it.id)} aria-expanded={isOpen} aria-controls={`bundle-${it.id}`}>
                    {#if isOpen}<ChevronDown class="text-muted-foreground size-3.5" aria-hidden="true" />{:else}<ChevronRight class="text-muted-foreground size-3.5" aria-hidden="true" />{/if}
                    {v.total} items
                  </button>
                  {#if !bundle}
                    <div class="text-muted-foreground text-[11px]">{v.parts.filter((p) => p.extra).map((p) => p.name).join(' · ')}</div>
                  {:else if v.priced}
                    {@const line = valueLine(v)}
                    <div class={cn('text-[11px] leading-4', v.savings > 0 ? 'text-success' : v.savings < 0 ? 'text-warning' : 'text-muted-foreground')} title={`${usd(v.separate)} bought apart (${v.priced} of ${v.priceable} pieces the store sells)`}>{line}</div>
                    <div class="text-muted-foreground text-[11px] leading-4">{usd(v.separate)} apart{#if v.priced < v.priceable}{` · ${v.priced}/${v.priceable} priced`}{/if}</div>
                  {:else}
                    <div class="text-muted-foreground text-[11px]">not sold apart</div>
                  {/if}
                {:else if it.contents?.length === 1 && paintKey(it.contents[0]!.name) !== paintKey(it.name)}
                  <span class="text-muted-foreground text-[11px]" title="What the listing grants">{it.contents[0]!.name}</span>
                {/if}
              </Table.Cell>
              <Table.Cell class="tabular-nums align-top">{usd(it.discounted)}{#if off}<div class="text-muted-foreground text-[11px] leading-4">list {usd(it.price)}</div>{/if}</Table.Cell>
              <Table.Cell class="align-top">{#if off}<span class="text-success">−{off}%</span><div class="text-muted-foreground text-[11px] leading-4">{usd(it.price - it.discounted)} off</div>{:else}<span class="text-muted-foreground">—</span>{/if}</Table.Cell>
              <Table.Cell class="align-top">
                {@const c = cart[it.id]}
                {#if c?.st === 'added'}
                  <span class="text-success inline-flex items-center gap-0.5 text-[11px]"><Check class="size-3" /> in cart</span>
                {:else if c?.st === 'adding'}
                  <span class="text-muted-foreground text-[11px]">adding…</span>
                {:else}
                  <Button variant="ghost" size="icon-xs" class="text-primary size-6" disabled={!it.available} onclick={() => addOne(it.id)} title={it.available ? 'Add to your RSI cart (nothing is paid)' : 'Out of stock'} aria-label="Add to cart"><ShoppingCart /></Button>
                  {#if c?.st === 'error'}<div class="text-destructive text-[11px]">{c.msg}</div>{/if}
                {/if}
              </Table.Cell>
            </Table.Row>
            {#if v && isOpen}
              <Table.Row id={`bundle-${it.id}`} class="hover:bg-transparent">
                <Table.Cell colspan={5} class="py-2 pr-3 pl-10">
                  <div class="rounded-lg border border-border/60 bg-white/[0.02] px-3 py-2">
                    {#if bundle}
                      <div class="mb-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
                        <span class="text-muted-foreground">Bought apart <strong class="text-foreground tabular-nums text-sm">{usd(v.separate)}</strong></span>
                        <span class="text-muted-foreground">This listing <strong class="text-foreground tabular-nums text-sm">{usd(it.discounted)}</strong></span>
                        {#if v.priced}
                          <span class={cn('font-semibold', v.savings > 0 ? 'text-success' : v.savings < 0 ? 'text-warning' : 'text-muted-foreground')}>{v.savings > 0 ? `Saves ${usd(v.savings)} · ${v.pct}%` : v.savings < 0 ? `${usd(-v.savings)} more than apart` : 'Same as apart'}</span>
                        {/if}
                        {#if v.priced < v.priceable}<span class="text-muted-foreground">{v.priced} of {v.priceable} pieces priced — the rest isn't sold on its own</span>{/if}
                      </div>
                    {/if}
                    <ul class="m-0 grid list-none gap-1.5 p-0">
                      {#each v.parts as part, i (i)}
                        {@const have = part.pieces ? part.pieces.filter((n) => ownedPiece(n) > 0).length : ownedPiece(part.name)}
                        <li class={cn('grid gap-0.5', i > 0 && part.pieces && 'border-border/40 border-t pt-1.5')}>
                          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                            {#if !part.pieces && have}<Check class="text-success size-3.5 shrink-0" aria-label="in your hangar" />{/if}
                            <span class={cn(part.extra && 'text-muted-foreground')}>{part.name}{#if part.count > 1} <span class="text-muted-foreground">×{part.count}</span>{/if}</span>
                            {#if part.ship}<Badge variant="outline" class="h-4 px-1 text-[10px]">ship</Badge>{/if}
                            {#if part.pieces}<Badge variant="outline" class="text-muted-foreground h-4 px-1 text-[10px]">{part.pieces.length} pieces</Badge>{/if}
                            {#if part.pieces && have}<Badge variant="outline" class="text-success h-4 px-1 text-[10px]">{have === part.pieces.length ? 'all owned' : `${have}/${part.pieces.length} owned`}</Badge>{:else if !part.pieces && have}<Badge variant="outline" class="text-success h-4 px-1 text-[10px]">owned{have > 1 ? ` ×${have}` : ''}</Badge>{/if}
                            <span class="text-muted-foreground ml-auto tabular-nums text-xs">{part.price != null ? (part.count > 1 ? `${usd(part.price)} × ${part.count} = ${usd(part.price * part.count)}` : usd(part.price)) : part.extra ? 'included' : 'not sold apart'}</span>
                          </div>
                          {#if part.pieces}
                            <ul class="text-muted-foreground m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-4 gap-y-0.5 p-0 pl-1 text-[11px]">
                              {#each part.pieces as piece, j (j)}
                                <li class="flex items-center gap-1 truncate" title={piece}>{#if ownedPiece(piece)}<Check class="text-success size-3 shrink-0" aria-label="in your hangar" />{:else}<span class="size-3 shrink-0" aria-hidden="true"></span>{/if}<span class="truncate">{piece}</span></li>
                              {/each}
                            </ul>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  </div>
                </Table.Cell>
              </Table.Row>
            {/if}
          {/each}
          {#if budget < shown.length}
            <Table.Row><Table.Cell colspan={5} class="text-muted-foreground text-xs">… {shown.length - budget} more loading</Table.Cell></Table.Row>
          {:else if !shown.length}
            <Table.Row>
              <Table.Cell colspan={5} class="text-muted-foreground">
                {#if loading}Loading…
                {:else if f.who === 'subscribers' && subscriber !== true}Nothing listed for this session.
                {:else if f.inStock && outOfStock}Nothing in stock matches — {outOfStock} out-of-stock {outOfStock === 1 ? 'listing does' : 'listings do'}; switch on <em>Out of stock</em> to see {outOfStock === 1 ? 'it' : 'them'}.
                {:else}Nothing matches.{/if}
              </Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>
</div>
