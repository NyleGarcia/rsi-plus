<script lang="ts">
  import { fetchCredits, loadHangar } from '@/lib/account';
  import { hangarCsv, hangarUrl, stackPledges, totals, type Pledge, type PledgeStack, type PledgeType } from '@/lib/hangar';
  import { canMelt, copiesElsewhere, duplicatePlan, keptCounts, lossWith, meltSummary, targetPlan } from '@/lib/melt';
  import { inventory, ownedShipsWithPaints, paintCopiesNeeded, paintStatus } from '@/lib/items';
  import { bg } from '@/lib/messages';
  import { catalogItem, hangarItem } from '@/lib/settings';
  import type { Catalog } from '@/lib/store';
  import { dateValue, sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';

  type Saved = NonNullable<Awaited<ReturnType<typeof hangarItem.getValue>>>;
  let data = $state<Saved | null>(null);
  let cat = $state<Catalog | null>(null);
  let loading = $state<{ page: number; count: number; pages?: number } | null>(null);
  let error = $state('');
  let q = $state('');
  let type = $state<PledgeType | 'all'>('all');
  let flag = $state<'' | 'lti' | 'warbond' | 'giftable' | 'meltable' | 'upgraded' | 'hasGame'>('');
  type Col = 'name' | 'type' | 'value' | 'date' | 'flags' | 'qty';
  let sort = $state<SortState<Col>>({ key: 'date', dir: 'desc' });
  let ctrl: AbortController | null = null;

  $effect(() => {
    hangarItem.getValue().then((v) => (data = v)).catch((e) => (error = `Couldn't read saved hangar: ${(e as Error).message}`));
    catalogItem.getValue().then((c) => (cat = c));
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch(() => {}); // only needed to know which hulls a paint fits
    const off = catalogItem.watch((c) => (cat = c));
    return () => (ctrl?.abort(), off());
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
        (type === 'all' || p.type === type) &&
        (!flag || p[flag]) &&
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
  const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

  function download(name: string, body: string, type: string) {
    const url = URL.createObjectURL(new Blob([body], { type }));
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---- melt calculator: tick pledges, see the credit and what you'd lose ----
  let picked = $state<Set<number>>(new Set());
  let view = $state<'all' | 'picked'>('all');
  /** Which pledge types the dedupe / target planner may pick (chips in the melt card). */
  let dedupe = $state<Set<PledgeType>>(new Set(['ship', 'package', 'combo', 'paint', 'gear', 'hangar', 'subscriber', 'other']));
  let keepLti = $state(false);
  /** Paint → copies to keep (one per owned hull it fits), so "3 paints for 3 Cutlasses" isn't a duplicate. */
  const inv = $derived.by(() => {
    const rows = inventory(all, cat?.ships ?? []);
    const fleet = ownedShipsWithPaints(rows);
    return { rows, fleet, ownedIds: new Set(fleet.map((f) => f.ship.id)) };
  });
  const keep = $derived(paintCopiesNeeded(inv.rows, inv.fleet));
  /** Meltable pledges holding only paints for ships you don't own (unknown-ship paints don't count — could be yours). */
  const orphanPaints = $derived.by(() => {
    const noShip = new Set(inv.rows.filter((r) => r.category === 'paint' && paintStatus(r, inv.ownedIds) === 'no-ship').flatMap((r) => r.pledges.map((p) => p.id)));
    const paintOnly = (p: Pledge) => p.items.length > 0 && inv.rows.filter((r) => r.pledges.some((x) => x.id === p.id)).every((r) => r.category === 'paint');
    return all.filter((p) => canMelt(p) && noShip.has(p.id) && paintOnly(p) && inv.rows.filter((r) => r.pledges.some((x) => x.id === p.id)).every((r) => paintStatus(r, inv.ownedIds) === 'no-ship'));
  });
  const orphanCredit = $derived(orphanPaints.reduce((n, p) => n + p.value, 0));
  const opts = $derived({ types: dedupe, keepLti, keep });
  const melt = $derived(meltSummary(all, picked, opts));
  /** One kept-count table per pick change for every row's "Would lose" (instead of one per row). */
  const kept = $derived(keptCounts(all, picked));
  const toggleDedupe = (t: PledgeType) => {
    const s = new Set(dedupe);
    s.has(t) ? s.delete(t) : s.add(t);
    dedupe = s;
  };
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
  const visible = $derived(view === 'all' ? stacks : stacks.filter((s) => s.entries.some((p) => picked.has(p.id))));
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

<div class="stack">
  <section class="card stack">
    <div class="row spread">
      <div>
        <h2>Hangar</h2>
        <span class="muted">
          {#if loading}Loading page {loading.page}{totalPages ? ` / ${totalPages}` : ''}… {loading.count} pledges{#if totalPages}<span class="bar" aria-hidden="true"><span style={`width:${Math.min(100, Math.round((100 * loading.page) / totalPages))}%`}></span></span>{/if}
          {:else if data}{all.length} pledges · {data.complete === false ? `partial (stopped after page ${data.page})` : 'loaded'} {new Date(data.at).toLocaleString()}
          {:else}Not loaded yet — reads every page of your RSI hangar (stays in this browser).{/if}
        </span>
      </div>
      <div class="row">
        {#if loading}
          <button class="btn" onclick={() => ctrl?.abort()}>Stop</button>
        {:else}
          {#if data && data.complete === false}
            <button class="btn primary" onclick={() => load(true)}>Resume from page {(data.page ?? 0) + 1}</button>
          {/if}
          <button class="btn" class:primary={!data} onclick={() => load(false)}>{data ? 'Reload all' : 'Load hangar'}</button>
        {/if}
        <button class="btn" disabled={!shown.length} onclick={() => download(`rsi-hangar-${stamp()}.csv`, hangarCsv(shown), 'text/csv')}>CSV</button>
        <button class="btn" disabled={!shown.length} onclick={() => download(`rsi-hangar-${stamp()}.json`, JSON.stringify(shown, null, 2), 'application/json')}>JSON</button>
      </div>
    </div>
    {#if error}<span class="err">{error}</span>{/if}

    {#if all.length}
      <section class="melt stack">
        <div class="row spread">
          <div>
            <h3>Melt calculator</h3>
            <span class="muted small">Melting is per pledge: you get its value as store credit and <strong>every item in it</strong> is gone — it can't be undone (buyback costs the same credit + a token). Duplicates and losses are worked out pledge by pledge: a pledge only counts as a duplicate when each item inside it has another copy in a pledge you keep.</span>
          </div>
          <div class="row">
            <button class="btn small" disabled={!dupes.length} title={dupes.map((p) => `${p.name} · ${money(p.value)}`).join('\n')} onclick={() => ((picked = new Set(dupes.map((p) => p.id))), (view = 'picked'))}>
              Pick duplicates{dupes.length ? ` · ${dupes.length} · ${money(dupeCredit)}` : ' · none'}
            </button>
            <button
              class="btn small"
              disabled={!orphanPaints.length}
              title={cat ? orphanPaints.map((p) => `${p.name} · ${money(p.value)}`).join('\n') : 'Needs the store ship list (loading…)'}
              onclick={() => ((picked = new Set([...picked, ...orphanPaints.map((p) => p.id)])), (view = 'picked'))}
            >
              Pick paints without a ship{orphanPaints.length ? ` · ${orphanPaints.length} · ${money(orphanCredit)}` : ' · none'}
            </button>
            <form class="row" onsubmit={(e) => (e.preventDefault(), planTarget())}>
              <label class="row muted small">Need $<input type="number" min="1" step="1" style="width:90px" bind:value={target} placeholder="credit" aria-label="Credit needed" /></label>
              <button class="btn small" disabled={!target}>Plan for target</button>
            </form>
            <button class="btn small" disabled={!shown.length} onclick={() => pickAll(shown, true)}>Pick shown</button>
            <button class="btn small" disabled={!picked.size} onclick={() => (picked = new Set())}>Clear</button>
          </div>
        </div>
        <div class="row small">
          <span class="muted">May pick:</span>
          {#each TYPES.filter((t) => t !== 'upgrade' && totals(all).byType[t]) as t (t)}
            {@const d = dupesByType.get(t)}
            <button class="chip" class:on={dedupe.has(t)} onclick={() => toggleDedupe(t)} title={dedupe.has(t) ? `Click to leave ${t} pledges alone` : `Click to allow ${t} pledges`}>
              {t}{#if d?.count} · {d.count} · {money(d.value)}{/if}
            </button>
          {/each}
          <label class="row muted"><input type="checkbox" bind:checked={keepLti} /> never LTI</label>
        </div>
        {#if planNote}<div class="small">{planNote}</div>{/if}
        {#if picked.size}
          <div class="stats">
            <div><strong>{money(melt.credit)}</strong><span>credit from melting</span></div>
            {#if data?.credits}<div><strong>{money(data.credits.usd + melt.credit)}</strong><span>store credit after ({money(data.credits.usd)} now)</span></div>{/if}
            <div><strong>{melt.pledges}</strong><span>pledges melted</span></div>
            <div class:bad={melt.lost.length}><strong>{melt.lost.length}</strong><span>items lost for good</span></div>
            <div><strong>{melt.stillOwned.length}</strong><span>items still owned (other copy)</span></div>
          </div>
          {#if melt.lost.length}
            <div class="small"><span class="err">Lost:</span> {melt.lost.join(' · ')}</div>
          {:else}
            <div class="small ok">Nothing lost — every item in the picked pledges has another copy you keep.</div>
          {/if}
          {#if melt.short.length}<div class="small"><span class="warn-t">Short:</span> {melt.short.join(' · ')} <span class="muted">— paints kept below one per ship it fits</span></div>{/if}
          {#if melt.stillOwned.length}<div class="small muted">Still owned afterwards: {melt.stillOwned.join(' · ')}</div>{/if}
          <details class="small">
            <summary>Melt them — {picked.size} pledge{picked.size === 1 ? '' : 's'}, one at a time</summary>
            <p class="muted">RSI asks for your account password on every melt, so RSI+ can't do it for you. Each link opens the hangar on the right page, scrolls to the pledge and opens RSI's own melt dialog. Tick off as you go — the hangar reloads after each melt; <em>Reload all</em> here afterwards.</p>
            <ul class="todo">
              {#each all.filter((p) => picked.has(p.id)) as p (p.id)}
                <li><a href={hangarUrl(all, p.id, 'melt')} target="_blank" rel="noopener">Melt ↗</a> <strong>{p.name}</strong> <span class="muted">#{p.id} · {money(p.value)}</span></li>
              {/each}
            </ul>
          </details>
          <div class="row small">
            <span class="muted">Show:</span>
            <button class="chip" class:on={view === 'all'} onclick={() => (view = 'all')}>everything</button>
            <button class="chip" class:on={view === 'picked'} onclick={() => (view = 'picked')}>picked only · {picked.size}</button>
          </div>
        {:else}
          <span class="muted small">
            Nothing picked. "Pick paints without a ship" adds every paint-only pledge whose paints fit no ship you own (adds to your picks; paints for an unknown ship are left alone). "Pick duplicates" selects the highest-value pledges you can melt without losing a single item or LTI hull
            (skips CCUs, game packages, non-meltable and $0 pledges; a paint that fits several ships you own keeps one copy per ship). "Plan for target" reaches a credit amount losing the fewest
            unique items. After either, the list shows only the picked pledges, each saying where else you hold the same item: duplicates first, then the pledges that cost the least. The "Would lose" column shows what each pledge
            costs on top of what's picked.
          </span>
        {/if}
      </section>
      <div class="stats">
        {#if data?.credits}
          <div class="credit" title={data.creditsAt ? `as of ${new Date(data.creditsAt).toLocaleString()}` : ''}><strong>{money(data.credits.usd)}</strong><span>store credit · <a href="#wallet">Wallet</a></span></div>
        {/if}
        <div><strong>{money(sum.value)}</strong><span>melt value</span></div>
        <div><strong>{sum.pledges}</strong><span>pledges</span></div>
        <div><strong>{sum.ships}</strong><span>ships</span></div>
        <div><strong>{sum.upgrades}</strong><span>CCUs</span></div>
        <div><strong>{sum.lti}</strong><span>LTI</span></div>
        <div><strong>{sum.giftable}</strong><span>giftable</span></div>
      </div>
      <div class="row">
        {#each TYPES.filter((t) => totals(all).byType[t]) as t (t)}
          {@const b = totals(all).byType[t]}
          <button class="chip" class:on={type === t} onclick={() => (type = type === t ? 'all' : t)}>{t} · {b.count} · {money(b.value)}</button>
        {/each}
      </div>
      <div class="row">
        <input placeholder="Search name, items, ship nickname" bind:value={q} aria-label="Search" />
        <label class="row muted small"><input type="checkbox" bind:checked={stacked} /> Stack identical pledges</label>
        <label class="row muted small"><input type="checkbox" bind:checked={allItems} /> Show all items in every pledge</label>
        <select bind:value={flag} aria-label="Flag">
          <option value="">Any</option>
          <option value="lti">LTI</option>
          <option value="warbond">Warbond</option>
          <option value="giftable">Giftable</option>
          <option value="meltable">Meltable</option>
          <option value="upgraded">Upgraded</option>
          <option value="hasGame">Has game package</option>
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" aria-label="Pick all shown" checked={shown.some(canMelt) && shown.every((p) => !canMelt(p) || picked.has(p.id))} onchange={(e) => pickAll(shown, e.currentTarget.checked)} /></th>
            <SortTh key="name" bind:sort>Pledge</SortTh>
            <SortTh key="qty" bind:sort firstDir="desc">Qty</SortTh>
            <SortTh key="type" bind:sort>Type</SortTh>
            <SortTh key="value" bind:sort firstDir="desc">Value</SortTh>
            <SortTh key="date" bind:sort firstDir="desc">Created</SortTh>
            <SortTh key="flags" bind:sort firstDir="desc">Flags</SortTh>
            <th title="Items that disappear for good if you melt one more of these on top of what's picked">Would lose</th>
            <th>Hangar entries</th>
          </tr>
        </thead>
        <tbody>
          {#each visible as s (s.key)}
            {@const p = s.rep}
            {@const n = s.entries.length}
            {@const nPicked = pickedIn(s)}
            {@const nMelt = meltableIn(s)}
            {@const next = s.entries.find((e) => canMelt(e) && !picked.has(e.id))}
            <tr class:picked={nPicked > 0}>
              <td>
                <input
                  type="checkbox"
                  checked={nMelt > 0 && nPicked === nMelt}
                  indeterminate={nPicked > 0 && nPicked < nMelt}
                  disabled={!nMelt}
                  title={nMelt ? (n > 1 ? `Pick all ${nMelt} meltable copies` : 'Pick to melt') : p.meltable ? 'No melt value ($0)' : 'Not meltable'}
                  onchange={() => toggleStack(s)}
                  aria-label={`Pick ${p.name}`}
                />
              </td>
              <td>
                <strong>{p.name}</strong>
                {#if p.upgrade}<div class="muted small">{p.upgrade.fromName} → {p.upgrade.toName}</div>{/if}
                {#if p.items.length}
                  {@const full = allItems || open.has(p.id)}
                  {@const list = full ? p.items : p.items.slice(0, 4)}
                  <ul class="items">
                    {#each list as it, i (i)}<li class:ship={/^(ship|vehicle)$/i.test(it.kind)}>{it.title}{#if it.kind && !/^(ship|vehicle)$/i.test(it.kind)}<span class="muted"> · {it.kind}</span>{/if}</li>{/each}
                  </ul>
                  {#if p.items.length > 4 && !allItems}
                    <button class="link small" onclick={() => toggleOpen(p.id)}>{full ? 'Show less' : `+${p.items.length - 4} more items`}</button>
                  {/if}
                {/if}
              </td>
              <td class="qty">
                {n > 1 ? `×${n}` : '1'}
                {#if nPicked}<div class="small"><span class="warn-t">{nPicked} melt</span>{#if n - nPicked}<span class="muted"> · {n - nPicked} keep</span>{/if}</div>{/if}
              </td>
              <td>{p.type}</td>
              <td>{money(p.value)}{#if n > 1}<div class="muted small">{money(p.value * n)} total</div>{/if}</td>
              <td class="muted small">{n > 1 ? `${s.entries[n - 1]!.date} – ${p.date}` : p.date}</td>
              <td class="flags">
                {#if p.insurance}<span class="chip" class:lti={p.insurance === 'LTI'}>{p.insurance}</span>{:else if p.lti}<span class="chip lti">LTI</span>{/if}
                {#if p.warbond}<span class="chip">WB</span>{/if}
                {#if s.entries.some((e) => e.giftable)}<span class="chip">gift{n > 1 ? ` ${s.entries.filter((e) => e.giftable).length}/${n}` : ''}</span>{/if}
                {#if p.upgraded}<span class="chip">upgraded</span>{/if}
                {#if p.hasGame}<span class="chip">game</span>{/if}
                {#if !p.meltable}<span class="chip muted">no melt</span>{/if}
              </td>
              <td class="small">
                {#if !nMelt}<span class="muted">—</span>
                {:else if !next}<span class="muted">{n > 1 ? 'all picked' : 'picked'}</span>
                {:else}
                  {@const loss = lossWith(kept, next, opts)}
                  {#if loss.length}<span class="chip warn" title={loss.join('\n')}>−{loss.length}</span> <span class="muted">{loss.slice(0, 2).join(', ')}{loss.length > 2 ? '…' : ''}</span>
                  {:else}<span class="chip ok">duplicate</span>{/if}
                {/if}
              </td>
              <td class="small entries">
                {#each s.entries as e (e.id)}
                  <div class="entry" class:on={picked.has(e.id)}>
                    {#if n > 1}
                      <input type="checkbox" checked={picked.has(e.id)} disabled={!canMelt(e)} title={canMelt(e) ? 'Pick this copy' : e.meltable ? 'No melt value ($0)' : 'Not meltable'} onchange={() => togglePick(e.id)} aria-label={`Pick ${e.name} #${e.id}`} />
                    {/if}
                    <a href={hangarUrl(all, e.id)} target="_blank" rel="noopener" title="Open the hangar page scrolled to this pledge">#{e.id} ↗</a>
                    {#if canMelt(e)}<a class="act" href={hangarUrl(all, e.id, 'melt')} target="_blank" rel="noopener" title="Open RSI's melt dialog for this pledge (you confirm with your password there)">melt</a>{/if}
                    {#if e.giftable}<a class="act" href={hangarUrl(all, e.id, 'gift')} target="_blank" rel="noopener" title="Open RSI's gift dialog for this pledge">gift</a>{/if}
                    {#if n > 1}<span class="muted">{e.date}</span>{/if}
                    {#if e.nickname}<span class="muted">“{e.nickname}”</span>{/if}
                    {#if n > 1 && e.giftable}<span class="chip">gift</span>{/if}
                    {#if picked.has(e.id)}
                      {@const where = copiesElsewhere(all, picked, e)}
                      {#if where.length}
                        <div class="why">
                          {#each where as w (w.title)}
                            <div>
                              {#if w.in.length}
                                <span class="ok">✓ {w.title}</span> <span class="muted">also in</span>
                                {#each w.in.slice(0, 3) as q (q.id)}<a href={hangarUrl(all, q.id)} target="_blank" rel="noopener" title={q.name}>#{q.id}</a>{/each}
                                {#if w.in.length > 3}<span class="muted">+{w.in.length - 3}</span>{/if}
                              {:else}
                                <span class="warn-t">✗ {w.title}</span> <span class="muted">— last copy</span>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </div>
                {/each}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

<style>
  .chip.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  button.chip {
    cursor: pointer;
    color: var(--text);
  }
  .small {
    font-size: 11px;
  }
  .flags .chip {
    margin: 1px;
  }
  .melt {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
  }
  .melt h3 {
    margin: 0;
    font-size: 14px;
  }
  .qty {
    white-space: nowrap;
  }
  .entries {
    min-width: 150px;
  }
  .entry {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 1px 0;
    white-space: nowrap;
  }
  .entry.on a {
    font-weight: 700;
  }
  .entry a {
    color: var(--accent);
    text-decoration: none;
  }
  .entry a.act {
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 5px;
  }
  .entry a.act:hover {
    color: var(--text);
  }
  details summary {
    cursor: pointer;
    color: var(--accent);
    font-weight: 600;
  }
  .todo {
    margin: 4px 0 0;
    padding-left: 18px;
  }
  .todo a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
  }
  .entry a:hover {
    text-decoration: underline;
  }
  .items {
    margin: 4px 0 0;
    padding-left: 14px;
    font-size: 11px;
    color: var(--muted);
  }
  .items li.ship {
    color: var(--text);
  }
  .warn-t {
    color: #ffb547;
  }
  .why {
    margin: 2px 0 4px 20px;
    font-size: 11px;
    line-height: 1.5;
  }
  .why a {
    color: var(--accent);
    text-decoration: none;
    margin-left: 4px;
  }
  .chip.warn {
    color: #ffb547;
    border-color: rgb(255 181 71 / 0.4);
  }
  .chip.ok {
    color: var(--ok);
  }
  .bar {
    display: inline-block;
    vertical-align: middle;
    width: 140px;
    height: 6px;
    margin-left: 8px;
    border-radius: 3px;
    background: rgb(255 255 255 / 0.08);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.3s;
  }
  .stats div.credit {
    border-color: rgb(255 209 102 / 0.35);
  }
  .chip.lti {
    color: #ffd166;
    border-color: rgb(255 209 102 / 0.4);
  }
  .stats div.bad strong {
    color: var(--err);
  }
  tr.picked td {
    background: rgb(255 255 255 / 0.04);
  }
</style>
