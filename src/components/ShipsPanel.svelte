<script lang="ts">
  import Segmented from './Segmented.svelte';
  import ShipSelect from './ShipSelect.svelte';
  import PaintBundlePanel from './PaintBundlePanel.svelte';
  import { hangarState, hangarUrl } from '@/lib/hangar';
  import {
    line,
    familyLabel,
    fitsLabel as fitsLabelOf,
    inventory,
    itemsCsv,
    ownedShipsWithPaints,
    paintGroups,
    shipsFor,
    storePaintFor,
    storePaintIndex,
    storePaintsByFamily,
    type GameShip,
    type ItemRow,
    type PaintGroup,
  } from '@/lib/items';
  import { bg } from '@/lib/messages';
  import { buybackItem, catalogItem, gameShipsItem, getSettings, hangarItem, paintCatalogItem, pledgeLabelsItem, settingsItem, storeItemsItem } from '@/lib/settings';
  import { addStandalone } from '@/lib/cart';
  import { createCartLedger } from '@/lib/cart-ui.svelte';
  import { isExtra, isInsurance } from '@/lib/bundle';
  import { cleanLabels, labelsOf, type Labels } from '@/lib/labels';
  import { sortBy, type SortState } from '@/lib/sort';
  import { paintKey, priceLabel, usd, type Catalog, type CatalogShip, type PaintCatalog, type StoreContent, type StorePaint } from '@/lib/store';
  import { ownUsd } from '@/lib/privacy.svelte';
  import SortTh from './SortTh.svelte';
  import Thumb from './Thumb.svelte';
  import Tag from './Tag.svelte';
  import HintBadge from './HintBadge.svelte';
  import TipButton from './TipButton.svelte';
  import WikiLink from './WikiLink.svelte';
  import { wikiPageUrl } from '@/lib/wiki';
  import CartButton from './CartButton.svelte';
  import OpenCartButton from './OpenCartButton.svelte';
  import Empty from './Empty.svelte';
  import * as Alert from '@/components/ui/alert';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import * as Collapsible from '@/components/ui/collapsible';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import { Input } from '@/components/ui/input';
  import { cn } from '@/lib/utils';
  import { LINK, LINK_QUIET } from '@/lib/ui';
  import { fmtDateTime } from '@/lib/dates';
  import { Checkbox } from '@/components/ui/checkbox';
  import SwitchRow from './SwitchRow.svelte';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Download from '@lucide/svelte/icons/download';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
  import House from '@lucide/svelte/icons/house';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
  import X from '@lucide/svelte/icons/x';
  import * as DropdownMenu from '@/components/ui/dropdown-menu';
  import { shipLines, starOrgRows, xplorCsv, xplorRows } from '@/lib/export';
  import { applyFacets, stageOf, type FacetValues } from '@/lib/facets';
  import { shipFacets, shipRanges, SHIP_PRIMARY } from '@/lib/pledge-facets';
  import FacetBar from './FacetBar.svelte';

  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let cat = $state<Catalog | null>(null);
  let storePaints = $state<PaintCatalog | null>(null);
  /** The Browse listing's contents per listing id (what a paint pack grants) — the paint catalog itself keeps none. */
  let packContents = $state(new Map<number, StoreContent[]>());
  const contentsOf = (items: { id: number; contents?: StoreContent[] }[] | undefined) => new Map((items ?? []).filter((i) => (i.contents?.length ?? 0) > 1).map((i) => [i.id, i.contents!]));
  let buyback = $state<Awaited<ReturnType<typeof buybackItem.getValue>>>(null);
  let game = $state<GameShip[]>([]);
  let labels = $state<Labels>({});
  let error = $state('');
  let paintsLoading = $state(false);

  $effect(() => {
    hangarItem.getValue().then((h) => (hangar = h));
    catalogItem.getValue().then((c) => (cat = c));
    paintCatalogItem.getValue().then((p) => (storePaints = p));
    storeItemsItem.getValue().then((v) => (packContents = contentsOf(v?.items)));
    buybackItem.getValue().then((b) => (buyback = b));
    gameShipsItem.getValue().then((g) => (game = g));
    pledgeLabelsItem.getValue().then((l) => (labels = cleanLabels(l)));
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch((e) => (error = `Store catalog: ${(e as Error).message} (needed to match paints to ships)`));
    refreshPaints(false);
    const offs = [hangarItem.watch((h) => (hangar = h)), catalogItem.watch((c) => (cat = c)), paintCatalogItem.watch((p) => (storePaints = p)), storeItemsItem.watch((v) => (packContents = contentsOf(v?.items))), buybackItem.watch((b) => (buyback = b)), gameShipsItem.watch((g) => (game = g ?? [])), pledgeLabelsItem.watch((l) => (labels = cleanLabels(l)))];
    return () => offs.forEach((o) => o());
  });
  async function refreshPaints(fresh: boolean) {
    paintsLoading = true;
    try {
      storePaints = await bg({ type: 'paints:get', fresh });
    } catch (e) {
      error = `Store paints: ${(e as Error).message}`;
    } finally {
      paintsLoading = false;
    }
  }

  const ships = $derived(cat?.ships ?? []);
  const rows = $derived(inventory(hangar?.pledges ?? [], ships));
  const fleet = $derived(ownedShipsWithPaints(rows, game, ships));
  const storeIdx = $derived(storePaintIndex(storePaints?.paints ?? []));
  const storeByFam = $derived(storePaintsByFamily(storePaints?.paints ?? [], ships));
  const ownedPaints = $derived(rows.filter((r) => r.category === 'paint'));
  /** Store paint id → the hulls it is for (exact variant when the name says one: "Hull A - Dusk Paint" → Hull A only). */
  const storeFits = $derived(new Map((storePaints?.paints ?? []).map((sp) => [sp.id, shipsFor(sp.name, ships)])));
  /**
   * Store paints you already have: same title in the hangar, or a pack / collection whose every paint you own one by
   * one (the pack would read "not owned" though nothing in it is missing).
   */
  const ownedStoreIds = $derived.by(() => {
    const ids = new Set(rows.filter((r) => r.category === 'paint').map((r) => storePaintFor(r, storeIdx)?.id).filter((x): x is number => x != null));
    const have = new Set(rows.map((r) => paintKey(r.title)));
    for (const sp of storePaints?.paints ?? []) {
      const pieces = (packContents.get(sp.id) ?? []).filter((c) => !c.ship && !isExtra(c.name) && !isInsurance(c.name));
      if (pieces.length > 1 && pieces.every((c) => have.has(paintKey(c.name)))) ids.add(sp.id);
    }
    return ids;
  });
  // ---- add a store paint to the RSI cart (same call as Browse / Paint rebuy; never retried, nothing paid) ----
  const cart = createCartLedger();
  const addOne = (sku: number) => cart.add(sku, () => addStandalone(sku, 1));

  // ---- view prefs ----
  type View = 'paints' | 'ships' | 'bundle';
  type Own = 'both' | 'owned' | 'not-owned';
  type GroupShow = '' | 'owned' | 'not-owned' | 'unknown';
  const PREFS = 'rsiplus:ships';
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<{ own: Own; groupShow: GroupShow; withEmpty: boolean; shipFacets: FacetValues }>;
    } catch {
      return {};
    }
  })();
  /** Which page the hub shows: Paints by ship (`#paints`), My ships (`#fleet`) or Paint rebuy (`#paint-rebuy`). One instance for all three. */
  let { view = 'paints' }: { view?: View } = $props();
  let own = $state<Own>(saved.own ?? 'both');
  let groupShow = $state<GroupShow>(saved.groupShow ?? '');
  let withEmpty = $state(saved.withEmpty ?? true);
  /** My ships facet choices (FacetBar). */
  let shipValues = $state<FacetValues>(saved.shipFacets ?? {});
  $effect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ own, groupShow, withEmpty, shipFacets: shipValues }));
    } catch {
      /* no persistence — fine */
    }
  });

  // ---- helpers ----
  const qty = (list: ItemRow[]) => list.reduce((n, r) => n + r.count, 0);
  /** Fits text per hangar row, once per hangar / catalog change. */
  const fitsLabels = $derived(new Map(rows.map((r) => [r.key, fitsLabelOf(r, ships)])));
  const fitsLabel = (r: ItemRow) => fitsLabels.get(r.key) ?? fitsLabelOf(r, ships);
  function download(name: string, body: string, type = 'text/csv') {
    const url = URL.createObjectURL(new Blob([body], { type }));
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  // ---- fleet export (HangarXPLOR shape: FleetYards, myfleet.gg, Starjump read it) ----
  const fleetRows = () => xplorRows(hangar?.pledges ?? [], ships);
  /** A stopped hangar load misses every pledge on the unread pages — exporting it would hand on a fleet with ships missing. */
  const partial = $derived(hangarState(hangar) === 'partial');
  function exportFleet(kind: 'json' | 'csv') {
    if (partial) return;
    const rows = fleetRows();
    if (kind === 'json') download(`hangarxplor-shiplist-${stamp()}.json`, JSON.stringify(rows, null, 2), 'application/json');
    else download(`hangarxplor-shiplist-${stamp()}.csv`, xplorCsv(rows));
  }
  /** Settings → Integrations → *StarOrg Tools* (opt-in): shows the StarOrg export below. */
  let starorgOn = $state(false);
  $effect(() => {
    getSettings().then((v) => (starorgOn = v.starorg));
    return settingsItem.watch(() => getSettings().then((v) => (starorgOn = v.starorg)));
  });
  /** StarOrg Tools preset: the same rows plus insurance, `acquired`, and the ships you have only in the game, without `pledge_date`. */
  const exportStarOrg = () => download(`starorg-fleet-${stamp()}.json`, JSON.stringify(starOrgRows(hangar?.pledges ?? [], game, ships), null, 2), 'application/json');
  let copiedNames = $state(false);
  async function copyNames() {
    await navigator.clipboard.writeText(shipLines(fleetRows()));
    copiedNames = true;
    setTimeout(() => (copiedNames = false), 1500);
  }
  let collapsed = $state<Set<string>>(new Set());
  const toggle = (k: string) => {
    const s = new Set(collapsed);
    s.has(k) ? s.delete(k) : s.add(k);
    collapsed = s;
  };
  const setOpen = (k: string, open: boolean) => collapsed.has(k) === open && toggle(k);
  const setAll = (keys: string[], close: boolean) => (collapsed = close ? new Set([...collapsed, ...keys]) : new Set([...collapsed].filter((k) => !keys.includes(k))));

  // ---- paints by ship ----
  let paintQ = $state('');
  interface Row {
    key: string;
    title: string;
    owned: ItemRow | null;
    store: StorePaint | null;
  }
  interface Group extends PaintGroup {
    rows: Row[];
    fam: string;
    /** Variant group (store paints for hulls of the family you don't own): exactly those hulls, for Plan CCU. */
    variants?: CatalogShip[];
  }
  const pgStatus = (g: PaintGroup): Exclude<GroupShow, ''> => (g.key === '~' ? 'unknown' : g.owned.length ? 'owned' : 'not-owned');
  const groupsAll = $derived.by((): Group[] => {
    // Always attach the hulls you own to their family, or a ship with no paints in the hangar would read "no ship
    // owned" next to its store paints; `withEmpty` only decides whether families with nothing to list still show.
    const base = paintGroups(rows, fleet, true, ships);
    const byKey = new Map(base.map((g) => [g.key, g]));
    // Families that only exist on the store side (you own neither ship nor paint) still get a group when
    // showing not-owned paints — that's how you browse paints for ships you don't have.
    if (own !== 'owned')
      for (const f of storeByFam.keys()) {
        const key = f === '~' ? 'packs' : `f:${f}`;
        if (!byKey.has(key)) byKey.set(key, { key, label: f === '~' ? 'Paint packs & collections (store)' : familyLabel(f, ships), owned: [], paints: [] });
      }
    const out: Group[] = [];
    for (const g of byKey.values()) {
      const fam = g.key === '~' || g.key === 'packs' ? g.key : g.key.slice(2);
      const rowsOut: Row[] = g.paints.map((r) => ({ key: r.key, title: r.title, owned: r, store: storePaintFor(r, storeIdx) }));
      const seen = new Set(rowsOut.map((r) => r.store?.id).filter((x) => x != null));
      // Store paints for a variant you don't own (you have a Hull B; the store sells Hull A / Hull C paints) get their
      // own "no ship owned" group per variant instead of padding the family you do own.
      const ownedIds = new Set(g.owned.map((o) => o.ship.id));
      const variants = new Map<string, { label: string; rows: Row[]; ships: CatalogShip[] }>();
      for (const sp of storeByFam.get(fam === 'packs' ? '~' : fam) ?? []) {
        if (seen.has(sp.id) || ownedStoreIds.has(sp.id)) continue;
        const row: Row = { key: `s:${sp.id}`, title: sp.name, owned: null, store: sp };
        const fits = storeFits.get(sp.id) ?? [];
        if (!ownedIds.size || !fits.length || fits.some((x) => ownedIds.has(x.id))) rowsOut.push(row);
        else {
          const label = fits.map((x) => x.name).join(', ');
          const v = variants.get(label) ?? { label, rows: [], ships: fits };
          v.rows.push(row);
          variants.set(label, v);
        }
      }
      out.push({ ...g, fam, rows: rowsOut });
      for (const [label, v] of variants) out.push({ key: `${g.key}|${label}`, label, owned: [], paints: [], fam, rows: v.rows, variants: v.ships });
    }
    return out;
  });
  const counts = $derived.by(() => {
    const c = { owned: 0, 'not-owned': 0 };
    for (const g of groupsAll) for (const r of g.rows) r.owned ? (c.owned += r.owned.count) : c['not-owned']++;
    return c;
  });
  /** Ship groups per status, for the Ships control: hulls you own / families you don't / packs + paints with no known ship. */
  const shipCounts = $derived.by(() => {
    const c = { owned: 0, 'not-owned': 0, unknown: 0 };
    for (const g of groupsAll) c[g.key === 'packs' ? 'unknown' : pgStatus(g)]++;
    return c;
  });
  const groups = $derived.by(() => {
    const query = paintQ.trim().toLowerCase();
    return groupsAll
      .filter((g) => !groupShow || (g.key === 'packs' ? groupShow === 'unknown' : pgStatus(g) === groupShow))
      .map((g) => {
        const groupHit = !!query && `${g.label} ${g.owned.map((o) => o.ship.name).join(' ')}`.toLowerCase().includes(query);
        const rs = g.rows.filter((r) => (own === 'both' || (own === 'owned') === !!r.owned) && (!query || groupHit || r.title.toLowerCase().includes(query)));
        return { ...g, rows: rs };
      })
      .filter((g) => g.rows.length || (withEmpty && g.owned.length && (!query || g.label.toLowerCase().includes(query))))
      .sort((a, b) => Number(a.key === '~' || a.key === 'packs') - Number(b.key === '~' || b.key === 'packs') || Number(!a.owned.length) - Number(!b.owned.length) || a.label.localeCompare(b.label));
  });
  const groupKeys = $derived(groups.map((g) => `p|${g.key}`));
  // Groups mount in chunks (12 first, then +20 a frame); a new filter starts over.
  let groupBudget = $derived.by(() => (void groups, 12));
  $effect(() => {
    if (groupBudget >= groups.length) return;
    const t = setTimeout(() => (groupBudget += 20), 16);
    return () => clearTimeout(t);
  });
  const cheapest = (fits: CatalogShip[]) => [...fits].filter((s) => s.msrp).sort((a, b) => a.msrp - b.msrp)[0] ?? fits[0];
  const familyShips = (g: Group) => g.variants ?? ships.filter((s) => line(s.name, ships) === g.fam);

  function openPaintsFor(name: string) {
    paintQ = familyLabel(line(name, ships), ships);
    groupShow = '';
    location.hash = '#paints';
  }

  // ---- my ships + compare ----
  let shipQ = $state('');
  let compare = $state<number[]>([]);
  let shipSort = $state<SortState<'name' | 'count' | 'msrp' | 'paints' | 'maker' | 'insurance'>>({ key: 'name', dir: 'asc' });
  /** Sort key: LTI first, then longest term. */
  const insRank = (ins: string[]) => (ins.includes('LTI') ? 10_000 : Math.max(0, ...ins.map((i) => parseInt(i, 10) || 0)));
  const fleetFacets = $derived(shipFacets(fleet));
  const fleetShown = $derived(
    sortBy(
      applyFacets(fleet, fleetFacets, shipValues, shipRanges).filter((f) => !shipQ.trim() || `${f.ship.name} ${f.ship.manufacturer} ${f.ship.focus}`.toLowerCase().includes(shipQ.trim().toLowerCase())),
      shipSort,
      { name: (f) => f.ship.name, count: (f) => f.count, msrp: (f) => f.ship.msrp || null, paints: (f) => f.paints.length, maker: (f) => f.ship.manufacturer, insurance: (f) => insRank(f.insurance) || null },
    ),
  );
  const byId = $derived(new Map(ships.map((s) => [s.id, s])));
  let addCompare = $state<number | null>(null);
  const compared = $derived(compare.map((id) => byId.get(id)).filter((s): s is CatalogShip => !!s));
  const fleetOf = (id: number) => fleet.find((f) => f.ship.id === id);
  const toggleCompare = (id: number) => (compare = compare.includes(id) ? compare.filter((x) => x !== id) : [...compare, id]);
  const unmatchedShips = $derived(rows.filter((r) => r.category === 'ship' && !r.ship));
  const storeFor = (fam: string) => (storeByFam.get(fam) ?? []).filter((sp) => !ownedStoreIds.has(sp.id));
  // ---- in-game ships (aUEC-bought / earned): tracked by hand, counted as hulls for paints ----
  let gameAdd = $state<number | null>(null);
  let gameHow = $state<GameShip['how']>('bought');
  const gameSorted = $derived([...game].sort((a, b) => a.name.localeCompare(b.name) || a.how.localeCompare(b.how)));
  /** Add `n` (may be negative) copies of a ship by `how`; a line at 0 is removed. */
  async function bumpGame(id: number, how: GameShip['how'], n: number) {
    const ship = byId.get(id);
    const cur = await gameShipsItem.getValue();
    const hit = cur.find((g) => g.id === id && g.how === how);
    const next = hit ? cur.map((g) => (g === hit ? { ...g, count: g.count + n } : g)) : n > 0 && ship ? [...cur, { id, name: ship.name, how, count: n }] : cur;
    await gameShipsItem.setValue(next.filter((g) => g.count > 0));
  }
  const removeGame = (g: GameShip) => bumpGame(g.id, g.how, -g.count);
  /** Your labels on the pledges holding a hull (`lib/labels.ts`). */
  const shipTags = (f: { items: ItemRow[] }) => [...new Set(f.items.flatMap((i) => i.pledges).flatMap((p) => labelsOf(labels, p.id)))];
</script>

{#snippet links(r: Row)}
  <span class="inline-flex flex-wrap gap-2">
    {#if r.store}
      <a class="{LINK} inline-flex items-center gap-1 whitespace-nowrap" href={r.store.url} target="_blank" rel="noopener" title={r.owned ? 'Store page (buy another / gift)' : 'Open on the store'}><ExternalLink class="size-3" /> {r.owned ? 'store' : `store ${priceLabel(r.store.discounted, r.store.price)}`}</a>
      {@const sku = r.store.id}
      {#if r.store.available || cart.of(sku)}<CartButton state={cart.of(sku)} onadd={() => addOne(sku)} name={r.title} available={r.store.available} />{/if}
    {/if}
    {#if r.owned}
      {#each [...new Map(r.owned.pledges.map((p) => [p.id, p])).values()].slice(0, 3) as p (p.id)}
        <a class="{LINK} inline-flex items-center gap-1 whitespace-nowrap" href={hangarUrl(hangar?.pledges ?? [], p.id)} target="_blank" rel="noopener" title={`Open the hangar page with ${p.name} (gift / melt)`}><House class="size-3" /> #{p.id}</a>
      {/each}
    {/if}
  </span>
{/snippet}

{#snippet insBadges(ins: string[], empty: string)}
  {#each ins as i (i)}<Tag kind="insurance" value={i} class="m-px" />{:else}<span class={empty}>—</span>{/each}
{/snippet}

{#if !hangar}
  <Card.Root><Card.Content><Empty>Load your hangar first (<a class={LINK} href="#hangar">Pledges</a>) — ships and paints are built from it.</Empty></Card.Content></Card.Root>
{:else}
  <div class="grid gap-4">
    {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}

      {#if view === 'ships' && compared.length}
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onclick={() => document.getElementById('compare')?.scrollIntoView({ behavior: 'smooth' })}>Compare · {compared.length} <ArrowDown /></Button>
        </div>
      {/if}

        {#if view === 'paints'}
          <Card.Root>
            <Card.Header>
              <Card.Description>
                Your paints and the store's, per ship. <ShoppingCart class="inline size-3.5 align-[-2px]" aria-hidden="true" /><span class="sr-only">Store</span> opens the store page, <House class="inline size-3.5 align-[-2px]" aria-hidden="true" /><span class="sr-only">Hangar</span> the hangar page holding it (gift / melt).
                {#if storePaints}· {storePaints.paints.length} store paints from {fmtDateTime(storePaints.at)}{/if}
                {#if ownedPaints.length}· pictures for {ownedPaints.filter((r) => r.image || storePaintFor(r, storeIdx)).length} of {ownedPaints.length} owned paints{#if !ownedPaints.some((r) => r.image)}
                  <HintBadge variant="warning" hint="The hangar page's item pictures are kept when the hangar is loaded — reload it on Pledges. If this stays, RSI's hangar markup differs from what the parser expects.">none from the hangar page — reload it on Pledges</HintBadge>
                {/if}{/if}
              </Card.Description>
              <Card.Action class="flex flex-wrap items-center gap-2">
                <OpenCartButton count={cart.added} />
                <Button variant="outline" size="sm" disabled={paintsLoading} onclick={() => refreshPaints(true)}>{paintsLoading ? 'Loading…' : 'Refresh store paints'}</Button>
              </Card.Action>
            </Card.Header>
            <Card.Content class="grid gap-4">
              <!-- Two independent cuts, same control, same words: which ships (groups) and which paints (rows inside them). -->
              <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 max-sm:grid-cols-1">
                <span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Ships</span>
                <div class="flex flex-wrap items-center gap-3">
                  <Segmented
                    options={[
                      { id: 'all', label: `All · ${shipCounts.owned + shipCounts['not-owned'] + shipCounts.unknown}` },
                      { id: 'owned', label: `I own · ${shipCounts.owned}`, hint: 'Ships in your hangar or added as in-game' },
                      { id: 'not-owned', label: `I don't own · ${shipCounts['not-owned']}`, hint: 'Ships the store has paints for that are not in your hangar' },
                      { id: 'unknown', label: `Packs & unmatched · ${shipCounts.unknown}`, hint: 'Paint packs / collections, and paints whose ship could not be worked out' },
                    ]}
                    bind:value={() => groupShow || 'all', (v) => (groupShow = (v === 'all' ? '' : v) as GroupShow)}
                    ariaLabel="Ships"
                    size="sm"
                  />
                  {#if groupShow !== 'not-owned' && groupShow !== 'unknown'}
                    <SwitchRow id="ships-with-empty" size="sm" class="text-xs" label="Also my ships with no paints" checked={withEmpty} onchange={(v) => (withEmpty = v)} />
                  {/if}
                </div>
                <span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Paints</span>
                <Segmented
                  options={[
                    { id: 'both', label: `All · ${counts.owned + counts['not-owned']}` },
                    { id: 'owned', label: `I own · ${counts.owned}`, hint: 'Paints in your hangar' },
                    { id: 'not-owned', label: `I don't own · ${counts['not-owned']}`, hint: 'Paints the store sells that you do not have' },
                  ]}
                  bind:value={own}
                  ariaLabel="Paints"
                  size="sm"
                />
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Input class="w-64" placeholder="Search paint or ship" bind:value={paintQ} aria-label="Search paints" />
                {#if paintQ}<Button variant="outline" size="sm" onclick={() => (paintQ = '')}><X /> clear</Button>{/if}
                <span class="flex-1"></span>
                <Button variant="outline" size="sm" onclick={() => setAll(groupKeys, false)}>Expand all</Button>
                <Button variant="outline" size="sm" onclick={() => setAll(groupKeys, true)}>Collapse all</Button>
                <Button variant="outline" size="sm" disabled={!groups.length} onclick={() => download(`rsi-paints-${stamp()}.csv`, itemsCsv([...new Set(groups.flatMap((g) => g.rows.map((r) => r.owned).filter((x): x is ItemRow => !!x)))]))}>CSV (owned)</Button>
              </div>

              {#if !groups.length}
                <Empty>No paints match.</Empty>
              {:else}
                <div class="flex flex-col gap-1.5">
                  {#each groups.slice(0, groupBudget) as g (g.key)}
                    {@const k = `p|${g.key}`}
                    {@const st = g.key === 'packs' ? 'unknown' : pgStatus(g)}
                    {@const nOwned = g.rows.filter((r) => r.owned).length}
                    <Collapsible.Root bind:open={() => !collapsed.has(k), (o) => setOpen(k, o)} class="rounded-lg border px-2 pt-0.5 pb-1.5">
                      <Collapsible.Trigger class="focus-visible:ring-ring/50 flex w-full cursor-pointer flex-wrap items-center gap-2 rounded py-1.5 text-left text-[13px] outline-none focus-visible:ring-2">
                        {#if collapsed.has(k)}<ChevronRight class="text-muted-foreground size-3.5" aria-hidden="true" />{:else}<ChevronDown class="text-muted-foreground size-3.5" aria-hidden="true" />{/if}
                        <strong class={cn(st !== 'owned' && 'text-muted-foreground')}>{g.label}</strong>
                        {#if st === 'owned'}
                          <Badge variant="success-soft"><Check /> {g.owned.map((o) => `${o.ship.name}${o.count > 1 ? ` ×${o.count}` : ''}${o.game ? ' (in-game)' : ''}`).join(', ')}</Badge>
                        {:else if st === 'not-owned'}
                          <Badge variant="warning">no ship owned</Badge>
                        {/if}
                        <span class="text-muted-foreground text-[11px]">{nOwned} owned · {g.rows.length - nOwned} on store</span>
                      </Collapsible.Trigger>
                      <Collapsible.Content>
                        {#if collapsed.has(k)}<!-- closed: nothing mounted -->
                        {:else if g.rows.length}
                          <!-- Fixed widths for the fits / links columns so "buy" lines up across every ship's table. -->
                          <Table.Root class="table-fixed">
                            <Table.Body>
                              {#each g.rows as r (r.key)}
                                <Table.Row class="border-t border-b-0">
                                  <Table.Cell class="whitespace-normal">
                                    <Thumb src={r.store?.thumb ?? r.owned?.image} name={r.title} class="mr-1.5" />
                                    <strong class={cn(!r.owned && 'text-muted-foreground font-medium')}>{r.title}</strong>
                                    {#if g.key.split('|')[0] !== 'packs'}<WikiLink href={wikiPageUrl(r.title)} name={r.title} />{/if}
                                    {#if r.owned}
                                      <Tag kind="owned" count={r.owned.count} class="m-px" />
                                      {#if r.owned.giftable}<Badge variant="secondary" class="m-px">gift</Badge>{/if}
                                      {#if r.owned.fitsVia === 'pledge'}<HintBadge variant="secondary" class="m-px" hint="Name doesn't say which ship — matched to the ship(s) in the same pledge">from pack</HintBadge>{/if}
                                    {:else if r.store && !r.store.available}
                                      <Tag kind="oos" class="m-px" />
                                    {/if}
                                  </Table.Cell>
                                  <Table.Cell class="w-[260px] text-[11px] whitespace-normal max-md:hidden">{r.owned ? fitsLabel(r.owned) || '—' : ''}</Table.Cell>
                                  <Table.Cell class="w-[220px] text-[11px] whitespace-normal">{@render links(r)}</Table.Cell>
                                </Table.Row>
                              {/each}
                            </Table.Body>
                          </Table.Root>
                        {:else}
                          <Empty class="py-2 text-[11px]">No paints owned; none on the store right now.</Empty>
                        {/if}
                        {#if st === 'not-owned'}
                          {@const target = cheapest(familyShips(g))}
                          {#if target}
                            <div class="flex flex-wrap items-center gap-2 pt-1.5 text-[11px]">
                              <span class="text-muted-foreground">Get the ship:</span>
                              <Button variant="outline" size="xs" href={`#ccu?to=${target.id}`}>Plan CCU → {target.name}{target.msrp ? ` (${usd(target.msrp)})` : ''}</Button>
                              <Button variant="outline" size="xs" onclick={() => !compare.includes(target.id) && (compare = [...compare, target.id])}>Compare</Button>
                            </div>
                          {/if}
                        {/if}
                      </Collapsible.Content>
                    </Collapsible.Root>
                  {/each}
                  {#if groupBudget < groups.length}<p class="text-muted-foreground text-xs">… {groups.length - groupBudget} more ships loading</p>{/if}
                </div>
              {/if}
            </Card.Content>
          </Card.Root>
        {/if}

        {#if view === 'bundle'}
          <PaintBundlePanel pledges={hangar.pledges} {rows} {fleet} {ships} storePaints={storePaints?.paints ?? []} {ownedStoreIds} buyback={buyback?.items ?? []} />
        {/if}

        {#if view === 'ships'}
          <Card.Root>
            <Card.Header>
              <Card.Title>My ships <span class="text-muted-foreground">({fleet.length} hulls)</span></Card.Title>
              <Card.Description>Each ship with the paints you own for it and how many more the store has. Tick ships to compare. Add ships you bought with aUEC or earned in the game — paints work on those too.</Card.Description>
              <Card.Action>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button {...props} variant="outline" size="sm" disabled={!fleet.length}><Download class="size-3.5" /> Export fleet <ChevronDown class="size-3.5" /></Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" class="w-80">
                    <DropdownMenu.Label class="text-muted-foreground text-[11px] font-normal">HangarXPLOR format — one row per hull, with pledge, LTI, warbond, nickname</DropdownMenu.Label>
                    {#if partial}
                      <DropdownMenu.Label class="text-warning text-xs font-normal">Hangar partly loaded (stopped after page {hangar?.page}) — load your whole hangar first (<a class={LINK} href="#hangar">Pledges</a> → Resume).</DropdownMenu.Label>
                    {/if}
                    <DropdownMenu.Item disabled={partial} onSelect={() => exportFleet('json')}>
                      <div class="grid"><span class="font-semibold">JSON file</span><span class="text-muted-foreground text-xs">FleetYards (Hangar → Import), myfleet.gg 3D fleet view, Starjump / hangar.link</span></div>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item disabled={partial} onSelect={() => exportFleet('csv')}>
                      <div class="grid"><span class="font-semibold">CSV file</span><span class="text-muted-foreground text-xs">Spreadsheets — Manufacturer, Ship, LTI, Warbond, ID, Pledge, Cost, Date</span></div>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item disabled={partial} onSelect={copyNames}>
                      <div class="grid"><span class="font-semibold">{copiedNames ? 'Copied ✓' : 'Copy ship names'}</span><span class="text-muted-foreground text-xs">One "Maker Ship" per hull, for tools that take a plain list</span></div>
                    </DropdownMenu.Item>
                    {#if starorgOn}
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onSelect={exportStarOrg}>
                        <div class="grid"><span class="font-semibold">JSON for StarOrg Tools</span><span class="text-muted-foreground text-xs">Import this on starorg.tools → Hangar</span></div>
                      </DropdownMenu.Item>
                    {/if}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </Card.Action>
            </Card.Header>
            <Card.Content class="grid gap-4">
              <FacetBar facets={fleetFacets} ranges={shipRanges} rows={fleet} shown={fleetShown.length} bind:values={shipValues} primary={SHIP_PRIMARY}>
                <Input class="w-64" placeholder="Search ships" bind:value={shipQ} aria-label="Search my ships" />
              </FacetBar>
              <div class="bg-muted/40 grid gap-2 rounded-lg border p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"><Gamepad2 class="size-3.5" /> In-game ships</span>
                  <span class="text-muted-foreground text-xs">Not on your RSI account — kept in this browser's sync storage, counted for paints and the melt planner.</span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <div class="w-[260px]"><ShipSelect ships={[...ships].sort((a, b) => a.name.localeCompare(b.name))} bind:value={gameAdd} ariaLabel="In-game ship to add" placeholder="Add a ship you have in-game…" price={false} /></div>
                  <Segmented
                    options={[
                      { id: 'bought', label: 'Bought (aUEC)', hint: 'Bought in the game with aUEC' },
                      { id: 'earned', label: 'Earned', hint: 'Earned in the game: event, mission or other reward' },
                    ]}
                    bind:value={gameHow}
                    ariaLabel="How you got it"
                    size="sm"
                  />
                  <Button size="sm" disabled={gameAdd == null} onclick={() => gameAdd != null && bumpGame(gameAdd, gameHow, 1).then(() => (gameAdd = null))}><Plus /> Add</Button>
                </div>
                {#if gameSorted.length}
                  <div class="flex flex-wrap gap-1.5">
                    {#each gameSorted as g (`${g.id}|${g.how}`)}
                      <span class="bg-background inline-flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 text-xs">
                        <span class="font-medium">{byId.get(g.id)?.name ?? g.name}</span>
                        <span class="text-muted-foreground">{g.how === 'bought' ? 'aUEC' : 'earned'} ×{g.count}</span>
                        <Button variant="ghost" size="icon-xs" aria-label={`One fewer ${g.name}`} onclick={() => bumpGame(g.id, g.how, -1)}><Minus /></Button>
                        <Button variant="ghost" size="icon-xs" aria-label={`One more ${g.name}`} onclick={() => bumpGame(g.id, g.how, 1)}><Plus /></Button>
                        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${g.name}`} onclick={() => removeGame(g)}><X /></Button>
                      </span>
                    {/each}
                  </div>
                {/if}
              </div>
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.Head>Compare</Table.Head>
                    <SortTh key="name" bind:sort={shipSort}>Ship</SortTh>
                    <SortTh key="maker" bind:sort={shipSort}>Maker · role</SortTh>
                    <SortTh key="count" bind:sort={shipSort} firstDir="desc">Copies</SortTh>
                    <SortTh key="msrp" bind:sort={shipSort} numeric>MSRP</SortTh>
                    <SortTh key="insurance" bind:sort={shipSort} firstDir="desc">Insurance</SortTh>
                    <SortTh key="paints" bind:sort={shipSort} firstDir="desc">Paints</SortTh>
                    <Table.Head class="text-right"><span class="sr-only">Actions</span></Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {#each fleetShown as f (f.ship.id)}
                    {@const more = storeFor(line(f.ship.name, ships)).length}
                    <Table.Row>
                      <Table.Cell><Checkbox checked={compare.includes(f.ship.id)} onCheckedChange={() => toggleCompare(f.ship.id)} aria-label={`Compare ${f.ship.name}`} /></Table.Cell>
                      <Table.Cell>
                        <div class="flex items-center gap-2.5">
                          <Thumb src={f.ship.thumb} name={f.ship.name} width={64} height={36} />
                          <div>
                            <div class="flex items-center gap-0.5"><strong>{f.ship.name}</strong><WikiLink href={wikiPageUrl(f.ship.name)} name={f.ship.name} /></div>
                            {#if (f.ship.flyable && stageOf(f.ship.flyable) !== 'ready') || f.ship.size}
                              <div class="mt-0.5 flex flex-wrap gap-0.5">
                                {#if f.ship.flyable && stageOf(f.ship.flyable) !== 'ready'}<Tag kind="stage" value={f.ship.flyable} size="xs" />{/if}
                                {#if f.ship.size}<Tag kind="size" value={f.ship.size} size="xs" />{/if}
                              </div>
                            {/if}
                            {#if shipTags(f).length}<div class="mt-0.5 flex flex-wrap gap-0.5">{#each shipTags(f) as t (t)}<HintBadge variant="muted" class="text-[10px]" hint="Your label on the pledges holding this ship (edit on Pledges)">{t}</HintBadge>{/each}</div>{/if}
                          </div>
                        </div>
                      </Table.Cell>
                      <Table.Cell class="text-muted-foreground text-[11px]">{f.ship.manufacturer}<br />{f.ship.focus}</Table.Cell>
                      <Table.Cell>
                        ×{f.count}
                        {#if f.game}<HintBadge variant="outline" class="ml-1 text-[11px]" hint={`${f.game} in the game only (${f.gameHow.map((h) => (h === 'bought' ? 'bought with aUEC' : 'earned')).join(', ')}), not on your RSI account`}><Gamepad2 /> {f.game === f.count ? 'in-game' : `${f.game} in-game`}</HintBadge>{/if}
                      </Table.Cell>
                      <Table.Cell class="text-right tabular-nums">{f.ship.msrp ? usd(f.ship.msrp) : '—'}</Table.Cell>
                      <Table.Cell>{@render insBadges(f.insurance, 'text-muted-foreground text-[11px]')}</Table.Cell>
                      <Table.Cell>
                        <TipButton variant="link" size="xs" class="h-auto px-0 font-semibold" onclick={() => openPaintsFor(f.ship.name)} tip={f.paints.map((p) => p.title).join('\n')}>
                          {qty(f.paints)} owned{more ? ` · ${more} more on store` : ''} →
                        </TipButton>
                      </Table.Cell>
                      <Table.Cell class="text-right text-[11px]">
                        <span class="inline-flex flex-wrap justify-end gap-2">
                          {#if f.ship.link}<a class="{LINK} inline-flex items-center gap-1 whitespace-nowrap" href={f.ship.link} target="_blank" rel="noopener"><ShoppingCart class="size-3" /> store</a>{/if}
                          {#each [...new Map(f.items.flatMap((i) => i.pledges).map((p) => [p.id, p])).values()].slice(0, 3) as p (p.id)}
                            <a class="{LINK} inline-flex items-center gap-1 whitespace-nowrap" href={hangarUrl(hangar.pledges, p.id)} target="_blank" rel="noopener" title={`Hangar page with ${p.name}`}><House class="size-3" /> #{p.id}</a>
                          {/each}
                        </span>
                      </Table.Cell>
                    </Table.Row>
                  {/each}
                  {#if !fleetShown.length}<Empty colspan={8}>Nothing matches.</Empty>{/if}
                </Table.Body>
              </Table.Root>
              {#if unmatchedShips.length}
                <p class="text-muted-foreground text-[11px]">Not matched to a store ship (no paints / compare): {unmatchedShips.map((r) => r.title).join(', ')}</p>
              {/if}
            </Card.Content>
          </Card.Root>
        {/if}

    {#if view === 'ships' && compared.length}
      <Card.Root id="compare">
        <Card.Header>
          <Card.Title>Compare <span class="text-muted-foreground">({compared.length})</span></Card.Title>
          <Card.Action class="flex flex-wrap items-center gap-2">
            <div class="w-[260px]"><ShipSelect ships={[...ships].sort((a, b) => a.name.localeCompare(b.name))} bind:value={addCompare} ariaLabel="Add any ship to compare" placeholder="Add any ship…" price={false} onpick={(id) => (id != null && !compare.includes(id) && (compare = [...compare, id]), (addCompare = null))} /></div>
            <Button variant="outline" size="sm" onclick={() => (compare = [])}>Clear</Button>
          </Card.Action>
        </Card.Header>
        <Card.Content>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head class="min-w-[120px]"></Table.Head>
                {#each compared as s (s.id)}
                  <Table.Head class="h-auto min-w-[170px] py-2 align-top">
                    <Thumb src={s.thumb} name={s.name} width={120} height={68} class="block" />
                    <div class="my-1.5 text-[13px]">{s.name}</div>
                    <Button variant="outline" size="xs" onclick={() => toggleCompare(s.id)}>Remove</Button>
                  </Table.Head>
                {/each}
              </Table.Row>
            </Table.Header>
            <Table.Body class="[&_td]:min-w-[170px] [&_td]:align-top [&_td]:whitespace-normal [&_th]:text-muted-foreground [&_th]:align-top">
              <Table.Row><Table.Head>Manufacturer</Table.Head>{#each compared as s (s.id)}<Table.Cell>{s.manufacturer}</Table.Cell>{/each}</Table.Row>
              <Table.Row><Table.Head>Role</Table.Head>{#each compared as s (s.id)}<Table.Cell>{s.focus}</Table.Cell>{/each}</Table.Row>
              <Table.Row><Table.Head>Status</Table.Head>{#each compared as s (s.id)}<Table.Cell>{s.flyable}</Table.Cell>{/each}</Table.Row>
              <Table.Row><Table.Head>MSRP</Table.Head>{#each compared as s (s.id)}<Table.Cell class="tabular-nums">{s.msrp ? usd(s.msrp) : '—'}</Table.Cell>{/each}</Table.Row>
              <Table.Row><Table.Head>You own</Table.Head>{#each compared as s (s.id)}<Table.Cell>{fleetOf(s.id) ? `×${fleetOf(s.id)!.count}` : '—'}</Table.Cell>{/each}</Table.Row>
              <Table.Row><Table.Head>Insurance</Table.Head>{#each compared as s (s.id)}<Table.Cell>{@render insBadges(fleetOf(s.id)?.insurance ?? [], 'text-muted-foreground')}</Table.Cell>{/each}</Table.Row>
              <Table.Row>
                <Table.Head>Your paints</Table.Head>
                {#each compared as s (s.id)}
                  {@const paints = rows.filter((r) => r.category === 'paint' && r.fits.some((x) => x.id === s.id))}
                  <Table.Cell>{#each paints as p (p.key)}<div class="text-[11px]">{p.title}</div>{:else}<span class="text-muted-foreground">—</span>{/each}</Table.Cell>
                {/each}
              </Table.Row>
              <Table.Row>
                <Table.Head>Store paints</Table.Head>
                {#each compared as s (s.id)}
                  {@const sp = storeFor(line(s.name, ships))}
                  <Table.Cell>{#each sp.slice(0, 8) as p (p.id)}<div class="text-[11px]"><a class={LINK_QUIET} href={p.url} target="_blank" rel="noopener">{p.name}</a> {usd(p.discounted)}</div>{:else}<span class="text-muted-foreground">—</span>{/each}{#if sp.length > 8}<div class="text-muted-foreground text-[11px]">+{sp.length - 8} more</div>{/if}</Table.Cell>
                {/each}
              </Table.Row>
              <Table.Row>
                <Table.Head>Pledges with it</Table.Head>
                {#each compared as s (s.id)}
                  <Table.Cell>{#each fleetOf(s.id)?.items.flatMap((i) => i.pledges) ?? [] as p, i (i)}<div class="text-[11px]"><a class={LINK_QUIET} href={hangarUrl(hangar.pledges, p.id)} target="_blank" rel="noopener">{p.name}</a> · {ownUsd(p.value * 100)}</div>{:else}<span class="text-muted-foreground">—</span>{/each}</Table.Cell>
                {/each}
              </Table.Row>
              <Table.Row>
                <Table.Head>On sale now</Table.Head>
                {#each compared as s (s.id)}
                  <Table.Cell>
                    {#each s.ccu as k (k.id)}<div class="text-[11px]">{k.title || 'CCU'} {usd(k.price)}</div>{/each}
                    {#each s.standalone.filter((k) => k.available) as k (k.id)}<div class="text-[11px]">Standalone {usd(k.price)}</div>{/each}
                    {#if !s.ccu.length && !s.standalone.some((k) => k.available)}<span class="text-muted-foreground">—</span>{/if}
                  </Table.Cell>
                {/each}
              </Table.Row>
              <Table.Row>
                <Table.Head><span class="sr-only">Actions</span></Table.Head>
                {#each compared as s (s.id)}
                  <Table.Cell>
                    <div class="flex flex-wrap items-center gap-2">
                      {#if s.link}<Button variant="outline" size="xs" href={s.link} target="_blank" rel="noopener">Store <ExternalLink /></Button>{/if}
                      <Button variant="outline" size="xs" href={`#ccu?to=${s.id}`}>Plan CCU</Button>
                    </div>
                  </Table.Cell>
                {/each}
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Card.Content>
      </Card.Root>
    {/if}
  </div>
{/if}
