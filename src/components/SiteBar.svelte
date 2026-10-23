<script lang="ts">
  import { bg, type HubTab } from '@/lib/messages';
  import { catalogItem, getSettings, settingsItem, wishlistItem, type WishShip } from '@/lib/settings';
  import { isWarbondSku, lowestOffer, usd, type Catalog, type CatalogShip } from '@/lib/store';
  import './site-bar.css';

  let path = $state(location.pathname);
  let enabled = $state(true);
  let cat = $state<Catalog | null>(null);
  let wish = $state<WishShip[]>([]);
  let hidden = $state(false);

  $effect(() => {
    getSettings().then((s) => (enabled = s.siteBar));
    catalogItem.getValue().then((c) => (cat = c));
    wishlistItem.getValue().then((w) => (wish = w));
    const offs = [
      settingsItem.watch(async () => (enabled = (await getSettings()).siteBar)),
      catalogItem.watch((c) => (cat = c)),
      wishlistItem.watch((w) => (wish = w ?? [])),
    ];
    const on = () => (path = location.pathname);
    window.addEventListener('wxt:locationchange', on);
    // Refresh the public catalog in the background if stale (no-op when fresh).
    bg({ type: 'catalog:get' }).catch(() => {});
    return () => (offs.forEach((o) => o()), window.removeEventListener('wxt:locationchange', on));
  });

  /** Ship page path without the locale prefix: /en/pledge/ships/x/y → /pledge/ships/x/y (case-insensitive). */
  const norm = (p: string) => p.replace(/^\/[a-z]{2}(?=\/)/, '').replace(/\/$/, '').toLowerCase();
  const ship = $derived.by((): CatalogShip | null => {
    if (!/\/pledge\/ships\//i.test(path) || !cat) return null;
    const here = norm(path);
    return cat.ships.find((s) => s.link && norm(new URL(s.link).pathname) === here) ?? null;
  });
  const page = $derived(/\/account\/pledges/.test(path) ? 'hangar' : /\/account\/buy-back-pledges/.test(path) ? 'buyback' : /\/pledge\/ship-upgrades/.test(path) ? 'upgrades' : null);
  const offer = $derived(ship ? lowestOffer(ship) : null);
  const wb = $derived(ship?.ccu.find((k) => isWarbondSku(k) && k.available) ?? null);
  const wished = $derived(!!ship && wish.some((w) => w.id === ship.id));

  async function toggleWish() {
    if (!ship) return;
    const cur = await wishlistItem.getValue();
    await wishlistItem.setValue(cur.some((w) => w.id === ship.id) ? cur.filter((w) => w.id !== ship.id) : [...cur, { id: ship.id, name: ship.name, lowest: offer?.price ?? null }]);
  }
  const hub = (tab: HubTab, params?: Record<string, string>) => bg({ type: 'hub:open', tab, params });
</script>

{#if enabled && !hidden && (ship || page)}
  <div class="bar rp rp-surface" role="toolbar" aria-label="RSI+">
    <span class="logo">RSI+</span>
    {#if ship}
      <span><strong>{ship.name}</strong> <span class="muted">MSRP {usd(ship.msrp)}</span></span>
      {#if wb}<span class="wb">Warbond CCU {usd(wb.price)}</span>{:else if offer}<span class="muted">{offer.title} {usd(offer.price)}</span>{/if}
      <button class="btn" class:on={wished} onclick={toggleWish} aria-describedby="rp-wish-hint">{wished ? '★ Wishlisted' : '☆ Wishlist'}</button>
      <span id="rp-wish-hint" class="muted">alerts on a warbond / lower price</span>
      <button class="btn" onclick={() => hub('ccu', { to: String(ship.id) })}>Plan CCU</button>
    {:else if page === 'hangar'}
      <span class="muted">Whole hangar: melt totals, filters, CSV</span>
      <button class="btn" onclick={() => hub('hangar')}>Open RSI+ Hangar</button>
    {:else if page === 'buyback'}
      <button class="btn" onclick={() => hub('buyback')}>Open RSI+ Buyback</button>
    {:else if page === 'upgrades'}
      <span class="muted">Find the cheapest chain first</span>
      <button class="btn" onclick={() => hub('ccu')}>CCU planner</button>
    {/if}
    <button class="x" aria-label="Hide" onclick={() => (hidden = true)}>×</button>
  </div>
{/if}

<style>
  /* Palette, buttons, logo: site-bar.css (shared with ThreadBar). */
  .bar {
    position: fixed;
    right: 18px;
    bottom: 18px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    max-width: calc(100vw - 36px);
    flex-wrap: wrap;
  }
  .wb {
    color: var(--rp-gold);
    font-weight: 600;
  }
</style>
