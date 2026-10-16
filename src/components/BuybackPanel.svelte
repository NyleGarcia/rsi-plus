<script lang="ts">
  import { loadBuyback, loadBuybackDetails } from '@/lib/account';
  import { addStandalone, CART_URL, CartError } from '@/lib/cart';
  import type { BuybackItem, PledgeType } from '@/lib/hangar';
  import { buybackItem, catalogItem, hangarItem, paintCatalogItem } from '@/lib/settings';
  import { itemKey } from '@/lib/melt';
  import { Badge } from '@/components/ui/badge';
  import { storePaintIndex } from '@/lib/items';
  import { buybackContents, countTitles, hangarCounts, packHint, storeLinksFor } from '@/lib/paints';
  import { inventory } from '@/lib/items';
  import { usd, type CatalogShip, type StorePaint } from '@/lib/store';
  import { ownUsd } from '@/lib/privacy.svelte';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { dateValue, sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';
  import * as Card from '@/components/ui/card';
  import { Button } from '@/components/ui/button';
  import * as Table from '@/components/ui/table';
  import * as Select from '@/components/ui/select';
  import { Input } from '@/components/ui/input';

  type Saved = NonNullable<Awaited<ReturnType<typeof buybackItem.getValue>>>;
  let data = $state<Saved | null>(null);
  let loading = $state<{ page: number; count: number; pages?: number } | null>(null);
  let error = $state('');
  let q = $state('');
  let type = $state<PledgeType | 'all'>('all');
  type Col = 'name' | 'type' | 'date';
  let sort = $state<SortState<Col>>({ key: 'date', dir: 'desc' });
  let ctrl: AbortController | null = null;
  /** Store catalog + paint listings (loaded by the Store / Ships tabs or the background) — for "buy it instead" links. */
  let ships = $state<CatalogShip[]>([]);
  let paints = $state<StorePaint[]>([]);
  const storeIdx = $derived(storePaintIndex(paints));
  /** Copies of each item title in the saved hangar → "already in hangar" per buyback entry. */
  let hangarPledges = $state<import('@/lib/hangar').Pledge[]>([]);
  const hangarQty = $derived(hangarCounts(hangarPledges));
  const qtyOf = (t: string) => hangarQty.get(itemKey(t)) ?? 0;
  /** Per entry: contents with hangar counts; `owned` = every content present. */
  const rows = $derived(inventory(hangarPledges, ships));
  const inHangar = (b: BuybackItem) => {
    const contents = buybackContents(b);
    // One line per distinct item: how many the entry holds (`need`) vs copies in the hangar (`n`).
    const parts = countTitles(contents).map(({ title, n: need }) => ({ title, need, n: qtyOf(title) }));
    const hint = contents.length ? null : packHint(b, rows, ships);
    // A count-only pack counts as owned when you hold at least as many paints for that hull as it has items.
    const owned = parts.length ? parts.every((p) => p.n >= p.need) : !!hint && hint.count > 0 && hint.ownedForHull.length >= hint.count;
    const any = parts.length ? parts.some((p) => p.n > 0) : !!hint?.ownedForHull.length;
    return { parts, hint, owned, any, status: (owned ? 'owned' : any ? 'partly' : hint ? 'unknown' : 'missing') as Own };
  };
  type Own = 'all' | 'owned' | 'partly' | 'missing' | 'unknown';
  const ownCount = (k: Own) => all.filter((i) => inHangar(i).status === k).length;
  /** Debug: copy the raw markup of the first buyback entries so a parser mismatch can be fixed from a paste. */
  let debugMsg = $state('');
  async function copyMarkup() {
    debugMsg = 'fetching…';
    try {
      const res = await fetch('https://robertsspaceindustries.com/account/buy-back-pledges?page=1&pagesize=50', { credentials: 'include' });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const blocks = [...doc.querySelectorAll('article.pledge, .list-items > li, .pledge')].filter((b) => !b.parentElement?.closest('article.pledge, .pledge')).slice(0, 2);
      const out = blocks.length ? blocks.map((b) => b.outerHTML).join('\n\n<!-- next -->\n\n') : (doc.body?.innerHTML ?? html).slice(0, 20000);
      await navigator.clipboard.writeText(out);
      debugMsg = `copied ${out.length.toLocaleString()} chars (${blocks.length} entries) — paste them to whoever fixes the parser`;
    } catch (e) {
      debugMsg = `could not copy: ${(e as Error).message}`;
    }
  }
  let own = $state<Own>('all');

  $effect(() => {
    buybackItem.getValue().then((v) => (data = v)).catch((e) => (error = `Couldn't read saved buyback: ${(e as Error).message}`));
    catalogItem.getValue().then((c) => (ships = c?.ships ?? [])).catch(() => {});
    paintCatalogItem.getValue().then((p) => (paints = p?.paints ?? [])).catch(() => {});
    hangarItem.getValue().then((h) => (hangarPledges = h?.pledges ?? [])).catch(() => {});
    const offH = hangarItem.watch((h) => (hangarPledges = h?.pledges ?? []));
    return () => (ctrl?.abort(), offH());
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
  // ---- contents + price per entry (one request each) ----
  let detailing = $state<{ done: number; total: number } | null>(null);
  let detailCtrl: AbortController | null = null;
  const withoutDetail = $derived(all.filter((b) => b.url && !b.items).length);
  async function loadDetails(force = false) {
    if (!data) return;
    error = '';
    detailCtrl = new AbortController();
    detailing = { done: 0, total: force ? all.filter((b) => b.url).length : withoutDetail };
    try {
      const items = await loadBuybackDetails(
        $state.snapshot(all) as BuybackItem[],
        async (p) => {
          detailing = { done: p.done, total: p.total };
          if (p.done % 5 === 0 || p.done === p.total) await save({ ...($state.snapshot(data) as Saved), items: p.items });
        },
        detailCtrl.signal,
        force,
      );
      await save({ ...($state.snapshot(data) as Saved), items });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = `Contents: ${(e as Error).message} — what was read so far is kept.`;
    } finally {
      detailing = null;
    }
  }
  // ---- add store items to the RSI cart (same call as the paint planner; never retried, nothing paid) ----
  type CartState = { st: 'adding' } | { st: 'added' } | { st: 'error'; msg: string };
  let cart = $state<Record<number, CartState>>({});
  let cartBusy = $state(false);
  async function addOne(sku: number, qty = 1) {
    cart = { ...cart, [sku]: { st: 'adding' } };
    try {
      await addStandalone(sku, qty);
      cart = { ...cart, [sku]: { st: 'added' } };
      return true;
    } catch (e) {
      const ce = e instanceof CartError ? e : new CartError('refused', (e as Error).message);
      cart = { ...cart, [sku]: { st: 'error', msg: ce.code === 'signed-out' ? 'Sign in to RSI' : ce.code === 'conflict' ? 'Cart busy' : ce.code === 'network' ? 'No answer — check your cart' : ce.message } };
      return false;
    }
  }
  /** Adds every missing item of an entry that the store sells, one after another; stops at the first error. */
  async function addMissing(lines: { sku: number; qty: number }[]) {
    cartBusy = true;
    try {
      for (const l of lines) {
        if (cart[l.sku]?.st === 'added') continue;
        if (!(await addOne(l.sku, l.qty))) break;
        await new Promise((ok) => setTimeout(ok, 400));
      }
    } finally {
      cartBusy = false;
    }
  }
  /** Store link for one item title of an entry (from `storeFor`). */
  const storeLink = (b: BuybackItem, title: string) => storeFor(b).find((l) => l.title === title) ?? null;
  /** Store pages for what each entry holds, when the store sells it today (CCUs: the planner's job). */
  const storeFor = (b: BuybackItem) => (b.type === 'upgrade' || b.upgrade ? [] : storeLinksFor(buybackContents(b), ships, storeIdx));
  let onlyStore = $state(false);
  const types = $derived([...new Set(all.map((i) => i.type))]);
  const shown = $derived(
    sortBy(
      all.filter((i) => (type === 'all' || i.type === type) && (!onlyStore || storeFor(i).length > 0) && (own === 'all' || inHangar(i).status === own) && (!q.trim() || `${i.name} ${i.contained}`.toLowerCase().includes(q.trim().toLowerCase()))),
      sort,
      { name: (i) => i.name, type: (i) => i.type, date: (i) => dateValue(i.date) },
    ),
  );
</script>

{#snippet cartBtn(sku: number, qty = 1)}
  {@const c = cart[sku]}
  {#if c?.st === 'added'}
    <span class="text-success inline-flex items-center gap-0.5 text-[11px]"><Check class="size-3" /> in cart</span>
  {:else if c?.st === 'adding'}
    <span class="text-muted-foreground text-[11px]">adding…</span>
  {:else}
    <Button variant="ghost" size="icon-xs" class="text-primary size-5" disabled={cartBusy} onclick={() => addOne(sku, qty)} title={`Add ${qty > 1 ? `${qty}× ` : ''}to your RSI cart (nothing is paid)`} aria-label="Add to cart"><ShoppingCart /></Button>
    {#if c?.st === 'error'}<span class="text-destructive text-[11px]" title={c.msg}>{c.msg}</span>{/if}
  {/if}
{/snippet}

<Card.Root>
  <Card.Header>
    <Card.Title><h2 class="m-0 text-lg font-semibold">Buyback</h2></Card.Title>
    <div class="text-muted-foreground text-sm">
      {#if loading}Loading page {loading.page}{loading.pages ? ` / ${loading.pages}` : ''}… {loading.count} items
      {:else if data}{all.length} items · {data.complete === false ? `partial (stopped after page ${data.page})` : 'loaded'} {new Date(data.at).toLocaleString()}
      {:else}Not loaded yet.{/if}
    </div>
    <Card.Action class="flex flex-wrap items-center gap-2">
      {#if loading}
        <Button variant="outline" onclick={() => ctrl?.abort()}>Stop</Button>
      {:else if detailing}
        <span class="text-muted-foreground text-sm">Reading entries… {detailing.done} / {detailing.total}</span>
        <Button variant="outline" onclick={() => detailCtrl?.abort()}>Stop</Button>
      {:else}
        {#if all.length}
          <Button variant={withoutDetail ? 'default' : 'outline'} onclick={() => loadDetails(!withoutDetail)} title="The list page only says “5 items”; each entry's own page lists the contents and today's buy-back price. One request per entry, ~3 per second.">
            {withoutDetail ? `Load contents & prices (${withoutDetail})` : 'Refresh contents & prices'}
          </Button>
        {/if}
        {#if data && data.complete === false}
          <Button onclick={() => load(true)}>Resume from page {(data.page ?? 0) + 1}</Button>
        {/if}
        <Button variant={data ? 'outline' : 'default'} onclick={() => load(false)}>{data ? 'Reload all' : 'Load buyback'}</Button>
        {#if Object.values(cart).some((c) => c.st === 'added')}<Button variant="outline" href={CART_URL} target="_blank" rel="noopener">Open RSI cart <ExternalLink /></Button>{/if}
      {/if}
    </Card.Action>
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if error}<span class="text-destructive">{error}</span>{/if}
    {#if all.length}
      <div class="flex flex-wrap items-center gap-2">
        <Input class="w-56" placeholder="Search" bind:value={q} aria-label="Search buyback" />
        <Select.Root type="single" bind:value={type}>
          <Select.Trigger aria-label="Type">{type === 'all' ? 'All types' : type}</Select.Trigger>
          <Select.Content>
            <Select.Item value="all" label="All types" />
            {#each types as t (t)}<Select.Item value={t} label={t} />{/each}
          </Select.Content>
        </Select.Root>
        <Select.Root type="single" bind:value={own}>
          <Select.Trigger aria-label="Hangar status">{own === 'all' ? 'In hangar: any' : own === 'owned' ? 'Already in hangar' : own === 'partly' ? 'Partly in hangar' : own === 'unknown' ? 'Contents not loaded' : 'Not in hangar'}</Select.Trigger>
          <Select.Content>
            <Select.Item value="all" label="In hangar: any" />
            <Select.Item value="owned" label={`Already in hangar (every item) · ${ownCount('owned')}`} />
            <Select.Item value="partly" label={`Partly in hangar (some items) · ${ownCount('partly')}`} />
            <Select.Item value="missing" label={`Not in hangar (none of it) · ${ownCount('missing')}`} />
            <Select.Item value="unknown" label={`Contents not loaded · ${ownCount('unknown')}`} />
          </Select.Content>
        </Select.Root>
        <label class="text-muted-foreground flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={onlyStore} class="accent-primary" /> only entries the store sells today</label>
        <span class="text-muted-foreground text-sm">{shown.length} shown · buyback CCUs can be used by the CCU planner</span>
        <span class="flex-1"></span>
        <Button variant="ghost" size="xs" onclick={copyMarkup} title="Copies the raw HTML of the first two buyback entries (as RSI serves them) to the clipboard, for fixing the parser when contents or dates come out wrong">Copy page markup</Button>
        {#if debugMsg}<span class="text-muted-foreground text-xs">{debugMsg}</span>{/if}
      </div>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <SortTh key="name" bind:sort>Item</SortTh>
            <SortTh key="type" bind:sort>Type</SortTh>
            <SortTh key="date" bind:sort firstDir="desc">Melted</SortTh>
            <Table.Head>In hangar · store</Table.Head>
            <Table.Head></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each shown as b, i (`${b.id}:${i}`)}
            <Table.Row>
              <Table.Cell class="whitespace-normal">
                <strong>{b.name}</strong>
                {#if b.items}<div class="text-muted-foreground text-xs">{b.items.length} item{b.items.length === 1 ? '' : 's'}</div>
                {:else if b.contained}<div class="text-muted-foreground text-xs">{b.contained}</div>{/if}
              </Table.Cell>
              <Table.Cell>{b.type}</Table.Cell>
              <Table.Cell class="text-muted-foreground text-xs">{b.date}</Table.Cell>
              <Table.Cell class="whitespace-normal text-xs">
                {@const h = inHangar(b)}
                {#if !hangarPledges.length}<span class="text-muted-foreground" title="Load the hangar on the Pledges page to compare">hangar not loaded</span>
                {:else if h.hint}
                  <Badge variant={h.owned ? 'secondary' : 'outline'} class={h.owned ? 'text-success' : h.hint.ownedForHull.length ? 'text-warning' : 'text-muted-foreground'} title="The list page only says how many items — use “Load contents & prices” to read this entry's page">{h.owned ? 'likely all in hangar' : 'contents not loaded'} · {h.hint.count} items</Badge>
                  {#if h.hint.hull}
                    <div class="mt-1">{#if h.hint.ownedForHull.length}<span class="text-muted-foreground">You own {h.hint.ownedForHull.length} {h.hint.hull} paint{h.hint.ownedForHull.length === 1 ? '' : 's'}{h.hint.ownedForHull.length >= h.hint.count ? ' (at least as many as the pack holds)' : ''}:</span> {h.hint.ownedForHull.map((p) => `${p.title}${p.n > 1 ? ` ×${p.n}` : ''}`).join(', ')}{:else}<span class="text-destructive">No {h.hint.hull} paints in your hangar.</span>{/if}</div>
                  {/if}
                {:else if h.parts.length === 1 && h.parts[0]!.need === 1}
                  {@const sl = storeLink(b, h.parts[0]!.title)}
                  <div class="flex flex-wrap items-center gap-2">
                    {#if h.parts[0]!.n}<Badge variant="secondary" class="text-success">in hangar ×{h.parts[0]!.n}</Badge>{:else}<Badge variant="outline" class="text-muted-foreground">not in hangar</Badge>{/if}
                    {#if sl}
                      <a href={sl.url} target="_blank" rel="noopener" class="text-primary no-underline hover:underline" title="Open the store page">store page{#if sl.price != null} · {usd(sl.price)}{/if}</a>
                      {@render cartBtn(sl.sku)}
                    {/if}
                  </div>
                {:else}
                  {@const lack = h.parts.filter((p) => p.n < p.need)}
                  {@const have = h.parts.filter((p) => p.n >= p.need)}
                  <Badge variant="secondary" class={h.owned ? 'text-success' : h.any ? 'text-warning' : 'text-muted-foreground'}>{h.owned ? 'all in hangar' : h.any ? `${h.parts.length - lack.length} of ${h.parts.length} in hangar` : 'not in hangar'}</Badge>
                  <ul class="m-0 mt-1.5 grid list-none gap-0.5 p-0">
                    {#each lack as p (p.title)}
                      {@const sl = storeLink(b, p.title)}
                      <li class="text-destructive flex items-start gap-1.5"><X class="mt-0.5 size-3 shrink-0" aria-label="missing" /><span class="inline-flex flex-wrap items-center gap-x-1.5">{#if sl}<a href={sl.url} target="_blank" rel="noopener" class="text-primary no-underline hover:underline" title="Open the store page">{p.title}</a>{:else}{p.title}{/if}{#if p.need > 1} <span class="font-semibold">×{p.need}</span>{#if p.n} <span class="text-muted-foreground">(have {p.n})</span>{/if}{/if}{#if sl}{#if sl.price != null}<span class="text-muted-foreground">{usd(sl.price)}</span>{/if}{@render cartBtn(sl.sku, Math.max(1, p.need - p.n))}{/if}</span></li>
                    {/each}
                    {#each have as p (p.title)}
                      <li class="text-muted-foreground flex items-start gap-1.5"><Check class="text-success mt-0.5 size-3 shrink-0" aria-label="in hangar" /><span>{p.title}{#if p.need > 1} ×{p.need}{/if} <span class="opacity-70">(have {p.n})</span></span></li>
                    {/each}
                  </ul>
                  {@const missingOnStore = lack.map((p) => ({ p, sl: storeLink(b, p.title) })).filter((x) => x.sl?.price != null)}
                  {#if missingOnStore.length}
                    {@const sum = missingOnStore.reduce((a, x) => a + x.sl!.price! * Math.max(1, x.p.need - x.p.n), 0)}
                    <div class="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 pt-1.5">
                      <span>Missing on the store: <strong class="text-foreground">{usd(sum)}</strong> ({missingOnStore.length} of {lack.length}){#if b.price != null} · buy back: <strong class="text-foreground">{ownUsd(b.price)}</strong>{#if missingOnStore.length === lack.length} → <span class={b.price < sum ? 'text-success' : 'text-warning'}>{b.price < sum ? 'buy-back is cheaper' : 'store is cheaper'}</span>{/if}{/if}</span>
                      <Button variant="outline" size="xs" disabled={cartBusy} onclick={() => addMissing(missingOnStore.map((x) => ({ sku: x.sl!.sku, qty: Math.max(1, x.p.need - x.p.n) })))} title="Adds every missing item the store sells to your RSI cart, one after another. Nothing is paid.">
                        <ShoppingCart /> Add all missing to cart
                      </Button>
                    </div>
                  {/if}
                {/if}
              </Table.Cell>
              <Table.Cell>
                {#if b.url}<Button variant="outline" size="xs" href={b.url} target="_blank" rel="noopener">Buy back</Button>{/if}
                {#if b.price != null}<div class="mt-1 text-xs whitespace-nowrap"><strong>{ownUsd(b.price)}</strong>{#if b.listPrice && b.listPrice > b.price}<span class="text-muted-foreground"> was {ownUsd(b.listPrice)} · −{Math.round(100 - (100 * b.price) / b.listPrice)}%</span>{/if}</div>{/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  </Card.Content>
</Card.Root>
