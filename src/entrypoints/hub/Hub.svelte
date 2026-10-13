<script lang="ts">
  import FeedPanel from '@/components/FeedPanel.svelte';
  import WatchingPanel from '@/components/WatchingPanel.svelte';
  import FriendsPanel from '@/components/FriendsPanel.svelte';
  import MutesPanel from '@/components/MutesPanel.svelte';
  import HangarPanel from '@/components/HangarPanel.svelte';
  import WalletPanel from '@/components/WalletPanel.svelte';
  import BuybackPanel from '@/components/BuybackPanel.svelte';
  import ItemsPanel from '@/components/ItemsPanel.svelte';
  import ShipsPanel from '@/components/ShipsPanel.svelte';
  import StorePanel from '@/components/StorePanel.svelte';
  import CcuPanel from '@/components/CcuPanel.svelte';
  import AccountSwitch from '@/components/AccountSwitch.svelte';
  import type { HubTab } from '@/lib/messages';
  import { INCOGNITO } from '@/lib/settings';

  type Tab = HubTab;
  const TABS: { id: Tab; label: string }[] = [
    { id: 'feed', label: 'Feed' },
    { id: 'friends', label: 'Friends' },
    { id: 'hangar', label: 'Hangar' },
    { id: 'wallet', label: 'Wallet' },
    { id: 'ships', label: 'Ships & paints' },
    { id: 'items', label: 'Items' },
    { id: 'buyback', label: 'Buyback' },
    { id: 'store', label: 'Store' },
    { id: 'ccu', label: 'CCU planner' },
    { id: 'watching', label: 'Watching' },
    { id: 'mutes', label: 'Mutes' },
  ];

  /** `#tab` or `#tab?key=value` (e.g. `#ccu?to=42` from Store / the RSI page button). */
  function fromHash(): Tab {
    const h = location.hash.slice(1).split('?')[0];
    return TABS.some((t) => t.id === h) ? (h as Tab) : 'feed';
  }
  const hashParam = (k: string) => new URLSearchParams(location.hash.split('?')[1] ?? '').get(k);

  let tab = $state<Tab>(fromHash());
  let ccuTo = $state<number | null>(Number(hashParam('to')) || null);

  $effect(() => {
    const onHash = () => ((tab = fromHash()), (ccuTo = Number(hashParam('to')) || null));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  function select(id: Tab) {
    tab = id;
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  }

  function onKey(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    const next = TABS[n];
    if (!next) return;
    e.preventDefault();
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }
</script>

<div class="wrap">
  <header>
    <div class="brand">
      <h1>RSI<span>+</span>{#if INCOGNITO}<em class="incog" title="Incognito: separate login, friends, hangar, reads and party mode">incognito</em>{/if}</h1>
      <AccountSwitch />
    </div>
    <div class="tabs" role="tablist" aria-label="Sections" tabindex="-1" onkeydown={onKey}>
      {#each TABS as t (t.id)}
        <button
          id={`tab-${t.id}`}
          role="tab"
          aria-selected={tab === t.id}
          aria-controls="panel"
          tabindex={tab === t.id ? 0 : -1}
          class:on={tab === t.id}
          onclick={() => select(t.id)}
        >
          {t.label}
        </button>
      {/each}
    </div>
  </header>

  <div id="panel" class="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabindex="0">
    {#if tab === 'feed'}
      <FeedPanel />
    {:else if tab === 'watching'}
      <WatchingPanel />
    {:else if tab === 'friends'}
      <FriendsPanel />
    {:else if tab === 'hangar'}
      <HangarPanel />
    {:else if tab === 'wallet'}
      <WalletPanel />
    {:else if tab === 'ships'}
      <ShipsPanel />
    {:else if tab === 'items'}
      <ItemsPanel />
    {:else if tab === 'buyback'}
      <BuybackPanel />
    {:else if tab === 'store'}
      <StorePanel />
    {:else if tab === 'ccu'}
      <CcuPanel initialTo={ccuTo} />
    {:else}
      <MutesPanel />
    {/if}
  </div>
</div>

<style>
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 32px 24px 48px;
    display: grid;
    gap: 24px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
  }
  h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.01em;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .incog {
    margin-left: 8px;
    padding: 1px 6px;
    border: 1px solid var(--line);
    border-radius: 6px;
    font-size: 11px;
    font-style: normal;
    font-weight: 600;
    color: var(--muted);
    vertical-align: middle;
  }
  h1 span {
    color: var(--accent);
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    padding: 3px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.05);
    border: 1px solid var(--line);
  }
  .tabs button {
    border: 0;
    background: none;
    padding: 8px 16px;
    border-radius: 8px;
    color: var(--muted);
    font-weight: 650;
    white-space: nowrap;
  }
  .tabs button:hover {
    color: var(--text);
  }
  .tabs button.on {
    background: var(--accent);
    color: #04121a;
  }
  .tabs button:focus-visible,
  .panel:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .panel {
    min-width: 0;
  }
  @media (max-width: 520px) {
    .wrap {
      padding: 32px 12px;
    }
    header {
      flex-direction: column;
      align-items: stretch;
    }
    .tabs button {
      padding: 8px 8px;
      flex: 1 1 auto;
    }
  }
</style>
