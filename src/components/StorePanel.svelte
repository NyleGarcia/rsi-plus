<script lang="ts">
  import { nearView } from '@/lib/near-view';
  import Combobox from './Combobox.svelte';
  import Segmented from './Segmented.svelte';
  import { bg } from '@/lib/messages';
  import type { GameShip } from '@/lib/items';
  import { ownedHulls } from '@/lib/owned-counts';
  import { useDeepLink } from '@/lib/deep-link.svelte';
  import { catalogItem, gameShipsItem, hangarItem, saleHistoryItem, storeItemsItem, wishlistItem, type WishShip } from '@/lib/settings';
  import { isLimitedSku, isLimitedTime, isWarbondSku, lastSale, lowestOffer, matchShip, usd, type Catalog, type CatalogShip, type SaleHistory, type StoreItem } from '@/lib/store';
  import { applyFacets, SIZE_OPTIONS, STAGE_OPTIONS, stageOf, type Facet, type FacetValues, type RangeFacet } from '@/lib/facets';
  import FacetBar from './FacetBar.svelte';
  import SkeletonSwap from './SkeletonSwap.svelte';
  import { sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';
  import Thumb from './Thumb.svelte';
  import Tag from './Tag.svelte';
  import HintBadge from './HintBadge.svelte';
  import LazyTip from './LazyTip.svelte';
  import TipButton from './TipButton.svelte';
  import WikiLink from './WikiLink.svelte';
  import { wikiPageUrl } from '@/lib/wiki';
  import Empty from './Empty.svelte';
  import * as Alert from '@/components/ui/alert';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { cn } from '@/lib/utils';
  import { fmtDate, fmtDateTime } from '@/lib/dates';
  import { LINK_QUIET } from '@/lib/ui';
  import Star from '@lucide/svelte/icons/star';
  import FanNotice from './FanNotice.svelte';

  let cat = $state<Catalog | null>(null);
  let wish = $state<WishShip[]>([]);
  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let sales = $state<SaleHistory>({});
  let game = $state<GameShip[]>([]);
  /** Ships you own (from the hangar) → copies + insurance, keyed by catalog id. */
  const owned = $derived(ownedHulls(hangar?.pledges, game, cat?.ships ?? []));
  /** Browse's standalone-ship listings (already loaded by Browse / the poll — never fetched here). */
  let shipListings = $state<StoreItem[]>([]);
  const shipsOf = (v: { items?: StoreItem[] } | null) => (v?.items ?? []).filter((i) => i.category === 'ships');
  /** Catalog id → its standalone listings, matched by name. */
  const listingsById = $derived.by(() => {
    const m = new Map<number, StoreItem[]>();
    for (const it of shipListings) {
      const id = matchShip(it.name, cat?.ships ?? [])?.id;
      if (id != null) m.set(id, [...(m.get(id) ?? []), it]);
    }
    return m;
  });
  /** Catalog ids of hulls the Browse listing flags Concierge-only (`isVip`, only present on a Chairman's Club session). */
  const vipIds = $derived(new Set([...listingsById].filter(([, l]) => l.some((i) => i.vip)).map(([id]) => id)));
  /** Hulls whose standalone listing RSI marks Limited Time (the catalog API carries no ribbon). */
  const limitedIds = $derived(new Set([...listingsById].filter(([, l]) => l.some((i) => i.available && isLimitedTime(i))).map(([id]) => id)));
  let error = $state('');
  let loading = $state(false);
  let q = $state('');
  let maker = $state('');
  /** Default: hulls the store sells right now (a CCU to them or a standalone). `off` = the rest, `all` = every hull. */
  type Sale = 'sale' | 'off' | 'all';
  let sale = $state<Sale>('sale');
  /** Facet picks (offer, stage, size, owned, wishlist, MSRP). */
  /** Facets survive a reload (`localStorage`); a saved value for a facet that no longer exists is harmless. */
  const CATALOG_PREFS = 'rsiplus:catalog';
  const readFv = (): FacetValues => {
    try {
      return (JSON.parse(localStorage.getItem(CATALOG_PREFS) ?? '{}') as { fv?: FacetValues }).fv ?? {};
    } catch {
      return {};
    }
  };
  let fv = $state<FacetValues>(readFv());
  $effect(() => {
    try {
      localStorage.setItem(CATALOG_PREFS, JSON.stringify({ fv: $state.snapshot(fv) }));
    } catch {
      /* private mode */
    }
  });
  type Col = 'wish' | 'name' | 'msrp' | 'offer' | 'saving';
  let sort = $state<SortState<Col>>({ key: 'msrp', dir: 'asc' });
  /** `#store?ship=<id>&q=<hull>` (from Store changes): show that hull — every hull, no maker / kind cut, the search set to it — and flash it. */
  const deepLink = useDeepLink({
    hash: '#store',
    idParam: 'ship',
    elId: (id) => `ship-${id}`,
    apply: (query) => {
      sale = 'all';
      fv = {};
      maker = '';
      q = query ?? '';
    },
    rendered: () => shown,
  });

  $effect(() => {
    catalogItem.getValue().then((c) => (cat = c));
    wishlistItem.getValue().then((w) => (wish = w));
    gameShipsItem.getValue().then((g) => (game = g));
    hangarItem.getValue().then((h) => (hangar = h));
    saleHistoryItem.getValue().then((h) => (sales = h));
    storeItemsItem.getValue().then((v) => (shipListings = shipsOf(v)));
    refresh(false);
    const offs = [catalogItem.watch((c) => (cat = c)), wishlistItem.watch((w) => (wish = w ?? [])), gameShipsItem.watch((g) => (game = g ?? [])), hangarItem.watch((h) => (hangar = h)), saleHistoryItem.watch((h) => (sales = h ?? {})), storeItemsItem.watch((v) => (shipListings = shipsOf(v)))];
    return () => offs.forEach((o) => o());
  });

  async function refresh(fresh: boolean) {
    loading = true;
    error = '';
    try {
      cat = await bg({ type: 'catalog:get', fresh });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  const wished = (id: number) => wish.some((w) => w.id === id);
  async function toggleWish(s: CatalogShip) {
    const cur = await wishlistItem.getValue();
    await wishlistItem.setValue(
      cur.some((w) => w.id === s.id) ? cur.filter((w) => w.id !== s.id) : [...cur, { id: s.id, name: s.name, lowest: lowestOffer(s)?.price ?? null }],
    );
  }

  const makers = $derived([...new Set((cat?.ships ?? []).map((s) => s.manufacturer).filter(Boolean))].sort());
  const warbondOf = (s: CatalogShip) => s.ccu.find((k) => isWarbondSku(k) && k.available);
  const onSale = (s: CatalogShip) => s.ccu.length > 0 || s.standalone.some((k) => k.available);
  const saving = (s: CatalogShip) => {
    const o = lowestOffer(s);
    return o && s.msrp ? s.msrp - o.price : 0;
  };
  const hasSize = $derived((cat?.ships ?? []).some((s) => !!s.size));
  const facets = $derived.by((): Facet<CatalogShip>[] => [
    {
      id: 'offer',
      label: 'Offer',
      options: [
        { id: 'warbond', label: 'Warbond CCU', hint: 'A warbond CCU to it on sale (new money only)', test: (s) => !!warbondOf(s) },
        { id: 'standard', label: 'Standard CCU', hint: 'A non-warbond CCU to it on sale (store credit welcome)', test: (s) => s.ccu.some((k) => !isWarbondSku(k)) },
        { id: 'limited', label: 'Limited CCU', hint: 'A CCU RSI titles limited', test: (s) => s.ccu.some(isLimitedSku) },
        { id: 'standalone', label: 'Standalone', hint: 'The ship itself on sale', test: (s) => s.standalone.some((k) => k.available) },
      ],
    },
    { id: 'stage', label: 'Stage', options: STAGE_OPTIONS<CatalogShip>((s) => s.flyable) },
    ...(hasSize ? [{ id: 'size', label: 'Size', options: SIZE_OPTIONS<CatalogShip>((s) => s.size ?? '') }] : []),
    {
      id: 'owned',
      label: 'Owned',
      options: [
        { id: 'yes', label: `Ships I own`, hint: 'In your hangar (pledged or in-game)', test: (s) => owned.has(s.id) },
        { id: 'no', label: "Ships I don't own", test: (s) => !owned.has(s.id) },
      ],
    },
    { id: 'wish', label: 'Wishlist', options: [{ id: 'yes', label: '★ Wishlist', hint: 'Hulls you starred', test: (s) => wished(s.id) }] },
  ]);
  const ranges: RangeFacet<CatalogShip>[] = [{ id: 'msrp', label: 'MSRP', unit: 'usd', get: (s) => (s.msrp ? s.msrp / 100 : null) }];
  /** Sale + maker + search, before the facets (what the FacetBar counts). */
  const rows = $derived.by(() => {
    const query = q.trim().toLowerCase();
    return (cat?.ships ?? []).filter(
      (s) => (sale === 'all' || (sale === 'sale') === onSale(s)) && (!maker || s.manufacturer === maker) && (!query || `${s.name} ${s.manufacturer} ${s.focus}`.toLowerCase().includes(query)),
    );
  });
  const shown = $derived.by(() => {
    const list = applyFacets(rows, facets, fv, ranges);
    const byName = [...list].sort((a, b) => a.name.localeCompare(b.name)); // tie order
    return sortBy(byName, sort, {
      wish: (s) => wished(s.id),
      name: (s) => s.name,
      msrp: (s) => s.msrp || null,
      offer: (s) => lowestOffer(s)?.price ?? null,
      saving: (s) => saving(s) || null,
    });
  });
  /** Rows on screen: first 40 with the click, 40 more a frame — *All hulls* (240 rows) blocked for ~250 ms in one go. */
  let budget = $derived.by(() => (void shown, 40));
  /** The "more loading" line is near the viewport (`lib/near-view.ts`): rows grow only then. */
  let near = $state(true);
  $effect(() => {
    if (budget >= shown.length || !near) return;
    const t = setTimeout(() => (budget += 40), 16);
    return () => clearTimeout(t);
  });
  const onSaleCount = $derived((cat?.ships ?? []).filter(onSale).length);
  const SALE = $derived<{ id: Sale; label: string; hint: string }[]>([
    { id: 'sale', label: `On sale · ${onSaleCount}`, hint: 'Hulls the store sells right now: a CCU to them or a standalone' },
    { id: 'off', label: `Not on sale · ${(cat?.ships.length ?? 0) - onSaleCount}`, hint: "Hulls with nothing on sale now — Plan CCU still works for them (Plan ahead), with the last date RSI+ saw them on sale" },
    { id: 'all', label: `All hulls · ${cat?.ships.length ?? 0}`, hint: 'Every hull in the catalog' },
  ]);
</script>

<Card.Root>
  <Card.Header>
    <Card.Description>
      {cat ? `What the pledge store sells right now — ${onSaleCount} of ${cat.ships.length} hulls · prices from ${fmtDateTime(cat.at)}` : loading ? 'Loading…' : ''}
      · ★ wishlist alerts when a warbond / sale price appears (checked every 30 min) · <em>Not on sale</em> lists the rest; <em>Plan CCU</em> works for those too (Plan ahead)
    </Card.Description>
    <Card.Action class="flex flex-wrap items-center gap-2">
      <TipButton variant="outline" href="#paint-rebuy" tip="Melt paints you own and buy them back together with RSI's multi-paint discount — best value per cart size">Paint rebuy value →</TipButton>
      <Button variant="outline" disabled={loading} onclick={() => refresh(true)}>{loading ? 'Loading…' : 'Refresh prices'}</Button>
    </Card.Action>
  </Card.Header>
  <Card.Content class="grid gap-3">
    <FanNotice variant="store" />
    {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
    <div class="flex flex-wrap items-center gap-2">
      <Segmented options={SALE} bind:value={sale} ariaLabel="On sale" />
    </div>
    <FacetBar {facets} {ranges} {rows} shown={shown.length} bind:values={fv} primary={['offer', 'stage', 'size']} hideEmpty>
      <Input class="w-60" placeholder="Search ship, maker, role" bind:value={q} aria-label="Search ships" />
      <div class="w-[220px]"><Combobox options={makers.map((m) => ({ value: m, label: m }))} value={maker || null} onpick={(v) => (maker = v ?? '')} ariaLabel="Manufacturer" placeholder="All makers" /></div>
    </FacetBar>
    <SkeletonSwap ready={!!cat || !loading} lines={8} lineHeight={44} label="Listings">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <SortTh key="wish" bind:sort firstDir="desc">★</SortTh>
          <SortTh key="name" bind:sort>Ship</SortTh>
          <SortTh key="msrp" bind:sort numeric>MSRP</SortTh>
          <SortTh key="offer" bind:sort>On sale</SortTh>
          <SortTh key="saving" bind:sort firstDir="desc" numeric>Under MSRP</SortTh>
          <Table.Head><span class="sr-only">Actions</span></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each shown.slice(0, budget) as s (s.id)}
          {@const wb = warbondOf(s)}
          {@const on = wished(s.id)}
          <Table.Row id={`ship-${s.id}`} class={cn(deepLink.flash === s.id && 'bg-primary/10')}>
            <Table.Cell>
              <Button variant="ghost" size="icon-sm" class={on ? 'text-warning' : 'text-muted-foreground'} onclick={() => toggleWish(s)} aria-label="Wishlist" aria-pressed={on}>
                <Star class={cn('size-[17px]', on && 'fill-current')} />
              </Button>
            </Table.Cell>
            <Table.Cell>
              <div class="flex items-center gap-2.5">
                <Thumb src={s.thumb} name={s.name} width={64} height={36} />
                <div class="grid gap-0.5">
                  <div class="flex items-center gap-0.5"><a class={LINK_QUIET} href={s.link} target="_blank" rel="noopener"><strong>{s.name}</strong></a><WikiLink href={wikiPageUrl(s.name)} name={s.name} /></div>
                  <div class="text-muted-foreground text-[11px]">{s.manufacturer} · {s.focus} · {s.flyable}</div>
                  {#if vipIds.has(s.id) || stageOf(s.flyable) !== 'ready' || s.size}
                    <div class="flex flex-wrap gap-1">
                      {#if stageOf(s.flyable) !== 'ready'}<Tag kind="stage" value={s.flyable} />{/if}
                      {#if s.size}<Tag kind="size" value={s.size} />{/if}
                      {#if vipIds.has(s.id)}<Tag kind="concierge" hint="The store lists this hull for Concierge members only" />{/if}
                    </div>
                  {/if}
                  {#if owned.get(s.id)}
                    {@const o = owned.get(s.id)!}
                    <div class="flex flex-wrap gap-1">
                      <Tag kind="owned" count={o.count} label={`owned ×${o.count}${o.game ? ` (${o.game === o.count ? '' : `${o.game} `}in-game)` : ''}`} />
                      {#each o.insurance as i (i)}<Tag kind="insurance" value={i} />{/each}
                    </div>
                  {/if}
                </div>
              </div>
            </Table.Cell>
            <Table.Cell class="text-right tabular-nums">{s.msrp ? usd(s.msrp) : '—'}</Table.Cell>
            <Table.Cell class="whitespace-normal">
              <div class="flex flex-wrap gap-1">
                {#if wb}<Tag kind="warbond" label={`Warbond ${usd(wb.price)}${wb.stock != null ? ` · ${wb.stock} left` : ''}`} />{#if isLimitedSku(wb)}<Tag kind="limited" size="xs" class="self-center" hint="RSI titles this CCU limited" />{/if}{/if}
                {#each s.ccu.filter((k) => k !== wb) as k (k.id)}<Tag kind="sale" label={`${k.title || 'CCU'} ${usd(k.price)}`} />{#if isLimitedSku(k)}<Tag kind="limited" size="xs" class="self-center" hint="RSI titles this CCU limited" />{/if}{/each}
                {#each s.standalone.filter((k) => k.available) as k (k.id)}<Tag kind="sale" label={`Standalone ${usd(k.price)}`} />{/each}
                {#if limitedIds.has(s.id)}<Tag kind="limited" size="xs" class="self-center" hint="RSI marks the standalone listing time-limited (from Browse)" />{/if}
                {#if !onSale(s)}
                  {@const t = lastSale(sales, s.id)}
                  <LazyTip tip={t ? 'Last seen on sale by RSI+ (history starts when it was installed)' : "Not seen on sale since RSI+ was installed — ships come back at IAE (November), Invictus (May) or the maker's showcase"}>
                    {#snippet trigger({ props })}<button type="button" {...props} class="text-muted-foreground cursor-default text-[11px]">not on sale{t ? ` · last ${fmtDate(t)}` : ''}</button>{/snippet}
                  </LazyTip>
                {/if}
              </div>
            </Table.Cell>
            <Table.Cell class="text-right whitespace-nowrap tabular-nums">
              {#if saving(s) > 0}
                {@const o = lowestOffer(s)!}
                <HintBadge variant="success-soft" hint={`${usd(s.msrp)} MSRP, cheapest offer now ${o.title} at ${usd(o.price)}`}>−{usd(saving(s))}</HintBadge>
              {:else}<span class="text-muted-foreground">—</span>{/if}
            </Table.Cell>
            <Table.Cell class="text-right">
              <Button variant="outline" size="xs" href={`#ccu?to=${s.id}${onSale(s) ? '' : '&ahead=1'}`}>Plan CCU</Button>
            </Table.Cell>
          </Table.Row>
        {/each}
        {#if budget < shown.length}
          <Table.Row><Table.Cell colspan={6} class="text-muted-foreground text-xs"><span use:nearView={(v) => (near = v)}>… {shown.length - budget} more below</span></Table.Cell></Table.Row>
        {:else if !shown.length}
          <Empty colspan={6}>{loading ? 'Loading…' : cat ? 'Nothing matches.' : 'No catalog yet — Refresh prices reads it.'}</Empty>
        {/if}
      </Table.Body>
    </Table.Root>
    </SkeletonSwap>
  </Card.Content>
</Card.Root>
