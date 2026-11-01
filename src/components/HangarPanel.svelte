<script lang="ts">
  import { nearView } from '@/lib/near-view';
  import { fetchCredits, loadHangar, updateHangar } from '@/lib/account';
  import { hangarCsv, hangarUrl, stackPledges, totals, type Pledge, type PledgeStack, type PledgeType } from '@/lib/hangar';
  import { xplorRows } from '@/lib/export';
  import { canMelt, copiesElsewhere, duplicatePlan, holdersIndex, keptCounts, lossWith, meltSummary, targetPlan } from '@/lib/melt';
  import { categorize, inventory, ownedShipsWithPaints, paintCopiesNeeded, paintStatus, seriesOf, shipGroups, storePaintIndex, upgradedFrom, type GameShip } from '@/lib/items';
  import { storeLinksFor } from '@/lib/paints';
  import { applyFacets, type FacetValues } from '@/lib/facets';
  import { isGifted, pledgeFacets, pledgeRanges, PLEDGE_PRIMARY, PLEDGE_TYPES as TYPES } from '@/lib/pledge-facets';
  import FacetBar from './FacetBar.svelte';
  import { bg } from '@/lib/messages';
  import { catalogItem, gameShipsItem, hangarItem, paintCatalogItem, pledgeLabelsItem } from '@/lib/settings';
  import { cleanLabels, idsWith, KEEP, labelsOf, MELT, type Labels } from '@/lib/labels';
  import LabelEdit from './LabelEdit.svelte';
  import { matchShip, type Catalog, type StorePaint } from '@/lib/store';
  import { compare, dateValue, nextSort, sortBy, type SortState, type SortValue } from '@/lib/sort';
  import SortTh from './SortTh.svelte';
  import { pledgeMsrp } from '@/lib/wallet';
  import Stat from './Stat.svelte';
  import StatGrid from './StatGrid.svelte';
  import LoadStatus from './LoadStatus.svelte';
  import LoadActions from './LoadActions.svelte';
  import TipButton from './TipButton.svelte';
  import WikiLink from './WikiLink.svelte';
  import { itemWikiUrl } from '@/lib/wiki';
  import LazyTip from './LazyTip.svelte';
  import HintBadge from './HintBadge.svelte';
  import Tag from './Tag.svelte';
  import FilterChips from './FilterChips.svelte';
  import Segmented from './Segmented.svelte';
  import Empty from './Empty.svelte';
  import { ownDollars } from '@/lib/privacy.svelte';
  import { dateStamp, downloadFile } from '@/lib/download';
  import SwitchRow from './SwitchRow.svelte';
  import * as Alert from '@/components/ui/alert';
  import { cn } from '@/lib/utils';
  import { LINK, LINK_ICON } from '@/lib/ui';
  import { fmtDate, fmtDateTime, parseRsiDate } from '@/lib/dates';
  import { hangarEvents } from '@/lib/hangar-events';
  import { mergeEvents } from '@/lib/watch';
  import { feedItem } from '@/lib/settings';
  import { loadHandle, saveCompleteLoad } from '@/lib/hangar-refresh';
  import Thumb from './Thumb.svelte';
  import * as Card from '@/components/ui/card';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import * as Table from '@/components/ui/table';
  import * as Collapsible from '@/components/ui/collapsible';
  import * as DropdownMenu from '@/components/ui/dropdown-menu';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Check from '@lucide/svelte/icons/check';
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
  import X from '@lucide/svelte/icons/x';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import EyeOff from '@lucide/svelte/icons/eye-off';

  type Saved = NonNullable<Awaited<ReturnType<typeof hangarItem.getValue>>>;
  let data = $state<Saved | null>(null);
  let cat = $state<Catalog | null>(null);
  let game = $state<GameShip[]>([]);
  let loading = $state<{ page: number; count: number; pages?: number } | null>(null);
  let error = $state('');
  /** What the last quick update found. */
  let updated = $state('');
  let q = $state('');
  /** Your labels (`lib/labels.ts`); the Labels facet filters by them. */
  let labels = $state<Labels>({});
  /** Store paint listings (loaded by Paints / Buyback / the background) — for the "In store" facet. */
  let storePaints = $state<StorePaint[] | null>(null);
  /** Store a plain copy: a Svelte state proxy put in chrome.storage turned label arrays into `{"0": …}` objects. */
  const saveLabels = (next: Labels) => {
    const plain = cleanLabels(JSON.parse(JSON.stringify(next)));
    labels = plain;
    pledgeLabelsItem.setValue(plain);
  };
  type Col = 'name' | 'type' | 'value' | 'msrp' | 'date' | 'flags' | 'qty' | 'labels' | 'id';
  let sort = $state<SortState<Col>>({ key: 'date', dir: 'desc' });
  let ctrl: AbortController | null = null;

  $effect(() => {
    hangarItem.getValue().then((v) => (data = v)).catch((e) => (error = `Couldn't read saved hangar: ${(e as Error).message}`));
    catalogItem.getValue().then((c) => (cat = c));
    gameShipsItem.getValue().then((g) => (game = g));
    pledgeLabelsItem.getValue().then((l) => (labels = cleanLabels(l)));
    paintCatalogItem.getValue().then((p) => (storePaints = p?.paints ?? null)).catch(() => {});
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch(() => {}); // only needed to know which hulls a paint fits
    const offs = [catalogItem.watch((c) => (cat = c)), gameShipsItem.watch((g) => (game = g ?? [])), pledgeLabelsItem.watch((l) => (labels = cleanLabels(l))), paintCatalogItem.watch((p) => (storePaints = p?.paints ?? null))];
    return () => (ctrl?.abort(), offs.forEach((o) => o()));
  });

  /** Persist a plain copy (never the reactive proxy). Throws so the UI can show storage errors. */
  async function save(v: Saved) {
    await hangarItem.setValue(JSON.parse(JSON.stringify(v)));
    data = v;
  }

  /** Quick update: read from the top until the pages match what's saved; the list stays on screen meanwhile. */
  /** Pledges that appeared or left since the last complete read → Feed (Hangar kind). */
  async function noteHangarEvents(prev: Pledge[], next: Pledge[]) {
    const ev = hangarEvents(prev, next, Date.now());
    if (ev.length) await feedItem.setValue(mergeEvents(await feedItem.getValue(), ev));
  }
  /** Save a completed read: stores it and announces the load (StarOrg auto-sync, `lib/hangar-refresh.ts`). */
  async function saveComplete(v: Saved & { complete: true }) {
    await saveCompleteLoad(JSON.parse(JSON.stringify(v)));
    data = v;
  }
  async function update() {
    error = updated = '';
    // Whose hangar RSI shows now: a saved list from another login (or from before handles were recorded) is reloaded in full.
    const handle = await loadHandle();
    if (!data?.complete || !data.pledges.length || data.handle !== handle) return load(false, handle);
    ctrl = new AbortController();
    loading = { page: 0, count: 0 };
    try {
      const prev = $state.snapshot(data.pledges) as Pledge[];
      const u = await updateHangar(prev, (p) => (loading = p), ctrl.signal);
      await saveComplete({ ...credits(), at: Date.now(), pledges: u.pledges, complete: true, handle });
      await noteHangarEvents(prev, u.pledges);
      const what = [u.added && `${u.added} new`, u.changed && `${u.changed} changed`, u.removed && `${u.removed} gone`].filter(Boolean).join(', ');
      updated = `${what || 'No changes'} · read ${u.pages} page${u.pages === 1 ? '' : 's'}`;
      refreshCredits();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = `${(e as Error).message} — the saved hangar is unchanged.`;
    } finally {
      loading = null;
    }
  }

  async function load(resume = false, known?: string | null) {
    error = updated = '';
    ctrl = new AbortController();
    const handle = known === undefined ? await loadHandle() : known;
    // Resume only a partial read of the same login; pages read as someone else start over.
    const from = resume && data && !data.complete && data.handle === handle ?{ page: data.page ?? 0, items: $state.snapshot(data.pledges) as Pledge[] } : undefined;
    loading = { page: from?.page ?? 0, count: from?.items.length ?? 0 };
    try {
      const pledges = await loadHangar(
        async ({ page, pages, items }) => {
          loading = { page, pages, count: items.length };
          await save({ ...credits(), at: Date.now(), pledges: items, complete: false, page, handle }); // after every page
        },
        ctrl.signal,
        from,
      );
      const prev = data?.complete ? ($state.snapshot(data.pledges) as Pledge[]) : [];
      await saveComplete({ ...credits(), at: Date.now(), pledges, complete: true, handle });
      await noteHangarEvents(prev, pledges);
      refreshCredits();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = `${(e as Error).message}${data?.pledges.length ? ' — what was read so far is kept; Resume to continue.' : ''}`;
    } finally {
      loading = null;
    }
  }

  const all = $derived(data?.pledges ?? []);
  /** Meltable pledges labelled *Melt* (one-click pick in the melt calculator). */
  const meltIds = $derived(idsWith(labels, MELT));
  const meltLabelled = $derived(all.filter((p) => meltIds.has(p.id) && canMelt(p)));
  /** Total pages while loading: the page's own pagination, else the last page a saved pledge came from. */
  const lastPage = $derived(all.reduce((m, p) => Math.max(m, p.page ?? 0), 0));
  const totalPages = $derived(loading?.pages ?? (lastPage ? Math.max(loading?.page ?? 0, lastPage) : undefined));

  // ---- credits (store credit / UEC / REC) ride along on the saved hangar; shown + refreshed on the Wallet tab ----
  const credits = () => ({ credits: data?.credits ?? null, creditsAt: data?.creditsAt });
  /** Quiet refresh after a full load so Wallet is current; failures are reported there, not here. */
  async function refreshCredits() {
    if (!data) return;
    try {
      const { credits: c } = await fetchCredits();
      if (c) await save({ ...$state.snapshot(data), credits: c, creditsAt: Date.now() } as Saved);
    } catch {
      /* Wallet tab shows the details */
    }
  }
  // ---- filters: FacetBar over the pledges left after "Hide sets" (`lib/pledge-facets.ts`), then the search ----
  const base = $derived(all.filter((p) => !hiddenBySet.has(p.id)));
  /**
   * Pledges with something the store sells today (a paint listing in stock / a ship with an available standalone),
   * worked out once per listing — same lookup as Buyback's store links. Null until a store listing is loaded.
   */
  const inStoreIds = $derived.by(() => {
    if (!storePaints && !cat?.ships.length) return null;
    const idx = storePaintIndex(storePaints ?? []);
    const ships = cat?.ships ?? [];
    const out = new Set<number>();
    for (const p of all) {
      if (p.type === 'upgrade' || p.upgrade) continue;
      const titles = p.items.length ? p.items.map((i) => i.title) : [p.name];
      if (storeLinksFor(titles, ships, idx).length) out.add(p.id);
    }
    return out;
  });
  /** Star Citizen Wiki link per item (`kind|title`), once per hangar / catalog: ships by their catalog name. */
  const wikiOf = $derived.by(() => {
    const ships = cat?.ships ?? [];
    const m = new Map<string, string | null>();
    for (const p of all)
      for (const it of p.items) {
        const k = `${it.kind}|${it.title}`;
        if (m.has(k)) continue;
        const c = categorize(it.title, it.kind);
        m.set(k, itemWikiUrl(c, it.title, c === 'ship' ? matchShip(it.title, ships) : null));
      }
    return m;
  });
  const facets = $derived(
    pledgeFacets({
      labels,
      ships: cat?.ships ?? [],
      inStore: inStoreIds ? (p) => inStoreIds.has(p.id) : null,
      types: TYPES.filter((t) => all.some((p) => p.type === t)),
    }),
  );
  const shown = $derived.by(() => {
    const query = q.trim().toLowerCase();
    const list = applyFacets(base, facets, facetValues, pledgeRanges);
    return query ? list.filter((p) => [p.name, p.nickname, ...p.items.map((i) => i.title)].some((s) => s.toLowerCase().includes(query))) : list;
  });
  /** Today's MSRP of each pledge's ships (pledge id → USD, null when unpriced): melt value vs buying the ships now. */
  const msrpOf = $derived.by(() => {
    const ships = cat?.ships ?? [];
    return new Map(all.map((p) => [p.id, ships.length ? pledgeMsrp(p, ships) : null]));
  });
  /** Saved vs MSRP over the pledges on show that have a price (MSRP − melt value), and how many count. */
  const savedSum = $derived.by(() => {
    let msrp = 0, paid = 0, n = 0;
    for (const p of shown) {
      const m = msrpOf.get(p.id);
      if (m == null) continue;
      msrp += m;
      paid += p.value;
      n++;
    }
    return { msrp, paid, saved: msrp - paid, n };
  });
  const stacks = $derived.by(() => {
    const st = grouping === 'identical' ? stackPledges(shown) : shown.map((p) => ({ key: String(p.id), rep: p, entries: [p] }) as PledgeStack);
    // Ties keep RSI's order (newest first); same-day pledges stay in that order.
    return sortBy(st, sort, colValue);
  });
  /** Sort value of each column for a row (the table header and each ship's own sort). */
  const colValue: Record<Col, (s: PledgeStack) => SortValue> = {
      name: (s) => s.rep.name,
      type: (s) => s.rep.type,
      value: (s) => s.rep.value,
      msrp: (s) => { const m = msrpOf.get(s.rep.id); return m == null ? null : m - s.rep.value; },
      date: (s) => dateValue(s.rep.date),
      flags: (s) => [s.rep.lti, s.rep.warbond, s.entries.some((p) => p.giftable), s.rep.upgraded, s.rep.hasGame].filter(Boolean).length,
      qty: (s) => s.entries.length,
      id: (s) => Math.min(...s.entries.map((p) => p.id)),
      labels: (s) => [...new Set(s.entries.flatMap((p) => labelsOf(labels, p.id)))].sort().join(', ') || null,
  };
  /** Column names for each ship's own sort menu, with the direction a first pick takes. */
  const COLS: { key: Col; label: string; dir: 'asc' | 'desc' }[] = [
    { key: 'name', label: 'Pledge', dir: 'asc' },
    { key: 'qty', label: 'Qty', dir: 'desc' },
    { key: 'type', label: 'Type', dir: 'asc' },
    { key: 'value', label: 'Value', dir: 'desc' },
    { key: 'msrp', label: 'MSRP (saved)', dir: 'desc' },
    { key: 'date', label: 'Created', dir: 'desc' },
    { key: 'flags', label: 'Flags', dir: 'desc' },
    { key: 'labels', label: 'Labels', dir: 'asc' },
    { key: 'id', label: 'Hangar entries', dir: 'desc' },
  ];
  /** A ship's own sort for the pledges under it (group key → sort); ships without one follow the header. */
  let groupSort = $state<Record<string, SortState<Col>>>({});
  const setGroupSort = (k: string, v: SortState<Col> | null) => {
    const { [k]: _, ...rest } = groupSort;
    groupSort = v ? { ...rest, [k]: v } : rest;
  };
  const sum = $derived(totals(shown));
  /** Pledges RSI marks as never returning to buyback, among the ones picked to melt. */
  const noBuybackPicked = $derived(all.filter((p) => picked.has(p.id) && p.noBuyback));
  const money = ownDollars;
  /** Pledge-type count · value for the planner's "May pick" chips. */
  const byType = $derived(totals(all).byType);
  const dedupeOptions = $derived(
    TYPES.filter((t) => t !== 'upgrade' && byType[t]).map((t) => {
      const d = dupesByType.get(t);
      return { id: t, label: d?.count ? `${t} · ${d.count} · ${money(d.value)}` : t };
    }),
  );

  // ---- panes: Pledges (the list) / Melt calculator (same list with the tick + "Would lose" columns) ----
  type Pane = 'pledges' | 'melt';
  const PREFS = 'rsiplus:hangar';
  type Prefs = Partial<{ byShip: boolean; shipShow: ShipShow; hiddenSets: string[]; facets: FacetValues; group: 'identical' | 'none' }>;
  /** Which ship groups show by ship: all, ships you own, ships you hold only paints / parts / CCUs for, pledges related to no ship. */
  type ShipShow = 'all' | 'owned' | 'unowned' | 'loose';
  const savedPrefs = (() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Prefs;
    } catch {
      return {} as Prefs;
    }
  })();
  /** Which page the hub shows: Pledges (`#hangar`) or the Melt calculator (`#melt`). Same instance for both. */
  let { pane = 'pledges' }: { pane?: Pane } = $props();
  /** Group the list by ship: each hull with the paints / parts / CCUs for it nested under it (every pledge keeps its own row). */
  let byShip = $state(savedPrefs.byShip ?? false);
  let shipShow = $state<ShipShow>(savedPrefs.shipShow ?? 'all');
  /** Event / flair sets (Luminalia, IAE, Subscriber, "RSI Disc.", "AA" …) whose pledges are hidden from the list. */
  let hiddenSets = $state<string[]>(savedPrefs.hiddenSets ?? []);
  /** Facet choices on the Pledges list (FacetBar). */
  let facetValues = $state<FacetValues>(savedPrefs.facets ?? {});
  /** Identical pledges as one row (Group: identical pledges); none = one stack per pledge, so the table code is the same. */
  let grouping = $state<'identical' | 'none'>(savedPrefs.group ?? 'identical');
  $effect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ byShip, shipShow, hiddenSets, facets: facetValues, group: grouping }));
    } catch {
      /* no persistence — fine */
    }
  });
  const melting = $derived(pane === 'melt');
  /**
   * Ship groups over the whole hangar (so "owned" is right whatever the filters), each reduced to the stacks on show in
   * the table's sort order. Groups keep their tiers (ships you own, then not owned, then not related to a ship) and within
   * a tier follow the same column: *Pledge* by ship name, *Qty* / *Value* / *MSRP* / *Created* by the ship's total pledges /
   * melt value / saved / newest pledge, the rest by where the ship's first pledge lands; ties by ship name.
   */
  const groups = $derived.by(() => {
    if (!byShip) return [];
    const idx = new Map(visible.map((st) => [st.rep.id, st]));
    const pos = new Map(visible.map((st, i) => [st.rep.id, i]));
    const seen = new Set<string>();
    return shipGroups(all, cat?.ships ?? [])
      .map((g) => {
        const rows: PledgeStack[] = [];
        for (const p of g.pledges) {
          const st = idx.get(p.id);
          if (!st) continue;
          const k = `${g.key}|${st.key}`;
          if (seen.has(k)) continue; // identical pledges share one stack
          seen.add(k);
          rows.push(st);
        }
        rows.sort((a, b) => pos.get(a.rep.id)! - pos.get(b.rep.id)!);
        const own = groupSort[g.key];
        if (own) rows.splice(0, rows.length, ...sortBy(rows, own, colValue));
        let value = 0, count = 0, saved = 0, newest = 0, giftable = 0;
        // The ship's own pledges (the hull, not paints / parts / CCUs for it): insurance and giftable copies for the folded row.
        const hullPledges = g.pledges.filter((p) => g.role.get(p.id) === 'hull');
        const insurance = [...new Set(hullPledges.map((p) => p.insurance || (p.lti ? 'LTI' : '')).filter(Boolean))].sort((a, b) => (a === 'LTI' ? -1 : b === 'LTI' ? 1 : a.localeCompare(b)));
        for (const p of hullPledges) if (p.giftable) giftable++;
        for (const st of rows) {
          const n = st.entries.length;
          value += st.rep.value * n;
          count += n;
          const m = msrpOf.get(st.rep.id);
          if (m != null) saved += (m - st.rep.value) * n;
          for (const e of st.entries) newest = Math.max(newest, dateValue(e.date) || 0);
        }
        return { ...g, rows, value, count, saved, newest, insurance, giftable };
      })
      .filter((g) => g.rows.length && (shipShow === 'all' || shipShow === (g.key === '~' ? 'loose' : g.owned ? 'owned' : 'unowned')))
      .sort((a, b) => {
        const tier = (g: { key: string; owned: boolean }) => (g.key === '~' ? 2 : g.owned ? 0 : 1);
        if (tier(a) !== tier(b)) return tier(a) - tier(b);
        const by: Partial<Record<Col, (g: typeof a) => number | string>> = { name: (g) => g.label, qty: (g) => g.count, value: (g) => g.value, msrp: (g) => g.saved, date: (g) => g.newest };
        const f = by[sort.key];
        const r = f ? compare(f(a), f(b), sort.dir) : pos.get(a.rows[0]!.rep.id)! - pos.get(b.rows[0]!.rep.id)!;
        return r || compare(a.label, b.label, 'asc');
      });
  });
  let closed = $state<Set<string>>(new Set());
  const toggleGroup = (k: string) => {
    const s = new Set(closed);
    s.has(k) ? s.delete(k) : s.add(k);
    closed = s;
  };

  // ---- melt calculator: tick pledges, see the credit and what you'd lose ----
  let picked = $state<Set<number>>(new Set());
  let pickView = $state<'all' | 'picked'>('all');
  /** Which pledge types the dedupe / target planner may pick (chips in the melt card). */
  let dedupe = $state<Set<PledgeType>>(new Set(['ship', 'package', 'combo', 'paint', 'gear', 'hangar', 'subscriber', 'other']));
  let keepLti = $state(false);
  /** Paint → copies to keep (one per owned hull it fits), so "3 paints for 3 Cutlasses" isn't a duplicate. */
  const inv = $derived.by(() => {
    const rows = inventory(all, cat?.ships ?? []);
    const fleet = ownedShipsWithPaints(rows, game, cat?.ships ?? []);
    return { rows, fleet, ownedIds: new Set(fleet.map((f) => f.ship.id)) };
  });
  const keep = $derived(paintCopiesNeeded(inv.rows, inv.fleet));
  // ---- event / flair sets: items.seriesOf names the event or collection each non-ship item belongs to ----
  const series = $derived(seriesOf(inv.rows));
  /** Per pledge: the sets its items belong to, and whether it also holds something outside any set (a ship, a game, a one-off). */
  const setsOf = $derived.by(() => {
    const m = new Map<number, { sets: Set<string>; other: boolean }>();
    for (const r of inv.rows) {
      const s = series.get(r.key);
      for (const p of r.pledges) {
        const e = m.get(p.id) ?? { sets: new Set<string>(), other: false };
        s ? e.sets.add(s) : (e.other = true);
        m.set(p.id, e);
      }
    }
    return m;
  });
  /** Every set in the hangar with how many pledges are *only* that set's items (what hiding it removes). */
  const setOptions = $derived.by(() => {
    const n = new Map<string, number>();
    for (const e of setsOf.values()) if (!e.other && e.sets.size) for (const s of e.sets) n.set(s, (n.get(s) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  });
  /** Pledges hidden: everything in them belongs to hidden sets (a ship or any other item keeps the pledge visible). */
  const hiddenBySet = $derived.by(() => {
    const hide = new Set(hiddenSets);
    const out = new Set<number>();
    if (!hide.size) return out;
    for (const [id, e] of setsOf) if (!e.other && e.sets.size && [...e.sets].every((s) => hide.has(s))) out.add(id);
    return out;
  });
  const toggleSet = (s: string, on: boolean) => (hiddenSets = on ? [...new Set([...hiddenSets, s])] : hiddenSets.filter((x) => x !== s));
  /** Meltable pledges holding only paints for ships you don't own (unknown-ship paints don't count — could be yours). */
  const orphanPaints = $derived.by(() => {
    const noShip = new Set(inv.rows.filter((r) => r.category === 'paint' && paintStatus(r, inv.ownedIds) === 'no-ship').flatMap((r) => r.pledges.map((p) => p.id)));
    const rowsOf = new Map<number, typeof inv.rows>();
    for (const r of inv.rows)
      for (const id of new Set(r.pledges.map((x) => x.id))) {
        const list = rowsOf.get(id);
        if (list) list.push(r);
        else rowsOf.set(id, [r]);
      }
    const paintOnly = (p: Pledge) => p.items.length > 0 && (rowsOf.get(p.id) ?? []).every((r) => r.category === 'paint');
    return all.filter((p) => canMelt(p) && noShip.has(p.id) && paintOnly(p) && (rowsOf.get(p.id) ?? []).every((r) => paintStatus(r, inv.ownedIds) === 'no-ship'));
  });
  const orphanCredit = $derived(orphanPaints.reduce((n, p) => n + p.value, 0));
  /** Pledges labelled *Keep* are never picked by the dedupe / target planners. */
  const opts = $derived({ types: dedupe, keepLti, keep, never: idsWith(labels, KEEP) });
  const melt = $derived(meltSummary(all, picked, opts));
  /** One kept-count table per pick change for every row's "Would lose" (instead of one per row). */
  const kept = $derived(keptCounts(all, picked));
  /** Item → pledges holding it, once per hangar, for the "also in #…" lines under each pick. */
  const holders = $derived(holdersIndex(all));
  const dupes = $derived(duplicatePlan(all, opts));
  const dupeCredit = $derived(dupes.reduce((n, p) => n + p.value, 0));
  /** What each type would add if allowed (planned with only that type enabled on top of the current chips). */
  const dupesByType = $derived.by(() => {
    const m = new Map<PledgeType, { count: number; value: number }>();
    for (const t of TYPES) {
      if (t === 'upgrade') continue;
      const list = duplicatePlan(all, { ...opts, types: new Set([...dedupe, t]) }).filter((p) => p.type === t);
      m.set(t, { count: list.length, value: list.reduce((n, p) => n + p.value, 0) });
    }
    return m;
  });
  const togglePick = (id: number) => {
    const s = new Set(picked);
    s.has(id) ? s.delete(id) : s.add(id);
    picked = s;
  };
  const pickAll = (list: Pledge[], on: boolean) => {
    const s = new Set(picked);
    for (const p of list) if (canMelt(p)) on ? s.add(p.id) : s.delete(p.id);
    picked = s;
  };
  /** Rows of open ship groups before each group (by-ship chunking). */
  const groupStarts = $derived.by(() => {
    let n = 0;
    return groups.map((g) => {
      const at = n;
      if (!closed.has(g.key)) n += g.rows.length;
      return at;
    });
  });
  const rowCount = $derived.by(() => (byShip ? groups.reduce((n, g) => n + (closed.has(g.key) ? 0 : g.rows.length), 0) : visible.length));
  /**
   * Rows on screen: the first few paint with the click, the rest follow a chunk per frame — building a
   * 500-pledge table in one go blocked the page for half a second after picking Pledges in the sidebar. Starts over
   * when the view switches (Pledges ↔ Melt calculator re-renders every row with other columns; flat ↔ by ship swaps the
   * whole tree). Rows are keyed by pledge id so Group: identical / none keeps the DOM of every row that stays. A filter
   * change keeps what is on screen (capped to the new list), so clearing a filter grows from there instead of mounting
   * every row in one frame. By ship, the budget counts the rows of open groups.
   */
  // Plain (not reactive): rows on screen and the view they were for, read when the list changes.
  let onScreen = 0;
  let onScreenView = '';
  let budget = $derived.by(() => {
    const view = `${pane}|${byShip}`;
    const keep = view === onScreenView ? onScreen : 0;
    onScreenView = view;
    return Math.max(40, Math.min(keep, rowCount));
  });
  /** The "more loading" line is near the viewport (`lib/near-view.ts`): rows grow only then. */
  let near = $state(true);
  $effect(() => {
    onScreen = Math.min(budget, rowCount);
    if (budget >= rowCount || !near) return;
    const t = setTimeout(() => (budget += 60), 16);
    return () => clearTimeout(t);
  });
  /** Header box of the melt table: every meltable pledge shown is picked. */
  const allShownPicked = $derived(shown.some(canMelt) && shown.every((p) => !canMelt(p) || picked.has(p.id)));
  const dateCell = (d: string) => {
    const t = parseRsiDate(d);
    return Number.isNaN(t) ? d : fmtDate(t);
  };
  const visible = $derived(!melting || pickView === 'all' ? stacks : stacks.filter((s) => s.entries.some((p) => picked.has(p.id))));
  const pickedIn = (s: PledgeStack) => s.entries.filter((p) => picked.has(p.id)).length;
  const meltableIn = (s: PledgeStack) => s.entries.filter(canMelt).length;
  /** Stack box: all meltable entries picked → on; some → indeterminate. Toggling picks all / none. */
  const toggleStack = (s: PledgeStack) => pickAll(s.entries, pickedIn(s) < meltableIn(s));
  /** Pledges whose full item list is open (default: first 4 items + "+N more"). */
  let open = $state<Set<number>>(new Set());
  let allItems = $state(false);
  const toggleOpen = (id: number) => {
    const s = new Set(open);
    s.has(id) ? s.delete(id) : s.add(id);
    open = s;
  };
  let target = $state<number | null>(null);
  let planNote = $state('');
  function planTarget() {
    const t = Number(target);
    if (!t || t <= 0) return;
    const r = targetPlan(all, t, opts);
    picked = new Set(r.picked.map((p) => p.id));
    planNote = r.reached
      ? `${money(r.summary.credit)} from ${r.picked.length} pledge${r.picked.length === 1 ? '' : 's'}, ${r.summary.lost.length} item${r.summary.lost.length === 1 ? '' : 's'} lost`
      : `Can't reach ${money(t)}: everything meltable (no game packages) is ${money(r.summary.credit)}`;
  }
</script>

{#snippet ext()}<ExternalLink class={LINK_ICON} aria-hidden="true" />{/snippet}
  <Card.Root class="overflow-visible">
    <Card.Header>
      <Card.Title>{pane === 'melt' ? 'Melt calculator' : 'Pledges'}</Card.Title>
      <LoadStatus
        loading={loading ? { ...loading, pages: totalPages } : null}
        {data}
        count={all.length}
        noun={loading && data?.complete ? 'read' : 'pledges'}
        empty="Not loaded yet — reads every page of your RSI hangar (stays in this browser)."
      />
      <Card.Action class="flex flex-wrap items-center gap-2">
        <LoadActions
          {loading}
          {data}
          noun="hangar"
          onstop={() => ctrl?.abort()}
          onload={load}
          onupdate={update}
          canUpdate={!!data?.pledges.length}
          updateHint="Reads from the newest pledge down and stops at the first page that matches what's saved. Changes further down (an old pledge melted or upgraded) need Reload all."
        >
          <Button variant="outline" disabled={!shown.length} onclick={() => downloadFile(`rsi-hangar-${dateStamp()}.csv`, hangarCsv(shown), 'text/csv')}>CSV</Button>
          <Button variant="outline" disabled={!shown.length} onclick={() => downloadFile(`rsi-hangar-${dateStamp()}.json`, JSON.stringify(shown, null, 2), 'application/json')}>JSON</Button>
          <TipButton variant="outline" disabled={!shown.length} tip="Ships in the pledges shown, HangarXPLOR format — import into FleetYards, myfleet.gg, Starjump" onclick={() => downloadFile(`hangarxplor-shiplist-${dateStamp()}.json`, JSON.stringify(xplorRows(shown, cat?.ships ?? []), null, 2), 'application/json')}>Fleet JSON (HangarXPLOR)</TipButton>
        </LoadActions>
      </Card.Action>
    </Card.Header>
    <Card.Content class="grid gap-4">
      {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{:else if updated}<span class="text-muted-foreground">{updated}</span>{/if}

      {#if all.length}
        {#if pane === 'pledges'}
          <div class="grid gap-4">
            <StatGrid>
              {#if data?.credits}
                <Stat value={money(data.credits.usd)} label="store credit" tone="credit" hint={data.creditsAt ? `as of ${fmtDateTime(data.creditsAt)}` : null}>
                  <a class="{LINK} text-[11.5px]" href="#wallet">Wallet</a>
                </Stat>
              {/if}
              <Stat value={money(sum.value)} label="melt value" />
              {#if savedSum.n}<Stat value={money(savedSum.saved)} label="saved vs MSRP" valueTone={savedSum.saved < 0 ? 'err' : null} hint={`Ships' store price today (${money(savedSum.msrp)}) minus what ${savedSum.n} pledge${savedSum.n === 1 ? '' : 's'} with them cost (melt value ${money(savedSum.paid)}). Pledges without a ship the store prices are left out.`} />{/if}
              <Stat value={sum.pledges} label="pledges" />
              <Stat value={sum.ships} label="ships" />
              <Stat value={sum.upgrades} label="CCUs" />
              <Stat value={sum.lti} label="ships with LTI" hint={`${sum.lti} of ${sum.ships} ships, on ${sum.ltiPledges} pledge${sum.ltiPledges === 1 ? '' : 's'} (a pack's ships each count; the Insurance filter counts pledges)`} />
              <Stat value={sum.giftable} label="giftable" />
            </StatGrid>
            {@render filters()}
            {@render list()}
          </div>
        {:else}
          <div class="grid gap-4">
            <p class="text-muted-foreground m-0 text-xs">Melting is per pledge: you get its value as store credit and <strong>every item in it</strong> is gone — it can't be undone (buyback costs the same credit + a token). Duplicates and losses are worked out pledge by pledge: a pledge only counts as a duplicate when each item inside it has another copy in a pledge you keep.</p>
            <div class="flex flex-wrap items-center gap-2">
              <TipButton variant="outline" size="sm" disabled={!dupes.length} tip={dupes.map((p) => `${p.name} · ${money(p.value)}`).join('\n')} onclick={() => ((picked = new Set(dupes.map((p) => p.id))), (pickView = 'picked'))}>
                Pick duplicates{dupes.length ? ` · ${dupes.length} · ${money(dupeCredit)}` : ' · none'}
              </TipButton>
              {#if meltLabelled.length}
                <TipButton variant="outline" size="sm" tip={meltLabelled.map((p) => `${p.name} · ${money(p.value)}`).join('\n')} onclick={() => ((picked = new Set([...picked, ...meltLabelled.map((p) => p.id)])), (pickView = 'picked'))}>
                  Pick labelled “Melt” · {meltLabelled.length} · {money(meltLabelled.reduce((n, p) => n + p.value, 0))}
                </TipButton>
              {/if}
              <TipButton variant="outline" size="sm" disabled={!orphanPaints.length} tip={cat ? orphanPaints.map((p) => `${p.name} · ${money(p.value)}`).join('\n') : 'Needs the store ship list (loading…)'} onclick={() => ((picked = new Set([...picked, ...orphanPaints.map((p) => p.id)])), (pickView = 'picked'))}>
                Pick paints without a ship{orphanPaints.length ? ` · ${orphanPaints.length} · ${money(orphanCredit)}` : ' · none'}
              </TipButton>
              <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), planTarget())}>
                <label class="text-muted-foreground flex items-center gap-1 text-xs">Need $<Input type="number" min="1" step="1" class="w-[90px]" bind:value={target} placeholder="credit" aria-label="Credit needed" /></label>
                <Button type="submit" variant="outline" size="sm" disabled={!target}>Plan for target</Button>
              </form>
              <Button variant="outline" size="sm" disabled={!shown.length} onclick={() => pickAll(shown, true)}>Pick shown</Button>
              <Button variant="outline" size="sm" disabled={!picked.size} onclick={() => (picked = new Set())}>Clear</Button>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="text-muted-foreground">May pick:</span>
              <FilterChips options={dedupeOptions} bind:value={dedupe} multiple ariaLabel="Pledge types the planner may pick" />
              <SwitchRow id="melt-never-lti" size="sm" label="Never LTI" checked={keepLti} onchange={(v) => (keepLti = v)} />
            </div>
            {#if planNote}<div class="text-xs">{planNote}</div>{/if}
            {#if picked.size}
              <StatGrid>
                <Stat value={money(melt.credit)} label="credit from melting" />
                {#if data?.credits}<Stat value={money(data.credits.usd + melt.credit)} label={`store credit after (${money(data.credits.usd)} now)`} />{/if}
                <Stat value={melt.pledges} label="pledges melted" />
                <Stat value={melt.lost.length} label="items lost for good" valueTone={melt.lost.length ? 'err' : null} />
                <Stat value={melt.stillOwned.length} label="items still owned (other copy)" />
              </StatGrid>
              {#if melt.lost.length}
                <div class="text-xs"><span class="text-destructive">Lost:</span> {melt.lost.join(' · ')}</div>
              {:else}
                <div class="text-success text-xs">Nothing lost — every item in the picked pledges has another copy you keep.</div>
              {/if}
              {#if noBuybackPicked.length}<div class="text-xs"><span class="text-warning">No buyback:</span> {noBuybackPicked.map((p) => p.name).join(' · ')} <span class="text-muted-foreground">— RSI marks these as not buy-backable; melting them is final</span></div>{/if}
              {#if melt.short.length}<div class="text-xs"><span class="text-warning">Short:</span> {melt.short.join(' · ')} <span class="text-muted-foreground">— paints kept below one per ship it fits</span></div>{/if}
              {#if melt.stillOwned.length}<div class="text-muted-foreground text-xs">Still owned afterwards: {melt.stillOwned.join(' · ')}</div>{/if}
              <Collapsible.Root class="text-xs">
                <Collapsible.Trigger class="text-primary group flex cursor-pointer items-center gap-1 font-semibold">
                  <ChevronRight class="size-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
                  Melt them — {picked.size} pledge{picked.size === 1 ? '' : 's'}, one at a time
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <p class="text-muted-foreground my-2">RSI asks for your account password on every melt, so RSI+ can't do it for you. Each link opens the hangar on the right page, scrolls to the pledge and opens RSI's own melt dialog. Listed last hangar page first: melting from the bottom keeps the rows above in place, so the next link is still right. If a pledge did move, the hangar page looks for it on the nearby pages. <em>Reload all</em> here afterwards.</p>
                  <ul class="mt-1 list-disc pl-[18px]">
                    {#each all.filter((p) => picked.has(p.id)).reverse() as p (p.id)}
                      <li><a class="{LINK} font-semibold" href={hangarUrl(all, p.id, 'melt')} target="_blank" rel="noopener">Melt {@render ext()}</a> <strong>{p.name}</strong> <span class="text-muted-foreground">#{p.id} · {money(p.value)}</span></li>
                    {/each}
                  </ul>
                </Collapsible.Content>
              </Collapsible.Root>
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="text-muted-foreground">Show:</span>
                <Segmented
                  options={[
                    { id: 'all', label: 'everything' },
                    { id: 'picked', label: `picked only · ${picked.size}` },
                  ]}
                  bind:value={pickView}
                  ariaLabel="Show"
                  size="sm"
                />
              </div>
            {:else}
              <span class="text-muted-foreground text-xs">
                Nothing picked. "Pick paints without a ship" adds every paint-only pledge whose paints fit no ship you own (adds to your picks; paints for an unknown ship are left alone). "Pick duplicates" selects the highest-value pledges you can melt without losing a single item or LTI hull
                (skips CCUs, game packages, non-meltable and $0 pledges; a paint that fits several ships you own keeps one copy per ship). "Plan for target" reaches a credit amount losing the fewest
                unique items. After either, the list shows only the picked pledges, each saying where else you hold the same item: duplicates first, then the pledges that cost the least. The "Would lose" column shows what each pledge
                costs on top of what's picked.
              </span>
            {/if}
            {@render filters()}
            {@render list()}
          </div>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>

{#snippet list()}
  {#if !byShip}
    {@render pledgeTable(visible.slice(0, budget))}
    {#if budget < rowCount}<p class="text-muted-foreground text-xs" use:nearView={(v) => (near = v)}>… {rowCount - budget} more below</p>{/if}
  {:else}
    <!-- Sticky under the hub header: Show and the one column header for every group's table. -->
    <div class="bg-card sticky top-14 z-10 -mx-1 grid gap-1 px-1 pt-1">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-muted-foreground">Show:</span>
      <Segmented
        options={[
          { id: 'all', label: 'all' },
          { id: 'owned', label: 'ships you own' },
          { id: 'unowned', label: 'ships not owned', hint: 'Paints, parts and CCUs for a ship you don\'t have' },
          { id: 'loose', label: 'not related to a ship', hint: 'Gear, flair, game packages and anything RSI+ can\'t match to a ship. Paints and parts sit under the ship they fit, even when that ship is in another pledge' },
        ]}
        bind:value={shipShow}
        ariaLabel="Which ships to show"
        size="sm"
      />
      <span class="text-muted-foreground">{groups.length} {groups.length === 1 ? 'group' : 'groups'}{cat ? '' : ' · store ship list still loading, paints and CCUs will attach once it is in'}</span>
      <span class="grow"></span>
      <Button variant="outline" size="sm" onclick={() => (closed = new Set())}>Expand all</Button>
      <Button variant="outline" size="sm" onclick={() => (closed = new Set(groups.map((g) => g.key)))}>Collapse all</Button>
    </div>
    <div class="border-x border-transparent px-2">
      <Table.Root class="table-fixed">
        {@render cols()}
        {@render head()}
      </Table.Root>
    </div>
    </div>
    <div class="grid gap-2">
      {#if !groups.length}<Empty>Nothing matches.</Empty>{/if}
      {#each groups as g, gi (g.key)}
        {@const open = !closed.has(g.key)}
        {#if groupStarts[gi]! < budget}
        {@const own = groupSort[g.key]}
        <Collapsible.Root {open} onOpenChange={() => toggleGroup(g.key)} class="rounded-lg border px-2 pt-0.5 pb-1.5">
          <div class="flex items-center gap-2">
          <Collapsible.Trigger class="focus-visible:ring-ring/50 flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-2 rounded py-1.5 text-left text-[13px] outline-none focus-visible:ring-2">
            {#if open}<ChevronDown class="text-muted-foreground size-3.5" aria-hidden="true" />{:else}<ChevronRight class="text-muted-foreground size-3.5" aria-hidden="true" />{/if}
            {#if g.ship?.thumb}<Thumb src={g.ship.thumb} name={g.label} width={40} height={22} />{/if}
            <strong class={g.ship && !g.owned ? 'text-muted-foreground' : ''}>{g.label}</strong>
            {#if g.owned}<Badge variant="success"><Check /> {g.hulls > 1 ? `you own ${g.hulls}` : 'you own it'}</Badge>{:else if g.ship}<Badge variant="outline">ship not owned · only its paints / parts / CCUs</Badge>{/if}
            {#each g.insurance as ins (ins)}<Badge variant={ins === 'LTI' ? 'warning' : 'muted'}>{ins === 'LTI' ? 'LTI' : `${ins} insurance`}</Badge>{/each}
            <span class="text-muted-foreground text-[11px]">{g.count} pledge{g.count === 1 ? '' : 's'} · {money(g.value)}</span>
            {#if g.ship}
              <span class="text-muted-foreground text-[11px]">
                {[g.ship.focus, g.ship.size, g.ship.flyable].filter(Boolean).join(' · ')}{#if g.ship.msrp > 0} · MSRP {money(g.ship.msrp / 100)}{/if}
              </span>
            {/if}
            {#if g.saved > 0}<span class="text-success text-[11px]">saved {money(g.saved)}</span>{/if}
            {#if g.giftable}<span class="text-info text-[11px]">{g.giftable} giftable</span>{/if}
          </Collapsible.Trigger>
          {#if open && g.rows.length > 1}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button {...props} variant="ghost" size="xs" class={cn('shrink-0', own ? 'text-primary' : 'text-muted-foreground')} aria-label={`Sort the pledges of ${g.label}`}>
                    <ArrowUpDown class="size-3.5" />{own ? `${COLS.find((c) => c.key === own.key)?.label} ${own.dir === 'asc' ? '↑' : '↓'}` : 'Sort'}
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="w-48">
                <DropdownMenu.Label class="text-muted-foreground text-[11px] font-normal">Sort this ship's pledges</DropdownMenu.Label>
                <DropdownMenu.Item onSelect={() => setGroupSort(g.key, null)}>{#if !own}<Check class="size-3.5" />{:else}<span class="size-3.5"></span>{/if} Same as the header</DropdownMenu.Item>
                <DropdownMenu.Separator />
                {#each COLS as c (c.key)}
                  <DropdownMenu.Item closeOnSelect={false} onSelect={() => setGroupSort(g.key, nextSort(own ?? { key: c.key, dir: c.dir === 'asc' ? 'desc' : 'asc' }, c.key, c.dir))}>
                    {#if own?.key === c.key}<span class="text-primary w-3.5 text-center">{own.dir === 'asc' ? '↑' : '↓'}</span>{:else}<span class="w-3.5"></span>{/if} {c.label}
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/if}
          </div>
          <Collapsible.Content>
            {#if open}{@render pledgeTable(g.rows.slice(0, Math.max(0, budget - groupStarts[gi]!)))}{/if}
          </Collapsible.Content>
        </Collapsible.Root>
        {/if}
      {/each}
      {#if budget < rowCount}<p class="text-muted-foreground text-xs" use:nearView={(v) => (near = v)}>… {rowCount - budget} more below</p>{/if}
    </div>
  {/if}
{/snippet}

{#snippet filters()}
  <FacetBar {facets} ranges={pledgeRanges} rows={base} shown={shown.length} bind:values={facetValues} primary={PLEDGE_PRIMARY}>
    <Input class="w-64" placeholder="Search name, items, ship nickname" bind:value={q} aria-label="Search" />
    <span class="text-muted-foreground text-xs">Group:</span>
    <Segmented
      options={[
        { id: 'identical', label: 'identical pledges', hint: 'Identical pledges (same name, contents and flags) share one row with a count' },
        { id: 'none', label: 'none' },
      ]}
      bind:value={grouping}
      ariaLabel="Group pledges"
      size="sm"
    />
    <SwitchRow id="hangar-by-ship" size="sm" label="Group by ship" hint="Each ship with the paints, parts and CCUs for it nested under it; every pledge keeps its own row." checked={byShip} onchange={(v) => (byShip = v)} />
    <SwitchRow id="hangar-all-items" size="sm" label="Show all items in every pledge" checked={allItems} onchange={(v) => (allItems = v)} />
    {#if setOptions.length}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline" size="sm"><EyeOff class="size-3.5" /> Hide sets{hiddenSets.length ? ` · ${hiddenBySet.size} hidden` : ''}</Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="max-h-[60vh] w-72 overflow-y-auto">
          <DropdownMenu.Label class="text-muted-foreground text-[11px] font-normal">Events (Luminalia, IAE, Subscriber…) and item collections ("RSI Disc.", "AA"). A pledge is hidden only when everything in it belongs to hidden sets — ships always stay.</DropdownMenu.Label>
          <div class="flex gap-1 px-1 py-1">
            <Button variant="outline" size="xs" onclick={() => (hiddenSets = setOptions.map(([s]) => s))}>Hide all</Button>
            <Button variant="outline" size="xs" disabled={!hiddenSets.length} onclick={() => (hiddenSets = [])}>Show all</Button>
          </div>
          <DropdownMenu.Separator />
          {#each setOptions as [s, n] (s)}
            <DropdownMenu.CheckboxItem checked={hiddenSets.includes(s)} onCheckedChange={(v) => toggleSet(s, v)} closeOnSelect={false}>
              <span class="flex-1">{s}</span><span class="text-muted-foreground text-xs">{n} pledge{n === 1 ? '' : 's'}</span>
            </DropdownMenu.CheckboxItem>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </FacetBar>
{/snippet}

{#snippet cols()}
              <colgroup>
                {#if melting}<col class="w-10" />{/if}
                <col />
                <col class="w-16" />
                <col class="w-24" />
                <col class="w-24" />
                <col class="w-32" />
                <col class="w-28" />
                <col class="w-48" />
                <col class="w-20" />
                {#if melting}<col class="w-48" />{/if}
                <col class="w-80" />
              </colgroup>
{/snippet}

{#snippet head()}
            <Table.Header>
              <Table.Row>
                {#if melting}<Table.Head><Checkbox aria-label="Pick all shown" checked={allShownPicked} onCheckedChange={(v) => pickAll(shown, v)} /></Table.Head>{/if}
                <SortTh key="name" bind:sort>Pledge</SortTh>
                <SortTh key="qty" bind:sort firstDir="desc">Qty</SortTh>
                <SortTh key="type" bind:sort>Type</SortTh>
                <SortTh key="value" bind:sort firstDir="desc" numeric>Value</SortTh>
                <SortTh key="msrp" bind:sort firstDir="desc" numeric>
                  <LazyTip tip="The ships' store price today, and what you saved against it (MSRP − melt value). Sorts by saved. An upgraded pledge is priced at the ship it was upgraded to, so cheap CCU chains show up here. Ships only: game packages and paints aren't priced">
                    {#snippet trigger({ props })}<span {...props}>MSRP</span>{/snippet}
                  </LazyTip>
                </SortTh>
                <SortTh key="date" bind:sort firstDir="desc">Created</SortTh>
                <SortTh key="flags" bind:sort firstDir="desc">Flags</SortTh>
                <SortTh key="labels" bind:sort>
                  <LazyTip tip="Your own labels — Keep, LTI token, CCU fodder and Melt steer the planners. Sorts A→Z by label, unlabelled last">
                    {#snippet trigger({ props })}<span {...props}>Labels</span>{/snippet}
                  </LazyTip>
                </SortTh>
                {#if melting}
                  <Table.Head>
                    <LazyTip tip="Items that disappear for good if you melt one more of these on top of what's picked">
                      {#snippet trigger({ props })}<button type="button" {...props} class="cursor-default">Would lose</button>{/snippet}
                    </LazyTip>
                  </Table.Head>
                {/if}
                <SortTh key="id" bind:sort firstDir="desc">Hangar entries</SortTh>
              </Table.Row>
            </Table.Header>
{/snippet}

{#snippet pledgeTable(rows: PledgeStack[])}
          <!-- By ship every group is its own table under one sticky header: fixed column widths keep them lined up. -->
          <Table.Root class={byShip ? 'table-fixed' : ''}>
            {#if byShip}{@render cols()}{:else}{@render head()}{/if}
            <Table.Body>
              {#each rows as s (s.rep.id)}
                {@const p = s.rep}
                {@const n = s.entries.length}
                {@const nPicked = pickedIn(s)}
                {@const nMelt = meltableIn(s)}
                {@const next = s.entries.find((e) => canMelt(e) && !picked.has(e.id))}
                <Table.Row class="align-top" data-state={melting && nPicked > 0 ? 'selected' : undefined}>
                  {#if melting}
                    <Table.Cell>
                      <LazyTip tip={nMelt ? (n > 1 ? `Pick all ${nMelt} meltable copies` : 'Pick to melt') : p.meltable ? 'No melt value ($0)' : 'Not meltable'}>
                        {#snippet trigger({ props })}
                          <Checkbox
                            {...props}
                            checked={nMelt > 0 && nPicked === nMelt}
                            indeterminate={nPicked > 0 && nPicked < nMelt}
                            disabled={!nMelt}
                            onCheckedChange={() => toggleStack(s)}
                            aria-label={`Pick ${p.name}`}
                          />
                        {/snippet}
                      </LazyTip>
                    </Table.Cell>
                  {/if}
                  <Table.Cell class="min-w-[200px] whitespace-normal">
                    <strong>{p.name}</strong>
                    {#if p.upgrade}<div class="text-muted-foreground text-xs">{p.upgrade.fromName} → {p.upgrade.toName}</div>{/if}
                    {#if p.upgraded}
                      {@const up = upgradedFrom(p, cat?.ships ?? [])}
                      {#if up}
                        <div class="text-xs">
                          <ArrowUpRight class="text-primary inline size-3 align-[-2px]" aria-hidden="true" /> <span class="text-muted-foreground">{up.from} →</span> <strong>{up.to}</strong>
                          <LazyTip tip="A CCU was applied: the pledge keeps its original name, the hull inside is the new one">
                            {#snippet trigger({ props })}<button type="button" {...props} class="text-muted-foreground cursor-default">(upgraded)</button>{/snippet}
                          </LazyTip>
                        </div>
                      {/if}
                    {/if}
                    {#if p.items.length}
                      {@const full = allItems || open.has(p.id)}
                      {@const list = full ? p.items : p.items.slice(0, 4)}
                      <ul class="text-muted-foreground mt-1 list-disc pl-3.5 text-xs">
                        {#each list as it, i (i)}<li class={/^(ship|vehicle)$/i.test(it.kind) ? 'text-foreground' : ''}>{it.title}<WikiLink class="-my-1 ml-0.5" href={wikiOf.get(`${it.kind}|${it.title}`)} name={it.title} />{#if it.kind && !/^(ship|vehicle)$/i.test(it.kind)}<span class="text-muted-foreground"> · {it.kind}</span>{/if}</li>{/each}
                      </ul>
                      {#if p.items.length > 4 && !allItems}
                        <Button variant="link" size="xs" class="h-auto px-0" onclick={() => toggleOpen(p.id)}>{full ? 'Show less' : `+${p.items.length - 4} more items`}</Button>
                      {/if}
                    {/if}
                  </Table.Cell>
                  <Table.Cell class="whitespace-nowrap">
                    {n > 1 ? `×${n}` : '1'}
                    {#if melting && nPicked}<div class="text-xs"><span class="text-warning">{nPicked} melt</span>{#if n - nPicked}<span class="text-muted-foreground"> · {n - nPicked} keep</span>{/if}</div>{/if}
                  </Table.Cell>
                  <Table.Cell>{p.type}</Table.Cell>
                  <Table.Cell class="text-right tabular-nums">{money(p.value)}{#if n > 1}<div class="text-muted-foreground text-xs">{money(p.value * n)} total</div>{/if}</Table.Cell>
                  <Table.Cell class="text-right tabular-nums">
                    {@const m = msrpOf.get(p.id)}
                    {#if m == null}<span class="text-muted-foreground">—</span>
                    {:else}
                      {money(m)}
                      {@const d = m - p.value}
                      {#if d > 0}<div class="text-success text-xs">saved {money(d)} ({Math.round((d / m) * 100)}%)</div>
                      {:else if d < 0}<div class="text-muted-foreground text-xs">{money(-d)} over</div>{/if}
                    {/if}
                  </Table.Cell>
                  <Table.Cell class="text-muted-foreground text-xs whitespace-normal">{n > 1 ? `${dateCell(s.entries[n - 1]!.date)} – ${dateCell(p.date)}` : dateCell(p.date)}</Table.Cell>
                  <Table.Cell class="whitespace-normal">
                    <div class="flex flex-wrap gap-0.5">
                      {#if p.insurance}<Tag kind="insurance" value={p.insurance} />{:else if p.lti}<Tag kind="insurance" value="LTI" />{/if}
                      {#if p.warbond}<Tag kind="warbond" />{/if}
                      {#if s.entries.some((e) => e.giftable)}<Tag kind="giftable" label={n > 1 ? `Giftable ${s.entries.filter((e) => e.giftable).length}/${n}` : null} />{/if}
                      {#if isGifted(p)}<Tag kind="gifted" />{/if}
                      {#if p.upgraded}<Tag kind="upgraded" />{/if}
                      {#if p.hasGame}<Tag kind="game" />{/if}
                      {#if !p.meltable}<Badge variant="muted">no melt</Badge>{/if}
                      {#if p.noBuyback}<HintBadge variant="warning" hint="RSI marks this pledge as not buy-backable: melting it is final">no buyback</HintBadge>{/if}
                      {#if p.configValue}<HintBadge variant="muted" hint="Paid customization on top of the pledge">+{money(p.configValue)} config</HintBadge>{/if}
                      {#if p.availability}<HintBadge variant="warning" hint="RSI's availability state for this pledge">{p.availability}</HintBadge>{/if}
                      {#if p.reservedNames?.length}<HintBadge variant="secondary" hint="Ship name reserved on RSI">name: {p.reservedNames.join(', ')}</HintBadge>{:else if p.nameable?.length}<HintBadge variant="muted" hint="RSI lets you name this ship">nameable</HintBadge>{/if}
                    </div>
                  </Table.Cell>
                  <Table.Cell class="min-w-[90px] whitespace-normal"><LabelEdit ids={s.entries.map((e) => e.id)} {labels} onchange={saveLabels} /></Table.Cell>
                  {#if melting}
                    <Table.Cell class="text-xs whitespace-normal">
                      {#if !nMelt}<span class="text-muted-foreground">—</span>
                      {:else if !next}<span class="text-muted-foreground">{n > 1 ? 'all picked' : 'picked'}</span>
                      {:else}
                        {@const loss = lossWith(kept, next, opts)}
                        {#if loss.length}
                          <HintBadge variant="warning" hint={loss.join('\n')}>−{loss.length}</HintBadge>
                          <span class="text-muted-foreground">{loss.slice(0, 2).join(', ')}{loss.length > 2 ? '…' : ''}</span>
                        {:else}<Badge variant="success">duplicate</Badge>{/if}
                      {/if}
                    </Table.Cell>
                  {/if}
                  <Table.Cell class="min-w-[150px] text-xs">
                    {#each s.entries as e (e.id)}
                      {@const on = melting && picked.has(e.id)}
                      <div class="flex items-center gap-1.5 py-px whitespace-nowrap">
                        {#if melting && n > 1}
                          <LazyTip tip={canMelt(e) ? 'Pick this copy' : e.meltable ? 'No melt value ($0)' : 'Not meltable'}>
                            {#snippet trigger({ props })}<Checkbox {...props} checked={on} disabled={!canMelt(e)} onCheckedChange={() => togglePick(e.id)} aria-label={`Pick ${e.name} #${e.id}`} />{/snippet}
                          </LazyTip>
                        {/if}
                        <a class={cn(LINK, on && 'font-bold')} href={hangarUrl(all, e.id)} target="_blank" rel="noopener" title="Open the hangar page scrolled to this pledge">#{e.id} {@render ext()}</a>
                        {#if canMelt(e)}<TipButton variant="outline" size="xs" class="text-muted-foreground h-5 px-1.5" href={hangarUrl(all, e.id, 'melt')} target="_blank" rel="noopener" tip="Open RSI's melt dialog for this pledge (you confirm with your password there)">melt</TipButton>{/if}
                        {#if e.giftable}<TipButton variant="outline" size="xs" class="text-muted-foreground h-5 px-1.5" href={hangarUrl(all, e.id, 'gift')} target="_blank" rel="noopener" tip="Open RSI's gift dialog for this pledge">gift</TipButton>{/if}
                        {#if n > 1}<span class="text-muted-foreground">{dateCell(e.date)}</span>{/if}
                        {#if e.nickname}<span class="text-muted-foreground">“{e.nickname}”</span>{/if}
                        {#if n > 1 && e.giftable}<Tag kind="giftable" size="xs" />{/if}
                      </div>
                      {#if on}
                        {@const where = copiesElsewhere(holders, picked, e)}
                        {#if where.length}
                          <div class="mt-0.5 mb-1 ml-5 text-[11px] leading-normal">
                            {#each where as w (w.title)}
                              <div>
                                {#if w.in.length}
                                  <span class="text-success inline-flex items-center gap-0.5"><Check class="size-3" aria-hidden="true" /> {w.title}</span> <span class="text-muted-foreground">also in</span>
                                  {#each w.in.slice(0, 3) as q (q.id)}<a class="{LINK} ml-1" href={hangarUrl(all, q.id)} target="_blank" rel="noopener" title={q.name}>#{q.id}</a>{/each}
                                  {#if w.in.length > 3}<span class="text-muted-foreground">+{w.in.length - 3}</span>{/if}
                                {:else}
                                  <span class="text-warning inline-flex items-center gap-0.5"><X class="size-3" aria-hidden="true" /> {w.title}</span> <span class="text-muted-foreground">— last copy</span>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {/if}
                      {/if}
                    {/each}
                  </Table.Cell>
                </Table.Row>
              {/each}
              {#if !rows.length}<Empty colspan={melting ? 10 : 8}>Nothing matches.</Empty>{/if}
            </Table.Body>
          </Table.Root>
{/snippet}
