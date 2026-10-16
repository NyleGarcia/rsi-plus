<script lang="ts">
  import { fetchCredits } from '@/lib/account';
  import { ownedCcus } from '@/lib/ccu';
  import { hangarUrl, totals, type BuybackItem, type Credits, type Pledge } from '@/lib/hangar';
  import { buybackItem, catalogItem, fundingItem, hangarItem } from '@/lib/settings';
  import type { CatalogShip } from '@/lib/store';
  import { ccuOverview, fetchFunding, fleetValue, fundingStats, shareOfFunding, spendByPayment, spendByMonth, spendByType, spendByYear, spendSummary, type Funding, type FundingRange } from '@/lib/wallet';
  import { AreaChart, BarChart, PieChart } from 'layerchart';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Wallet from '@lucide/svelte/icons/wallet';
  import CalendarRange from '@lucide/svelte/icons/calendar-range';
  import Banknote from '@lucide/svelte/icons/banknote';
  import Rocket from '@lucide/svelte/icons/rocket';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Check from '@lucide/svelte/icons/check';
  import Flame from '@lucide/svelte/icons/flame';
  import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
  import Pencil from '@lucide/svelte/icons/pencil';
  import WidgetGrid from './WidgetGrid.svelte';
  import { mergeLayout, type WidgetItem, type WidgetSize } from '@/lib/widgets';
  import { Button } from '@/components/ui/button';
  import * as Card from '@/components/ui/card';
  import * as Chart from '@/components/ui/chart';
  import * as Table from '@/components/ui/table';
  import { cn } from '@/lib/utils';
  import Segmented from './Segmented.svelte';
  import Stat from './Stat.svelte';
  import ConciergeCard from './ConciergeCard.svelte';
  import { own, ownMoney } from '@/lib/privacy.svelte';
  import { Badge } from '@/components/ui/badge';
  import type { Snippet } from 'svelte';

  type Saved = NonNullable<Awaited<ReturnType<typeof hangarItem.getValue>>>;
  let hangar = $state<Saved | null>(null);
  let buybacks = $state(0);
  let buybackList = $state<BuybackItem[]>([]);
  let ships = $state<CatalogShip[]>([]);
  let error = $state('');

  // ---- credits ----
  /** Credits read while no hangar is saved yet (nothing to attach them to). */
  let loose = $state<{ credits: Credits; at: number } | null>(null);
  let creditsBusy = $state(false);
  let creditsDebug = $state('');
  const credits = $derived(hangar?.credits ? { credits: hangar.credits, at: hangar.creditsAt ?? 0 } : loose);
  async function refreshCredits() {
    creditsBusy = true;
    error = '';
    try {
      const { credits: c, debug } = await fetchCredits();
      creditsDebug = debug;
      if (!c) return;
      if (hangar) {
        const next = { ...($state.snapshot(hangar) as Saved), credits: c, creditsAt: Date.now() };
        await hangarItem.setValue(JSON.parse(JSON.stringify(next)));
        hangar = next;
      } else loose = { credits: c, at: Date.now() };
    } catch (e) {
      error = `Credits: ${(e as Error).message}`;
    } finally {
      creditsBusy = false;
    }
  }

  // ---- funding (public RSI stats) ----
  let range = $state<FundingRange>('month');
  let cache = $state<Partial<Record<FundingRange, Funding>>>({});
  let fundingBusy = $state(false);
  let fundingError = $state('');
  const funding = $derived(cache[range] ?? null);
  const FRESH = 60 * 60 * 1000;
  let ctrl: AbortController | null = null;
  async function loadFunding(force = false) {
    const have = cache[range];
    if (!force && have && Date.now() - have.at < FRESH) return;
    ctrl?.abort();
    ctrl = new AbortController();
    fundingBusy = true;
    fundingError = '';
    try {
      const f = await fetchFunding(range, ctrl.signal);
      cache = { ...cache, [range]: f };
      await fundingItem.setValue(JSON.parse(JSON.stringify(cache)));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') fundingError = (e as Error).message;
    } finally {
      fundingBusy = false;
    }
  }

  /** Cached funding read from storage — fetch only after, so a stale fetch can't overwrite the cache. */
  let ready = $state(false);
  $effect(() => {
    hangarItem.getValue().then((v) => (hangar = v)).catch((e) => (error = `Couldn't read saved hangar: ${(e as Error).message}`));
    buybackItem.getValue().then((b) => ((buybacks = b?.items.length ?? 0), (buybackList = b?.items ?? []))).catch(() => {});
    catalogItem.getValue().then((c) => (ships = c?.ships ?? [])).catch(() => {});
    fundingItem
      .getValue()
      .then((c) => (cache = c ?? {}))
      .catch(() => {})
      .finally(() => (ready = true));
    const off = hangarItem.watch((v) => (hangar = v));
    return () => (ctrl?.abort(), off());
  });
  $effect(() => {
    if (ready) void loadFunding(); // reads `range` + `cache[range]`; a fresh cache entry returns early
  });

  // ---- personal spend ----
  const all = $derived<Pledge[]>(hangar?.pledges ?? []);
  const sum = $derived(spendSummary(all));
  const tot = $derived(totals(all));
  const byYear = $derived(spendByYear(all));
  let months = $state(24);
  const byMonth = $derived(spendByMonth(all, months));
  const byType = $derived(spendByType(all));
  const byPayment = $derived(spendByPayment(all));
  const payment = $derived(Object.fromEntries(byPayment.map((b) => [b.key, b])) as Partial<Record<string, (typeof byPayment)[number]>>);
  /** New money = warbond + regular cash (store credit and $0 pledges aren't). */
  const newMoney = $derived((payment.warbond?.value ?? 0) + (payment.cash?.value ?? 0));
  const last24 = $derived(spendByMonth(all, 24).map((b) => b.value));
  const prev12 = $derived(last24.slice(0, 12).reduce((a, b) => a + b, 0));
  const this12 = $derived(last24.slice(12).reduce((a, b) => a + b, 0));

  // ---- spend widgets: order + size per viewer (localStorage), rearranged in "Customize" mode ----
  const WIDGETS: WidgetItem[] = [
    { id: 'year', size: 'wide' },
    { id: 'month', size: 'wide' },
    { id: 'payment', size: 'wide' },
    { id: 'type', size: 'wide' },
    { id: 'time', size: 'wide' },
    { id: 'facts', size: 'sm' },
    { id: 'actions', size: 'sm' },
  ];
  const WIDGET_LABELS: Record<string, string> = { year: 'By year', month: 'By month', payment: 'How you paid', type: 'By type', time: 'Backing over time', facts: 'At a glance', actions: 'Quick actions' };
  const LAYOUT_KEY = 'rsiplus:spend:layout';
  const PAY_COLORS: Record<string, string> = { warbond: '#ffb547', cash: 'var(--success)', credit: 'var(--chart-1)', unknown: 'var(--muted-foreground)', free: '#c77dff' };
  const ACTIONS = [
    { href: '#hangar', label: 'Pledges', hint: 'refresh your hangar', icon: Wallet },
    { href: '#melt', label: 'Melt calculator', hint: 'pick what to melt', icon: Flame },
    { href: '#buyback', label: 'Buyback', hint: 'what you can rebuy', icon: ArchiveRestore },
    { href: '#ccu', label: 'CCU planner', hint: 'cheapest upgrade chains', icon: Pencil },
  ];
  let layout = $state<WidgetItem[]>(
    mergeLayout(
      (() => {
        try {
          return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
        } catch {
          return null;
        }
      })(),
      WIDGETS,
    ),
  );
  let editing = $state(false);
  function saveLayout(next: WidgetItem[]) {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* private window: layout just isn't remembered */
    }
  }
  function resetLayout() {
    layout = WIDGETS.map((w) => ({ ...w }));
    try {
      localStorage.removeItem(LAYOUT_KEY);
    } catch {
      /* ignore */
    }
  }
  const share = $derived(funding ? shareOfFunding(sum.value, funding.funds) : 0);
  /** Running total of melt value by month over the whole backing history (for the cumulative line). */
  const cumulative = $derived.by(() => {
    if (!sum.since) return [] as { key: string; label: string; value: number }[];
    const first = new Date(sum.since);
    const span = (new Date().getFullYear() - first.getFullYear()) * 12 + (new Date().getMonth() - first.getMonth()) + 1;
    let acc = 0;
    return spendByMonth(all, Math.max(2, span)).map((b) => ((acc += b.value), { key: b.key, label: b.label, value: Math.round(acc * 100) / 100 }));
  });
  const last12 = $derived(spendByMonth(all, 12).map((b) => b.value));

  // ---- fleet value + CCU portfolio (needs the store catalog for today's prices) ----
  const fleet = $derived(fleetValue(all, ships));
  const ccus = $derived(ccuOverview(ownedCcus(all, buybackList, ships).owned, ships));
  let showFleet = $state(false);
  let showCcus = $state(false);
  const signed = (n: number) => `${n < 0 ? '−' : '+'}${money(Math.abs(n))}`;

  // Your numbers go through ownMoney (screenshare mode → $•••); the public funding figures (big/short) stay readable.
  const money = (n: number) => ownMoney(`$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`);
  const whole = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const money0 = (n: number) => ownMoney(whole(n));
  const big = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : whole(n));
  /** Fits a narrow bar column: $55, $2.3k, $16k. */
  const short = (n: number) => (n >= 1e6 ? big(n) : n >= 1e4 ? `$${Math.round(n / 1e3)}k` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : whole(n));
  const fmtN = (n: number) => ownMoney(`¤${n.toLocaleString('en-US')}`);
  const RANGES: { id: FundingRange; label: string; hint: string }[] = [
    { id: 'day', label: 'Days', hint: 'last 7 days' },
    { id: 'week', label: 'Weeks', hint: 'last 7 weeks' },
    { id: 'month', label: 'Months', hint: 'last 7 months' },
  ];
  const period = $derived(funding?.points.at(-1));
  const prev = $derived(funding?.points.at(-2));
  const delta = $derived(period && prev && prev.usd > 0 ? ((period.usd - prev.usd) / prev.usd) * 100 : null);
  const shown = $derived(funding ? funding.points.reduce((s, p) => s + p.usd, 0) : 0);
  const fstats = $derived(funding ? fundingStats(funding) : null);
  const facts = $derived<[string, string][]>([
    ['Backing since', sum.since ? `${new Date(sum.since).getFullYear()} · ${sum.years} yr` : '—'],
    ['Per year', money0(sum.perYear)],
    ['Pledges', String(sum.pledges)],
    ['Average pledge', sum.pledges ? money0(sum.value / sum.pledges) : '—'],
    ['Ships · LTI', `${tot.ships} · ${tot.lti}`],
    ['In buyback', String(buybacks)],
    ...(funding ? ([['Share of all funding', share ? `${share.toPrecision(2)}%` : '—']] as [string, string][]) : []),
  ]);

  // ---- charts (LayerChart) ----
  /** One bar: `key` is unique (x domain), `label` is what the axis shows, `last` = running period (yellow). */
  interface BarPoint {
    key: string;
    label: string;
    value: number;
    hint?: string;
    last?: boolean;
  }
  interface Slice {
    key: string;
    label: string;
    value: number;
    count: number;
  }
  const barConfig = {
    value: { label: 'Value', color: 'var(--chart-1)' },
    running: { label: 'Running', color: 'var(--chart-2)' },
  } satisfies Chart.ChartConfig;
  const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', '#fb8500', '#8ecae6', '#c77dff', '#ffafcc', '#b5e48c'];
  const plural = (n: number) => `${n} pledge${n === 1 ? '' : 's'}`;
  const yearBars = $derived<BarPoint[]>(byYear.map((b) => ({ key: b.key, label: b.label, value: b.value, hint: plural(b.count) })));
  const monthBars = $derived<BarPoint[]>(byMonth.map((b) => ({ key: b.key, label: months > 12 ? (b.key.endsWith('-01') ? b.key.slice(0, 4) : b.label) : b.label, value: b.value, hint: `${b.key} · ${plural(b.count)}` })));
  const fundingBars = $derived<BarPoint[]>(funding ? funding.points.map((p, i, a) => ({ key: p.key, label: p.label, value: p.usd, hint: p.key, last: i === a.length - 1 })) : []);
  const typeSlices = $derived<Slice[]>(byType.map((b) => ({ key: b.key, label: b.label, value: b.value, count: b.count })));
  const paymentSlices = $derived<Slice[]>(byPayment.map((b) => ({ key: b.key, label: b.label, value: b.value, count: b.count })));
  /** Running total as dated points for the big area chart. */
  const cumulativeDated = $derived(cumulative.map((c) => ({ date: new Date(Number(c.key.slice(0, 4)), Number(c.key.slice(5, 7)) - 1, 1), key: c.key, value: c.value })));
  /** Hovered donut slice per chart (legend row or arc): the others dim, the centre shows its share. */
  let hot = $state<Record<string, string | null>>({});
  /** Sparkline colour: fixed tone, or trend (last vs first) when `auto`. */
  const sparkColor = (values: number[], tone: 'auto' | 'accent' | 'muted') =>
    tone === 'accent' ? 'var(--chart-1)' : tone === 'muted' ? 'var(--muted-foreground)' : (values.at(-1) ?? 0) >= (values[0] ?? 0) ? 'var(--success)' : '#ffb547';
</script>

{#snippet bars(points: BarPoint[], fmt: (n: number) => string, height: number, seriesLabel: string)}
  {#if !points.length || Math.max(0, ...points.map((p) => p.value)) <= 0}
    <div class="text-muted-foreground py-3 text-xs">No data for this range.</div>
  {:else}
    {@const byKey = new Map(points.map((p) => [p.key, p]))}
    <Chart.Container config={barConfig} class="aspect-auto w-full" style={height ? `height:${height}px` : 'height:100%'} role="img" aria-label={points.map((p) => `${p.label}: ${fmt(p.value)}`).join(', ')}>
      <BarChart
        data={points}
        x="key"
        series={[{ key: 'value', label: seriesLabel, value: 'value', color: 'var(--color-value)' }]}
        padding={{ top: 18, right: 6, bottom: 22, left: 44 }}
        grid={{ x: false, y: true }}
        labels={{ placement: 'outside', occlude: true, format: (n: number) => (n > 0 ? fmt(n) : ''), class: 'text-[10px] font-semibold' }}
        props={{
          // Bar's `fill` takes a per-datum accessor at runtime (resolveColorProp); Bars' prop type only says string.
          bars: { fill: ((d: BarPoint) => (d.last ? 'var(--color-running)' : 'var(--color-value)')) as unknown as string, radius: 3 },
          xAxis: { format: (k: string) => byKey.get(k)?.label ?? k, tickOcclusion: { priority: 'end' } },
          yAxis: { format: (n: number) => (n ? fmt(n) : '0'), ticks: 4 },
        }}
      >
        {#snippet tooltip()}
          <Chart.Tooltip
            labelFormatter={(k: string) => {
              const p = byKey.get(k);
              return p ? `${p.label}${p.hint ? ` · ${p.hint}` : ''}` : k;
            }}
          >
            {#snippet formatter({ value, name })}
              <div class="flex w-full items-center justify-between gap-3">
                <span class="text-muted-foreground">{name}</span>
                <span class="text-foreground font-mono font-medium tabular-nums">{fmt(Number(value))}</span>
              </div>
            {/snippet}
          </Chart.Tooltip>
        {/snippet}
      </BarChart>
    </Chart.Container>
  {/if}
{/snippet}

{#snippet donut(id: string, slices: Slice[], fmt: (n: number) => string, colors: Record<string, string> = {})}
  {@const color = (s: Slice, i: number) => colors[s.key] ?? PALETTE[i % PALETTE.length]}
  {@const total = slices.reduce((s, x) => s + x.value, 0)}
  {#if !slices.length || total <= 0}
    <div class="text-muted-foreground py-3 text-xs">Nothing to chart.</div>
  {:else}
    {@const pct = (v: number) => `${((100 * v) / total).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`}
    {@const on = hot[id] ?? null}
    {@const cur = slices.find((s) => s.key === on)}
    {@const data = slices.map((s, i) => ({
      ...s,
      props: {
        fill: color(s, i),
        opacity: on == null || on === s.key ? 1 : 0.35,
        onpointerenter: () => (hot[id] = s.key),
        onpointerleave: () => (hot[id] = null),
      },
    }))}
    <div class="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div class="relative size-[124px] shrink-0">
        <Chart.Container config={{}} class="aspect-square size-full" role="img" aria-label={slices.map((s) => `${s.label} ${pct(s.value)}`).join(', ')}>
          <PieChart {data} key="key" label="label" value="value" innerRadius={0.68} padAngle={0.015} cornerRadius={2}>
            {#snippet tooltip()}
              <Chart.Tooltip hideLabel>
                {#snippet formatter()}
                  {#if cur}
                    <div class="grid gap-0.5">
                      <span class="font-medium capitalize">{cur.label}</span>
                      <span class="text-muted-foreground">{fmt(cur.value)} · {pct(cur.value)} · {plural(cur.count)}</span>
                    </div>
                  {/if}
                {/snippet}
              </Chart.Tooltip>
            {/snippet}
          </PieChart>
        </Chart.Container>
        <div class="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <strong class="text-sm font-bold tabular-nums">{cur ? pct(cur.value) : fmt(total)}</strong>
          {#if cur}<span class="text-muted-foreground max-w-20 truncate text-[10px] capitalize">{cur.label}</span>{/if}
        </div>
      </div>
      <ul class="grid max-w-[380px] min-w-[180px] flex-1 gap-1 text-xs" onmouseleave={() => (hot[id] = null)}>
        {#each slices as s, i (s.key)}
          <li class={cn('transition-opacity', on != null && on !== s.key && 'opacity-45')}>
            <button
              type="button"
              class="hover:bg-muted/60 focus-visible:bg-muted/60 -mx-1.5 grid w-[calc(100%+0.75rem)] cursor-default grid-cols-[10px_1fr_auto_auto] items-center gap-2 rounded-md px-1.5 py-0.5 text-left outline-none"
              title={plural(s.count)}
              aria-label={`${s.label}: ${fmt(s.value)} (${pct(s.value)})`}
              onmouseenter={() => (hot[id] = s.key)}
              onfocus={() => (hot[id] = s.key)}
              onblur={() => (hot[id] = null)}
            >
              <i class="size-2.5 rounded-[3px]" style={`background:${color(s, i)}`}></i>
              <span class="truncate capitalize">{s.label}</span>
              <span class="text-muted-foreground tabular-nums">{fmt(s.value)}</span>
              <span class="text-muted-foreground min-w-[42px] text-right tabular-nums">{pct(s.value)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

{#snippet hero(Icon: typeof Wallet, title: string, value: string, sub: string, change: { pct: number; against: string } | null, trend: number[], tone: 'auto' | 'accent' | 'muted')}
  <Card.Root class="gap-0 overflow-hidden rounded-xl py-0 shadow-none">
    <div class="flex items-start justify-between gap-3 px-4 pt-4">
      <div class="grid min-w-0 gap-1">
        <span class="text-muted-foreground text-xs font-medium">{title}</span>
        <strong class="text-2xl leading-none font-semibold tracking-tight tabular-nums">{value}</strong>
      </div>
      <span class="bg-primary/10 text-primary inline-flex size-9 shrink-0 items-center justify-center rounded-lg"><Icon class="size-[18px]" /></span>
    </div>
    <div class="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-2 pb-3 text-xs">
      {#if change}
        <Badge variant="secondary" class={cn('h-5 px-1.5 text-[11px] font-semibold tabular-nums', change.pct >= 0 ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive')}>
          <span aria-hidden="true">{change.pct >= 0 ? '↑' : '↓'}</span>{Math.abs(change.pct).toFixed(0)}%<span class="sr-only"> {change.against}</span>
        </Badge>
      {/if}
      <span class="text-muted-foreground truncate">{sub}</span>
    </div>
    {#if trend.length > 1}<div class="-mt-1 px-1 pb-1">{@render spark(trend, tone)}</div>{/if}
  </Card.Root>
{/snippet}

{#snippet panel(title: string, sub: string, body: Snippet, aside?: Snippet)}
  <Card.Root class="flex h-full min-w-0 flex-col gap-2 overflow-hidden rounded-xl py-3.5 shadow-none">
    <div class="flex min-h-7 flex-wrap items-start justify-between gap-2 px-4">
      <div class="grid min-w-0 gap-0.5">
        <h3 class="text-sm leading-none font-semibold">{title}</h3>
        {#if sub}<span class="text-muted-foreground truncate text-[11.5px]">{sub}</span>{/if}
      </div>
      {#if aside}{@render aside()}{/if}
    </div>
    <div class="relative min-h-0 flex-1 px-4">{@render body()}</div>
  </Card.Root>
{/snippet}

{#snippet fill(content: Snippet)}
  <div class="absolute inset-0 px-2">{@render content()}</div>
{/snippet}

{#snippet tile(id: string, size: WidgetSize)}
  {#if id === 'year'}
    {#snippet b()}{@render fill(yearChart)}{/snippet}
    {@render panel('By year', 'melt value per year pledged', b)}
  {:else if id === 'month'}
    {#snippet b()}{@render fill(monthChart)}{/snippet}
    {#snippet a()}<Segmented options={[12, 24, 36].map((m) => ({ id: m, label: String(m) }))} bind:value={months} ariaLabel="Months shown" size="sm" />{/snippet}
    {@render panel('By month', `last ${months} months`, b, a)}
  {:else if id === 'time'}
    {#snippet b()}{@render fill(timeChart)}{/snippet}
    {@render panel('Backing over time', 'running total since your first pledge', b)}
  {:else if id === 'type'}
    {#snippet b()}<div class="h-full overflow-auto">{@render donut('type', typeSlices, money0)}</div>{/snippet}
    {@render panel('By type', `${byType.length} kinds of pledge`, b)}
  {:else if id === 'payment'}
    {#snippet b()}<div class="sens h-full overflow-auto">{@render donut('payment', paymentSlices, money0, PAY_COLORS)}</div>{/snippet}
    {@render panel('How you paid', 'warbond and cash are new money; store credit is recycled', b)}
  {:else if id === 'facts'}
    {#snippet b()}
      <dl class="grid h-full content-start gap-1.5 overflow-auto text-xs">
        {#each facts as [k, v] (k)}
          <div class="flex items-baseline justify-between gap-3 border-b border-dashed pb-1.5 last:border-0">
            <dt class="text-muted-foreground truncate">{k}</dt>
            <dd class="font-medium tabular-nums">{v}</dd>
          </div>
        {/each}
      </dl>
    {/snippet}
    {@render panel('At a glance', '', b)}
  {:else if id === 'actions'}
    {#snippet b()}
      <div class={cn('grid h-full content-start gap-1.5 overflow-auto', size !== 'sm' && size !== 'tall' && 'grid-cols-2')}>
        {#each ACTIONS as act (act.href)}
          <a href={act.href} class="hover:bg-muted/60 group/act flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-xs transition-colors">
            <span class="bg-muted text-muted-foreground group-hover/act:text-primary inline-flex size-7 shrink-0 items-center justify-center rounded-md"><act.icon class="size-3.5" /></span>
            <span class="grid min-w-0"><strong class="truncate font-medium">{act.label}</strong><span class="text-muted-foreground truncate text-[11px]">{act.hint}</span></span>
          </a>
        {/each}
      </div>
    {/snippet}
    {@render panel('Quick actions', '', b)}
  {/if}
{/snippet}

{#snippet yearChart()}<div class="sens h-full">{@render bars(yearBars, short, 0, 'Melt value')}</div>{/snippet}
{#snippet monthChart()}<div class="sens h-full">{@render bars(monthBars, short, 0, 'Melt value')}</div>{/snippet}
{#snippet timeChart()}
  {#if cumulativeDated.length > 1}
    <Chart.Container config={{ value: { label: 'Running total', color: 'var(--chart-1)' } }} class="sens aspect-auto h-full w-full">
      <AreaChart
        data={cumulativeDated}
        x="date"
        series={[{ key: 'value', label: 'Running total', value: 'value', color: 'var(--color-value)' }]}
        padding={{ top: 8, right: 8, bottom: 20, left: 44 }}
        grid={{ x: false, y: true }}
        props={{
          area: { fillOpacity: 0.25, line: { strokeWidth: 2 } },
          xAxis: { format: (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), ticks: 6, tickOcclusion: true },
          yAxis: { format: (n: number) => (n ? short(n) : '0'), ticks: 3 },
        }}
      >
        {#snippet tooltip()}
          <Chart.Tooltip labelFormatter={(d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} indicator="line">
            {#snippet formatter({ value, name })}
              <div class="flex w-full items-center justify-between gap-3">
                <span class="text-muted-foreground">{name}</span>
                <span class="text-foreground font-mono font-medium tabular-nums">{money0(Number(value))}</span>
              </div>
            {/snippet}
          </Chart.Tooltip>
        {/snippet}
      </AreaChart>
    </Chart.Container>
  {/if}
{/snippet}

{#snippet spark(values: number[], tone: 'auto' | 'accent' | 'muted')}
  {#if values.length > 1}
    <Chart.Container config={{}} class="aspect-auto h-7 w-full" aria-hidden="true">
      <AreaChart
        data={values.map((v, i) => ({ i, v }))}
        x="i"
        series={[{ key: 'v', value: 'v', color: sparkColor(values, tone) }]}
        axis={false}
        grid={false}
        rule={false}
        highlight={false}
        tooltipContext={false}
        padding={{ top: 3, right: 3, bottom: 3, left: 3 }}
        props={{ area: { fillOpacity: 0.22, line: { strokeWidth: 1.5 } } }}
      />
    </Chart.Container>
  {:else}
    <div class="h-7"></div>
  {/if}
{/snippet}

<div class="grid gap-4">
  <Card.Root>
    <Card.Header>
      <Card.Title>Wallet</Card.Title>
      <Card.Description>
        {#if credits}Credits as of {new Date(credits.at).toLocaleString()}{#if !hangar} · saved once you load the hangar{/if}
        {:else}Store credit, UEC and REC from your RSI account (one request to /account/billing — stays in this browser).{/if}
      </Card.Description>
      <Card.Action class="flex flex-wrap items-center gap-2">
        <Button variant={credits ? 'outline' : 'default'} disabled={creditsBusy} onclick={refreshCredits}>{creditsBusy ? '…' : credits ? 'Refresh credits' : 'Read credits'}</Button>
        <Button variant="outline" href="https://robertsspaceindustries.com/account/billing" target="_blank" rel="noopener">Billing <ExternalLink /></Button>
      </Card.Action>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if error}<span class="text-destructive text-sm">{error}</span>{/if}
      {#if creditsDebug}<div class="text-muted-foreground text-xs"><strong class="text-foreground">Credits box not found on any account page.</strong> Open <a class="text-primary hover:underline" href="https://robertsspaceindustries.com/account/billing" target="_blank" rel="noopener">Billing</a> once with the extension on and it's picked up from there. Details: {creditsDebug}</div>{/if}
      <div class="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
        <Stat tone="credit" value={credits ? money(credits.credits.usd) : '—'} label="store credit" />
        <Stat tone="credit" value={credits ? fmtN(credits.credits.uec) : '—'} label="UEC" />
        <Stat tone="credit" value={credits ? fmtN(credits.credits.rec) : '—'} label="REC" />
        <Stat value={money(sum.value)} label="hangar melt value" />
        {#if credits}<Stat value={money(credits.credits.usd + sum.value)} label="credit if you melted everything" />{/if}
      </div>
      <ConciergeCard />
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Your spend</Card.Title>
      <Card.Description class="text-xs">
        {#if all.length}
          Melt value of what's in your hangar by the pledge's <em>Created</em> date — not cash paid: CCU chains, discounts, gifts received and melted pledges aren't in it.
        {:else}
          Load your hangar on the <a class="text-primary hover:underline" href="#hangar">Pledges</a> page first.
        {/if}
      </Card.Description>
      {#if all.length}
        <Card.Action class="flex flex-wrap items-center gap-2">
          {#if editing}
            <Button variant="ghost" size="sm" onclick={resetLayout}><RotateCcw /> Reset</Button>
            <Button size="sm" onclick={() => (editing = false)}><Check /> Done</Button>
          {:else}
            <Button variant="outline" size="sm" onclick={() => (editing = true)}><LayoutDashboard /> Customize</Button>
          {/if}
        </Card.Action>
      {/if}
    </Card.Header>
    {#if all.length}
      <Card.Content class="grid gap-4">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {@render hero(Wallet, 'Hangar melt value', money(sum.value), `${sum.pledges} pledges · since ${sum.since ? new Date(sum.since).getFullYear() : '—'}`, null, cumulative.map((c) => c.value), 'accent')}
          {@render hero(
            CalendarRange,
            'Last 12 months',
            money0(this12),
            `${money0(sum.perYear)} a year on average`,
            prev12 > 0 ? { pct: ((this12 - prev12) / prev12) * 100, against: 'vs the 12 months before' } : null,
            last12,
            'auto',
          )}
          {@render hero(
            Banknote,
            'New money',
            money0(newMoney),
            sum.payKnown ? `${sum.value ? Math.round((100 * newMoney) / sum.value) : 0}% · warbond + cash` : 'warbond only · refresh Pledges',
            null,
            [],
            'muted',
          )}
          {@render hero(Rocket, 'Ships', String(tot.ships), `${tot.lti} with LTI · ${buybacks} in buyback`, null, [], 'muted')}
        </div>
        {#if !sum.payKnown || sum.payKnown < sum.pledges - (payment.free?.count ?? 0)}
          <div class="border-warning/30 bg-warning/5 text-muted-foreground rounded-lg border px-3 py-2 text-xs">
            <strong class="text-foreground">{sum.payKnown ? `${payment.unknown?.count ?? 0} pledges` : 'Your saved pledges'} don't say how they were paid.</strong>
            RSI shows cash vs store credit per pledge; your save predates RSI+ reading it. Refresh on the <a class="text-primary hover:underline" href="#hangar">Pledges</a> page to fill in <em>How you paid</em>.
          </div>
        {/if}
        <WidgetGrid bind:items={layout} editable={editing} labels={WIDGET_LABELS} onchange={saveLayout}>
          {#snippet widget(id: string, size: WidgetSize)}
            {@render tile(id, size)}
          {/snippet}
        </WidgetGrid>
      </Card.Content>
    {/if}
  </Card.Root>

  {#if all.length && ships.length}
    <Card.Root>
      <Card.Header>
        <Card.Title>Fleet at today's prices</Card.Title>
        <Card.Description class="text-xs">
          Single-ship pledges matched to the store catalog: melt value (what RSI credits you) vs the ship's current MSRP. Price rises since you pledged show as a gain.
          {#if fleet.packs} {fleet.packs} multi-ship pack{fleet.packs === 1 ? '' : 's'} not split.{/if}
        </Card.Description>
        {#if fleet.rows.length}
          <Card.Action><Button variant="outline" size="sm" onclick={() => (showFleet = !showFleet)}>{showFleet ? 'Hide ships' : `Show ${fleet.rows.length} ships`}</Button></Card.Action>
        {/if}
      </Card.Header>
      <Card.Content class="grid gap-3">
        {#if !fleet.rows.length}
          <span class="text-muted-foreground">No single-ship pledge matched a store ship{ships.length ? '' : ' — open Ships for sale once to load the catalog'}.</span>
        {:else}
          <div class="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
            <Stat value={money(fleet.paid)} label={`melt value · ${fleet.rows.length} ships`} />
            <Stat value={money(fleet.msrp)} label="at today's MSRP" />
            <Stat
              value={signed(fleet.msrp - fleet.paid)}
              valueTone={fleet.msrp > fleet.paid ? 'ok' : fleet.msrp < fleet.paid ? 'warn' : null}
              label="price change since you pledged"
              delta={fleet.paid ? { text: `${fleet.msrp >= fleet.paid ? '▲' : '▼'} ${Math.abs((100 * (fleet.msrp - fleet.paid)) / fleet.paid).toFixed(0)}% vs melt`, tone: fleet.msrp > fleet.paid ? 'up' : fleet.msrp < fleet.paid ? 'down' : 'neutral' } : null}
            />
          </div>
          {#if showFleet}
            <Table.Root>
              <Table.Header>
                <Table.Row><Table.Head>Ship</Table.Head><Table.Head>Pledge</Table.Head><Table.Head>Melt</Table.Head><Table.Head>MSRP now</Table.Head><Table.Head>Δ</Table.Head></Table.Row>
              </Table.Header>
              <Table.Body>
                {#each fleet.rows as r (r.pledgeId)}
                  <Table.Row>
                    <Table.Cell><strong>{r.ship}</strong></Table.Cell>
                    <Table.Cell class="text-muted-foreground text-xs"><a class="hover:text-primary hover:underline" href={hangarUrl(all, r.pledgeId)} target="_blank" rel="noopener">{r.pledge}</a></Table.Cell>
                    <Table.Cell class="tabular-nums">{money(r.paid)}</Table.Cell>
                    <Table.Cell class="tabular-nums">{money(r.msrp)}</Table.Cell>
                    <Table.Cell class={cn('tabular-nums', r.msrp > r.paid && 'text-success', r.msrp < r.paid && 'text-warning')}>{signed(r.msrp - r.paid)}</Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {/if}
        {/if}
      </Card.Content>
    </Card.Root>

    {#if ccus.count}
      <Card.Root>
        <Card.Header>
          <Card.Title>CCU portfolio</Card.Title>
          <Card.Description class="text-xs">Upgrades in your hangar: what you paid (melt value) vs what the same upgrade is worth at today's MSRP gap. Gifted CCUs have no melt value. Plan chains on the <a class="text-primary hover:underline" href="#ccu">CCU planner</a> tab.</Card.Description>
          <Card.Action><Button variant="outline" size="sm" onclick={() => (showCcus = !showCcus)}>{showCcus ? 'Hide CCUs' : `Show ${ccus.count} CCUs`}</Button></Card.Action>
        </Card.Header>
        <Card.Content class="grid gap-3">
          <div class="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
            <Stat value={ccus.count} label={`CCUs · ${ccus.gifted} gifted`} />
            <Stat value={money(ccus.paid)} label="paid (melt value)" />
            <Stat value={money(ccus.worth)} label="worth at today's prices" />
            <Stat
              value={signed(ccus.gain)}
              valueTone={ccus.gain > 0 ? 'ok' : ccus.gain < 0 ? 'warn' : null}
              label="unrealised gain"
              delta={{ text: `${ccus.winners} winner${ccus.winners === 1 ? '' : 's'}`, tone: ccus.winners > 0 ? 'up' : 'neutral' }}
            />
          </div>
          {#if showCcus}
            <Table.Root>
              <Table.Header>
                <Table.Row><Table.Head>CCU</Table.Head><Table.Head>Paid</Table.Head><Table.Head>Worth</Table.Head><Table.Head>Gain</Table.Head></Table.Row>
              </Table.Header>
              <Table.Body>
                {#each ccus.rows as r (r.ref)}
                  <Table.Row>
                    <Table.Cell><span class="text-muted-foreground">{r.from} →</span> <strong>{r.to}</strong> <a class="text-muted-foreground hover:text-primary text-xs hover:underline" href={hangarUrl(all, r.ref)} target="_blank" rel="noopener">#{r.ref}</a></Table.Cell>
                    <Table.Cell class="tabular-nums">{r.paid ? money(r.paid) : 'gift'}</Table.Cell>
                    <Table.Cell class="tabular-nums">{money(r.worth)}</Table.Cell>
                    <Table.Cell class={cn('tabular-nums', r.gain > 0 && 'text-success', r.gain < 0 && 'text-warning')}>{r.paid ? signed(r.gain) : '—'}</Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>Star Citizen funding</Card.Title>
      <Card.Description class="text-xs">
        RSI's public crowdfund counter (the numbers behind the old funding page).
        {#if funding} Updated {new Date(funding.at).toLocaleString()}.{/if}
      </Card.Description>
      <Card.Action class="flex flex-wrap items-center gap-2">
        <Segmented options={RANGES} bind:value={range} ariaLabel="Funding range" size="sm" />
        <Button variant="outline" disabled={fundingBusy} onclick={() => loadFunding(true)}>{fundingBusy ? '…' : 'Refresh'}</Button>
      </Card.Action>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if fundingError}<span class="text-destructive text-sm">Funding: {fundingError}</span>{/if}
      {#if funding}
        <div class="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
          <Stat value={big(funding.funds)} label="raised to date" />
          <Stat value={funding.fans.toLocaleString('en-US')} label="citizens" />
          <Stat value={funding.fans ? money0(funding.funds / funding.fans) : '—'} label="per citizen" />
          {#if period}
            <Stat value={big(period.usd)} label={`this ${range}`} delta={delta != null ? { text: `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}% vs last`, tone: delta >= 0 ? 'up' : 'down' } : null}>
              {@render spark(funding.points.map((p) => p.usd), 'auto')}
            </Stat>
          {/if}
          <Stat value={big(shown)} label={`last ${funding.points.length} ${range}s`} />
          {#if fstats?.average}<Stat value={big(fstats.average)} label={`average per ${range}`} />{/if}
          {#if fstats?.best}<Stat value={big(fstats.best.usd)} label={`best ${range} shown · ${fstats.best.key}`} />{/if}
          {#if fstats?.projected && period}<Stat value={big(fstats.projected)} valueTone={fstats.projected > fstats.average ? 'ok' : fstats.average > 0 && fstats.projected < fstats.average ? 'warn' : null} label={`this ${range} on pace for`} />{/if}
          {#if all.length && funding.fans}<Stat value={own(`${(sum.value / (funding.funds / funding.fans)).toFixed(1)}×`)} label="you vs the average citizen" />{/if}
        </div>
        <Card.Root size="sm" class="min-w-0 shadow-none">
          <Card.Content>{@render bars(fundingBars, big, 220, 'Pledged')}</Card.Content>
        </Card.Root>
        <span class="text-muted-foreground text-xs">The current {range} is still running (yellow). Gross pledges before melts.</span>
      {:else if fundingBusy}
        <div class="text-muted-foreground">Loading…</div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
