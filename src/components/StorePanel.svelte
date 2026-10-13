<script lang="ts">
  import { bg } from '@/lib/messages';
  import { inventory, ownedShipsWithPaints, type OwnedShip } from '@/lib/items';
  import { catalogItem, hangarItem, wishlistItem, type WishShip } from '@/lib/settings';
  import { isWarbondSku, lowestOffer, usd, type Catalog, type CatalogShip } from '@/lib/store';
  import { sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';

  let cat = $state<Catalog | null>(null);
  let wish = $state<WishShip[]>([]);
  let hangar = $state<Awaited<ReturnType<typeof hangarItem.getValue>>>(null);
  /** Ships you own (from the hangar) → copies + insurance, keyed by catalog id. */
  const owned = $derived.by(() => {
    const ships = cat?.ships ?? [];
    const fleet = hangar && ships.length ? ownedShipsWithPaints(inventory(hangar.pledges, ships)) : [];
    return new Map<number, OwnedShip>(fleet.map((f) => [f.ship.id, f]));
  });
  let error = $state('');
  let loading = $state(false);
  let q = $state('');
  let maker = $state('');
  let only = $state<'' | 'wish' | 'warbond' | 'standalone' | 'ccu' | 'owned' | 'not-owned'>('');
  type Col = 'wish' | 'name' | 'msrp' | 'offer' | 'saving';
  let sort = $state<SortState<Col>>({ key: 'msrp', dir: 'asc' });

  $effect(() => {
    catalogItem.getValue().then((c) => (cat = c));
    wishlistItem.getValue().then((w) => (wish = w));
    hangarItem.getValue().then((h) => (hangar = h));
    refresh(false);
    const offs = [catalogItem.watch((c) => (cat = c)), wishlistItem.watch((w) => (wish = w ?? [])), hangarItem.watch((h) => (hangar = h))];
    return () => offs.forEach((o) => o());
  });

  async function refresh(fresh: boolean) {
    loading = true;
    error = '';
    try {
      cat = await bg({ type: 'catalog:get', fresh });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  const wished = (id: number) => wish.some((w) => w.id === id);
  async function toggleWish(s: CatalogShip) {
    const cur = await wishlistItem.getValue();
    await wishlistItem.setValue(
      cur.some((w) => w.id === s.id) ? cur.filter((w) => w.id !== s.id) : [...cur, { id: s.id, name: s.name, lowest: lowestOffer(s)?.price ?? null }],
    );
  }

  const makers = $derived([...new Set((cat?.ships ?? []).map((s) => s.manufacturer).filter(Boolean))].sort());
  const warbondOf = (s: CatalogShip) => s.ccu.find((k) => isWarbondSku(k) && k.available);
  const saving = (s: CatalogShip) => {
    const o = lowestOffer(s);
    return o && s.msrp ? s.msrp - o.price : 0;
  };
  const shown = $derived.by(() => {
    const query = q.trim().toLowerCase();
    const list = (cat?.ships ?? []).filter(
      (s) =>
        (!maker || s.manufacturer === maker) &&
        (!query || `${s.name} ${s.manufacturer} ${s.focus}`.toLowerCase().includes(query)) &&
        (only === '' ||
          (only === 'wish' && wished(s.id)) ||
          (only === 'warbond' && !!warbondOf(s)) ||
          (only === 'standalone' && s.standalone.some((k) => k.available)) ||
          (only === 'ccu' && s.ccu.length > 0) ||
          (only === 'owned' && owned.has(s.id)) ||
          (only === 'not-owned' && !owned.has(s.id))),
    );
    const byName = [...list].sort((a, b) => a.name.localeCompare(b.name)); // tie order
    return sortBy(byName, sort, {
      wish: (s) => wished(s.id),
      name: (s) => s.name,
      msrp: (s) => s.msrp || null,
      offer: (s) => lowestOffer(s)?.price ?? null,
      saving: (s) => saving(s) || null,
    });
  });
</script>

<section class="card stack">
  <div class="row spread">
    <div>
      <h2>Store</h2>
      <span class="muted">
        {cat ? `${cat.ships.length} ships · prices from ${new Date(cat.at).toLocaleString()}` : loading ? 'Loading…' : ''}
        · ★ wishlist alerts when a warbond / sale price appears (checked every 30 min)
      </span>
    </div>
    <button class="btn" disabled={loading} onclick={() => refresh(true)}>{loading ? 'Loading…' : 'Refresh prices'}</button>
  </div>
  {#if error}<span class="err">{error}</span>{/if}
  <div class="row">
    <input placeholder="Search ship, maker, role" bind:value={q} aria-label="Search ships" />
    <select bind:value={maker} aria-label="Manufacturer">
      <option value="">All makers</option>
      {#each makers as m (m)}<option value={m}>{m}</option>{/each}
    </select>
    <select bind:value={only} aria-label="Show">
      <option value="">All ships</option>
      <option value="wish">★ Wishlist ({wish.length})</option>
      <option value="warbond">Warbond CCU on sale</option>
      <option value="standalone">Standalone on sale</option>
      <option value="ccu">Any CCU on sale</option>
      <option value="owned">Ships I own ({owned.size})</option>
      <option value="not-owned">Ships I don't own</option>
    </select>
  </div>
  <table>
    <thead>
      <tr>
        <SortTh key="wish" bind:sort firstDir="desc">★</SortTh>
        <SortTh key="name" bind:sort>Ship</SortTh>
        <SortTh key="msrp" bind:sort>MSRP</SortTh>
        <SortTh key="offer" bind:sort>On sale</SortTh>
        <SortTh key="saving" bind:sort firstDir="desc">Discount</SortTh>
      </tr>
    </thead>
    <tbody>
      {#each shown as s (s.id)}
        {@const wb = warbondOf(s)}
        <tr>
          <td><button class="star" class:on={wished(s.id)} onclick={() => toggleWish(s)} aria-label="Wishlist">{wished(s.id) ? '★' : '☆'}</button></td>
          <td>
            <div class="who">
              {#if s.thumb}<img src={s.thumb} alt="" width="64" height="36" loading="lazy" />{/if}
              <div>
                <a href={s.link} target="_blank" rel="noopener"><strong>{s.name}</strong></a>
                <div class="muted small">{s.manufacturer} · {s.focus} · {s.flyable}</div>
                {#if owned.get(s.id)}
                  {@const o = owned.get(s.id)!}
                  <div class="small"><span class="chip own">owned ×{o.count}</span> {#each o.insurance as i (i)}<span class="chip" class:lti={i === 'LTI'}>{i}</span>{/each}</div>
                {/if}
              </div>
            </div>
          </td>
          <td>{s.msrp ? usd(s.msrp) : '—'}</td>
          <td class="offers">
            {#if wb}<span class="chip wb">WB {usd(wb.price)}{wb.stock != null ? ` · ${wb.stock} left` : ''}</span>{/if}
            {#each s.ccu.filter((k) => k !== wb) as k (k.id)}<span class="chip">{k.title || 'CCU'} {usd(k.price)}</span>{/each}
            {#each s.standalone.filter((k) => k.available) as k (k.id)}<span class="chip sa">Standalone {usd(k.price)}</span>{/each}
            {#if !s.ccu.length && !s.standalone.some((k) => k.available)}<span class="muted small">not on sale</span>{/if}
          </td>
          <td>
            {#if saving(s) > 0}<div class="ok small">−{usd(saving(s))}</div>{/if}
            <a class="btn small" href={`#ccu?to=${s.id}`}>Plan CCU</a>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .who {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .who img {
    border-radius: 6px;
    object-fit: cover;
  }
  .who a {
    color: var(--text);
    text-decoration: none;
  }
  .small {
    font-size: 11px;
  }
  .star {
    border: 0;
    background: none;
    font-size: 17px;
    color: var(--muted);
  }
  .star.on {
    color: #ffd166;
  }
  .offers .chip {
    margin: 1px;
  }
  .chip.wb {
    color: #ffd166;
    border-color: rgb(255 209 102 / 0.4);
  }
  .chip.sa,
  .chip.own {
    color: var(--ok);
  }
  .chip.lti {
    color: #ffd166;
    border-color: rgb(255 209 102 / 0.4);
  }
</style>
