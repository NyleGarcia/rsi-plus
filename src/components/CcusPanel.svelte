<script lang="ts">
  /**
   * My CCUs: every upgrade you hold (hangar + buyback) joined with the catalog — what you paid vs the MSRP gap between
   * the two hulls, flags, the saved chains that use it — with facets, totals and CSV. Model: `lib/ccu-rows.ts`.
   * Spec: docs/plans/specs/filters-and-labels.md → CCUs page.
   */
  import { ownedCcus, type SavedChain } from '@/lib/ccu';
  import { ccuCsv, ccuFacets, ccuRanges, ccuRows, ccuTotals, groupCcus, type CcuRow } from '@/lib/ccu-rows';
  import { applyFacets, type FacetValues } from '@/lib/facets';
  import { hangarUrl } from '@/lib/hangar';
  import { bg } from '@/lib/messages';
  import { buybackItem, catalogItem, ccuChainsItem, hangarItem } from '@/lib/settings';
  import { usd, type Catalog } from '@/lib/store';
  import { ownUsd } from '@/lib/privacy.svelte';
  import { downloadFile, dateStamp } from '@/lib/download';
  import { sortBy, type SortState } from '@/lib/sort';
  import { cn } from '@/lib/utils';
  import { LINK } from '@/lib/ui';
  import FacetBar from './FacetBar.svelte';
  import Segmented from './Segmented.svelte';
  import SortTh from './SortTh.svelte';
  import StatGrid from './StatGrid.svelte';
  import Stat from './Stat.svelte';
  import Tag from './Tag.svelte';
  import HintBadge from './HintBadge.svelte';
  import TipButton from './TipButton.svelte';
  import WikiLink from './WikiLink.svelte';
  import { wikiUrl } from '@/lib/wiki';
  import Thumb from './Thumb.svelte';
  import Empty from './Empty.svelte';
  import * as Alert from '@/components/ui/alert';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import Download from '@lucide/svelte/icons/download';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Route from '@lucide/svelte/icons/route';

  const BUYBACK_PAGE = 'https://robertsspaceindustries.com/account/buy-back-pledges';

  let cat = $state<Catalog | null>(null);
  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let buyback = $state<Awaited<ReturnType<typeof buybackItem.getValue>>>(null);
  let chains = $state<SavedChain[]>([]);
  let error = $state('');

  $effect(() => {
    hangarItem.getValue().then((h) => (hangar = h)).catch(() => {});
    buybackItem.getValue().then((b) => (buyback = b)).catch(() => {});
    catalogItem.getValue().then((c) => (cat = c ?? cat)).catch(() => {});
    ccuChainsItem.getValue().then((c) => (chains = c)).catch(() => {});
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch((e) => (error = `Catalog: ${(e as Error).message}`));
    const offs = [hangarItem.watch((h) => (hangar = h)), buybackItem.watch((b) => (buyback = b)), ccuChainsItem.watch((c) => (chains = c))];
    return () => offs.forEach((o) => o());
  });

  // ---- prefs: facet values, grouping and sort in `rsiplus:ccus` ----
  type Col = 'from' | 'to' | 'paid' | 'gap' | 'saving' | 'place';
  type Prefs = { values: FacetValues; group: 'upgrade' | 'none'; sort: SortState<Col> };
  const PREFS_KEY = 'rsiplus:ccus';
  const prefs: Prefs = (() => {
    const d: Prefs = { values: {}, group: 'upgrade', sort: { key: 'saving', dir: 'desc' } };
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
      return p ? { values: p.values ?? d.values, group: p.group === 'none' ? 'none' : 'upgrade', sort: p.sort ?? d.sort } : d;
    } catch {
      return d;
    }
  })();
  let values = $state<FacetValues>(prefs.values);
  let group = $state<'upgrade' | 'none'>(prefs.group);
  let sort = $state<SortState<Col>>(prefs.sort);
  let q = $state('');
  $effect(() => {
    const v = JSON.stringify({ values, group, sort });
    try {
      localStorage.setItem(PREFS_KEY, v);
    } catch {
      /* no persistence — fine */
    }
  });

  // Same ship list as the CCU planner (priced hulls), so both pages map CCUs alike.
  const ships = $derived((cat?.ships ?? []).filter((s) => s.msrp > 0));
  const pledges = $derived(hangar?.pledges ?? []);
  const bbItems = $derived(buyback?.items ?? []);
  const owned = $derived(ownedCcus(pledges, bbItems, ships).owned);
  const rows = $derived(ccuRows(owned, ships, pledges, bbItems, chains));
  const facets = $derived(ccuFacets(rows));
  const needle = $derived(q.trim().toLowerCase());
  const filtered = $derived(applyFacets(rows, facets, values, ccuRanges).filter((r) => !needle || `${r.fromName} ${r.toName}`.toLowerCase().includes(needle)));
  const sorted = $derived(
    sortBy(filtered, sort, {
      from: (r) => r.fromName,
      to: (r) => r.toName,
      paid: (r) => r.paid,
      gap: (r) => r.gap,
      saving: (r) => r.saving,
      place: (r) => r.place,
    }),
  );
  const shown = $derived(group === 'upgrade' ? groupCcus(sorted) : sorted.map((r) => ({ key: r.key, rep: r, rows: [r] })));
  const totals = $derived(ccuTotals(filtered));
  const COLS = 8;

  const openUrl = (r: CcuRow) => (r.place === 'hangar' ? hangarUrl(pledges, r.ref) : (r.buyback?.url ?? BUYBACK_PAGE));
  const insuranceOf = (r: CcuRow) => (r.lti ? 'LTI' : r.insurance);
  const exportCsv = () => downloadFile(`rsi-ccus-${dateStamp()}.csv`, ccuCsv(sorted));
</script>

{#snippet hull(s: CcuRow['from'], name: string, msrp: number | null)}
  <div class="flex items-center gap-2">
    <Thumb src={s?.thumb} {name} placeholder="block" />
    <div class="min-w-0">
      <div class="flex items-center gap-0.5 font-medium">{name || '?'}{#if s}<WikiLink class="-my-1" href={wikiUrl(s.name)} name={s.name} />{/if}</div>
      <div class="text-muted-foreground text-xs">{s?.manufacturer ?? 'not in the catalog'}{#if msrp != null} · {usd(msrp)}{/if}</div>
    </div>
  </div>
{/snippet}

<Card.Root>
  <Card.Header>
    <Card.Description>
      Every upgrade you hold — in the hangar and in buyback — with what you paid against the MSRP gap between the two hulls. Read from the saved
      <a class={LINK} href="#hangar">Pledges</a>{#if !hangar}<span class="text-warning"> (not loaded)</span>{/if} and
      <a class={LINK} href="#buyback">Buyback</a>{#if !buyback}<span class="text-warning"> (not loaded)</span>{:else if bbItems.some((b) => b.upgrade && b.price == null)} (load contents & prices there for buyback costs){/if} pages.
    </Card.Description>
    <Card.Action class="flex flex-wrap items-center gap-2">
      <Button variant="outline" href="#ccu"><Route /> Open CCU planner</Button>
      <TipButton variant="outline" disabled={!sorted.length} onclick={exportCsv} tip="Download the rows shown as CSV (one line per CCU)"><Download /> CSV</TipButton>
    </Card.Action>
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
    {#if !hangar && !buyback}
      <Empty>No hangar or buyback read yet. Load your <a class={LINK} href="#hangar">Pledges</a> (and <a class={LINK} href="#buyback">Buyback</a>) first.</Empty>
    {:else if !rows.length}
      <Empty>No CCUs in what was read.{#if !hangar} Pledges not loaded — <a class={LINK} href="#hangar">load them</a>.{/if}{#if !buyback} Buyback not loaded — <a class={LINK} href="#buyback">load it</a>.{/if}</Empty>
    {:else}
      <FacetBar {facets} ranges={ccuRanges} {rows} shown={filtered.length} bind:values primary={['place', 'saving', 'warbond']} hideEmpty>
        <Input class="w-56" placeholder="Search ships" bind:value={q} aria-label="Search CCUs by ship" />
        <Segmented
          size="sm"
          ariaLabel="Group"
          bind:value={group}
          options={[
            { id: 'upgrade', label: 'By upgrade', hint: 'Stack identical upgrades (same place, same from → to) into one row with ×n' },
            { id: 'none', label: 'None', hint: 'One row per CCU' },
          ]}
        />
      </FacetBar>

      <StatGrid layout="divided">
        <Stat value={totals.count} label="CCUs" sub={group === 'upgrade' ? `${shown.length} distinct` : null} />
        <Stat value={ownUsd(totals.paid)} label="Paid" hint="Hangar melt values plus buyback prices that were read (gifted CCUs count $0)" />
        <Stat value={ownUsd(totals.gap)} label="MSRP gap" hint="What the same upgrades cost at today's MSRPs (target − source)" />
        <Stat value={ownUsd(totals.saving)} label="Saving" valueTone={totals.saving > 0 ? 'ok' : totals.saving < 0 ? 'err' : null} hint="MSRP gap − paid" sub={totals.unknown ? `${totals.unknown} unknown left out` : null} />
      </StatGrid>

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <SortTh key="from" bind:sort>From</SortTh>
            <SortTh key="to" bind:sort>→ To</SortTh>
            <SortTh key="paid" bind:sort firstDir="desc" numeric>Paid</SortTh>
            <SortTh key="gap" bind:sort firstDir="desc" numeric>Gap</SortTh>
            <SortTh key="saving" bind:sort firstDir="desc" numeric>Saving</SortTh>
            <SortTh key="place" bind:sort>Place</SortTh>
            <Table.Head>Flags</Table.Head>
            <Table.Head class="text-right"><span class="sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each shown as g (g.key)}
            {@const r = g.rep}
            <Table.Row>
              <Table.Cell>{@render hull(r.from, r.fromName, r.sourceMsrp)}</Table.Cell>
              <Table.Cell>
                <div class="flex flex-wrap items-center gap-1.5">
                  {@render hull(r.to, r.toName, r.targetMsrp)}
                  {#if r.to && /concept/i.test(r.to.flyable)}<Tag kind="stage" value={r.to.flyable} size="xs" />{/if}
                  {#if r.to?.size}<Tag kind="size" value={r.to.size} size="xs" />{/if}
                  {#if g.rows.length > 1}<HintBadge variant="secondary" hint={`${g.rows.length} identical CCUs · paid ${ownUsd(g.rows.reduce((n, x) => n + (x.paid ?? 0), 0))} in all`}>×{g.rows.length}</HintBadge>{/if}
                </div>
              </Table.Cell>
              <Table.Cell class="text-right tabular-nums">
                {#if r.paid != null}{ownUsd(r.paid)}{:else}<HintBadge variant="muted" hint="Buyback price not read yet — use “Load contents & prices” on the Buyback page">?</HintBadge>{/if}
              </Table.Cell>
              <Table.Cell class="text-right tabular-nums">{r.gap != null ? usd(r.gap) : '—'}</Table.Cell>
              <Table.Cell class={cn('text-right tabular-nums', r.saving != null && r.saving > 0 && 'text-success', r.saving != null && r.saving < 0 && 'text-destructive')}>{r.saving != null ? ownUsd(r.saving) : '—'}</Table.Cell>
              <Table.Cell>
                {#if r.place === 'hangar'}<HintBadge variant="success" hint="In your hangar — applying it costs nothing more">hangar</HintBadge>
                {:else}<HintBadge variant="warning" hint="Melted — buy it back to use it">buyback</HintBadge>{/if}
              </Table.Cell>
              <Table.Cell class="whitespace-normal">
                <div class="flex flex-wrap items-center gap-1">
                  {#if r.warbond}<Tag kind="warbond" size="xs" />{/if}
                  {#if insuranceOf(r)}<Tag kind="insurance" value={insuranceOf(r)} size="xs" />{/if}
                  {#if r.giftable}<Tag kind="giftable" size="xs" />{/if}
                  {#if r.gifted}<Tag kind="gifted" size="xs" />{/if}
                  {#if r.meltable}<Tag kind="meltable" size="xs" />{/if}
                  {#if r.chain}<HintBadge variant="info" size="xs" hint={`Used by the saved chain “${r.chain}” in the CCU planner`}>in chain</HintBadge>{/if}
                </div>
              </Table.Cell>
              <Table.Cell class="text-right">
                <div class="flex items-center justify-end gap-1">
                  <TipButton variant="ghost" size="icon-xs" href={openUrl(r)} target="_blank" rel="noopener" tip={r.place === 'hangar' ? 'Open the hangar page holding this pledge' : r.buyback?.url ? 'Open the buy-back page of this CCU' : 'Open your buyback list'} aria-label={r.place === 'hangar' ? 'Open in hangar' : 'Open in buyback'}><ExternalLink /></TipButton>
                  {#if r.to}<TipButton variant="ghost" size="icon-xs" href={`#ccu?to=${r.to.id}`} tip={`Plan a chain to the ${r.to.name} in the CCU planner — your CCUs, this one included, are routed in automatically`} aria-label="Plan from this"><Route /></TipButton>{/if}
                </div>
              </Table.Cell>
            </Table.Row>
          {/each}
          {#if !shown.length}<Empty colspan={COLS}>Nothing matches.</Empty>{/if}
        </Table.Body>
      </Table.Root>
    {/if}
  </Card.Content>
</Card.Root>
