<script lang="ts">
  import { fetchCredits, loadHangar } from '@/lib/account';
  import { hangarCsv, hangarUrl, stackPledges, totals, type Pledge, type PledgeStack, type PledgeType } from '@/lib/hangar';
  import { xplorRows } from '@/lib/export';
  import { canMelt, copiesElsewhere, duplicatePlan, keptCounts, lossWith, meltSummary, targetPlan } from '@/lib/melt';
  import { inventory, ownedShipsWithPaints, paintCopiesNeeded, paintStatus, seriesOf, shipGroups, upgradedFrom, type GameShip } from '@/lib/items';
  import { bg } from '@/lib/messages';
  import { catalogItem, gameShipsItem, hangarItem, pledgeLabelsItem } from '@/lib/settings';
  import { allLabels, idsWith, KEEP, MELT, type Labels } from '@/lib/labels';
  import LabelEdit from './LabelEdit.svelte';
  import type { Catalog } from '@/lib/store';
  import { dateValue, sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';
  import Stat from './Stat.svelte';
  import { ownMoney } from '@/lib/privacy.svelte';
  import Thumb from './Thumb.svelte';
  import * as Card from '@/components/ui/card';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import * as Table from '@/components/ui/table';
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import * as Tooltip from '@/components/ui/tooltip';
  import * as Select from '@/components/ui/select';
  import * as Collapsible from '@/components/ui/collapsible';
  import * as DropdownMenu from '@/components/ui/dropdown-menu';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import { Progress } from '@/components/ui/progress';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Check from '@lucide/svelte/icons/check';
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
  let q = $state('');
  /** Your labels (`lib/labels.ts`) and the label filter ('' = any). */
  let labels = $state<Labels>({});
  let labelFilter = $state('');
  const labelList = $derived(allLabels(labels));
  const labelIds = $derived(labelFilter ? idsWith(labels, labelFilter) : null);
  const saveLabels = (next: Labels) => ((labels = next), pledgeLabelsItem.setValue(next));
  let type = $state<PledgeType | 'all'>('all');
  let flag = $state<'' | 'lti' | 'warbond' | 'giftable' | 'meltable' | 'notMeltable' | 'upgraded' | 'hasGame' | 'noBuyback' | 'cash' | 'credit' | 'named'>('');
  /** Flag filter. "Meltable" means it can actually be melted for credit (Reclaim button *and* a value) — RSI puts a
   *  Reclaim button on nearly every row, $0 flair included, so the raw flag alone filtered almost nothing out. */
  const flagPass = (p: Pledge) =>
    !flag ? true : flag === 'meltable' ? canMelt(p) : flag === 'notMeltable' ? !canMelt(p) : flag === 'cash' || flag === 'credit' ? p.paidWith === flag : flag === 'named' ? !!(p.nickname || p.reservedNames?.length) : !!p[flag];
  type Col = 'name' | 'type' | 'value' | 'date' | 'flags' | 'qty';
  let sort = $state<SortState<Col>>({ key: 'date', dir: 'desc' });
  let ctrl: AbortController | null = null;

  $effect(() => {
    hangarItem.getValue().then((v) => (data = v)).catch((e) => (error = `Couldn't read saved hangar: ${(e as Error).message}`));
    catalogItem.getValue().then((c) => (cat = c));
    gameShipsItem.getValue().then((g) => (game = g));
    pledgeLabelsItem.getValue().then((l) => (labels = l));
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch(() => {}); // only needed to know which hulls a paint fits
    const offs = [catalogItem.watch((c) => (cat = c)), gameShipsItem.watch((g) => (game = g ?? [])), pledgeLabelsItem.watch((l) => (labels = l ?? {}))];
    return () => (ctrl?.abort(), offs.forEach((o) => o()));
  });

  /** Persist a plain copy (never the reactive proxy). Throws so the UI can show storage errors. */
  async function save(v: Saved) {
    await hangarItem.setValue(JSON.parse(JSON.stringify(v)));
    data = v;
  }

  async function load(resume = false) {
    error = '';
    ctrl = new AbortController();
    const from = resume && data && !data.complete ? { page: data.page ?? 0, items: $state.snapshot(data.pledges) as Pledge[] } : undefined;
    loading = { page: from?.page ?? 0, count: from?.items.length ?? 0 };
    try {
      const pledges = await loadHangar(
        async ({ page, pages, items }) => {
          loading = { page, pages, count: items.length };
          await save({ ...credits(), at: Date.now(), pledges: items, complete: false, page }); // after every page
        },
        ctrl.signal,
        from,
      );
      await save({ ...credits(), at: Date.now(), pledges, complete: true });
      refreshCredits();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = `${(e as Error).message}${data?.pledges.length ? ' — what was read so far is kept; Resume to continue.' : ''}`;
    } finally {
      loading = null;
    }
  }

  const all = $derived(data?.pledges ?? []);
  /** Meltable pledges labelled *Melt* (one-click pick in the melt calculator). */
  const meltLabelled = $derived(all.filter((p) => idsWith(labels, MELT).has(p.id) && canMelt(p)));
  /** Total pages while loading: the page's own pagination, else ~ last known size / 50 (a reload of a known hangar). */
  const totalPages = $derived(loading?.pages ?? (all.length ? Math.max(loading?.page ?? 0, Math.ceil(all.length / 50)) : undefined));

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
  const shown = $derived.by(() => {
    const query = q.trim().toLowerCase();
    const list = all.filter(
      (p) =>
        !hiddenBySet.has(p.id) &&
        (type === 'all' || p.type === type) &&
        flagPass(p) &&
        (!labelIds || labelIds.has(p.id)) &&
        (!query || [p.name, p.nickname, ...p.items.map((i) => i.title)].some((s) => s.toLowerCase().includes(query))),
    );
    return list;
  });
  /** Identical pledges as one row (toggle); unstacked = one stack per pledge, so the table code is the same. */
  let stacked = $state(true);
  const stacks = $derived.by(() => {
    const st = stacked ? stackPledges(shown) : shown.map((p) => ({ key: String(p.id), rep: p, entries: [p] }) as PledgeStack);
    // Ties keep RSI's order (newest first); same-day pledges stay in that order.
    return sortBy(st, sort, {
      name: (s) => s.rep.name,
      type: (s) => s.rep.type,
      value: (s) => s.rep.value,
      date: (s) => dateValue(s.rep.date),
      flags: (s) => [s.rep.lti, s.rep.warbond, s.entries.some((p) => p.giftable), s.rep.upgraded, s.rep.hasGame].filter(Boolean).length,
      qty: (s) => s.entries.length,
    });
  });
  const sum = $derived(totals(shown));
  const TYPES: PledgeType[] = ['ship', 'package', 'combo', 'upgrade', 'paint', 'gear', 'hangar', 'subscriber', 'other'];
  const FLAGS: { value: typeof flag; label: string }[] = [
    { value: '', label: 'Any' },
    { value: 'lti', label: 'LTI' },
    { value: 'warbond', label: 'Warbond' },
    { value: 'giftable', label: 'Giftable' },
    { value: 'meltable', label: 'Meltable (melts for credit)' },
    { value: 'notMeltable', label: 'Not meltable or $0' },
    { value: 'upgraded', label: 'Upgraded' },
    { value: 'hasGame', label: 'Has game package' },
    { value: 'noBuyback', label: 'No buyback after melt' },
    { value: 'cash', label: 'Paid with cash' },
    { value: 'credit', label: 'Paid with store credit' },
    { value: 'named', label: 'Named ship' },
  ];
  /** Pledges RSI marks as never returning to buyback, among the ones picked to melt. */
  const noBuybackPicked = $derived(all.filter((p) => picked.has(p.id) && p.noBuyback));
  /** Filter-chip look for toggle-group items (old `.chip` / `.chip.on`). */
  const chipItem = 'h-6 rounded-full px-2.5 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary';
  const ltiBadge = 'text-warning border-warning/40';
  const money = (n: number) => ownMoney(`$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`);

  function download(name: string, body: string, type: string) {
    const url = URL.createObjectURL(new Blob([body], { type }));
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---- panes: Pledges (the list) / Melt calculator (same list with the tick + "Would lose" columns) ----
  type Pane = 'pledges' | 'melt';
  const PREFS = 'rsiplus:hangar';
  const savedPrefs = (() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<{ byShip: boolean; hiddenSets: string[] }>;
    } catch {
      return {} as Partial<{ byShip: boolean; hiddenSets: string[] }>;
    }
  })();
  /** Which page the hub shows: Pledges (`#hangar`) or the Melt calculator (`#melt`). Same instance for both. */
  let { pane = 'pledges' }: { pane?: Pane } = $props();
  /** Group the list by ship: each hull with the paints / parts / CCUs for it nested under it (every pledge keeps its own row). */
  let byShip = $state(savedPrefs.byShip ?? false);
  /** Event / flair sets (Luminalia, IAE, Subscriber, "RSI Disc.", "AA" …) whose pledges are hidden from the list. */
  let hiddenSets = $state<string[]>(savedPrefs.hiddenSets ?? []);
  $effect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ byShip, hiddenSets }));
    } catch {
      /* no persistence — fine */
    }
  });
  const melting = $derived(pane === 'melt');
  /** Ship groups over the whole hangar (so "owned" is right whatever the filters), each reduced to the stacks on show. */
  const groups = $derived.by(() => {
    if (!byShip) return [];
    const idx = new Map(visible.map((st) => [st.rep.id, st]));
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
        return { ...g, rows, value: rows.reduce((n, st) => n + st.rep.value * st.entries.length, 0), count: rows.reduce((n, st) => n + st.entries.length, 0) };
      })
      .filter((g) => g.rows.length);
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
    const paintOnly = (p: Pledge) => p.items.length > 0 && inv.rows.filter((r) => r.pledges.some((x) => x.id === p.id)).every((r) => r.category === 'paint');
    return all.filter((p) => canMelt(p) && noShip.has(p.id) && paintOnly(p) && inv.rows.filter((r) => r.pledges.some((x) => x.id === p.id)).every((r) => paintStatus(r, inv.ownedIds) === 'no-ship'));
  });
  const orphanCredit = $derived(orphanPaints.reduce((n, p) => n + p.value, 0));
  /** Pledges labelled *Keep* are never picked by the dedupe / target planners. */
  const opts = $derived({ types: dedupe, keepLti, keep, never: idsWith(labels, KEEP) });
  const melt = $derived(meltSummary(all, picked, opts));
  /** One kept-count table per pick change for every row's "Would lose" (instead of one per row). */
  const kept = $derived(keptCounts(all, picked));
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

{#snippet ext()}<ExternalLink class="inline size-3 align-[-1px]" aria-hidden="true" />{/snippet}
  <Card.Root>
    <Card.Header>
      <Card.Title><h2 class="m-0 text-lg font-semibold">{pane === 'melt' ? 'Melt calculator' : 'Pledges'}</h2></Card.Title>
      <div class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        {#if loading}<span>Loading page {loading.page}{totalPages ? ` / ${totalPages}` : ''}… {loading.count} pledges</span>{#if totalPages}<Progress value={Math.min(100, Math.round((100 * loading.page) / totalPages))} class="h-1.5 w-[140px]" aria-hidden="true" />{/if}
        {:else if data}{all.length} pledges · {data.complete === false ? `partial (stopped after page ${data.page})` : 'loaded'} {new Date(data.at).toLocaleString()}
        {:else}Not loaded yet — reads every page of your RSI hangar (stays in this browser).{/if}
      </div>
      <Card.Action class="flex flex-wrap items-center gap-2">
        {#if loading}
          <Button variant="outline" onclick={() => ctrl?.abort()}>Stop</Button>
        {:else}
          {#if data && data.complete === false}
            <Button onclick={() => load(true)}>Resume from page {(data.page ?? 0) + 1}</Button>
          {/if}
          <Button variant={data ? 'outline' : 'default'} onclick={() => load(false)}>{data ? 'Reload all' : 'Load hangar'}</Button>
        {/if}
        <Button variant="outline" disabled={!shown.length} onclick={() => download(`rsi-hangar-${stamp()}.csv`, hangarCsv(shown), 'text/csv')}>CSV</Button>
        <Button variant="outline" disabled={!shown.length} onclick={() => download(`rsi-hangar-${stamp()}.json`, JSON.stringify(shown, null, 2), 'application/json')}>JSON</Button>
        <Button variant="outline" disabled={!shown.length} title="Ships in the pledges shown, HangarXPLOR format — import into FleetYards, myfleet.gg, Starjump" onclick={() => download(`hangarxplor-shiplist-${stamp()}.json`, JSON.stringify(xplorRows(shown, cat?.ships ?? []), null, 2), 'application/json')}>Fleet JSON (HangarXPLOR)</Button>
      </Card.Action>
    </Card.Header>
    <Card.Content class="grid gap-4">
      {#if error}<span class="text-destructive">{error}</span>{/if}

      {#if all.length}
        {#if pane === 'pledges'}
          <div class="grid gap-4">
            <div class="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
              {#if data?.credits}
                {@const c = data.credits}
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    {#snippet child({ props })}
                      <div {...props} class="grid">
                        <Stat value={money(c.usd)} label="store credit" tone="credit">
                          <a class="text-primary text-[11.5px]" href="#wallet">Wallet</a>
                        </Stat>
                      </div>
                    {/snippet}
                  </Tooltip.Trigger>
                  {#if data.creditsAt}<Tooltip.Content>as of {new Date(data.creditsAt).toLocaleString()}</Tooltip.Content>{/if}
                </Tooltip.Root>
              {/if}
              <Stat value={money(sum.value)} label="melt value" />
              <Stat value={sum.pledges} label="pledges" />
              <Stat value={sum.ships} label="ships" />
              <Stat value={sum.upgrades} label="CCUs" />
              <Stat value={sum.lti} label="LTI" />
              <Stat value={sum.giftable} label="giftable" />
            </div>
            {@render filters()}
            {@render list()}
          </div>
        {:else}
          <div class="grid gap-4">
            <p class="text-muted-foreground m-0 text-xs">Melting is per pledge: you get its value as store credit and <strong>every item in it</strong> is gone — it can't be undone (buyback costs the same credit + a token). Duplicates and losses are worked out pledge by pledge: a pledge only counts as a duplicate when each item inside it has another copy in a pledge you keep.</p>
            <div class="flex flex-wrap items-center gap-2">
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <span {...props} class="inline-flex">
                      <Button variant="outline" size="sm" disabled={!dupes.length} onclick={() => ((picked = new Set(dupes.map((p) => p.id))), (pickView = 'picked'))}>
                        Pick duplicates{dupes.length ? ` · ${dupes.length} · ${money(dupeCredit)}` : ' · none'}
                      </Button>
                    </span>
                  {/snippet}
                </Tooltip.Trigger>
                {#if dupes.length}<Tooltip.Content class="whitespace-pre-line">{dupes.map((p) => `${p.name} · ${money(p.value)}`).join('\n')}</Tooltip.Content>{/if}
              </Tooltip.Root>
              {#if meltLabelled.length}
                <Button variant="outline" size="sm" title={meltLabelled.map((p) => `${p.name} · ${money(p.value)}`).join('\n')} onclick={() => ((picked = new Set([...picked, ...meltLabelled.map((p) => p.id)])), (pickView = 'picked'))}>
                  Pick labelled “Melt” · {meltLabelled.length} · {money(meltLabelled.reduce((n, p) => n + p.value, 0))}
                </Button>
              {/if}
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <span {...props} class="inline-flex">
                      <Button variant="outline" size="sm" disabled={!orphanPaints.length} onclick={() => ((picked = new Set([...picked, ...orphanPaints.map((p) => p.id)])), (pickView = 'picked'))}>
                        Pick paints without a ship{orphanPaints.length ? ` · ${orphanPaints.length} · ${money(orphanCredit)}` : ' · none'}
                      </Button>
                    </span>
                  {/snippet}
                </Tooltip.Trigger>
                {#if !cat || orphanPaints.length}
                  <Tooltip.Content class="whitespace-pre-line">{cat ? orphanPaints.map((p) => `${p.name} · ${money(p.value)}`).join('\n') : 'Needs the store ship list (loading…)'}</Tooltip.Content>
                {/if}
              </Tooltip.Root>
              <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), planTarget())}>
                <label class="text-muted-foreground flex items-center gap-1 text-xs">Need $<Input type="number" min="1" step="1" class="h-7 w-[90px]" bind:value={target} placeholder="credit" aria-label="Credit needed" /></label>
                <Button type="submit" variant="outline" size="sm" disabled={!target}>Plan for target</Button>
              </form>
              <Button variant="outline" size="sm" disabled={!shown.length} onclick={() => pickAll(shown, true)}>Pick shown</Button>
              <Button variant="outline" size="sm" disabled={!picked.size} onclick={() => (picked = new Set())}>Clear</Button>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="text-muted-foreground">May pick:</span>
              <ToggleGroup.Root
                type="multiple"
                variant="outline"
                size="sm"
                spacing={1}
                class="flex-wrap"
                aria-label="Pledge types the planner may pick"
                bind:value={() => [...dedupe], (v) => (dedupe = new Set(v as PledgeType[]))}
              >
                {#each TYPES.filter((t) => t !== 'upgrade' && totals(all).byType[t]) as t (t)}
                  {@const d = dupesByType.get(t)}
                  <ToggleGroup.Item value={t} class={chipItem} title={dedupe.has(t) ? `Click to leave ${t} pledges alone` : `Click to allow ${t} pledges`}>
                    {t}{#if d?.count} · {d.count} · {money(d.value)}{/if}
                  </ToggleGroup.Item>
                {/each}
              </ToggleGroup.Root>
              <label class="text-muted-foreground flex items-center gap-1.5"><Checkbox bind:checked={keepLti} /> never LTI</label>
            </div>
            {#if planNote}<div class="text-xs">{planNote}</div>{/if}
            {#if picked.size}
              <div class="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
                <Stat value={money(melt.credit)} label="credit from melting" />
                {#if data?.credits}<Stat value={money(data.credits.usd + melt.credit)} label={`store credit after (${money(data.credits.usd)} now)`} />{/if}
                <Stat value={melt.pledges} label="pledges melted" />
                <Stat value={melt.lost.length} label="items lost for good" valueTone={melt.lost.length ? 'err' : null} />
                <Stat value={melt.stillOwned.length} label="items still owned (other copy)" />
              </div>
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
                      <li><a class="text-primary font-semibold no-underline hover:underline" href={hangarUrl(all, p.id, 'melt')} target="_blank" rel="noopener">Melt {@render ext()}</a> <strong>{p.name}</strong> <span class="text-muted-foreground">#{p.id} · {money(p.value)}</span></li>
                    {/each}
                  </ul>
                </Collapsible.Content>
              </Collapsible.Root>
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="text-muted-foreground">Show:</span>
                <ToggleGroup.Root type="single" variant="outline" size="sm" spacing={1} aria-label="Show" bind:value={() => pickView, (v) => v && (pickView = v as typeof pickView)}>
                  <ToggleGroup.Item value="all" class={chipItem}>everything</ToggleGroup.Item>
                  <ToggleGroup.Item value="picked" class={chipItem}>picked only · {picked.size}</ToggleGroup.Item>
                </ToggleGroup.Root>
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
    {@render pledgeTable(visible)}
  {:else}
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-muted-foreground">{groups.length} ships{cat ? '' : ' · store ship list still loading, paints and CCUs will attach once it is in'}</span>
      <span class="grow"></span>
      <Button variant="outline" size="xs" onclick={() => (closed = new Set())}>Expand all</Button>
      <Button variant="outline" size="xs" onclick={() => (closed = new Set(groups.map((g) => g.key)))}>Collapse all</Button>
    </div>
    <div class="grid gap-2">
      {#each groups as g (g.key)}
        {@const open = !closed.has(g.key)}
        <Collapsible.Root {open} onOpenChange={() => toggleGroup(g.key)} class="rounded-lg border px-2 pt-0.5 pb-1.5">
          <Collapsible.Trigger class="focus-visible:ring-ring/50 flex w-full cursor-pointer flex-wrap items-center gap-2 rounded py-1.5 text-left text-[13px] outline-none focus-visible:ring-2">
            {#if open}<ChevronDown class="text-muted-foreground size-3.5" aria-hidden="true" />{:else}<ChevronRight class="text-muted-foreground size-3.5" aria-hidden="true" />{/if}
            {#if g.ship?.thumb}<Thumb src={g.ship.thumb} name={g.label} width={40} height={22} />{/if}
            <strong class={g.ship && !g.owned ? 'text-muted-foreground' : ''}>{g.label}</strong>
            {#if g.ship}
              {#if g.owned}<Badge variant="secondary" class="text-success"><Check /> {g.hulls > 1 ? `${g.hulls} hulls` : 'hull'}</Badge>{:else}<Badge variant="outline" class="border-warning/40 text-warning">no hull</Badge>{/if}
            {/if}
            <span class="text-muted-foreground text-[11px]">{g.count} pledge{g.count === 1 ? '' : 's'} · {money(g.value)}</span>
          </Collapsible.Trigger>
          <Collapsible.Content>
            {@render pledgeTable(g.rows)}
          </Collapsible.Content>
        </Collapsible.Root>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet filters()}
          <ToggleGroup.Root
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            class="flex-wrap"
            aria-label="Pledge type"
            bind:value={() => (type === 'all' ? '' : type), (v) => (type = v ? (v as PledgeType) : 'all')}
          >
            {#each TYPES.filter((t) => totals(all).byType[t]) as t (t)}
              {@const b = totals(all).byType[t]}
              <ToggleGroup.Item value={t} class={chipItem}>{t} · {b.count} · {money(b.value)}</ToggleGroup.Item>
            {/each}
          </ToggleGroup.Root>
          <div class="flex flex-wrap items-center gap-2">
            <Input class="w-64" placeholder="Search name, items, ship nickname" bind:value={q} aria-label="Search" />
            <label class="text-muted-foreground flex items-center gap-1.5 text-xs"><Checkbox bind:checked={stacked} /> Stack identical pledges</label>
          <label class="text-muted-foreground flex items-center gap-1.5 text-xs" title="Each ship with the paints, parts and CCUs for it nested under it; every pledge keeps its own row"><Checkbox bind:checked={byShip} /> Group by ship</label>
            <label class="text-muted-foreground flex items-center gap-1.5 text-xs"><Checkbox bind:checked={allItems} /> Show all items in every pledge</label>
            <Select.Root type="single" bind:value={() => flag || 'any', (v) => (flag = v === 'any' ? '' : (v as typeof flag))}>
              <Select.Trigger aria-label="Flag">{FLAGS.find((f) => f.value === flag)?.label}</Select.Trigger>
              <Select.Content>
                {#each FLAGS as f (f.value)}<Select.Item value={f.value || 'any'} label={f.label} />{/each}
              </Select.Content>
            </Select.Root>
            {#if labelList.length}
              <Select.Root type="single" bind:value={() => labelFilter || 'any', (v) => (labelFilter = v === 'any' ? '' : v)}>
                <Select.Trigger aria-label="Label">{labelFilter ? `Label: ${labelFilter}` : 'Any label'}</Select.Trigger>
                <Select.Content>
                  <Select.Item value="any" label="Any label" />
                  {#each labelList as l (l.name)}<Select.Item value={l.name} label={`${l.name} · ${l.count}`} />{/each}
                </Select.Content>
              </Select.Root>
            {/if}
            {#if setOptions.length}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <Button {...props} variant="outline" size="sm" title="Hide event rewards, subscriber flair and other item sets (pledges holding only those)"><EyeOff class="size-3.5" /> Hide sets{hiddenSets.length ? ` · ${hiddenBySet.size} hidden` : ''}</Button>
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
          </div>
{/snippet}

{#snippet pledgeTable(rows: PledgeStack[])}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                {#if melting}<Table.Head><Checkbox aria-label="Pick all shown" checked={shown.some(canMelt) && shown.every((p) => !canMelt(p) || picked.has(p.id))} onCheckedChange={(v) => pickAll(shown, v)} /></Table.Head>{/if}
                <SortTh key="name" bind:sort>Pledge</SortTh>
                <SortTh key="qty" bind:sort firstDir="desc">Qty</SortTh>
                <SortTh key="type" bind:sort>Type</SortTh>
                <SortTh key="value" bind:sort firstDir="desc">Value</SortTh>
                <SortTh key="date" bind:sort firstDir="desc">Created</SortTh>
                <SortTh key="flags" bind:sort firstDir="desc">Flags</SortTh>
                <Table.Head title="Your own labels — Keep, LTI token, CCU fodder and Melt steer the planners">Labels</Table.Head>
                {#if melting}
                  <Table.Head>
                    <Tooltip.Root>
                      <Tooltip.Trigger class="cursor-help">Would lose</Tooltip.Trigger>
                      <Tooltip.Content>Items that disappear for good if you melt one more of these on top of what's picked</Tooltip.Content>
                    </Tooltip.Root>
                  </Table.Head>
                {/if}
                <Table.Head>Hangar entries</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each rows as s (s.key)}
                {@const p = s.rep}
                {@const n = s.entries.length}
                {@const nPicked = pickedIn(s)}
                {@const nMelt = meltableIn(s)}
                {@const next = s.entries.find((e) => canMelt(e) && !picked.has(e.id))}
                <Table.Row class="align-top" data-state={melting && nPicked > 0 ? 'selected' : undefined}>
                  {#if melting}
                    <Table.Cell>
                      <Checkbox
                        checked={nMelt > 0 && nPicked === nMelt}
                        indeterminate={nPicked > 0 && nPicked < nMelt}
                        disabled={!nMelt}
                        title={nMelt ? (n > 1 ? `Pick all ${nMelt} meltable copies` : 'Pick to melt') : p.meltable ? 'No melt value ($0)' : 'Not meltable'}
                        onCheckedChange={() => toggleStack(s)}
                        aria-label={`Pick ${p.name}`}
                      />
                    </Table.Cell>
                  {/if}
                  <Table.Cell class="min-w-[200px] whitespace-normal">
                    <strong>{p.name}</strong>
                    {#if p.upgrade}<div class="text-muted-foreground text-xs">{p.upgrade.fromName} → {p.upgrade.toName}</div>{/if}
                    {#if p.upgraded}
                      {@const up = upgradedFrom(p, cat?.ships ?? [])}
                      {#if up}
                        <div class="text-xs" title="A CCU was applied: the pledge keeps its original name, the hull inside is the new one">
                          <ArrowUpRight class="text-primary inline size-3 align-[-2px]" aria-hidden="true" /> <span class="text-muted-foreground">{up.from} →</span> <strong>{up.to}</strong> <span class="text-muted-foreground">(upgraded)</span>
                        </div>
                      {/if}
                    {/if}
                    {#if p.items.length}
                      {@const full = allItems || open.has(p.id)}
                      {@const list = full ? p.items : p.items.slice(0, 4)}
                      <ul class="text-muted-foreground mt-1 list-disc pl-3.5 text-xs">
                        {#each list as it, i (i)}<li class={/^(ship|vehicle)$/i.test(it.kind) ? 'text-foreground' : ''}>{it.title}{#if it.kind && !/^(ship|vehicle)$/i.test(it.kind)}<span class="text-muted-foreground"> · {it.kind}</span>{/if}</li>{/each}
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
                  <Table.Cell>{money(p.value)}{#if n > 1}<div class="text-muted-foreground text-xs">{money(p.value * n)} total</div>{/if}</Table.Cell>
                  <Table.Cell class="text-muted-foreground text-xs">{n > 1 ? `${s.entries[n - 1]!.date} – ${p.date}` : p.date}</Table.Cell>
                  <Table.Cell class="whitespace-normal">
                    <div class="flex flex-wrap gap-0.5">
                      {#if p.insurance}<Badge variant={p.insurance === 'LTI' ? 'outline' : 'secondary'} class={p.insurance === 'LTI' ? ltiBadge : ''}>{p.insurance}</Badge>{:else if p.lti}<Badge variant="outline" class={ltiBadge}>LTI</Badge>{/if}
                      {#if p.warbond}<Badge variant="secondary">WB</Badge>{/if}
                      {#if s.entries.some((e) => e.giftable)}<Badge variant="secondary">gift{n > 1 ? ` ${s.entries.filter((e) => e.giftable).length}/${n}` : ''}</Badge>{/if}
                      {#if p.upgraded}<Badge variant="secondary" title="A CCU was applied to this pledge">upgraded</Badge>{/if}
                      {#if p.hasGame}<Badge variant="secondary">game</Badge>{/if}
                      {#if !p.meltable}<Badge variant="outline" class="text-muted-foreground">no melt</Badge>{/if}
                      {#if p.noBuyback}<Badge variant="outline" class="border-warning/40 text-warning" title="RSI marks this pledge as not buy-backable: melting it is final">no buyback</Badge>{/if}
                      {#if p.paidWith === 'credit'}<Badge variant="outline" class="text-muted-foreground" title="Paid with store credit (RSI's hangar page)">credit</Badge>{/if}
                      {#if p.configValue}<Badge variant="outline" class="text-muted-foreground" title="Paid customization on top of the pledge">+{money(p.configValue)} config</Badge>{/if}
                      {#if p.availability}<Badge variant="outline" class="border-warning/40 text-warning" title="RSI's availability state for this pledge">{p.availability}</Badge>{/if}
                      {#if p.reservedNames?.length}<Badge variant="secondary" title="Ship name reserved on RSI">name: {p.reservedNames.join(', ')}</Badge>{:else if p.nameable?.length}<Badge variant="outline" class="text-muted-foreground" title="RSI lets you name this ship">nameable</Badge>{/if}
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
                          <Tooltip.Root>
                            <Tooltip.Trigger>
                              {#snippet child({ props })}<Badge {...props} variant="outline" class="text-warning border-warning/40 cursor-help">−{loss.length}</Badge>{/snippet}
                            </Tooltip.Trigger>
                            <Tooltip.Content class="whitespace-pre-line">{loss.join('\n')}</Tooltip.Content>
                          </Tooltip.Root>
                          <span class="text-muted-foreground">{loss.slice(0, 2).join(', ')}{loss.length > 2 ? '…' : ''}</span>
                        {:else}<Badge variant="secondary" class="text-success">duplicate</Badge>{/if}
                      {/if}
                    </Table.Cell>
                  {/if}
                  <Table.Cell class="min-w-[150px] text-xs">
                    {#each s.entries as e (e.id)}
                      {@const on = melting && picked.has(e.id)}
                      <div class="flex items-center gap-1.5 py-px whitespace-nowrap">
                        {#if melting && n > 1}
                          <Checkbox checked={on} disabled={!canMelt(e)} title={canMelt(e) ? 'Pick this copy' : e.meltable ? 'No melt value ($0)' : 'Not meltable'} onCheckedChange={() => togglePick(e.id)} aria-label={`Pick ${e.name} #${e.id}`} />
                        {/if}
                        <a class={['text-primary no-underline hover:underline', on && 'font-bold']} href={hangarUrl(all, e.id)} target="_blank" rel="noopener" title="Open the hangar page scrolled to this pledge">#{e.id} {@render ext()}</a>
                        {#if canMelt(e)}<Button variant="outline" size="xs" class="text-muted-foreground h-5 px-1.5" href={hangarUrl(all, e.id, 'melt')} target="_blank" rel="noopener" title="Open RSI's melt dialog for this pledge (you confirm with your password there)">melt</Button>{/if}
                        {#if e.giftable}<Button variant="outline" size="xs" class="text-muted-foreground h-5 px-1.5" href={hangarUrl(all, e.id, 'gift')} target="_blank" rel="noopener" title="Open RSI's gift dialog for this pledge">gift</Button>{/if}
                        {#if n > 1}<span class="text-muted-foreground">{e.date}</span>{/if}
                        {#if e.nickname}<span class="text-muted-foreground">“{e.nickname}”</span>{/if}
                        {#if n > 1 && e.giftable}<Badge variant="secondary">gift</Badge>{/if}
                      </div>
                      {#if on}
                        {@const where = copiesElsewhere(all, picked, e)}
                        {#if where.length}
                          <div class="mt-0.5 mb-1 ml-5 text-[11px] leading-normal">
                            {#each where as w (w.title)}
                              <div>
                                {#if w.in.length}
                                  <span class="text-success inline-flex items-center gap-0.5"><Check class="size-3" aria-hidden="true" /> {w.title}</span> <span class="text-muted-foreground">also in</span>
                                  {#each w.in.slice(0, 3) as q (q.id)}<a class="text-primary ml-1 no-underline hover:underline" href={hangarUrl(all, q.id)} target="_blank" rel="noopener" title={q.name}>#{q.id}</a>{/each}
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
            </Table.Body>
          </Table.Root>
{/snippet}
