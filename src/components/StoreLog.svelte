<script lang="ts">
  /**
   * Store changes (ccugame-style): what the pledge store added and removed between two copies RSI+ read — CCUs and
   * standalone ships from the upgrade catalog, paints / packs / gear … from the listing. Newest first, one group per
   * check and action. Built only from copies read since this log existed, so it starts empty.
   */
  import Plus from '@lucide/svelte/icons/plus';
  import Minus from '@lucide/svelte/icons/minus';
  import { catalogItem, gameShipsItem, hangarItem, storeItemsItem, storeLogItem, storeSnapshotItem } from '@/lib/settings';
  import { inventory, ownedShipsWithPaints, type GameShip } from '@/lib/items';
  import { paintKey, STORE_CATEGORIES, usd, type Catalog, type StoreListing } from '@/lib/store';
  import { cleanLog, dismiss, mergeChanges, skuName, tally, type EntryKind, type MergedChange, type StoreChange, type StoreEntry, type StoreSnapshot } from '@/lib/storelog';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import X from '@lucide/svelte/icons/x';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import Check from '@lucide/svelte/icons/check';
  import Route from '@lucide/svelte/icons/route';
  import { addStandalone, CART_URL, CartError } from '@/lib/cart';
  import { insuranceOf, insuranceTag, isInsurance } from '@/lib/bundle';
  import * as Tooltip from '@/components/ui/tooltip';
  import Segmented from './Segmented.svelte';
  import Thumb from './Thumb.svelte';
  import * as Card from '@/components/ui/card';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';

  let log = $state<StoreChange[]>([]);
  let snap = $state<StoreSnapshot>({});
  let cat = $state<Catalog | null>(null);
  let listing = $state<StoreListing | null>(null);
  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let game = $state<GameShip[]>([]);
  type Show = 'all' | 'add' | 'remove';
  let show = $state<Show>('all');
  let limit = $state(4);
  /** Type sections (`<group>:<kind>`) opened past their first tiles. */
  let open = $state(new Set<string>());

  $effect(() => {
    storeLogItem.getValue().then((v) => (log = cleanLog(v)));
    storeSnapshotItem.getValue().then((v) => (snap = v));
    catalogItem.getValue().then((v) => (cat = v));
    storeItemsItem.getValue().then((v) => (listing = v));
    hangarItem.getValue().then((v) => (hangar = v));
    gameShipsItem.getValue().then((v) => (game = v ?? []));
    const offs = [
      storeLogItem.watch((v) => (log = cleanLog(v))),
      storeSnapshotItem.watch((v) => (snap = v ?? {})),
      catalogItem.watch((v) => (cat = v)),
      storeItemsItem.watch((v) => (listing = v)),
      hangarItem.watch((v) => (hangar = v)),
      gameShipsItem.watch((v) => (game = v ?? [])),
    ];
    return () => offs.forEach((o) => o());
  });

  /**
   * Store page + name per entry key from the current catalog / listing: entries logged before links were kept (and
   * standalones named after their SKU alone, "Standard Edition") get their link and hull name back from it.
   */
  const known = $derived.by(() => {
    const m = new Map<string, { link: string; name: string; thumb: string | null; ship?: number; hull?: string }>();
    for (const s of cat?.ships ?? []) {
      if (!s.link) continue;
      for (const k of s.ccu) m.set(`ccu:${k.id}`, { link: s.link, name: `${skuName(s.name, k.title)} CCU`, thumb: s.thumb, ship: s.id, hull: s.name });
      for (const k of s.standalone) m.set(`ship:${k.id}`, { link: s.link, name: skuName(s.name, k.title), thumb: s.thumb, ship: s.id, hull: s.name });
    }
    for (const i of listing?.items ?? []) if (i.url) m.set(`item:${i.id}`, { link: i.url, name: i.name, thumb: i.thumb });
    return m;
  });
  /** Hull copies in the hangar (pledged + in-game) by catalog id — as the Ship catalog counts them. */
  const ownedHulls = $derived.by(() => {
    const ships = cat?.ships ?? [];
    if (!hangar || !ships.length) return new Map<number, number>();
    return new Map(ownedShipsWithPaints(inventory(hangar.pledges, ships), game, ships).map((o) => [o.ship.id, o.count]));
  });
  /** Copies of an item in the hangar by normalized title (pledge names and every item inside them) — as Browse counts them. */
  const ownedKeys = $derived.by(() => {
    const m = new Map<string, number>();
    for (const p of hangar?.pledges ?? []) for (const t of new Set([p.name, ...p.items.map((i) => i.title)].map(paintKey))) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  /** "owned ×n" for an item / a standalone hull, "hull owned" for a CCU to a hull you have; null when not in the hangar. */
  const ownedLabel = (e: StoreEntry): string | null => {
    if (!hangar) return null;
    if (isHull(e)) {
      const id = e.ship ?? known.get(e.key)?.ship;
      const n = id ? (ownedHulls.get(id) ?? 0) : 0;
      return n ? (e.kind === 'ccu' ? `hull owned${n > 1 ? ` ×${n}` : ''}` : `owned ×${n}`) : null;
    }
    const n = ownedKeys.get(paintKey(nameOf(e))) ?? 0;
    return n ? `owned ×${n}` : null;
  };
  // ---- cart: an item's listing id and a standalone's SKU id are what the cart takes; a CCU needs a source hull → planner ----
  type CartState = { st: 'adding' } | { st: 'added' } | { st: 'error'; msg: string };
  let cart = $state<Record<string, CartState>>({});
  const skuOf = (e: StoreEntry): number | null => (e.kind === 'ccu' ? null : Number(e.key.split(':')[1]) || null);
  async function addOne(e: StoreEntry) {
    const sku = skuOf(e);
    if (sku == null || cart[e.key]?.st === 'adding') return;
    cart = { ...cart, [e.key]: { st: 'adding' } };
    try {
      await addStandalone(sku, 1);
      cart = { ...cart, [e.key]: { st: 'added' } };
    } catch (err) {
      const ce = err instanceof CartError ? err : new CartError('refused', (err as Error).message);
      cart = { ...cart, [e.key]: { st: 'error', msg: ce.code === 'signed-out' ? 'Sign in to RSI' : ce.code === 'conflict' ? 'Cart busy' : ce.code === 'network' ? 'No answer — check your cart' : ce.message } };
    }
  }
  const inCart = $derived(Object.values(cart).filter((c) => c.st === 'added').length);
  /** The listing behind an item entry (contents, warbond flag) while the store still has it. */
  const itemsById = $derived(new Map((listing?.items ?? []).map((i) => [i.id, i])));
  const itemOf = (e: StoreEntry) => (isHull(e) ? undefined : itemsById.get(Number(e.key.split(':')[1])));
  /** What a pack grants (insurance aside, it is a tag) — for the hover. */
  const contentsOf = (e: StoreEntry) => (itemOf(e)?.contents ?? []).filter((c) => !isInsurance(c.name));
  /** Warbond: the listing says so, else the SKU / name does ("Warbond Edition"). Insurance: from the contents, else the name. */
  const tagsOf = (e: StoreEntry) => {
    const it = itemOf(e);
    const name = nameOf(e);
    return { warbond: it ? it.warbond : /\bwarbond\b/i.test(name), insurance: it ? insuranceOf(it) : insuranceTag(name) };
  };
  const linkOf = (e: StoreEntry) => e.link ?? known.get(e.key)?.link;
  const thumbOf = (e: StoreEntry) => e.thumb ?? known.get(e.key)?.thumb ?? null;
  /**
   * Dismissing = taking it out of the saved log (one entry, one type, one group, or everything shown). Always from a
   * plain snapshot: a `$state` proxy handed to chrome.storage is saved as `{}`.
   */
  const drop = (c: MergedChange, entry?: string) => {
    let next = $state.snapshot(log);
    for (const p of c.parts) if (entry == null || p.entries.some((e) => e.key === entry)) next = dismiss(next, p.at, p.action, p.entries[0]?.key ?? '', entry);
    return storeLogItem.setValue(next);
  };
  /** Dismiss every entry of one type in a card (the ships, the paints …), across the logged groups behind it. */
  const dropKind = (c: MergedChange, kind: EntryKind) => {
    let next = $state.snapshot(log);
    for (const p of c.parts) {
      const keys = p.entries.filter((e) => e.kind === kind).map((e) => e.key);
      if (keys.length) next = dismiss(next, p.at, p.action, p.entries[0]?.key ?? '', keys);
    }
    return storeLogItem.setValue(next);
  };
  const dropAll = () => storeLogItem.setValue(show === 'all' ? [] : $state.snapshot(log).filter((c) => c.action !== show));
  const totals = $derived(tally(log));
  const nameOf = (e: StoreEntry) => (e.link ? e.name : (known.get(e.key)?.name ?? e.name));
  const isHull = (e: StoreEntry) => e.kind === 'ccu' || e.kind === 'ship';
  /**
   * Where the entry lives in RSI+: hulls on the Ship catalog (`#store?ship=<id>&q=<hull>` — every hull stays in the
   * catalog, on sale or not), items on Browse (`#browse?item=<id>&q=<name>`), only while the listing still has them.
   */
  const appHref = (e: StoreEntry): string | null => {
    const k = known.get(e.key);
    if (isHull(e)) {
      const id = e.ship ?? k?.ship;
      const hull = k?.hull ?? nameOf(e).replace(/ CCU$/, '').split(' - ')[0]!;
      return `#store?${new URLSearchParams({ ...(id ? { ship: String(id) } : {}), q: hull })}`;
    }
    return k ? `#browse?${new URLSearchParams({ item: e.key.slice('item:'.length), q: nameOf(e) })}` : null;
  };

  const KIND: Record<string, string> = { ccu: 'CCU', ship: 'Ship', ...Object.fromEntries(STORE_CATEGORIES.map((c) => [c.id, c.label])) };
  const kindLabel = (k: EntryKind) => KIND[k] ?? k;
  /** Section headers: "Ships", "CCUs", else the category label (already plural). */
  const kindPlural = (k: EntryKind) => (k === 'ship' ? 'Ships' : k === 'ccu' ? 'CCUs' : kindLabel(k));
  /** A poll's catalog check and listing check log separately; one card for both. */
  const merged = $derived(mergeChanges(log));
  const shown = $derived(merged.filter((c) => show === 'all' || c.action === show));
  const count = (s: Show) => merged.filter((c) => s === 'all' || c.action === s).length;
  const since = $derived(Math.min(...[snap.catalog?.at, snap.listing?.at].filter((n): n is number => !!n)));
  const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  /** Tiles per type before "+n more". */
  const FIRST = 12;
  /** A group's entries by kind, in the catalog's order (CCU, ship, then the listing categories). */
  const KIND_ORDER = ['ship', 'ccu', ...STORE_CATEGORIES.map((c) => c.id)];
  const byKind = (entries: StoreEntry[]): [EntryKind, StoreEntry[]][] => {
    const m = new Map<EntryKind, StoreEntry[]>();
    for (const e of entries) m.set(e.kind, [...(m.get(e.kind) ?? []), e]);
    return [...m].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]));
  };
  /** A catalog check and a listing check can both log a group of the same kind at the same moment. */
  const groupId = (c: MergedChange) => `${c.at}:${c.action}:${c.entries[0]?.key ?? ''}`;
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-lg font-semibold">Store changes</Card.Title>
    <Card.Description>
      What the pledge store added and removed: CCUs and standalone ships, paints, packs, gear, game packages, add-ons.
      {#if Number.isFinite(since)}Watching since {when(since)}.{/if} Checked when RSI+ polls (catalog every 30 min with a wishlist, else 6 h; the listing hourly) and when you refresh Browse. Click a name to see it in RSI+, ↗ for the RSI page, 🛒 adds it to your RSI cart (CCUs open the planner); ✕ dismisses.
    </Card.Description>
    {#if log.length}
      <Card.Action class="flex flex-wrap items-center gap-2">
        {#if inCart}<Button variant="outline" size="sm" href={CART_URL} target="_blank" rel="noopener">Open RSI cart ({inCart}) <ExternalLink /></Button>{/if}
        <Button variant="outline" size="sm" onclick={dropAll}>{show === 'all' ? 'Dismiss all' : `Dismiss ${show === 'add' ? 'added' : 'removed'}`}</Button>
        <Segmented
          size="sm"
          options={[
            { id: 'all', label: `All · ${count('all')}`, hint: 'Every change' },
            { id: 'add', label: `+${totals.add} added`, hint: `${count('add')} added group${count('add') === 1 ? '' : 's'} — new in the store` },
            { id: 'remove', label: `−${totals.remove} removed`, hint: `${count('remove')} removed group${count('remove') === 1 ? '' : 's'} — gone from the store` },
          ]}
          bind:value={show}
          ariaLabel="Show changes"
        />
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content>
    {#if !log.length}
      <p class="text-muted-foreground m-0 text-sm">
        {Number.isFinite(since) ? 'No changes yet: the store looks the same as at the first check.' : 'Nothing recorded yet: the first check sets the baseline, changes after it show up here.'}
      </p>
    {:else}
      <ol class="m-0 grid list-none gap-2 p-0">
        {#each shown.slice(0, limit) as c (groupId(c))}
          {@const id = groupId(c)}
          {@const add = c.action === 'add'}
          <li class="rounded-lg border px-3 py-2.5">
            <div class="flex flex-wrap items-center gap-2">
              <span class={['inline-flex size-5 items-center justify-center rounded-full', add ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive']} aria-hidden="true">
                {#if add}<Plus class="size-3.5" />{:else}<Minus class="size-3.5" />{/if}
              </span>
              <strong class="text-sm"><span class={add ? 'text-success' : 'text-destructive'}>{add ? '+' : '−'}{c.entries.length}</span> {c.entries.length === 1 ? nameOf(c.entries[0]!) : add ? 'added' : 'removed'}</strong>
              <span class="text-muted-foreground ml-auto text-xs">{when(c.at)}</span>
              <Button variant="ghost" size="icon-xs" class="text-muted-foreground size-6" onclick={() => drop(c)} title="Dismiss this group" aria-label="Dismiss this group"><X class="size-3.5" /></Button>
            </div>
            {#each byKind(c.entries) as [kind, list] (kind)}
              {@const sid = `${id}:${kind}`}
              {@const more = open.has(sid)}
              <section class="mt-2">
                {#if c.entries.length > 1}
                  <h4 class="text-muted-foreground m-0 mb-1 flex items-center gap-1 pl-7 text-[11px] font-semibold tracking-wide uppercase">
                    {kindPlural(kind)} <span class={add ? 'text-success' : 'text-destructive'}>{add ? '+' : '−'}{list.length}</span>
                    <Button variant="ghost" size="icon-xs" class="text-muted-foreground size-5" onclick={() => dropKind(c, kind)} title={`Dismiss these ${list.length} ${kindPlural(kind).toLowerCase()}`} aria-label={`Dismiss ${kindPlural(kind)}`}><X class="size-3" /></Button>
                  </h4>
                {/if}
                <ul class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-1.5 p-0 pl-7 text-[13px]">
                  {#each more ? list : list.slice(0, FIRST) as e (e.key)}
                    {@const rsi = linkOf(e)}
                    {@const app = appHref(e)}
                    {@const pic = thumbOf(e)}
                    {@const owned = ownedLabel(e)}
                    {@const tags = tagsOf(e)}
                    {@const inside = contentsOf(e)}
                    <li class={['group/entry flex min-w-0 items-center gap-2.5 rounded-md border p-1.5', owned ? 'border-success/30 bg-success/5' : 'border-border/40 bg-background/40']}>
                      {#if pic}<Thumb src={pic} name={nameOf(e)} width={80} height={45} />{:else}<span class="bg-muted/40 h-[45px] w-20 shrink-0 rounded-md" aria-hidden="true"></span>{/if}
                      <div class="grid min-w-0 flex-1 gap-0.5">
                        <div class="flex min-w-0 items-start gap-1">
                          {#if app}
                            <a class={['line-clamp-2 no-underline hover:underline', add ? 'text-foreground' : 'text-muted-foreground']} href={app} title={`${nameOf(e)} — ${isHull(e) ? 'show on the Ship catalog' : 'show on Browse'}`}>{nameOf(e)}</a>
                          {:else}
                            <span class={['line-clamp-2', add ? '' : 'text-muted-foreground']} title={nameOf(e)}>{nameOf(e)}</span>
                          {/if}
                        </div>
                        <div class="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11px] leading-4">
                          {#if e.price > 0}<span class="text-foreground tabular-nums font-medium">{usd(e.price)}</span>{/if}
                          {#if tags.warbond}<Badge variant="outline" class="border-warning/40 text-warning h-4 px-1 text-[10px]" title="Warbond: new money only, no store credit">Warbond</Badge>{/if}
                          {#if tags.insurance}<Badge variant="outline" class={['h-4 px-1 text-[10px]', tags.insurance === 'LTI' ? 'border-warning/40 text-warning' : 'text-muted-foreground']} title={tags.insurance === 'LTI' ? 'Lifetime insurance on the hull(s)' : `${tags.insurance.replace(' mo', ' months')} of insurance on the hull(s)`}>{tags.insurance === 'LTI' ? 'LTI' : `${tags.insurance} insurance`}</Badge>{/if}
                          {#if inside.length >= 2}
                            <Tooltip.Root delayDuration={150}>
                              <Tooltip.Trigger class="cursor-default">
                                <Badge variant="outline" class="h-4 px-1 text-[10px]">{inside.length} items</Badge>
                              </Tooltip.Trigger>
                              <Tooltip.Content side="bottom" align="start" class="max-w-80">
                                <ul class="m-0 grid list-none gap-0.5 p-0 text-xs">
                                  {#each inside as c, i (i)}
                                    <li class="flex items-center gap-1">{c.name}{#if c.ship}<span class="opacity-70">· ship</span>{/if}</li>
                                  {/each}
                                </ul>
                              </Tooltip.Content>
                            </Tooltip.Root>
                          {/if}
                          {#if owned}<Badge variant="outline" class="text-success h-4 px-1 text-[10px]" title={e.kind === 'ccu' ? 'The hull this upgrades to is already in your hangar' : 'Already in your hangar'}>{owned}</Badge>{/if}
                          {#if rsi}
                            <Button variant="ghost" size="icon-xs" class="text-muted-foreground size-5 shrink-0" href={rsi} target="_blank" rel="noopener" title="Open on the RSI store" aria-label="Open on the RSI store"><ExternalLink class="size-3" /></Button>
                          {/if}
                          {#if e.kind === 'ccu'}
                            {@const to = e.ship ?? known.get(e.key)?.ship}
                            {#if to}<Button variant="ghost" size="icon-xs" class="text-primary size-5 shrink-0" href={`#ccu?to=${to}`} title="Plan a CCU chain to this hull (a CCU needs a ship to start from)" aria-label="Plan CCU"><Route class="size-3" /></Button>{/if}
                          {:else if add && skuOf(e) != null}
                            {@const c = cart[e.key]}
                            {#if c?.st === 'added'}
                              <span class="text-success inline-flex items-center gap-0.5"><Check class="size-3" /> in cart</span>
                            {:else if c?.st === 'adding'}
                              <span>adding…</span>
                            {:else}
                              <Button variant="ghost" size="icon-xs" class="text-primary size-5 shrink-0" onclick={() => addOne(e)} title="Add to your RSI cart (nothing is paid)" aria-label={`Add ${nameOf(e)} to cart`}><ShoppingCart class="size-3" /></Button>
                              {#if c?.st === 'error'}<span class="text-destructive">{c.msg}</span>{/if}
                            {/if}
                          {/if}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon-xs" class="text-muted-foreground size-6 shrink-0 self-start opacity-0 group-hover/entry:opacity-100 focus-visible:opacity-100" onclick={() => drop(c, e.key)} title="Dismiss" aria-label={`Dismiss ${nameOf(e)}`}><X class="size-3.5" /></Button>
                    </li>
                  {/each}
                </ul>
                {#if list.length > FIRST}
                  <Button variant="link" size="xs" class="ml-5 h-6" onclick={() => (open = new Set(more ? [...open].filter((x) => x !== sid) : [...open, sid]))}>
                    {more ? 'Show fewer' : `+${list.length - FIRST} more ${kindPlural(kind).toLowerCase()}`}
                  </Button>
                {/if}
              </section>
            {/each}
          </li>
        {/each}
      </ol>
      {#if shown.length > limit}
        <Button variant="outline" size="sm" class="mt-2" onclick={() => (limit += 20)}>Show older ({shown.length - limit} more)</Button>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>
