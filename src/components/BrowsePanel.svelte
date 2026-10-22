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
  import { fetchStoreItems, matchShip, paintKey, STORE_CATEGORIES, usd, type CatalogShip, type StoreItem, type StoreListing } from '@/lib/store';
  import { activeFilters, DEFAULT_FILTER, discountPct, filterItems, forWho, isAudience, isBundle, isCat, matchesFilter, parseUsd, type Audience, type BrowseFilter, type Cat, type Edition, type HangarMatch, type Owned } from '@/lib/browse';
  import { addStandalone, CART_URL, CartError } from '@/lib/cart';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import Check from '@lucide/svelte/icons/check';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import ImageOff from '@lucide/svelte/icons/image-off';
  import { bundleValue, contentKey, hasContents, insuranceOf, isExtra, priceIndex, type BundleValue } from '@/lib/bundle';
  import { PAINT_TIERS, paintDiscount } from '@/lib/paints';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { cn } from '@/lib/utils';
  import type { Concierge } from '@/lib/concierge';
  import { sortBy, type SortState } from '@/lib/sort';
  import { listingEntries } from '@/lib/storelog';
  import { saveStoreCopy } from '@/lib/storelog-save';
  import SortTh from './SortTh.svelte';
  import FanNotice from './FanNotice.svelte';
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
    { value: 'all', label: 'Pieces: all owned' },
    { value: 'some', label: 'Pieces: some owned' },
    { value: 'none', label: 'Pieces: none owned' },
  ];
  const whoParam = hashParam('who');
  const catParam = hashParam('cat');
  let f = $state<BrowseFilter>({ ...DEFAULT_FILTER, who: isAudience(whoParam) ? whoParam : 'all', cat: isCat(catParam) ? catParam : 'all' });
  /** Listing to flash after a deep link (`#browse?item=<id>&q=<name>` from Store changes). */
  let flash = $state<number | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  /** `#browse?item=<id>&q=<name>`: show that listing — every filter off (out of stock included), the search set to it. */
  function fromHash() {
    const id = Number(hashParam('item')) || null;
    const query = hashParam('q');
    if (!id && query == null) return;
    f = { ...DEFAULT_FILTER, inStock: false, q: query ?? '' };
    flash = id;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash = null), 3000);
    history.replaceState(null, '', '#browse');
  }
  $effect(() => {
    if (flash == null) return;
    void shown;
    document.getElementById(`listing-${flash}`)?.scrollIntoView({ block: 'center' });
  });
  $effect(() => {
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  });
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
  /**
   * Picture per piece of a pack, from the store itself: a listing that grants just that piece (by content key), any
   * listing by its own name (a set priced as one listing: armor sets, paint packs), and hulls from the ship catalog.
   * RSI never ships pictures with a pack's contents, so a piece nobody sells alone has none.
   */
  /** Where a piece is sold on its own: the store page, the SKU for the cart, the picture. */
  interface Sold {
    url: string;
    sku: number | null;
    available: boolean;
    thumb: string | null;
  }
  const sold = $derived.by(() => {
    const m = new Map<string, Sold>();
    const put = (k: string, s: Sold) => {
      const cur = m.get(k);
      if (k && (!cur || (!cur.available && s.available))) m.set(k, s);
    };
    for (const it of all) {
      if (it.category === 'subscribers') continue; // not for sale to everyone
      const s: Sold = { url: it.url, sku: it.id, available: it.available, thumb: it.thumb };
      put(paintKey(it.name), s);
      const pieces = (it.contents ?? []).filter((c) => !c.ship && !isExtra(c.name));
      if (pieces.length === 1) put(contentKey(pieces[0]!.name), s);
    }
    return m;
  });
  const soldOf = (name: string, ship?: true): Sold | null => {
    if (ship) {
      const s = matchShip(name, ships);
      if (!s?.link) return null;
      const sku = s.standalone.filter((k) => k.available).sort((a, b) => a.price - b.price)[0];
      return { url: s.link, sku: sku?.id ?? null, available: !!sku, thumb: s.thumb };
    }
    return sold.get(contentKey(name)) ?? sold.get(paintKey(name)) ?? null;
  };
  /**
   * A paint pack's paints bought as singles under RSI's multi-paint discount: these n alone, then in a cart that reaches
   * each higher tier (the discount applies to every paint line in the cart). The pack line is priced as listed — whether
   * RSI discounts a pack line too, or counts it toward the tier, is unverified.
   */
  const paintTiers = (separate: number, n: number) => {
    const row = (paints: number, label: string) => {
      const rate = paintDiscount(paints);
      return { label, rate, cost: Math.round(separate * (1 - rate)) };
    };
    return [row(n, `${n} alone`), ...PAINT_TIERS.filter((t) => t.min > n).map((t) => row(t.min, `in a cart of ${t.min}+ paints`))];
  };
  /** A part's price line: its price (× copies), *included* for the extras, else *not sold apart*. */
  const subOf = (p: { price: number | null; count: number; extra?: true }) => (p.price != null ? (p.count > 1 ? `${usd(p.price)} × ${p.count} = ${usd(p.price * p.count)}` : usd(p.price)) : p.extra ? 'included' : 'not sold apart');
  const thumbOf = (name: string, ship?: true): string | null => soldOf(name, ship)?.thumb ?? null;
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
  /**
   * Pieces of a bundle already in the hangar vs all its pieces (extras aside, duplicates counted), and what the missing
   * ones cost bought apart (`unpriced` = missing pieces the store never sells alone; a set with any piece missing costs
   * the whole set).
   */
  const ownedOf = (v: BundleValue) => {
    let have = 0, of = 0, cost = 0, unpriced = 0;
    for (const p of v.parts) {
      if (p.extra) continue;
      if (p.pieces) {
        const h = p.pieces.filter((n) => ownedPiece(n) > 0).length;
        have += h;
        of += p.pieces.length;
        if (h < p.pieces.length) p.price != null ? (cost += p.price) : (unpriced += p.pieces.length - h);
      } else {
        const h = Math.min(ownedPiece(p.name), p.count);
        have += h;
        of += p.count;
        if (h < p.count) p.price != null ? (cost += p.price * (p.count - h)) : (unpriced += p.count - h);
      }
    }
    return { have, of, cost, unpriced };
  };
  /** What the hangar holds of a listing: the listing itself, and its pieces (a pack's parts; a single listing is its own piece). */
  const hangarOf = (it: StoreItem): HangarMatch => {
    const count = ownedCount(it);
    const v = values.get(it.id);
    if (v && isBundle(it)) {
      const o = ownedOf(v);
      return { count, have: o.have, of: o.of };
    }
    return { count, have: count > 0 ? 1 : 0, of: 1 };
  };
  /** Rows that pass every filter but the category — what each tab would show. */
  const filtered = $derived.by(() => {
    const query = f.q.trim().toLowerCase();
    return all.filter((it) => matchesFilter(it, f, hangarOf(it), query));
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
    const list = filterItems(all, f, hangarOf);
    const byName = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return sortBy(byName, sort, {
      name: (it) => it.name,
      bundle: (it) => (isBundle(it) ? (values.get(it.id)?.savings ?? null) : null),
      price: (it) => it.discounted,
      discount: (it) => discountPct(it) || null,
      owned: (it) => {
        const h = hangarOf(it);
        return h.of ? h.have / h.of || null : null;
      },
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
  const outOfStock = $derived(all.filter((it) => !it.available && matchesFilter(it, { ...f, inStock: false }, hangarOf(it)) && (f.cat === 'all' || it.category === f.cat)).length);
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

{#snippet tile(name: string, pic: string | null, owned: number, sub: string, opts: { ship?: boolean; extra?: boolean; count?: number; small?: boolean; buy?: Sold | null } = {})}
  {@const buy = opts.buy ?? null}
  {@const c = buy?.sku != null ? cart[buy.sku] : undefined}
  <li class={cn('flex min-w-0 items-center gap-2 rounded-md border px-1.5 py-1', owned ? 'border-success/30 bg-success/5' : 'border-border/40 bg-background/40', opts.extra && 'opacity-70')} title={name}>
    {#if pic}
      <Thumb src={pic} {name} width={opts.small ? 44 : 56} height={opts.small ? 25 : 32} />
    {:else}
      <span class={cn('bg-muted/40 text-muted-foreground flex shrink-0 items-center justify-center rounded-md', opts.small ? 'h-[25px] w-11' : 'h-8 w-14')} aria-hidden="true" title={opts.extra ? '' : 'No picture: the store never sells this on its own'}><ImageOff class="size-3.5 opacity-50" /></span>
    {/if}
    <div class="grid min-w-0 gap-0">
      <div class="flex min-w-0 items-center gap-1 text-[12px] leading-4">
        {#if owned}<Check class="text-success size-3 shrink-0" aria-label="in your hangar" />{/if}
        {#if buy}
          <a class="text-foreground truncate no-underline hover:underline" href={buy.url} target="_blank" rel="noopener" title={`${name} — open on the RSI store`}>{name}</a>
        {:else}
          <span class="truncate">{name}</span>
        {/if}
        {#if opts.count && opts.count > 1}<span class="text-muted-foreground shrink-0">×{opts.count}</span>{/if}
        {#if opts.ship}<Badge variant="outline" class="h-4 shrink-0 px-1 text-[10px]">ship</Badge>{/if}
      </div>
      {#if sub || owned > 1}<div class="text-muted-foreground text-[11px] leading-4 tabular-nums">{sub}{#if sub && owned > 1}{' · '}{/if}{#if owned > 1}owned ×{owned}{/if}</div>{/if}
    </div>
    {#if buy}
      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="icon-xs" class="text-muted-foreground size-6" href={buy.url} target="_blank" rel="noopener" title="Open on the RSI store" aria-label={`Open ${name} on the RSI store`}><ExternalLink class="size-3" /></Button>
        {#if buy.sku != null}
          {#if c?.st === 'added'}
            <span class="text-success inline-flex items-center gap-0.5 text-[11px]"><Check class="size-3" /> in cart</span>
          {:else if c?.st === 'adding'}
            <span class="text-muted-foreground text-[11px]">adding…</span>
          {:else}
            <Button variant="ghost" size="icon-xs" class="text-primary size-6" disabled={!buy.available} onclick={() => addOne(buy.sku!)} title={buy.available ? `Add ${name} to your RSI cart on its own (nothing is paid)` : 'Out of stock'} aria-label={`Add ${name} to cart`}><ShoppingCart class="size-3.5" /></Button>
            {#if c?.st === 'error'}<span class="text-destructive text-[11px]">{c.msg}</span>{/if}
          {/if}
        {/if}
      </div>
    {/if}
  </li>
{/snippet}

<div class="grid gap-4">
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
      <FanNotice variant="store" />
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
          <Select.Trigger aria-label="Hangar" size="sm" class="min-w-36" title="In / not in my hangar: the listing itself. Pieces: what you hold of a pack's parts — all (every paint of a collection already yours), some (two of nine ships), none">{OWNED.find((o) => o.value === f.owned)?.label}</Select.Trigger>
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
            {@const own = bundle && hangar ? ownedOf(v) : null}
            <Table.Row id={`listing-${it.id}`} class={cn(flash === it.id && 'bg-primary/10')}>
              <Table.Cell class="w-[46%] min-w-[380px] whitespace-normal">
                <div class="flex items-center gap-2">
                  {#if v}
                    <button type="button" class="text-muted-foreground hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0" onclick={() => toggle(it.id)} aria-expanded={isOpen} aria-controls={`bundle-${it.id}`} aria-label={isOpen ? 'Hide contents' : 'Show contents'}>
                      {#if isOpen}<ChevronDown class="size-4" aria-hidden="true" />{:else}<ChevronRight class="size-4" aria-hidden="true" />{/if}
                    </button>
                  {:else}
                    <span class="size-6 shrink-0" aria-hidden="true"></span>
                  {/if}
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
              <Table.Cell class="align-top whitespace-nowrap">
                {#if v}
                  <button type="button" class="text-foreground inline-flex items-center gap-1 rounded border-0 bg-transparent p-0 text-left text-[12.5px] hover:underline" onclick={() => toggle(it.id)} aria-expanded={isOpen} tabindex="-1">
                    {v.total} items
                  </button>
                  {#if own}
                    <div class={cn('inline-flex items-center gap-1 text-[11px] leading-4', own.have ? 'text-success' : 'text-muted-foreground')} title={`${own.of} of the ${v.total} items can be owned (hangar, game download and UEC extras aside); ${own.have} of those are already in your hangar`}>
                      {#if own.have}<Check class="size-3 shrink-0" aria-hidden="true" />{/if}
                      {own.have === own.of ? `all ${own.of} in your hangar` : `${own.have} of ${own.of} in your hangar`}
                    </div>
                  {/if}
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
              <Table.Cell class="w-full align-top">
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
              {@const singles = v.parts.filter((p) => !p.pieces)}
              {@const sets = v.parts.filter((p) => p.pieces)}
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
                        {#if it.category === 'paints' && !sets.length && v.priced === v.priceable && v.priceable >= 2}
                          {@const tiers = paintTiers(v.separate, v.priceable)}
                          <div class="basis-full">
                            <div class="text-muted-foreground mb-0.5" title="RSI takes 15 % off every paint line at 2 paints in the cart, 20 % at 3, 25 % at 5, 30 % at 7, 35 % at 10 — singles only; whether a pack line is discounted too, or counts toward the tier, is unverified">As singles with the multi-paint discount</div>
                            <div class="grid w-fit grid-cols-[auto_auto_auto_auto] gap-x-3 gap-y-0.5 text-[11px] leading-4">
                              {#each tiers as t, i (i)}
                                {@const d = it.discounted - t.cost}
                                <span class="text-muted-foreground">{t.label}</span>
                                <span class="text-muted-foreground tabular-nums text-right">−{Math.round(t.rate * 100)}%</span>
                                <strong class="text-foreground tabular-nums text-right">{usd(t.cost)}</strong>
                                <span class={cn('tabular-nums', d > 0 ? 'text-success' : 'text-muted-foreground')}>{d > 0 ? `beats the pack by ${usd(d)}` : d < 0 ? `pack cheaper by ${usd(-d)}` : 'same as the pack'}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        {#if own}
                          <span class={cn(own.have === own.of ? 'text-success' : 'text-muted-foreground')} title={`${own.of} of the ${v.total} items can be owned (hangar, game download and UEC extras aside)`}>In your hangar <strong class={cn('tabular-nums text-sm', own.have === own.of ? 'text-success' : 'text-foreground')}>{own.have} of {own.of}</strong></span>
                          {#if own.have && own.have < own.of}
                            <span class="text-muted-foreground" title="What the pieces you don't have would cost bought one by one">Missing apart <strong class="text-foreground tabular-nums text-sm">{usd(own.cost)}</strong>{#if own.unpriced}{` + ${own.unpriced} not sold apart`}{/if}</span>
                          {/if}
                        {/if}
                      </div>
                    {/if}
                    {#if singles.length}
                      <ul class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-1.5 p-0">
                        {#each singles as part, i (i)}
                          {@render tile(part.name, part.extra ? null : thumbOf(part.name, part.ship), ownedPiece(part.name), subOf(part), { ship: !!part.ship, extra: !!part.extra, count: part.count, buy: part.extra ? null : soldOf(part.name, part.ship) })}
                        {/each}
                      </ul>
                    {/if}
                    {#each sets as part, i (i)}
                      {@const pieces = part.pieces ?? []}
                      {@const have = pieces.filter((n) => ownedPiece(n) > 0).length}
                      {@const pic = thumbOf(part.name)}
                      <section class={cn('border-border/40 bg-background/30 rounded-md border p-1.5', (singles.length || i > 0) && 'mt-1.5')}>
                        <div class="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                          {#if pic}<Thumb src={pic} name={part.name} width={44} height={25} />{/if}
                          <strong class="font-semibold">{part.name}</strong>
                          <Badge variant="outline" class="text-muted-foreground h-4 px-1 text-[10px]">{pieces.length} pieces</Badge>
                          {#if have}<Badge variant="outline" class="text-success h-4 px-1 text-[10px]">{have === pieces.length ? 'all owned' : `${have}/${pieces.length} owned`}</Badge>{/if}
                          <span class="text-muted-foreground ml-auto tabular-nums text-xs">{part.price != null ? `${usd(part.price)} as a set` : 'not sold apart'}</span>
                        </div>
                        <ul class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-1 p-0">
                          {#each pieces as piece, j (j)}
                            {@render tile(piece, thumbOf(piece), ownedPiece(piece), '', { small: true, buy: soldOf(piece) })}
                          {/each}
                        </ul>
                      </section>
                    {/each}
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
