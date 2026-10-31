<script lang="ts">
  import { fetchCredits } from '@/lib/account';
  import { ownedCcus } from '@/lib/ccu';
  import { hangarUrl, totals, type BuybackItem, type Credits, type Pledge } from '@/lib/hangar';
  import { buybackItem, catalogItem, fundingItem, hangarItem, ordersItem } from '@/lib/settings';
  import { r2, usd0 } from '@/lib/money';
  import { displayCurrency, fmtUsdCompact } from '@/lib/currency';
  import { fmtDateTime } from '@/lib/dates';
  import { LINK } from '@/lib/ui';
  import { captureBilling, fetchOrders, orderSlices, ordersByMonth, ordersByYear, ordersCumulative, orderTotals, warbondInOrders, type Order, type SubPayment } from '@/lib/orders';
  import type { CatalogShip } from '@/lib/store';
  import { ccuOverview, fetchFunding, fleetValue, fundingStats, shareOfFunding, spendByPayment, spendByMonth, spendByType, spendByYear, spendLedger, spendSummary, type Funding, type FundingRange } from '@/lib/wallet';
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
  import StatGrid from './StatGrid.svelte';
  import Empty from './Empty.svelte';
  import Section from './Section.svelte';
  import TipButton from './TipButton.svelte';
  import * as Alert from '@/components/ui/alert';
  import { own, ownDollars, ownMoney } from '@/lib/privacy.svelte';
  import type { Snippet } from 'svelte';

  type Saved = NonNullable<Awaited<ReturnType<typeof hangarItem.getValue>>>;
  let hangar = $state<Saved | null>(null);
  let buybacks = $state(0);
  let buybackList = $state<BuybackItem[]>([]);
  // ---- where the money went: hangar ledger + imported order history ----
  let orders = $state<{ at: number; orders: Order[]; subs?: SubPayment[]; pages: number } | null>(null);
  let ordersBusy = $state(false);
  let ordersMsg = $state('');
  $effect(() => {
    ordersItem.getValue().then((o) => (orders = o));
  });
  let months = $state(24);
  const orderSums = $derived(orders ? orderTotals(orders.orders) : null);
  // ---- basis: the hangar (melt value of what you hold) or the order history (what RSI charged) drives the heroes + charts ----
  type Basis = 'orders' | 'hangar';
  const BASIS_KEY = 'rsiplus:spend:basis';
  let basisPick = $state<Basis>(
    (() => {
      try {
        return (localStorage.getItem(BASIS_KEY) as Basis) || 'orders';
      } catch {
        return 'orders';
      }
    })(),
  );
  const setBasis = (b: Basis) => {
    basisPick = b;
    try {
      localStorage.setItem(BASIS_KEY, b);
    } catch {
      /* not remembered */
    }
  };
  /** Orders only count once imported. */
  const useOrders = $derived(basisPick === 'orders' && !!orders?.orders.length);
  const orderList = $derived<Order[]>(orders?.orders ?? []);
  const oYear = $derived(ordersByYear(orderList));
  const oMonth = $derived(ordersByMonth(orderList, months));
  const oCum = $derived(ordersCumulative(orderList));
  const oLast24 = $derived(ordersByMonth(orderList, 24).map((b) => b.cash));
  const oPrev12 = $derived(oLast24.slice(0, 12).reduce((a, b) => a + b, 0));
  const oThis12 = $derived(oLast24.slice(12).reduce((a, b) => a + b, 0));
  const oFirst = $derived(orderList.reduce((t, o) => Math.min(t, o.at), Infinity));
  const oWarbond = $derived(orderList.length ? warbondInOrders(orderList) : null);
  async function importOrders() {
    ordersBusy = true;
    ordersMsg = '';
    try {
      const r = await fetchOrders();
      if (r.orders.length) {
        orders = { at: Date.now(), orders: r.orders, subs: r.subs, pages: r.pages };
        await ordersItem.setValue($state.snapshot(orders));
        ordersMsg = `${r.orders.length} orders from ${r.pages} page${r.pages === 1 ? '' : 's'}${r.subs.length ? ` · ${r.subs.length} subscription payments` : ''}${r.debug ? ` · ${r.debug}` : ''}`;
      } else ordersMsg = `No orders found${r.debug ? ` — ${r.debug}` : ''}. If Billing shows orders, RSI changed the page: copy the markup and send it over.`;
    } catch (e) {
      ordersMsg = `Could not read /account/billing: ${(e as Error).message}`;
    } finally {
      ordersBusy = false;
    }
  }
  async function copyBilling() {
    try {
      ordersMsg = await captureBilling();
    } catch (e) {
      ordersMsg = `could not copy: ${(e as Error).message}`;
    }
  }
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
  const ledger = $derived(spendLedger(all, buybackList));
  const sum = $derived(spendSummary(all));
  const tot = $derived(totals(all));
  const byYear = $derived(spendByYear(all));
  const byMonth = $derived(spendByMonth(all, months));
  const byType = $derived(spendByType(all));
  const byPayment = $derived(spendByPayment(all));
  const payment = $derived(Object.fromEntries(byPayment.map((b) => [b.key, b])) as Partial<Record<string, (typeof byPayment)[number]>>);
  /** New money = warbond + regular cash (store credit and $0 pledges aren't). */
  const warbond = $derived(payment.warbond?.value ?? 0);
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
    { id: 'ledger', size: 'wide' },
    { id: 'orders', size: 'wide' },
    { id: 'facts', size: 'sm' },
    { id: 'actions', size: 'sm' },
  ];
  const WIDGET_LABELS: Record<string, string> = { year: 'By year', month: 'By month', payment: 'How you paid', type: 'By type', time: 'Backing over time', ledger: 'Where the money went', orders: 'Order history', facts: 'At a glance', actions: 'Quick actions' };
  const LAYOUT_KEY = 'rsiplus:spend:layout';
  const PAY_COLORS: Record<string, string> = { warbond: 'var(--accent-2)', standard: 'var(--chart-1)', free: 'var(--chart-8)', cash: 'var(--accent-2)', credit: 'var(--chart-1)' };
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
    return spendByMonth(all, Math.max(2, span)).map((b) => ((acc += b.value), { key: b.key, label: b.label, value: r2(acc) }));
  });
  const last12 = $derived(spendByMonth(all, 12).map((b) => b.value));

  // ---- fleet value + CCU portfolio (needs the store catalog for today's prices) ----
  const fleet = $derived(fleetValue(all, ships));
  const ccus = $derived(ccuOverview(ownedCcus(all, buybackList, ships).owned, ships));
  // Your numbers go through ownDollars / ownMoney (screenshare mode → $•••); the public funding figures (big/short) stay readable.
  const money = ownDollars;
  const signed = (n: number) => `${n < 0 ? '−' : '+'}${money(Math.abs(n))}`;
  const money0 = (n: number) => ownMoney(usd0(n));
  const big = (n: number) => (displayCurrency() !== 'USD' ? (n >= 1e6 ? fmtUsdCompact(n) : usd0(n)) : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : usd0(n));
  /** Fits a narrow bar column: $55, $2.3k, $16k. */
  const short = (n: number) => (displayCurrency() !== 'USD' ? (n >= 1e3 ? fmtUsdCompact(n) : usd0(n)) : n >= 1e6 ? big(n) : n >= 1e4 ? `$${Math.round(n / 1e3)}k` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : usd0(n));
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
  const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)', 'var(--chart-9)', 'var(--chart-10)'];
  const plural = (n: number) => `${n} pledge${n === 1 ? '' : 's'}`;
  const orderHint = (b: { credits: number; count: number }) => `${b.count} order${b.count === 1 ? '' : 's'}${b.credits ? ` · +${money0(b.credits)} store credit` : ''}`;
  const yearBars = $derived<BarPoint[]>(useOrders ? oYear.map((b) => ({ key: b.key, label: b.label, value: b.cash, hint: orderHint(b) })) : byYear.map((b) => ({ key: b.key, label: b.label, value: b.value, hint: plural(b.count) })));
  const monthLabel = (b: { key: string; label: string }) => (months > 12 ? (b.key.endsWith('-01') ? b.key.slice(0, 4) : b.label) : b.label);
  const monthBars = $derived<BarPoint[]>(
    useOrders ? oMonth.map((b) => ({ key: b.key, label: monthLabel(b), value: b.cash, hint: `${b.key} · ${orderHint(b)}` })) : byMonth.map((b) => ({ key: b.key, label: monthLabel(b), value: b.value, hint: `${b.key} · ${plural(b.count)}` })),
  );
  const fundingBars = $derived<BarPoint[]>(funding ? funding.points.map((p, i, a) => ({ key: p.key, label: p.label, value: p.usd, hint: p.key, last: i === a.length - 1 })) : []);
  const typeSlices = $derived<Slice[]>(byType.map((b) => ({ key: b.key, label: b.label, value: b.value, count: b.count })));
  const paymentSlices = $derived<Slice[]>(useOrders ? orderSlices(orderList) : byPayment.map((b) => ({ key: b.key, label: b.label, value: b.value, count: b.count })));
  /** Running total as dated points for the big area chart. */
  const cumulativeDated = $derived((useOrders ? oCum : cumulative).map((c) => ({ date: new Date(Number(c.key.slice(0, 4)), Number(c.key.slice(5, 7)) - 1, 1), key: c.key, value: c.value })));
  /** Hovered donut slice per chart (legend row or arc): the others dim, the centre shows its share. */
  let hot = $state<Record<string, string | null>>({});
  /** Sparkline colour: fixed tone, or trend (last vs first) when `auto`. */
  const sparkColor = (values: number[], tone: 'auto' | 'accent' | 'muted') =>
    tone === 'accent' ? 'var(--chart-1)' : tone === 'muted' ? 'var(--muted-foreground)' : (values.at(-1) ?? 0) >= (values[0] ?? 0) ? 'var(--success)' : 'var(--accent-2)';
</script>

{#snippet bars(points: BarPoint[], fmt: (n: number) => string, height: number, seriesLabel: string)}
  {#if !points.length || Math.max(0, ...points.map((p) => p.value)) <= 0}
    <Empty class="py-3 text-xs">No data for this range.</Empty>
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
    <Empty class="py-3 text-xs">Nothing to chart.</Empty>
  {:else}
    {@const pct = (v: number) => `${((100 * v) / total).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`}
    {@const on = hot[id] ?? null}
    {@const cur = slices.find((s) => s.key === on)}
    {@const config = Object.fromEntries(slices.map((s, i) => [s.key, { label: s.label, color: color(s, i) }]))}
    {@const data = slices.map((s) => ({
      ...s,
      props: {
        fill: `var(--color-${s.key})`,
        opacity: on == null || on === s.key ? 1 : 0.35,
        onpointerenter: () => (hot[id] = s.key),
        onpointerleave: () => (hot[id] = null),
      },
    }))}
    <div class="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div class="relative size-[124px] shrink-0">
        <Chart.Container {config} class="aspect-square size-full" role="img" aria-label={slices.map((s) => `${s.label} ${pct(s.value)}`).join(', ')}>
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
            <TipButton
              variant="ghost"
              size="xs"
              class="hover:bg-muted/60 focus-visible:bg-muted/60 -mx-1.5 grid h-auto w-[calc(100%+0.75rem)] cursor-default grid-cols-[10px_1fr_auto_auto] items-center justify-items-stretch gap-2 rounded-md px-1.5 py-0.5 text-left font-normal"
              tip={plural(s.count)}
              side="left"
              aria-label={`${s.label}: ${fmt(s.value)} (${pct(s.value)}, ${plural(s.count)})`}
              onmouseenter={() => (hot[id] = s.key)}
              onfocus={() => (hot[id] = s.key)}
              onblur={() => (hot[id] = null)}
            >
              <i class="size-2.5 rounded-[3px]" style={`background:${color(s, i)}`}></i>
              <span class="truncate capitalize">{s.label}</span>
              <span class="text-muted-foreground tabular-nums">{fmt(s.value)}</span>
              <span class="text-muted-foreground min-w-[42px] text-right tabular-nums">{pct(s.value)}</span>
            </TipButton>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

{#snippet hero(Icon: typeof Wallet, title: string, value: string, sub: string, change: { pct: number; against: string } | null, trend: number[], tone: 'auto' | 'accent' | 'muted')}
  <Stat
    size="lg"
    icon={Icon}
    {value}
    label={title}
    {sub}
    hint={change ? `Change ${change.against}` : null}
    delta={change ? { text: `${change.pct >= 0 ? '↑' : '↓'} ${change.pct >= 900 ? `${Math.round(change.pct / 100 + 1)}×` : `${Math.abs(change.pct).toFixed(0)}%`}`, tone: change.pct >= 0 ? 'up' : 'down' } : null}
  >
    {#if trend.length > 1}{@render spark(trend, tone)}{/if}
  </Stat>
{/snippet}

{#snippet panel(title: string, sub: string, body: Snippet, aside?: Snippet)}
  <Card.Root size="sm" class="h-full min-w-0 gap-2 shadow-none">
    <Card.Header>
      <Card.Title>{title}</Card.Title>
      {#if sub}<Card.Description class="truncate text-[11.5px]">{sub}</Card.Description>{/if}
      {#if aside}<Card.Action>{@render aside()}</Card.Action>{/if}
    </Card.Header>
    <Card.Content class="relative min-h-0 flex-1">{@render body()}</Card.Content>
  </Card.Root>
{/snippet}

{#snippet fill(content: Snippet)}
  <div class="absolute inset-0 px-2">{@render content()}</div>
{/snippet}

{#snippet tile(id: string, size: WidgetSize)}
  {#if id === 'year'}
    {#snippet b()}{@render fill(yearChart)}{/snippet}
    {@render panel('By year', useOrders ? 'cash charged per year · hover for store credit' : 'melt value per year pledged', b)}
  {:else if id === 'month'}
    {#snippet b()}{@render fill(monthChart)}{/snippet}
    {#snippet a()}<Segmented options={[12, 24, 36].map((m) => ({ id: m, label: String(m) }))} bind:value={months} ariaLabel="Months shown" size="sm" />{/snippet}
    {@render panel('By month', `last ${months} months`, b, a)}
  {:else if id === 'time'}
    {#snippet b()}{@render fill(timeChart)}{/snippet}
    {@render panel('Backing over time', useOrders ? 'cash paid, running total since your first order' : 'running total since your first pledge', b)}
  {:else if id === 'type'}
    {#snippet b()}<div>{@render donut('type', typeSlices, money0)}</div>{/snippet}
    {@render panel('By type', `${byType.length} kinds of pledge · hangar melt value`, b)}
  {:else if id === 'payment'}
    {#snippet b()}
      <div class="sens grid gap-2">
        {@render donut('payment', paymentSlices, money0, PAY_COLORS)}
        <span class="text-muted-foreground text-[11px]">
          {#if useOrders}Cash is what RSI charged your card or PayPal; store credit is melt value spent again. Every order's goods = cash + credit.{:else}RSI's hangar doesn't say whether a standard pledge was paid with cash or store credit — only warbonds are sure to be new money. Import the order history for the real split.{/if}
        </span>
      </div>
    {/snippet}
    {@render panel('How you paid', useOrders ? 'from your order history' : 'warbond needs new money; standard takes cash or store credit', b)}
  {:else if id === 'ledger'}
    {#snippet b()}
      <StatGrid layout="divided" class="sens">
        {#if oWarbond}
          <Stat value={money(oWarbond.usd)} label="Warbond (new money)" sub={`${oWarbond.lines} warbond line${oWarbond.lines === 1 ? '' : 's'} in your orders`} hint="Warbond prices can't be paid with store credit. Counted from the order lines: the hangar drops 'Warbond' from most pledge names, so its own count runs low." valueTone="ok" />
        {:else}
          <Stat value={money(ledger.newMoney)} label="New money for sure" sub={`${ledger.newMoneyCount} warbond pledge${ledger.newMoneyCount === 1 ? '' : 's'} by name`} hint="Warbond prices can't be paid with store credit. Only pledges still named 'Warbond' count here — import the order history for the real figure." valueTone="ok" />
        {/if}
        <Stat value={money(ledger.either)} label="Cash or store credit" sub={`${ledger.eitherCount} standard pledge${ledger.eitherCount === 1 ? '' : 's'}`} hint="Standard pledges accept both; the hangar keeps no record of which you used" />
        <Stat value={money(ledger.melted)} label="Sitting in buyback" sub={`${ledger.meltedCount} melted, not bought back${ledger.meltedUnknown ? ` · ${ledger.meltedUnknown} unpriced` : ''}`} hint="What's melted right now (Buyback → Load contents & prices), not everything ever melted: a pledge bought back leaves the list. The credit these gave is spent or in your balance. Melting isn't money — the same dollar can be melted and spent again." />
        {#if orderSums}
          <Stat value={money(orderSums.credits)} label="Store credit cycled" sub={`${orderSums.count} orders · turnover, not money`} hint="Store credit spent across all orders. A dollar melted and spent, melted again and spent again counts twice here — this is how much work your credit did, not how much you had. Credit ever issued ≈ this + your balance now." />
        {/if}
        <Stat value={`${ledger.gifted + ledger.free}`} label="$0 pledges" sub={`${ledger.gifted} gifted (ships, CCUs, paints) · ${ledger.free} flair`} hint="No melt value: received as gifts or referral rewards (a gifted CCU melts for $0), plus event flair, hangar decor and subscriber items" />
        {#if ledger.custom}<Stat value={money(ledger.custom)} label="Paid customization" hint="RSI's configuration value on top of the pledge — cash" />{/if}
        {#if orderSums}
          <Stat value={money(orderSums.cash)} label="Cash paid" context={`${orderSums.count} orders · ${money(orderSums.credits)} paid with store credit`} hint="From the order history: every order's Total is what was charged to you" tone="accent" />
        {:else}
          <Stat value={ledger.cashMin === ledger.cashMax ? money(ledger.cashMax) : `${money0(ledger.cashMin)} – ${money0(ledger.cashMax)}`} label="Cash spent (rough)" context="Lower bound: everything in buyback was re-spent on standard pledges; upper bound: none was. Credit cycled more than once makes the true figure lower still" hint="New money + customization + standard pledges, less what the credit now in buyback could have covered. The hangar can't see credit that was melted and spent several times — import the order history for the real figure." tone="accent" />
        {/if}
      </StatGrid>
    {/snippet}
    {@render panel('Where the money went', 'warbond took new money; standard took cash or credit; melting moves value to credit and back, it never adds money', b)}
  {:else if id === 'orders'}
    {#snippet b()}
      <div class="sens grid gap-3">
        {#if orderSums}
          <StatGrid layout="divided">
            <Stat value={money(orderSums.cash)} label="Cash paid" valueTone="ok" hint="Sum of every order's Total — what RSI charged your card / PayPal" />
            <Stat value={money(orderSums.credits)} label="Store credit used" hint="Sum of Credits used — melt value spent again" />
            <Stat value={money(orderSums.items)} label="Goods at the price paid" hint="Sum of the line totals (after RSI's sale and multi-paint discounts); cash + credit should match it" />
            <Stat value={money(orderSums.discounts)} label="Discounts taken" hint="Line discounts (multi-paint tiers, sales) plus any additional discount" />
            {#if orderSums.free}<Stat value={orderSums.free} label="Free orders" hint="Nothing charged and nothing priced: gifts received, giveaways, referral rewards" />{/if}
            {#if orderSums.refunds}<Stat value={money(orderSums.refunds)} label="Refunded" valueTone="warn" />{/if}
            {#if orderSums.cancelled}<Stat value={orderSums.cancelled} label="Cancelled" hint="Left out of every total" />{/if}
          </StatGrid>
        {:else}
          <span class="text-muted-foreground text-xs">Not imported yet. <em>Import order history</em> reads every page of RSI's Billing (orders, lines, what was cash and what was store credit) in this browser — nothing is sent anywhere.</span>
        {/if}
        <div class="flex flex-wrap items-center gap-2">
          <TipButton variant={orders ? 'outline' : 'default'} size="sm" disabled={ordersBusy} onclick={importOrders} tip="Reads your order history pages from robertsspaceindustries.com/account/billing in this browser — nothing is sent anywhere">{ordersBusy ? 'Reading…' : orders ? 'Re-import order history' : 'Import order history'}</TipButton>
          {#if ordersMsg.startsWith('No orders') || ordersMsg.startsWith('Could not')}<TipButton variant="ghost" size="sm" onclick={copyBilling} tip="Copies the billing page's markup (bill-to removed) to the clipboard, for fixing the reader when RSI changes the page">Copy billing markup</TipButton>{/if}
          {#if orders}<span class="text-muted-foreground text-xs">{orders.orders.length} orders · read {fmtDateTime(orders.at)}</span>{/if}
          {#if ordersMsg}<span class="text-muted-foreground text-xs">{ordersMsg}</span>{/if}
        </div>
      </div>
    {/snippet}
    {@render panel('Order history', orderSums ? `${orderSums.count} orders from RSI's Billing` : 'the real cash vs store credit split', b)}
  {:else if id === 'facts'}
    {#snippet b()}
      <dl class="grid content-start gap-1.5 text-xs">
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
      <div class={cn('grid content-start gap-1.5', size !== 'sm' && size !== 'tall' && 'grid-cols-2')}>
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

{#snippet yearChart()}<div class="sens h-full">{@render bars(yearBars, short, 0, useOrders ? 'Cash paid' : 'Melt value')}</div>{/snippet}
{#snippet monthChart()}<div class="sens h-full">{@render bars(monthBars, short, 0, useOrders ? 'Cash paid' : 'Melt value')}</div>{/snippet}
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
    <Chart.Container config={{ v: { label: 'Trend', color: sparkColor(values, tone) } }} class="aspect-auto h-7 w-full" aria-hidden="true">
      <AreaChart
        data={values.map((v, i) => ({ i, v }))}
        x="i"
        series={[{ key: 'v', value: 'v', color: 'var(--color-v)' }]}
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
      <Card.Title>Credits</Card.Title>
      <Card.Description>
        {#if credits}Credits as of {fmtDateTime(credits.at)}{#if !hangar} · saved once you load the hangar{/if}
        {:else}Store credit, UEC and REC from your RSI account (one request to /account/billing — stays in this browser).{/if}
      </Card.Description>
      <Card.Action class="flex flex-wrap items-center gap-2">
        <Button variant={credits ? 'outline' : 'default'} disabled={creditsBusy} onclick={refreshCredits}>{creditsBusy ? '…' : credits ? 'Refresh credits' : 'Read credits'}</Button>
        <Button variant="outline" href="https://robertsspaceindustries.com/account/billing" target="_blank" rel="noopener">Billing <ExternalLink /></Button>
      </Card.Action>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
      {#if creditsDebug}
        <Alert.Root variant="warning">
          <Alert.Title>Credits box not found on any account page.</Alert.Title>
          <Alert.Description class="text-xs">Open <a class={LINK} href="https://robertsspaceindustries.com/account/billing" target="_blank" rel="noopener">Billing</a> once with the extension on and it's picked up from there. Details: {creditsDebug}</Alert.Description>
        </Alert.Root>
      {/if}
      <StatGrid layout="divided">
        <Stat tone="credit" value={credits ? money(credits.credits.usd) : '—'} label="store credit" />
        <Stat tone="credit" value={credits ? fmtN(credits.credits.uec) : '—'} label="UEC" />
        <Stat tone="credit" value={credits ? fmtN(credits.credits.rec) : '—'} label="REC" />
        <Stat value={money(sum.value)} label="hangar melt value" />
        {#if credits}<Stat value={money(credits.credits.usd + sum.value)} label="credit if you melted everything" />{/if}
      </StatGrid>
      <ConciergeCard />
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Your spend</Card.Title>
      {#if all.length}
        <Card.Description class="text-xs">
          {#if useOrders}What RSI charged you, from your order history by order date: cash on the charts, store credit on hover. Melted pledges, CCU chains and discounts are all in it.{:else}Melt value of what's in your hangar by the pledge's <em>Created</em> date — not cash paid: CCU chains, discounts, gifts received and melted pledges aren't in it.{/if}
        </Card.Description>
        <Card.Action class="flex flex-wrap items-center gap-2">
          {#if orders?.orders.length}
            <Segmented
              options={[
                { id: 'orders', label: 'Order history', hint: 'What RSI charged: cash and store credit per order' },
                { id: 'hangar', label: 'Hangar', hint: 'Melt value of the pledges you hold, by Created date' },
              ]}
              bind:value={() => basisPick, setBasis}
              ariaLabel="Spend basis"
            />
          {/if}
          {#if editing}
            <Button variant="ghost" onclick={resetLayout}><RotateCcw /> Reset</Button>
            <Button onclick={() => (editing = false)}><Check /> Done</Button>
          {:else}
            <Button variant="outline" onclick={() => (editing = true)}><LayoutDashboard /> Customize</Button>
          {/if}
        </Card.Action>
      {/if}
    </Card.Header>
    {#if !all.length}
      <Card.Content><Empty>Load your hangar on the <a class={LINK} href="#hangar">Pledges</a> page first.</Empty></Card.Content>
    {:else}
      <Card.Content class="grid gap-4">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {#if useOrders && orderSums}
            {@render hero(Wallet, 'Cash paid', money(orderSums.cash), `${orderSums.count} orders · since ${Number.isFinite(oFirst) ? new Date(oFirst).getFullYear() : '—'}`, null, oCum.map((c) => c.value), 'accent')}
            {@render hero(
              CalendarRange,
              'Last 12 months',
              money0(oThis12),
              `cash · ${money0(orderSums.credits)} store credit used overall`,
              oPrev12 > 0 ? { pct: ((oThis12 - oPrev12) / oPrev12) * 100, against: 'vs the 12 months before' } : null,
              oLast24.slice(12),
              'auto',
            )}
            {@render hero(Banknote, 'Store credit used', money0(orderSums.credits), `${orderSums.items ? ((100 * orderSums.credits) / orderSums.items).toFixed(0) : 0}% of goods · ${money0(orderSums.discounts)} in discounts`, null, [], 'muted')}
          {:else}
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
              'Warbond (new money)',
              money0(warbond),
              `${payment.warbond?.count ?? 0} warbond pledges · ${sum.value ? ((100 * warbond) / sum.value).toFixed(warbond && warbond < sum.value / 100 ? 1 : 0) : 0}% of melt value`,
              null,
              [],
              'muted',
            )}
          {/if}
          {@render hero(Rocket, 'Ships', String(tot.ships), `${tot.lti} with LTI · ${buybacks} in buyback`, null, [], 'muted')}
        </div>
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
      </Card.Header>
      <Card.Content class="grid gap-3">
        {#if !fleet.rows.length}
          <Empty>No single-ship pledge matched a store ship{ships.length ? '' : ' — open Ships for sale once to load the catalog'}.</Empty>
        {:else}
          <StatGrid>
            <Stat value={money(fleet.paid)} label={`melt value · ${fleet.rows.length} ships`} />
            <Stat value={money(fleet.msrp)} label="at today's MSRP" />
            <Stat
              value={signed(fleet.msrp - fleet.paid)}
              valueTone={fleet.msrp > fleet.paid ? 'ok' : fleet.msrp < fleet.paid ? 'err' : null}
              label="price change since you pledged"
              delta={fleet.paid ? { text: `${fleet.msrp >= fleet.paid ? '▲' : '▼'} ${Math.abs((100 * (fleet.msrp - fleet.paid)) / fleet.paid).toFixed(0)}% vs melt`, tone: fleet.msrp > fleet.paid ? 'up' : fleet.msrp < fleet.paid ? 'down' : 'neutral' } : null}
            />
          </StatGrid>
          <Section id="wallet-fleet" title="Ships" summary={`${fleet.rows.length} matched`} defaultOpen={false}>
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
                    <Table.Cell class={cn('tabular-nums', r.msrp > r.paid && 'text-success', r.msrp < r.paid && 'text-destructive')}>{signed(r.msrp - r.paid)}</Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </Section>
        {/if}
      </Card.Content>
    </Card.Root>

    {#if ccus.count}
      <Card.Root>
        <Card.Header>
          <Card.Title>CCU portfolio</Card.Title>
          <Card.Description class="text-xs">Upgrades in your hangar: what you paid (melt value) vs what the same upgrade is worth at today's MSRP gap. Gifted CCUs have no melt value. Plan chains on the <a class={LINK} href="#ccu">CCU planner</a> tab.</Card.Description>
        </Card.Header>
        <Card.Content class="grid gap-3">
          <StatGrid>
            <Stat value={ccus.count} label={`CCUs · ${ccus.gifted} gifted`} />
            <Stat value={money(ccus.paid)} label="paid (melt value)" />
            <Stat value={money(ccus.worth)} label="worth at today's prices" />
            <Stat
              value={signed(ccus.gain)}
              valueTone={ccus.gain > 0 ? 'ok' : ccus.gain < 0 ? 'err' : null}
              label="unrealised gain"
              delta={{ text: `${ccus.winners} winner${ccus.winners === 1 ? '' : 's'}`, tone: ccus.winners > 0 ? 'up' : 'neutral' }}
            />
          </StatGrid>
          <Section id="wallet-ccus" title="CCUs" summary={`${ccus.count} upgrades`} defaultOpen={false}>
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
                    <Table.Cell class={cn('tabular-nums', r.gain > 0 && 'text-success', r.gain < 0 && 'text-destructive')}>{r.paid ? signed(r.gain) : '—'}</Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </Section>
        </Card.Content>
      </Card.Root>
    {/if}
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>Star Citizen funding</Card.Title>
      <Card.Description class="text-xs">
        RSI's public crowdfund counter (the numbers behind the old funding page).
        {#if funding} Updated {fmtDateTime(funding.at)}.{/if}
      </Card.Description>
      <Card.Action class="flex flex-wrap items-center gap-2">
        <Segmented options={RANGES} bind:value={range} ariaLabel="Funding range" />
        <Button variant="outline" disabled={fundingBusy} onclick={() => loadFunding(true)}>{fundingBusy ? '…' : 'Refresh'}</Button>
      </Card.Action>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if fundingError}<Alert.Root variant="destructive"><Alert.Description>Funding: {fundingError}</Alert.Description></Alert.Root>{/if}
      {#if funding}
        <StatGrid>
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
        </StatGrid>
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
