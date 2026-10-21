<script lang="ts">
  import Combobox from './Combobox.svelte';
  import Segmented from './Segmented.svelte';
  import { bg } from '@/lib/messages';
  import { inventory, ownedShipsWithPaints, type GameShip, type OwnedShip } from '@/lib/items';
  import { catalogItem, gameShipsItem, hangarItem, saleHistoryItem, storeItemsItem, wishlistItem, type WishShip } from '@/lib/settings';
  import { isWarbondSku, lastSale, lowestOffer, matchShip, usd, type Catalog, type CatalogShip, type SaleHistory } from '@/lib/store';
  import { sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';
  import Thumb from './Thumb.svelte';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import * as Select from '@/components/ui/select';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { cn } from '@/lib/utils';
  import Star from '@lucide/svelte/icons/star';

  let cat = $state<Catalog | null>(null);
  let wish = $state<WishShip[]>([]);
  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let sales = $state<SaleHistory>({});
  let game = $state<GameShip[]>([]);
  /** Ships you own (from the hangar) → copies + insurance, keyed by catalog id. */
  const owned = $derived.by(() => {
    const ships = cat?.ships ?? [];
    const fleet = hangar && ships.length ? ownedShipsWithPaints(inventory(hangar.pledges, ships), game, ships) : ships.length ? ownedShipsWithPaints([], game, ships) : [];
    return new Map<number, OwnedShip>(fleet.map((f) => [f.ship.id, f]));
  });
  /** Catalog ids of hulls the Browse listing flags Concierge-only (`isVip`, only present on a Chairman's Club session). */
  let vipNames = $state<string[]>([]);
  const vipIds = $derived(new Set(vipNames.map((n) => matchShip(n, cat?.ships ?? [])?.id).filter((id): id is number => id != null)));
  let error = $state('');
  let loading = $state(false);
  let q = $state('');
  let maker = $state('');
  /** Default: hulls the store sells right now (a CCU to them or a standalone). `off` = the rest, `all` = every hull. */
  type Sale = 'sale' | 'off' | 'all';
  let sale = $state<Sale>('sale');
  let only = $state<'' | 'wish' | 'warbond' | 'standalone' | 'ccu' | 'concept' | 'owned' | 'not-owned'>('');
  type Col = 'wish' | 'name' | 'msrp' | 'offer' | 'saving';
  let sort = $state<SortState<Col>>({ key: 'msrp', dir: 'asc' });

  $effect(() => {
    catalogItem.getValue().then((c) => (cat = c));
    wishlistItem.getValue().then((w) => (wish = w));
    gameShipsItem.getValue().then((g) => (game = g));
    hangarItem.getValue().then((h) => (hangar = h));
    saleHistoryItem.getValue().then((h) => (sales = h));
    storeItemsItem.getValue().then((v) => (vipNames = (v?.items ?? []).filter((i) => i.vip && i.category === 'ships').map((i) => i.name)));
    refresh(false);
    const offs = [catalogItem.watch((c) => (cat = c)), wishlistItem.watch((w) => (wish = w ?? [])), gameShipsItem.watch((g) => (game = g ?? [])), hangarItem.watch((h) => (hangar = h)), saleHistoryItem.watch((h) => (sales = h ?? {})), storeItemsItem.watch((v) => (vipNames = (v?.items ?? []).filter((i) => i.vip && i.category === 'ships').map((i) => i.name)))];
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
  const shown = $derived.by(() => {
    const query = q.trim().toLowerCase();
    const list = (cat?.ships ?? []).filter(
      (s) =>
        (sale === 'all' || (sale === 'sale') === onSale(s)) &&
        (!maker || s.manufacturer === maker) &&
        (!query || `${s.name} ${s.manufacturer} ${s.focus}`.toLowerCase().includes(query)) &&
        (only === '' ||
          (only === 'wish' && wished(s.id)) ||
          (only === 'warbond' && !!warbondOf(s)) ||
          (only === 'standalone' && s.standalone.some((k) => k.available)) ||
          (only === 'ccu' && s.ccu.length > 0) ||
          (only === 'concept' && /concept/i.test(s.flyable)) ||
          (only === 'owned' && owned.has(s.id)) ||
          (only === 'not-owned' && !owned.has(s.id))),
    );
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
  $effect(() => {
    if (budget >= shown.length) return;
    const t = setTimeout(() => (budget += 40), 16);
    return () => clearTimeout(t);
  });
  type Only = typeof only;
  const ONLY = $derived<{ value: Only; label: string }[]>([
    { value: '', label: 'All ships' },
    { value: 'wish', label: `★ Wishlist (${wish.length})` },
    { value: 'warbond', label: 'Warbond CCU on sale' },
    { value: 'standalone', label: 'Standalone on sale' },
    { value: 'ccu', label: 'Any CCU on sale' },
    { value: 'concept', label: 'Concept ships' },
    { value: 'owned', label: `Ships I own (${owned.size})` },
    { value: 'not-owned', label: "Ships I don't own" },
  ]);
  /** bits-ui Select treats '' as "nothing picked", so "All ships" travels as 'all'. */
  const ALL = 'all';
  const onSaleCount = $derived((cat?.ships ?? []).filter(onSale).length);
  const SALE = $derived<{ id: Sale; label: string; hint: string }[]>([
    { id: 'sale', label: `On sale · ${onSaleCount}`, hint: 'Hulls the store sells right now: a CCU to them or a standalone' },
    { id: 'off', label: `Not on sale · ${(cat?.ships.length ?? 0) - onSaleCount}`, hint: "Hulls with nothing on sale now — Plan CCU still works for them (Plan ahead), with the last date RSI+ saw them on sale" },
    { id: 'all', label: `All hulls · ${cat?.ships.length ?? 0}`, hint: 'Every hull in the catalog' },
  ]);
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">Ship catalog</Card.Title>
    <Card.Description>
      {cat ? `What the pledge store sells right now — ${onSaleCount} of ${cat.ships.length} hulls · prices from ${new Date(cat.at).toLocaleString()}` : loading ? 'Loading…' : ''}
      · ★ wishlist alerts when a warbond / sale price appears (checked every 30 min) · <em>Not on sale</em> lists the rest; <em>Plan CCU</em> works for those too (Plan ahead)
    </Card.Description>
    <Card.Action class="flex flex-wrap items-center gap-2">
      <Button variant="outline" href="#paint-rebuy" title="Melt paints you own and buy them back together with RSI's multi-paint discount — best value per cart size">Paint rebuy value →</Button>
      <Button variant="outline" disabled={loading} onclick={() => refresh(true)}>{loading ? 'Loading…' : 'Refresh prices'}</Button>
    </Card.Action>
  </Card.Header>
  <Card.Content class="grid gap-3">
    {#if error}<span class="text-destructive">{error}</span>{/if}
    <div class="flex flex-wrap items-center gap-2">
      <Segmented options={SALE} bind:value={sale} ariaLabel="On sale" />
      <Input class="w-60" placeholder="Search ship, maker, role" bind:value={q} aria-label="Search ships" />
      <div class="w-[220px]"><Combobox options={makers.map((m) => ({ value: m, label: m }))} value={maker || null} onpick={(v) => (maker = v ?? '')} ariaLabel="Manufacturer" placeholder="All makers" /></div>
      <Select.Root type="single" value={only || ALL} onValueChange={(v) => (only = v === ALL ? '' : (v as Only))}>
        <Select.Trigger aria-label="Show" class="min-w-44">{ONLY.find((o) => o.value === only)?.label}</Select.Trigger>
        <Select.Content>
          {#each ONLY as o (o.value)}<Select.Item value={o.value || ALL} label={o.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <SortTh key="wish" bind:sort firstDir="desc">★</SortTh>
          <SortTh key="name" bind:sort>Ship</SortTh>
          <SortTh key="msrp" bind:sort>MSRP</SortTh>
          <SortTh key="offer" bind:sort>On sale</SortTh>
          <SortTh key="saving" bind:sort firstDir="desc">Discount</SortTh>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each shown.slice(0, budget) as s (s.id)}
          {@const wb = warbondOf(s)}
          {@const on = wished(s.id)}
          <Table.Row>
            <Table.Cell>
              <Button variant="ghost" size="icon-sm" class={on ? 'text-warning' : 'text-muted-foreground'} onclick={() => toggleWish(s)} aria-label="Wishlist" aria-pressed={on}>
                <Star class={cn('size-[17px]', on && 'fill-current')} />
              </Button>
            </Table.Cell>
            <Table.Cell>
              <div class="flex items-center gap-2.5">
                <Thumb src={s.thumb} name={s.name} width={64} height={36} />
                <div class="grid gap-0.5">
                  <a class="text-foreground no-underline hover:underline" href={s.link} target="_blank" rel="noopener"><strong>{s.name}</strong></a>
                  <div class="text-muted-foreground text-[11px]">{s.manufacturer} · {s.focus} · {s.flyable}</div>
                  {#if vipIds.has(s.id)}<div><Badge variant="outline" class="border-warning/40 text-warning" title="The store lists this hull for Concierge members only">Concierge</Badge></div>{/if}
                  {#if owned.get(s.id)}
                    {@const o = owned.get(s.id)!}
                    <div class="flex flex-wrap gap-1">
                      <Badge variant="outline" class="text-success">owned ×{o.count}{o.game ? ` (${o.game === o.count ? '' : `${o.game} `}in-game)` : ''}</Badge>
                      {#each o.insurance as i (i)}<Badge variant="outline" class={cn(i === 'LTI' && 'border-warning/40 text-warning')}>{i}</Badge>{/each}
                    </div>
                  {/if}
                </div>
              </div>
            </Table.Cell>
            <Table.Cell>{s.msrp ? usd(s.msrp) : '—'}</Table.Cell>
            <Table.Cell class="whitespace-normal">
              <div class="flex flex-wrap gap-1">
                {#if wb}<Badge variant="outline" class="border-warning/40 text-warning">WB {usd(wb.price)}{wb.stock != null ? ` · ${wb.stock} left` : ''}</Badge>{/if}
                {#each s.ccu.filter((k) => k !== wb) as k (k.id)}<Badge variant="outline">{k.title || 'CCU'} {usd(k.price)}</Badge>{/each}
                {#each s.standalone.filter((k) => k.available) as k (k.id)}<Badge variant="outline" class="text-success">Standalone {usd(k.price)}</Badge>{/each}
                {#if !onSale(s)}
                  {@const t = lastSale(sales, s.id)}
                  <span class="text-muted-foreground text-[11px]" title={t ? 'Last seen on sale by RSI+ (history starts when it was installed)' : 'Not seen on sale since RSI+ was installed — ships come back at IAE (November), Invictus (May) or the maker\'s showcase'}>not on sale{t ? ` · last ${new Date(t).toLocaleDateString()}` : ''}</span>
                {/if}
              </div>
            </Table.Cell>
            <Table.Cell>
              {#if saving(s) > 0}<div class="text-success text-[11px]">−{usd(saving(s))}</div>{/if}
              <Button variant="outline" size="xs" href={`#ccu?to=${s.id}${onSale(s) ? '' : '&ahead=1'}`}>Plan CCU</Button>
            </Table.Cell>
          </Table.Row>
        {/each}
        {#if budget < shown.length}
          <Table.Row><Table.Cell colspan={5} class="text-muted-foreground text-xs">… {shown.length - budget} more loading</Table.Cell></Table.Row>
        {/if}
      </Table.Body>
    </Table.Root>
  </Card.Content>
</Card.Root>
