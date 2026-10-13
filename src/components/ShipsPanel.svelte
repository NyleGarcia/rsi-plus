<script lang="ts">
  import { hangarUrl } from '@/lib/hangar';
  import {
    family,
    familyLabel,
    inventory,
    itemsCsv,
    ownedShipsWithPaints,
    paintGroups,
    storePaintFor,
    storePaintIndex,
    storePaintsByFamily,
    type ItemRow,
    type PaintGroup,
  } from '@/lib/items';
  import { bg } from '@/lib/messages';
  import { catalogItem, hangarItem, paintCatalogItem } from '@/lib/settings';
  import { sortBy, type SortState } from '@/lib/sort';
  import { usd, type Catalog, type CatalogShip, type PaintCatalog, type StorePaint } from '@/lib/store';
  import SortTh from './SortTh.svelte';

  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  let cat = $state<Catalog | null>(null);
  let storePaints = $state<PaintCatalog | null>(null);
  let error = $state('');
  let paintsLoading = $state(false);

  $effect(() => {
    hangarItem.getValue().then((h) => (hangar = h));
    catalogItem.getValue().then((c) => (cat = c));
    paintCatalogItem.getValue().then((p) => (storePaints = p));
    bg({ type: 'catalog:get' })
      .then((c) => (cat = c))
      .catch((e) => (error = `Store catalog: ${(e as Error).message} (needed to match paints to ships)`));
    refreshPaints(false);
    const offs = [hangarItem.watch((h) => (hangar = h)), catalogItem.watch((c) => (cat = c)), paintCatalogItem.watch((p) => (storePaints = p))];
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
  const fleet = $derived(ownedShipsWithPaints(rows));
  const storeIdx = $derived(storePaintIndex(storePaints?.paints ?? []));
  const storeByFam = $derived(storePaintsByFamily(storePaints?.paints ?? [], ships));
  /** Store paints you already have (same title in the hangar). */
  const ownedStoreIds = $derived(new Set(rows.filter((r) => r.category === 'paint').map((r) => storePaintFor(r, storeIdx)?.id).filter((x): x is number => x != null)));

  // ---- view prefs ----
  type View = 'paints' | 'ships';
  type Own = 'both' | 'owned' | 'not-owned';
  type GroupShow = '' | 'owned' | 'not-owned' | 'unknown';
  const PREFS = 'rsiplus:ships';
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<{ view: View; own: Own; groupShow: GroupShow; withEmpty: boolean }>;
    } catch {
      return {};
    }
  })();
  const hashView = new URLSearchParams(location.hash.split('?')[1] ?? '').get('view');
  let view = $state<View>(hashView === 'ships' || hashView === 'paints' ? hashView : (saved.view ?? 'paints'));
  let own = $state<Own>(saved.own ?? 'both');
  let groupShow = $state<GroupShow>(saved.groupShow ?? '');
  let withEmpty = $state(saved.withEmpty ?? true);
  $effect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ view, own, groupShow, withEmpty }));
    } catch {
      /* no persistence — fine */
    }
  });

  // ---- helpers ----
  const qty = (list: ItemRow[]) => list.reduce((n, r) => n + r.count, 0);
  const fitsLabel = (r: ItemRow) => {
    if (r.ship) return r.ship.name;
    if (!r.fits.length) return '';
    if (r.fits.length === 1) return r.fits[0]!.name;
    const fams = [...new Set(r.fits.map((s) => family(s.name)))];
    return fams
      .map((f) => {
        const inFam = ships.filter((s) => family(s.name) === f).length;
        const hit = r.fits.filter((s) => family(s.name) === f);
        return hit.length >= inFam && inFam > 1 ? `All ${familyLabel(f, hit)}` : hit.map((s) => s.name).join(', ');
      })
      .join(' · ');
  };
  function download(name: string, body: string) {
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  let collapsed = $state<Set<string>>(new Set());
  const toggle = (k: string) => {
    const s = new Set(collapsed);
    s.has(k) ? s.delete(k) : s.add(k);
    collapsed = s;
  };
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
  }
  const pgStatus = (g: PaintGroup): Exclude<GroupShow, ''> => (g.key === '~' ? 'unknown' : g.owned.length ? 'owned' : 'not-owned');
  const groupsAll = $derived.by((): Group[] => {
    const base = paintGroups(rows, fleet, withEmpty);
    const byKey = new Map(base.map((g) => [g.key, g]));
    // Families that only exist on the store side (you own neither ship nor paint) still get a group when
    // showing not-owned paints — that's how you browse paints for ships you don't have.
    if (own !== 'owned')
      for (const f of storeByFam.keys()) {
        const key = f === '~' ? 'packs' : `f:${f}`;
        if (!byKey.has(key)) byKey.set(key, { key, label: f === '~' ? 'Paint packs & collections (store)' : familyLabel(f, ships), owned: [], paints: [] });
      }
    return [...byKey.values()].map((g) => {
      const fam = g.key === '~' || g.key === 'packs' ? g.key : g.key.slice(2);
      const rowsOut: Row[] = g.paints.map((r) => ({ key: r.key, title: r.title, owned: r, store: storePaintFor(r, storeIdx) }));
      const seen = new Set(rowsOut.map((r) => r.store?.id).filter((x) => x != null));
      for (const sp of storeByFam.get(fam === 'packs' ? '~' : fam) ?? [])
        if (!seen.has(sp.id) && !ownedStoreIds.has(sp.id)) rowsOut.push({ key: `s:${sp.id}`, title: sp.name, owned: null, store: sp });
      return { ...g, fam, rows: rowsOut };
    });
  });
  const counts = $derived.by(() => {
    const c = { owned: 0, 'not-owned': 0 };
    for (const g of groupsAll) for (const r of g.rows) r.owned ? (c.owned += r.owned.count) : c['not-owned']++;
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
  const cheapest = (fits: CatalogShip[]) => [...fits].filter((s) => s.msrp).sort((a, b) => a.msrp - b.msrp)[0] ?? fits[0];
  const familyShips = (g: Group) => ships.filter((s) => family(s.name) === g.fam);
  const price = (sp: StorePaint) => (sp.discounted < sp.price ? `${usd(sp.discounted)} (was ${usd(sp.price)})` : usd(sp.price));

  function openPaintsFor(name: string) {
    paintQ = familyLabel(family(name), ships);
    groupShow = '';
    view = 'paints';
  }

  // ---- my ships + compare ----
  let shipQ = $state('');
  let noPaints = $state(false);
  let compare = $state<number[]>([]);
  let shipSort = $state<SortState<'name' | 'count' | 'msrp' | 'paints' | 'maker' | 'insurance'>>({ key: 'name', dir: 'asc' });
  /** Sort key: LTI first, then longest term. */
  const insRank = (ins: string[]) => (ins.includes('LTI') ? 10_000 : Math.max(0, ...ins.map((i) => parseInt(i, 10) || 0)));
  const fleetShown = $derived(
    sortBy(
      fleet.filter((f) => (!noPaints || !f.paints.length) && (!shipQ.trim() || `${f.ship.name} ${f.ship.manufacturer} ${f.ship.focus}`.toLowerCase().includes(shipQ.trim().toLowerCase()))),
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
</script>

{#snippet links(r: Row)}
  <span class="links">
    {#if r.store}<a href={r.store.url} target="_blank" rel="noopener" title={r.owned ? 'Store page (buy another / gift)' : 'Buy on the store'}>🛒 {r.owned ? 'store' : `buy ${price(r.store)}`}</a>{/if}
    {#if r.owned}
      {#each [...new Map(r.owned.pledges.map((p) => [p.id, p])).values()].slice(0, 3) as p (p.id)}
        <a href={hangarUrl(hangar?.pledges ?? [], p.id)} target="_blank" rel="noopener" title={`Open the hangar page with ${p.name} (gift / melt)`}>🏠 #{p.id}</a>
      {/each}
    {/if}
  </span>
{/snippet}

{#if !hangar}
  <section class="card"><p class="empty">Load your hangar first (Hangar tab) — ships and paints are built from it.</p></section>
{:else}
  <div class="stack">
    {#if error}<section class="card"><span class="err">{error}</span></section>{/if}

    <div class="seg" role="tablist" aria-label="Ships view">
      <button role="tab" aria-selected={view === 'paints'} class:on={view === 'paints'} onclick={() => (view = 'paints')}>Paints by ship</button>
      <button role="tab" aria-selected={view === 'ships'} class:on={view === 'ships'} onclick={() => (view = 'ships')}>My ships · {fleet.length}</button>
      {#if compared.length}<button onclick={() => document.getElementById('compare')?.scrollIntoView({ behavior: 'smooth' })}>Compare · {compared.length} ↓</button>{/if}
    </div>

    {#if view === 'paints'}
      <section class="card stack">
        <div class="row spread">
          <div>
            <h2>Paints by ship</h2>
            <span class="muted">
              Your paints and the store's, per ship. 🛒 opens the store page, 🏠 the hangar page holding it (gift / melt).
              {#if storePaints}· {storePaints.paints.length} store paints from {new Date(storePaints.at).toLocaleString()}{/if}
            </span>
          </div>
          <button class="btn small" disabled={paintsLoading} onclick={() => refreshPaints(true)}>{paintsLoading ? 'Loading…' : 'Refresh store paints'}</button>
        </div>
        <div class="row">
          <div class="seg small-seg" role="radiogroup" aria-label="Paint ownership">
            <button role="radio" aria-checked={own === 'both'} class:on={own === 'both'} onclick={() => (own = 'both')}>Both</button>
            <button role="radio" aria-checked={own === 'owned'} class:on={own === 'owned'} onclick={() => (own = 'owned')}>Owned · {counts.owned}</button>
            <button role="radio" aria-checked={own === 'not-owned'} class:on={own === 'not-owned'} onclick={() => (own = 'not-owned')}>Not owned · {counts['not-owned']}</button>
          </div>
          <span class="muted">Ships:</span>
          {#each [['', 'All'], ['owned', 'I own'], ['not-owned', "I don't own"], ['unknown', 'Unknown / packs']] as [k, label] (k)}
            <button class="chip" class:on={groupShow === k} onclick={() => (groupShow = k as GroupShow)}>{label}</button>
          {/each}
        </div>
        <div class="row">
          <input placeholder="Search paint or ship" bind:value={paintQ} aria-label="Search paints" />
          {#if paintQ}<button class="btn small" onclick={() => (paintQ = '')}>× clear</button>{/if}
          <label class="row muted"><input type="checkbox" bind:checked={withEmpty} /> Include my ships with no paints</label>
          <span class="spacer"></span>
          <button class="btn small" onclick={() => setAll(groupKeys, false)}>Expand all</button>
          <button class="btn small" onclick={() => setAll(groupKeys, true)}>Collapse all</button>
          <button class="btn small" disabled={!groups.length} onclick={() => download(`rsi-paints-${stamp()}.csv`, itemsCsv([...new Set(groups.flatMap((g) => g.rows.map((r) => r.owned).filter((x): x is ItemRow => !!x)))]))}>CSV (owned)</button>
        </div>

        {#if !groups.length}
          <p class="empty">No paints match.</p>
        {:else}
          <div class="groups">
            {#each groups as g (g.key)}
              {@const k = `p|${g.key}`}
              {@const st = g.key === 'packs' ? 'unknown' : pgStatus(g)}
              {@const nOwned = g.rows.filter((r) => r.owned).length}
              <div class="grp" class:dim={st !== 'owned'}>
                <button class="grp-head" aria-expanded={!collapsed.has(k)} onclick={() => toggle(k)}>
                  <span class="caret" aria-hidden="true">{collapsed.has(k) ? '▸' : '▾'}</span>
                  <strong>{g.label}</strong>
                  {#if st === 'owned'}
                    <span class="chip ok">✓ {g.owned.map((o) => `${o.ship.name}${o.count > 1 ? ` ×${o.count}` : ''}`).join(', ')}</span>
                  {:else if st === 'not-owned'}
                    <span class="chip warn">no ship owned</span>
                  {/if}
                  <span class="muted small">{nOwned} owned · {g.rows.length - nOwned} on store</span>
                </button>
                {#if !collapsed.has(k)}
                  {#if g.rows.length}
                    <table>
                      <tbody>
                        {#each g.rows as r (r.key)}
                          <tr class:store-only={!r.owned}>
                            <td>
                              {#if r.store?.thumb}<img class="thumb" src={r.store.thumb} alt="" width="48" height="27" loading="lazy" />{/if}
                              <strong>{r.title}</strong>
                              {#if r.owned}
                                <span class="chip ok">owned{r.owned.count > 1 ? ` ×${r.owned.count}` : ''}</span>
                                {#if r.owned.giftable}<span class="chip">gift</span>{/if}
                                {#if r.owned.fitsVia === 'pledge'}<span class="chip" title="Name doesn't say which ship — matched to the ship(s) in the same pledge">from pack</span>{/if}
                              {:else if r.store && !r.store.available}
                                <span class="chip muted">out of stock</span>
                              {/if}
                            </td>
                            <td class="small">{r.owned ? fitsLabel(r.owned) || '—' : ''}</td>
                            <td class="small">{@render links(r)}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  {:else}
                    <p class="muted small">No paints owned; none on the store right now.</p>
                  {/if}
                  {#if st === 'not-owned'}
                    {@const target = cheapest(familyShips(g))}
                    {#if target}
                      <div class="row small get">
                        <span class="muted">Get the ship:</span>
                        <a class="btn small" href={`#ccu?to=${target.id}`}>Plan CCU → {target.name}{target.msrp ? ` (${usd(target.msrp)})` : ''}</a>
                        <button class="btn small" onclick={() => !compare.includes(target.id) && (compare = [...compare, target.id])}>Compare</button>
                      </div>
                    {/if}
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {:else}
      <section class="card stack">
        <div>
          <h2>My ships <span class="muted">({fleet.length} hulls)</span></h2>
          <span class="muted">Each ship with the paints you own for it and how many more the store has. Tick ships to compare.</span>
        </div>
        <div class="row">
          <input placeholder="Search ships" bind:value={shipQ} aria-label="Search my ships" />
          <label class="row muted"><input type="checkbox" bind:checked={noPaints} /> Only ships with no paints</label>
        </div>
        <table>
          <thead>
            <tr>
              <th>Compare</th>
              <SortTh key="name" bind:sort={shipSort}>Ship</SortTh>
              <SortTh key="maker" bind:sort={shipSort}>Maker / role</SortTh>
              <SortTh key="count" bind:sort={shipSort} firstDir="desc">Copies</SortTh>
              <SortTh key="msrp" bind:sort={shipSort}>MSRP</SortTh>
              <SortTh key="insurance" bind:sort={shipSort} firstDir="desc">Insurance</SortTh>
              <SortTh key="paints" bind:sort={shipSort} firstDir="desc">Paints</SortTh>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {#each fleetShown as f (f.ship.id)}
              {@const more = storeFor(family(f.ship.name)).length}
              <tr>
                <td><input type="checkbox" checked={compare.includes(f.ship.id)} onchange={() => toggleCompare(f.ship.id)} aria-label={`Compare ${f.ship.name}`} /></td>
                <td>
                  <div class="who">
                    {#if f.ship.thumb}<img src={f.ship.thumb} alt="" width="64" height="36" loading="lazy" />{/if}
                    <div><strong>{f.ship.name}</strong></div>
                  </div>
                </td>
                <td class="muted small">{f.ship.manufacturer}<br />{f.ship.focus}</td>
                <td>×{f.count}</td>
                <td>{f.ship.msrp ? usd(f.ship.msrp) : '—'}</td>
                <td>{#each f.insurance as i (i)}<span class="chip" class:lti={i === 'LTI'}>{i}</span>{:else}<span class="muted small">—</span>{/each}</td>
                <td>
                  <button class="link" onclick={() => openPaintsFor(f.ship.name)} title={f.paints.map((p) => p.title).join('\n')}>
                    {qty(f.paints)} owned{more ? ` · ${more} more on store` : ''} →
                  </button>
                </td>
                <td class="small links">
                  {#if f.ship.link}<a href={f.ship.link} target="_blank" rel="noopener">🛒 store</a>{/if}
                  {#each [...new Map(f.items.flatMap((i) => i.pledges).map((p) => [p.id, p])).values()].slice(0, 3) as p (p.id)}
                    <a href={hangarUrl(hangar.pledges, p.id)} target="_blank" rel="noopener" title={`Hangar page with ${p.name}`}>🏠 #{p.id}</a>
                  {/each}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if unmatchedShips.length}
          <p class="muted small">Not matched to a store ship (no paints / compare): {unmatchedShips.map((r) => r.title).join(', ')}</p>
        {/if}
      </section>
    {/if}

    {#if compared.length}
      <section class="card stack" id="compare">
        <div class="row spread">
          <h2>Compare <span class="muted">({compared.length})</span></h2>
          <div class="row">
            <select bind:value={addCompare} aria-label="Add any ship to compare">
              <option value={null}>Add any ship…</option>
              {#each [...ships].sort((a, b) => a.name.localeCompare(b.name)) as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
            </select>
            <button class="btn small" disabled={addCompare == null} onclick={() => (addCompare != null && !compare.includes(addCompare) && (compare = [...compare, addCompare]), (addCompare = null))}>Add</button>
            <button class="btn small" onclick={() => (compare = [])}>Clear</button>
          </div>
        </div>
        <div class="scroll">
          <table class="cmp">
            <thead>
              <tr>
                <th></th>
                {#each compared as s (s.id)}
                  <th>
                    {#if s.thumb}<img src={s.thumb} alt="" width="120" height="68" loading="lazy" />{/if}
                    <div>{s.name}</div>
                    <button class="btn small" onclick={() => toggleCompare(s.id)}>Remove</button>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              <tr><th>Manufacturer</th>{#each compared as s (s.id)}<td>{s.manufacturer}</td>{/each}</tr>
              <tr><th>Role</th>{#each compared as s (s.id)}<td>{s.focus}</td>{/each}</tr>
              <tr><th>Status</th>{#each compared as s (s.id)}<td>{s.flyable}</td>{/each}</tr>
              <tr><th>MSRP</th>{#each compared as s (s.id)}<td>{s.msrp ? usd(s.msrp) : '—'}</td>{/each}</tr>
              <tr><th>You own</th>{#each compared as s (s.id)}<td>{fleetOf(s.id) ? `×${fleetOf(s.id)!.count}` : '—'}</td>{/each}</tr>
              <tr><th>Insurance</th>{#each compared as s (s.id)}<td>{#each fleetOf(s.id)?.insurance ?? [] as i (i)}<span class="chip" class:lti={i === 'LTI'}>{i}</span>{:else}<span class="muted">—</span>{/each}</td>{/each}</tr>
              <tr>
                <th>Your paints</th>
                {#each compared as s (s.id)}
                  {@const paints = rows.filter((r) => r.category === 'paint' && r.fits.some((x) => x.id === s.id))}
                  <td>{#each paints as p (p.key)}<div class="small">{p.title}</div>{:else}<span class="muted">—</span>{/each}</td>
                {/each}
              </tr>
              <tr>
                <th>Store paints</th>
                {#each compared as s (s.id)}
                  {@const sp = storeFor(family(s.name))}
                  <td>{#each sp.slice(0, 8) as p (p.id)}<div class="small"><a href={p.url} target="_blank" rel="noopener">{p.name}</a> {usd(p.discounted)}</div>{:else}<span class="muted">—</span>{/each}{#if sp.length > 8}<div class="muted small">+{sp.length - 8} more</div>{/if}</td>
                {/each}
              </tr>
              <tr>
                <th>Pledges with it</th>
                {#each compared as s (s.id)}
                  <td>{#each fleetOf(s.id)?.items.flatMap((i) => i.pledges) ?? [] as p, i (i)}<div class="small"><a href={hangarUrl(hangar.pledges, p.id)} target="_blank" rel="noopener">{p.name}</a> · {usd(p.value * 100)}</div>{:else}<span class="muted">—</span>{/each}</td>
                {/each}
              </tr>
              <tr>
                <th>On sale now</th>
                {#each compared as s (s.id)}
                  <td>
                    {#each s.ccu as k (k.id)}<div class="small">{k.title || 'CCU'} {usd(k.price)}</div>{/each}
                    {#each s.standalone.filter((k) => k.available) as k (k.id)}<div class="small">Standalone {usd(k.price)}</div>{/each}
                    {#if !s.ccu.length && !s.standalone.some((k) => k.available)}<span class="muted">—</span>{/if}
                  </td>
                {/each}
              </tr>
              <tr>
                <th></th>
                {#each compared as s (s.id)}
                  <td class="row">{#if s.link}<a class="btn small" href={s.link} target="_blank" rel="noopener">Store</a>{/if}<a class="btn small" href={`#ccu?to=${s.id}`}>Plan CCU</a></td>
                {/each}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  </div>
{/if}

<style>
  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    width: fit-content;
    max-width: 100%;
  }
  .seg button {
    border: 0;
    background: none;
    color: var(--muted);
    padding: 6px 12px;
    border-radius: 7px;
    font-weight: 600;
    cursor: pointer;
  }
  .seg.small-seg button {
    padding: 3px 9px;
    font-size: 12px;
  }
  .seg button.on {
    background: rgb(255 255 255 / 0.08);
    color: var(--text);
  }
  .spacer {
    flex: 1;
  }
  .who {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .who img,
  .cmp img,
  .thumb {
    border-radius: 6px;
    object-fit: cover;
    vertical-align: middle;
    margin-right: 6px;
  }
  .small {
    font-size: 11px;
  }
  button.chip {
    cursor: pointer;
    color: var(--text);
  }
  .chip.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.warn {
    color: #ffb547;
    border-color: rgb(255 181 71 / 0.4);
  }
  .chip.ok {
    color: var(--ok);
  }
  .chip.lti {
    color: #ffd166;
    border-color: rgb(255 209 102 / 0.4);
  }
  td .chip {
    margin: 1px;
  }
  .links {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .links a {
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
  }
  .links a:hover {
    text-decoration: underline;
  }
  tr.store-only strong {
    color: var(--muted);
    font-weight: 500;
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .grp {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 2px 8px 6px;
  }
  .grp.dim .grp-head strong {
    color: var(--muted);
  }
  .grp-head {
    all: unset;
    cursor: pointer;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    width: 100%;
    padding: 6px 0;
    color: var(--text);
    font-size: 13px;
  }
  .grp-head:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .caret {
    width: 10px;
    color: var(--muted);
  }
  .grp table td {
    border-bottom: 0;
    border-top: 1px solid var(--line);
  }
  .get {
    padding-top: 6px;
  }
  button.link {
    all: unset;
    cursor: pointer;
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
  }
  .scroll {
    overflow-x: auto;
  }
  .cmp th,
  .cmp td {
    min-width: 170px;
    vertical-align: top;
  }
  .cmp tbody th {
    min-width: 120px;
    color: var(--muted);
  }
  .cmp thead th div {
    margin: 6px 0;
    color: var(--text);
    font-size: 13px;
  }
  .cmp a {
    color: var(--text);
  }
</style>
