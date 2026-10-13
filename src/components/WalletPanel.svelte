<script lang="ts">
  import { fetchCredits } from '@/lib/account';
  import { ownedCcus } from '@/lib/ccu';
  import { hangarUrl, totals, type BuybackItem, type Credits, type Pledge } from '@/lib/hangar';
  import { buybackItem, catalogItem, fundingItem, hangarItem } from '@/lib/settings';
  import type { CatalogShip } from '@/lib/store';
  import { ccuOverview, fetchFunding, fleetValue, fundingStats, shareOfFunding, spendByFunding, spendByMonth, spendByType, spendByYear, spendSummary, type Funding, type FundingRange } from '@/lib/wallet';
  import Bars from './Bars.svelte';
  import Segmented from './Segmented.svelte';
  import Donut from './Donut.svelte';

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
  const byFunding = $derived(spendByFunding(all));
  const share = $derived(funding ? shareOfFunding(sum.value, funding.funds) : 0);

  // ---- fleet value + CCU portfolio (needs the store catalog for today's prices) ----
  const fleet = $derived(fleetValue(all, ships));
  const ccus = $derived(ccuOverview(ownedCcus(all, buybackList, ships).owned, ships));
  let showFleet = $state(false);
  let showCcus = $state(false);
  const signed = (n: number) => `${n < 0 ? '−' : '+'}${money(Math.abs(n))}`;

  const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const money0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const big = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : money0(n));
  /** Fits a narrow bar column: $55, $2.3k, $16k. */
  const short = (n: number) => (n >= 1e6 ? big(n) : n >= 1e4 ? `$${Math.round(n / 1e3)}k` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : money0(n));
  const fmtN = (n: number) => `¤${n.toLocaleString('en-US')}`;
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
</script>

<div class="stack">
  <section class="card stack">
    <div class="row spread">
      <div>
        <h2>Wallet</h2>
        <span class="muted">
          {#if credits}Credits as of {new Date(credits.at).toLocaleString()}{#if !hangar} · saved once you load the hangar{/if}
          {:else}Store credit, UEC and REC from your RSI account (one request to /account/billing — stays in this browser).{/if}
        </span>
      </div>
      <div class="row">
        <button class="btn" class:primary={!credits} disabled={creditsBusy} onclick={refreshCredits}>{creditsBusy ? '…' : credits ? 'Refresh credits' : 'Read credits'}</button>
        <a class="btn" href="https://robertsspaceindustries.com/account/billing" target="_blank" rel="noopener">Billing ↗</a>
      </div>
    </div>
    {#if error}<span class="err">{error}</span>{/if}
    {#if creditsDebug}<div class="small muted"><strong>Credits box not found on any account page.</strong> Open <a href="https://robertsspaceindustries.com/account/billing" target="_blank" rel="noopener">Billing</a> once with the extension on and it's picked up from there. Details: {creditsDebug}</div>{/if}
    <div class="stats">
      <div class="credit"><strong>{credits ? money(credits.credits.usd) : '—'}</strong><span>store credit</span></div>
      <div class="credit"><strong>{credits ? fmtN(credits.credits.uec) : '—'}</strong><span>UEC</span></div>
      <div class="credit"><strong>{credits ? fmtN(credits.credits.rec) : '—'}</strong><span>REC</span></div>
      <div><strong>{money(sum.value)}</strong><span>hangar melt value</span></div>
      {#if credits}<div><strong>{money(credits.credits.usd + sum.value)}</strong><span>credit if you melted everything</span></div>{/if}
    </div>
  </section>

  <section class="card stack">
    <div class="row spread">
      <div>
        <h2>Your spend</h2>
        <span class="muted small">
          {#if all.length}
            Melt value of what's in your hangar by the pledge's <em>Created</em> date — not cash paid: CCU chains, discounts, gifts received and melted pledges aren't in it.
          {:else}
            Load your hangar on the <a href="#hangar">Hangar</a> tab first.
          {/if}
        </span>
      </div>
    </div>
    {#if all.length}
      <div class="stats">
        <div><strong>{money(sum.value)}</strong><span>{sum.pledges} pledges</span></div>
        <div><strong>{money(sum.warbond)}</strong><span>warbond ({sum.value ? Math.round((100 * sum.warbond) / sum.value) : 0}%)</span></div>
        <div><strong>{sum.since ? new Date(sum.since).getFullYear() : '—'}</strong><span>backing since{sum.years ? ` · ${sum.years} yr` : ''}</span></div>
        <div><strong>{money0(sum.perYear)}</strong><span>per year</span></div>
        <div><strong>{tot.ships}</strong><span>ships · {tot.lti} LTI</span></div>
        <div><strong>{buybacks}</strong><span>in buyback</span></div>
        {#if funding}<div><strong>{share ? `${share.toPrecision(2)}%` : '—'}</strong><span>of all funding ever</span></div>{/if}
      </div>
      <div class="charts">
        <div class="chart">
          <h3>By year</h3>
          <Bars points={byYear.map((b) => ({ label: b.label, value: b.value, hint: `${b.count} pledge${b.count === 1 ? '' : 's'}` }))} fmt={short} />
        </div>
        <div class="chart">
          <div class="row spread">
            <h3>By month</h3>
            <Segmented options={[12, 24, 36].map((m) => ({ id: m, label: String(m) }))} bind:value={months} ariaLabel="Months shown" size="sm" />
          </div>
          <Bars points={byMonth.map((b) => ({ label: `${b.label} '${b.key.slice(2, 4)}`, value: b.value, hint: `${b.count} pledge${b.count === 1 ? '' : 's'}` }))} fmt={short} height={110} />
        </div>
        <div class="chart">
          <h3>By type</h3>
          <Donut slices={byType.map((b) => ({ label: b.label, value: b.value, count: b.count }))} fmt={money0} />
        </div>
        <div class="chart">
          <h3>Warbond vs credit</h3>
          <Donut slices={byFunding.map((b) => ({ label: b.label, value: b.value, count: b.count }))} fmt={money0} />
          <span class="muted small">Warbond pledges needed new money; the rest could have been bought with store credit (RSI doesn't say which were).</span>
        </div>
      </div>
    {/if}
  </section>

  {#if all.length && ships.length}
    <section class="card stack">
      <div class="row spread">
        <div>
          <h2>Fleet at today's prices</h2>
          <span class="muted small">
            Single-ship pledges matched to the store catalog: melt value (what RSI credits you) vs the ship's current MSRP. Price rises since you pledged show as a gain.
            {#if fleet.packs} {fleet.packs} multi-ship pack{fleet.packs === 1 ? '' : 's'} not split.{/if}
          </span>
        </div>
        {#if fleet.rows.length}<button class="btn small" onclick={() => (showFleet = !showFleet)}>{showFleet ? 'Hide ships' : `Show ${fleet.rows.length} ships`}</button>{/if}
      </div>
      {#if !fleet.rows.length}
        <span class="muted">No single-ship pledge matched a store ship{ships.length ? '' : ' — open the Store tab once to load the catalog'}.</span>
      {:else}
        <div class="stats">
          <div><strong>{money(fleet.paid)}</strong><span>melt value · {fleet.rows.length} ships</span></div>
          <div><strong>{money(fleet.msrp)}</strong><span>at today's MSRP</span></div>
          <div><strong class:ok={fleet.msrp > fleet.paid} class:warn={fleet.msrp < fleet.paid}>{signed(fleet.msrp - fleet.paid)}</strong><span>price change since you pledged</span>{#if fleet.paid}<span class="delta" class:up={fleet.msrp > fleet.paid} class:down={fleet.msrp < fleet.paid}>{fleet.msrp >= fleet.paid ? '▲' : '▼'} {Math.abs((100 * (fleet.msrp - fleet.paid)) / fleet.paid).toFixed(0)}% vs melt</span>{/if}</div>
        </div>
        {#if showFleet}
          <table>
            <thead><tr><th>Ship</th><th>Pledge</th><th>Melt</th><th>MSRP now</th><th>Δ</th></tr></thead>
            <tbody>
              {#each fleet.rows as r (r.pledgeId)}
                <tr>
                  <td><strong>{r.ship}</strong></td>
                  <td class="muted small"><a href={hangarUrl(all, r.pledgeId)} target="_blank" rel="noopener">{r.pledge}</a></td>
                  <td>{money(r.paid)}</td>
                  <td>{money(r.msrp)}</td>
                  <td class:ok={r.msrp > r.paid} class:warn={r.msrp < r.paid}>{signed(r.msrp - r.paid)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}
    </section>

    {#if ccus.count}
      <section class="card stack">
        <div class="row spread">
          <div>
            <h2>CCU portfolio</h2>
            <span class="muted small">Upgrades in your hangar: what you paid (melt value) vs what the same upgrade is worth at today's MSRP gap. Gifted CCUs have no melt value. Plan chains on the <a href="#ccu">CCU planner</a> tab.</span>
          </div>
          <button class="btn small" onclick={() => (showCcus = !showCcus)}>{showCcus ? 'Hide CCUs' : `Show ${ccus.count} CCUs`}</button>
        </div>
        <div class="stats">
          <div><strong>{ccus.count}</strong><span>CCUs · {ccus.gifted} gifted</span></div>
          <div><strong>{money(ccus.paid)}</strong><span>paid (melt value)</span></div>
          <div><strong>{money(ccus.worth)}</strong><span>worth at today's prices</span></div>
          <div><strong class:ok={ccus.gain > 0} class:warn={ccus.gain < 0}>{signed(ccus.gain)}</strong><span>unrealised gain</span><span class="delta" class:up={ccus.winners > 0}>{ccus.winners} winner{ccus.winners === 1 ? '' : 's'}</span></div>
        </div>
        {#if showCcus}
          <table>
            <thead><tr><th>CCU</th><th>Paid</th><th>Worth</th><th>Gain</th></tr></thead>
            <tbody>
              {#each ccus.rows as r (r.ref)}
                <tr>
                  <td><span class="muted">{r.from} →</span> <strong>{r.to}</strong> <a class="muted small" href={hangarUrl(all, r.ref)} target="_blank" rel="noopener">#{r.ref}</a></td>
                  <td>{r.paid ? money(r.paid) : 'gift'}</td>
                  <td>{money(r.worth)}</td>
                  <td class:ok={r.gain > 0} class:warn={r.gain < 0}>{r.paid ? signed(r.gain) : '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>
    {/if}
  {/if}

  <section class="card stack">
    <div class="row spread">
      <div>
        <h2>Star Citizen funding</h2>
        <span class="muted small">
          RSI's public crowdfund counter (the numbers behind the old funding page).
          {#if funding} Updated {new Date(funding.at).toLocaleString()}.{/if}
        </span>
      </div>
      <div class="row">
        <Segmented options={RANGES} bind:value={range} ariaLabel="Funding range" size="sm" />
        <button class="btn" disabled={fundingBusy} onclick={() => loadFunding(true)}>{fundingBusy ? '…' : 'Refresh'}</button>
      </div>
    </div>
    {#if fundingError}<span class="err">Funding: {fundingError}</span>{/if}
    {#if funding}
      <div class="stats">
        <div><strong>{big(funding.funds)}</strong><span>raised to date</span></div>
        <div><strong>{funding.fans.toLocaleString('en-US')}</strong><span>citizens</span></div>
        <div><strong>{funding.fans ? money0(funding.funds / funding.fans) : '—'}</strong><span>per citizen</span></div>
        {#if period}
          <div><strong>{big(period.usd)}</strong><span>this {range}</span>{#if delta != null}<span class="delta" class:up={delta >= 0} class:down={delta < 0}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}% vs last</span>{/if}</div>
        {/if}
        <div><strong>{big(shown)}</strong><span>last {funding.points.length} {range}s</span></div>
        {#if fstats?.average}<div><strong>{big(fstats.average)}</strong><span>average per {range}</span></div>{/if}
        {#if fstats?.best}<div><strong>{big(fstats.best.usd)}</strong><span>best {range} shown · {fstats.best.key}</span></div>{/if}
        {#if fstats?.projected && period}<div><strong class:ok={fstats.projected > fstats.average} class:warn={fstats.average > 0 && fstats.projected < fstats.average}>{big(fstats.projected)}</strong><span>this {range} on pace for</span></div>{/if}
        {#if all.length && funding.fans}<div><strong>{(sum.value / (funding.funds / funding.fans)).toFixed(1)}×</strong><span>you vs the average citizen</span></div>{/if}
      </div>
      <Bars points={funding.points.map((p) => ({ label: p.label, value: p.usd, hint: p.key }))} fmt={big} highlightLast />
      <span class="muted small">The current {range} is still running (yellow). Gross pledges before melts.</span>
    {:else if fundingBusy}
      <div class="muted">Loading…</div>
    {/if}
  </section>
</div>

<style>
  h3 {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--muted);
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: #ffd166;
  }
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }
  .chart {
    min-width: 0;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
    display: grid;
    gap: 6px;
    align-content: start;
  }
  .small {
    font-size: 11px;
  }
</style>
