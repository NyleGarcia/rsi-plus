<script lang="ts">
  import { loadBuyback, loadBuybackDetails } from '@/lib/account';
  import { addStandalone } from '@/lib/cart';
  import { createCartLedger } from '@/lib/cart-ui.svelte';
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
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { BUYBACK_GROUP_BY, buybackGroups, type BuybackGroupBy } from '@/lib/buyback-groups';
  import { dateValue, sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';
  import LoadStatus from './LoadStatus.svelte';
  import LoadActions from './LoadActions.svelte';
  import CartButton from './CartButton.svelte';
  import OpenCartButton from './OpenCartButton.svelte';
  import TipButton from './TipButton.svelte';
  import HintBadge from './HintBadge.svelte';
  import Tag from './Tag.svelte';
  import Empty from './Empty.svelte';
  import SwitchRow from './SwitchRow.svelte';
  import * as Alert from '@/components/ui/alert';
  import { LINK } from '@/lib/ui';
  import { fmtDate, parseRsiDate } from '@/lib/dates';
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
  /** `inHangar` per entry, once per data / hangar / catalog change (the filter, counts and cells all read it). */
  const ownOf = $derived.by(() => new Map(all.map((b) => [b, inHangar(b)])));
  const ownFor = (b: BuybackItem) => ownOf.get(b) ?? inHangar(b);
  const ownCounts = $derived.by(() => {
    const m = new Map<Own, number>();
    for (const h of ownOf.values()) m.set(h.status, (m.get(h.status) ?? 0) + 1);
    return m;
  });
  const ownCount = (k: Own) => ownCounts.get(k) ?? 0;
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
  const cart = createCartLedger();
  const addOne = (sku: number, qty = 1) => cart.add(sku, () => addStandalone(sku, qty));
  /** Adds every missing item of an entry that the store sells, one after another; stops at the first error. */
  const addMissing = (lines: { sku: number; qty: number }[]) => cart.addAll(lines.map((l) => ({ key: l.sku, task: () => addStandalone(l.sku, l.qty) })));
  /** Store link for one item title of an entry (from `storeFor`). */
  const storeLink = (b: BuybackItem, title: string) => storeFor(b).find((l) => l.title === title) ?? null;
  /** Store pages for what each entry holds, when the store sells it today (CCUs: the planner's job). */
  const storeOf = (b: BuybackItem) => (b.type === 'upgrade' || b.upgrade ? [] : storeLinksFor(buybackContents(b), ships, storeIdx));
  const storeMap = $derived(new Map(all.map((b) => [b, storeOf(b)])));
  const storeFor = (b: BuybackItem) => storeMap.get(b) ?? storeOf(b);
  /** Row keys: the id, suffixed only when RSI repeats one. */
  const rowKey = $derived.by(() => {
    const seen = new Map<number, number>();
    for (const b of all) seen.set(b.id, (seen.get(b.id) ?? 0) + 1);
    return new Map(all.map((b, i) => [b, (seen.get(b.id) ?? 0) > 1 || !b.id ? `${b.id}:${i}` : String(b.id)]));
  });
  let onlyStore = $state(false);
  const types = $derived([...new Set(all.map((i) => i.type))]);
  const shown = $derived(
    sortBy(
      all.filter((i) => (type === 'all' || i.type === type) && (!onlyStore || storeFor(i).length > 0) && (own === 'all' || ownFor(i).status === own) && (!q.trim() || `${i.name} ${i.contained}`.toLowerCase().includes(q.trim().toLowerCase()))),
      sort,
      { name: (i) => i.name, type: (i) => i.type, date: (i) => dateValue(i.date) },
    ),
  );
  /** Group by (type / ship / none), remembered on this device. */
  const PREFS = 'rsiplus:buyback';
  let groupBy = $state<BuybackGroupBy>(
    (() => {
      try {
        const v = (JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { groupBy?: BuybackGroupBy }).groupBy;
        return BUYBACK_GROUP_BY.some((o) => o.value === v) ? v! : 'none';
      } catch {
        return 'none';
      }
    })(),
  );
  $effect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ groupBy }));
    } catch {
      /* no persistence — fine */
    }
  });
  const groups = $derived(buybackGroups(shown, groupBy, ships));
  const groupKeys = $derived(groups.map((g) => g.key));
  let collapsed = $state<Set<string>>(new Set());
  const toggle = (k: string) => {
    const next = new Set(collapsed);
    if (!next.delete(k)) next.add(k);
    collapsed = next;
  };
  const setAll = (keys: string[], close: boolean) => (collapsed = close ? new Set([...collapsed, ...keys]) : new Set([...collapsed].filter((k) => !keys.includes(k))));
  /** Rows before each group among the expanded ones, for the chunked render. */
  const starts = $derived.by(() => {
    let n = 0;
    return groups.map((g) => {
      const at = n;
      if (!collapsed.has(g.key)) n += g.items.length;
      return at;
    });
  });
  const visibleRows = $derived(groups.reduce((n, g) => n + (collapsed.has(g.key) ? 0 : g.items.length), 0));
  // Rows mount in chunks (40 first, then +60 a frame) so a long buyback list doesn't block the first paint; a new
  // filter or grouping starts over.
  let budget = $derived.by(() => (void groups, 40));
  $effect(() => {
    if (budget >= visibleRows) return;
    const t = setTimeout(() => (budget += 60), 16);
    return () => clearTimeout(t);
  });
</script>

{#snippet cartBtn(sku: number, qty = 1)}
  <CartButton state={cart.of(sku)} onadd={() => addOne(sku, qty)} busy={cart.busy} {qty} />
{/snippet}

{#snippet row(b: BuybackItem)}
  <Table.Row>
    <Table.Cell class="whitespace-normal">
      <strong>{b.name}</strong>
      {#if b.items}<div class="text-muted-foreground text-xs">{b.items.length} item{b.items.length === 1 ? '' : 's'}</div>
      {:else if b.contained}<div class="text-muted-foreground text-xs">{b.contained}</div>{/if}
    </Table.Cell>
    <Table.Cell>{b.type}</Table.Cell>
    {@const melted = parseRsiDate(b.date)}
    <Table.Cell class="text-muted-foreground text-xs">{Number.isNaN(melted) ? b.date : fmtDate(melted)}</Table.Cell>
    <Table.Cell class="whitespace-normal text-xs">
      {@const h = ownFor(b)}
      {#if !hangarPledges.length}<HintBadge variant="muted" hint="Load the hangar on the Pledges page to compare">hangar not loaded</HintBadge>
      {:else if h.hint}
        <HintBadge variant={h.owned ? 'success' : h.hint.ownedForHull.length ? 'warning' : 'muted'} hint="The list page only says how many items — use “Load contents & prices” to read this entry's page">{h.owned ? 'likely all in hangar' : 'contents not loaded'} · {h.hint.count} items</HintBadge>
        {#if h.hint.hull}
          <div class="mt-1">{#if h.hint.ownedForHull.length}<span class="text-muted-foreground">You own {h.hint.ownedForHull.length} {h.hint.hull} paint{h.hint.ownedForHull.length === 1 ? '' : 's'}{h.hint.ownedForHull.length >= h.hint.count ? ' (at least as many as the pack holds)' : ''}:</span> {h.hint.ownedForHull.map((p) => `${p.title}${p.n > 1 ? ` ×${p.n}` : ''}`).join(', ')}{:else}<span class="text-destructive">No {h.hint.hull} paints in your hangar.</span>{/if}</div>
        {/if}
      {:else if h.parts.length === 1 && h.parts[0]!.need === 1}
        {@const sl = storeLink(b, h.parts[0]!.title)}
        <div class="flex flex-wrap items-center gap-2">
          {#if h.parts[0]!.n}<Tag kind="owned" count={h.parts[0]!.n} />{:else}<Badge variant="muted">not in hangar</Badge>{/if}
          {#if sl}
            <a href={sl.url} target="_blank" rel="noopener" class={LINK} title="Open the store page">store page{#if sl.price != null} · {usd(sl.price)}{/if}</a>
            {@render cartBtn(sl.sku)}
          {/if}
        </div>
      {:else}
        {@const lack = h.parts.filter((p) => p.n < p.need)}
        {@const have = h.parts.filter((p) => p.n >= p.need)}
        <Badge variant={h.owned ? 'success' : h.any ? 'warning' : 'muted'}>{h.owned ? 'all in hangar' : h.any ? `${h.parts.length - lack.length} of ${h.parts.length} in hangar` : 'not in hangar'}</Badge>
        <ul class="m-0 mt-1.5 grid list-none gap-0.5 p-0">
          {#each lack as p (p.title)}
            {@const sl = storeLink(b, p.title)}
            <li class="text-destructive flex items-start gap-1.5"><X class="mt-0.5 size-3 shrink-0" aria-label="missing" /><span class="inline-flex flex-wrap items-center gap-x-1.5">{#if sl}<a href={sl.url} target="_blank" rel="noopener" class={LINK} title="Open the store page">{p.title}</a>{:else}{p.title}{/if}{#if p.need > 1} <span class="font-semibold">×{p.need}</span>{#if p.n} <span class="text-muted-foreground">(have {p.n})</span>{/if}{/if}{#if sl}{#if sl.price != null}<span class="text-muted-foreground">{usd(sl.price)}</span>{/if}{@render cartBtn(sl.sku, Math.max(1, p.need - p.n))}{/if}</span></li>
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
            <TipButton variant="outline" size="xs" disabled={cart.busy} onclick={() => addMissing(missingOnStore.map((x) => ({ sku: x.sl!.sku, qty: Math.max(1, x.p.need - x.p.n) })))} tip="Adds every missing item the store sells to your RSI cart, one after another. Nothing is paid.">
              <ShoppingCart /> Add all missing to cart
            </TipButton>
          </div>
        {/if}
      {/if}
    </Table.Cell>
    <Table.Cell class="text-right">
      {#if b.url}<Button variant="outline" size="xs" href={b.url} target="_blank" rel="noopener">Buy back</Button>{/if}
      {#if b.price != null}<div class="mt-1 text-xs whitespace-nowrap"><strong>{ownUsd(b.price)}</strong>{#if b.listPrice && b.listPrice > b.price}<span class="text-muted-foreground"> was {ownUsd(b.listPrice)} · −{Math.round(100 - (100 * b.price) / b.listPrice)}%</span>{/if}</div>{/if}
    </Table.Cell>
  </Table.Row>
{/snippet}

<Card.Root>
  <Card.Header>
    <LoadStatus {loading} {data} count={all.length} noun="items" />
    <Card.Action class="flex flex-wrap items-center gap-2">
      {#if detailing && !loading}
        <span class="text-muted-foreground text-sm">Reading entries… {detailing.done} / {detailing.total}</span>
        <Button variant="outline" onclick={() => detailCtrl?.abort()}>Stop</Button>
      {:else}
        {#if all.length && !loading}
          <TipButton variant={withoutDetail ? 'default' : 'outline'} onclick={() => loadDetails(!withoutDetail)} tip="The list page only says “5 items”; each entry's own page lists the contents and today's buy-back price. One request per entry, ~3 per second.">
            {withoutDetail ? `Load contents & prices (${withoutDetail})` : 'Refresh contents & prices'}
          </TipButton>
        {/if}
        <LoadActions {loading} {data} noun="buyback" onstop={() => ctrl?.abort()} onload={load}>
          {#if !loading}<OpenCartButton count={cart.added} size="default" />{/if}
        </LoadActions>
      {/if}
    </Card.Action>
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
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
        <Select.Root type="single" bind:value={() => groupBy, (v) => (groupBy = v as BuybackGroupBy)}>
          <Select.Trigger aria-label="Group by">{BUYBACK_GROUP_BY.find((o) => o.value === groupBy)?.label}</Select.Trigger>
          <Select.Content>
            {#each BUYBACK_GROUP_BY as o (o.value)}<Select.Item value={o.value} label={o.label} />{/each}
          </Select.Content>
        </Select.Root>
        {#if groupBy !== 'none'}
          <Button variant="outline" size="sm" onclick={() => setAll(groupKeys, false)}>Expand all</Button>
          <Button variant="outline" size="sm" onclick={() => setAll(groupKeys, true)}>Collapse all</Button>
        {/if}
        <SwitchRow id="buyback-only-store" size="sm" label="Only entries the store sells today" checked={onlyStore} onchange={(v) => (onlyStore = v)} />
        <span class="text-muted-foreground text-sm">{shown.length} shown · buyback CCUs can be used by the CCU planner</span>
        <span class="flex-1"></span>
        <TipButton variant="ghost" size="xs" onclick={copyMarkup} tip="Copies the raw HTML of the first two buyback entries (as RSI serves them) to the clipboard, for fixing the parser when contents or dates come out wrong">Copy page markup</TipButton>
        {#if debugMsg}<span class="text-muted-foreground text-xs">{debugMsg}</span>{/if}
      </div>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <SortTh key="name" bind:sort>Item</SortTh>
            <SortTh key="type" bind:sort>Type</SortTh>
            <SortTh key="date" bind:sort firstDir="desc">Melted</SortTh>
            <Table.Head>In hangar · store</Table.Head>
            <Table.Head class="text-right"><span class="sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        {#each groups as g, gi (g.key)}
          <Table.Body>
            {#if g.label}
              <Table.Row class="hover:bg-transparent">
                <Table.Head colspan={5} class="h-auto pt-3.5">
                  <!-- Table row group: a Collapsible can't wrap <tr>s, so this stays a disclosure button. -->
                  <Button variant="ghost" size="sm" class="aria-expanded:bg-transparent h-auto w-full flex-wrap justify-start gap-2 px-1 py-1.5 text-left text-[13px] font-normal whitespace-normal" aria-expanded={!collapsed.has(g.key)} onclick={() => toggle(g.key)}>
                    {#if collapsed.has(g.key)}<ChevronRight class="text-muted-foreground size-3.5" aria-hidden="true" />{:else}<ChevronDown class="text-muted-foreground size-3.5" aria-hidden="true" />{/if}
                    <strong>{g.label}</strong>
                    <span class="text-muted-foreground text-[11px]">· {g.items.length} entr{g.items.length === 1 ? 'y' : 'ies'}</span>
                  </Button>
                </Table.Head>
              </Table.Row>
            {/if}
            {#if !collapsed.has(g.key) && budget > starts[gi]!}
              {#each g.items.slice(0, budget - starts[gi]!) as b (rowKey.get(b))}
                {@render row(b)}
              {/each}
            {/if}
          </Table.Body>
        {/each}
        <Table.Body>
          {#if budget < visibleRows}
            <Table.Row><Table.Cell colspan={5} class="text-muted-foreground text-xs">… {visibleRows - budget} more loading</Table.Cell></Table.Row>
          {/if}
          {#if !shown.length}<Empty colspan={5}>Nothing matches.</Empty>{/if}
        </Table.Body>
      </Table.Root>
    {/if}
  </Card.Content>
</Card.Root>
