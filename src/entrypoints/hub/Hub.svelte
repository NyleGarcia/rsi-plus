<script lang="ts">
  import type { Component } from 'svelte';
  import SkeletonSwap from '@/components/SkeletonSwap.svelte';
  import AccountSwitch from '@/components/AccountSwitch.svelte';
  import NavItem from './NavItem.svelte';
  import HubFooter from './HubFooter.svelte';
  import ProductTour, { type TourStep } from '@/components/ProductTour.svelte';
  import * as Sidebar from '@/components/ui/sidebar';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Separator } from '@/components/ui/separator';
  import HintBadge from '@/components/HintBadge.svelte';
  import TipButton from '@/components/TipButton.svelte';
  import Settings from '@lucide/svelte/icons/settings';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import { cn } from '@/lib/utils';
  import { privacy, togglePrivacy } from '@/lib/privacy.svelte';
  import type { HubTab } from '@/lib/messages';
  import { HUB_GROUPS, HUB_PAGES, SETTINGS_PAGE, isHubTab, pageOf, type HubPage } from '@/lib/hub-pages';
  import { INCOGNITO, feedItem, storeLogItem } from '@/lib/settings';
  import { cleanLog, tally } from '@/lib/storelog';
  import { legacyHash } from '@/lib/hub-hash';

  type Tab = HubTab;
  /** A sidebar entry = one hub page (`#<tab>`). No second-level tab bars: every view people switch between is its own entry.
   *  Settings sits in the header (gear) rather than the nav: 15 page entries + footer already fill an 800px window. */
  type Item = HubPage;
  const ITEMS = HUB_PAGES;

  /** `#tab` or `#tab?key=value` (e.g. `#ccu?to=42` from Store / the RSI page button, `#browse?who=concierge`). */
  function fromHash(): Tab {
    const l = legacyHash(location.hash);
    if (l) history.replaceState(null, '', l);
    const h = location.hash.slice(1).split('?')[0] ?? '';
    return isHubTab(h) ? pageOf(h).tab : 'feed'; // pageOf folds the legacy `ships` alias
  }
  const hashParam = (k: string) => new URLSearchParams(location.hash.split('?')[1] ?? '').get(k);

  const TOUR: TourStep[] = [
    { icon: pageOf('hangar').icon, title: 'Load your hangar', description: 'Pledges reads every page of your RSI hangar into this browser — melt values, insurance, CCUs, items. Nothing leaves it.', href: '#hangar', linkLabel: 'Open Pledges' },
    { icon: pageOf('fleet').icon, title: 'Ships, CCUs, paints', description: 'Your hulls with size and stage, every upgrade you hold with what it saves, and the paints you own per ship.', href: '#fleet', linkLabel: 'Open Ships' },
    { icon: pageOf('store').icon, title: 'The store, filtered', description: 'Ship catalog and Browse show what RSI sells right now — warbond, limited time, new, Concierge — with your hangar matched against it.', href: '#store', linkLabel: 'Open Ship catalog' },
    { icon: pageOf('ccu').icon, title: 'Plan upgrades', description: 'The CCU planner finds the cheapest chain to a ship using CCUs on sale and the ones you already own, then fills your RSI cart.', href: '#ccu', linkLabel: 'Open the planner' },
    { icon: pageOf('feed').icon, title: 'Feed', description: 'Watched Spectrum threads, friends coming online, friend requests, store alerts and store changes land here. Settings has the switches.', href: '#feed', linkLabel: 'Open Feed' },
  ];
  let tab = $state<Tab>(fromHash());
  /**
   * The page whose panel is mounted: follows `tab` one paint later. A click first paints the nav highlight and the
   * title, then the panel swap (tearing down a 17k-node Pledges table, building the next page) runs in its own task —
   * in the click's frame it held the next paint for 200–800 ms (INP).
   */
  // svelte-ignore state_referenced_locally
  let paneTab = $state<Tab>(tab);
  $effect(() => {
    const t = tab;
    let timer = 0;
    const raf = requestAnimationFrame(() => (timer = window.setTimeout(() => (paneTab = t))));
    return () => (cancelAnimationFrame(raf), clearTimeout(timer));
  });

  /**
   * Panels load on first visit (one chunk each) instead of all fifteen up front: the hub chunk was 1.1 MB parsed on
   * every open. The rest are fetched in idle time after the first panel paints, so switching stays instant. A loaded
   * panel stays loaded (same component instance rules as before: Pledges / Melt share one, Paints / Fleet / Paint rebuy share one).
   */
  const LOADERS = {
    feed: () => import('@/components/FeedPanel.svelte'),
    watching: () => import('@/components/WatchingPanel.svelte'),
    friends: () => import('@/components/FriendsPanel.svelte'),
    hangar: () => import('@/components/HangarPanel.svelte'),
    wallet: () => import('@/components/WalletPanel.svelte'),
    ships: () => import('@/components/ShipsPanel.svelte'),
    items: () => import('@/components/ItemsPanel.svelte'),
    buyback: () => import('@/components/BuybackPanel.svelte'),
    store: () => import('@/components/StorePanel.svelte'),
    browse: () => import('@/components/BrowsePanel.svelte'),
    ccus: () => import('@/components/CcusPanel.svelte'),
    ccu: () => import('@/components/CcuPanel.svelte'),
    settings: () => import('@/components/SettingsPanel.svelte'),
    mutes: () => import('@/components/MutesPanel.svelte'),
  } as const;
  type PanelKey = keyof typeof LOADERS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loaded = $state<Partial<Record<PanelKey, Component<any>>>>({});
  const panelKey = $derived<PanelKey>(
    paneTab === 'melt' ? 'hangar' : paneTab === 'fleet' || paneTab === 'paint-rebuy' || paneTab === 'paints' ? 'ships' : paneTab in LOADERS ? (paneTab as PanelKey) : 'mutes',
  );
  const Panel = $derived(loaded[panelKey]);
  const load = (k: PanelKey) => (loaded[k] ? Promise.resolve() : LOADERS[k]().then((m) => void (loaded[k] = m.default)));
  let prefetched = false;
  $effect(() => {
    const k = panelKey;
    void load(k).then(() => {
      if (prefetched) return;
      prefetched = true;
      const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
      idle(() => {
        for (const other of Object.keys(LOADERS) as PanelKey[]) if (other !== k) void load(other);
      });
    });
  });
  /** Feed entry badges: unseen events, and store changes not yet dismissed ("+32 −5"). */
  let notices = $state({ add: 0, remove: 0 });
  let unseen = $state(0);
  $effect(() => {
    storeLogItem.getValue().then((v) => (notices = tally(cleanLog(v))));
    feedItem.getValue().then((f) => (unseen = (f ?? []).filter((e) => !e.seen).length));
    const offs = [storeLogItem.watch((v) => (notices = tally(cleanLog(v)))), feedItem.watch((f) => (unseen = (f ?? []).filter((e) => !e.seen).length))];
    return () => offs.forEach((off) => off());
  });
  let ccuTo = $state<number | null>(Number(hashParam('to')) || null);
  let ccuAhead = $state(hashParam('ahead') === '1'); // `#ccu?to=&ahead=1`: the hull isn't on sale, start with Plan ahead on

  $effect(() => {
    const onHash = () => ((tab = fromHash()), (ccuTo = Number(hashParam('to')) || null), (ccuAhead = hashParam('ahead') === '1'));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  const current = $derived(pageOf(tab));

  function select(it: Item) {
    const hash = `#${it.tab}`;
    tab = it.tab;
    if (it.tab !== 'ccu') ccuTo = null;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  /** Up/Down/Home/End move between the nav entries (and select, like the old tab strip did). */
  function onKey(e: KeyboardEvent) {
    const i = ITEMS.indexOf(current);
    let n = -1;
    if (e.key === 'ArrowDown') n = (i + 1) % ITEMS.length;
    else if (e.key === 'ArrowUp') n = (i - 1 + ITEMS.length) % ITEMS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = ITEMS.length - 1;
    const next = ITEMS[n];
    if (!next) return;
    e.preventDefault();
    select(next);
    document.getElementById(`nav-${next.tab}`)?.focus();
  }

  /** Sidebar expanded/collapsed: a per-browser UI pref. */
  const SIDEBAR_PREF = 'rsiplus:hub:sidebar';
  let sidebarOpen = $state(
    (() => {
      try {
        return localStorage.getItem(SIDEBAR_PREF) !== 'collapsed';
      } catch {
        return true;
      }
    })(),
  );
  function onSidebar(open: boolean) {
    try {
      localStorage.setItem(SIDEBAR_PREF, open ? 'open' : 'collapsed');
    } catch {
      /* private mode etc. */
    }
  }
</script>

<Tooltip.Provider delayDuration={300}>
  <Sidebar.Provider bind:open={sidebarOpen} onOpenChange={onSidebar}>
    <Sidebar.Root collapsible="icon">
      <Sidebar.Header>
        <div class="flex h-8 items-center gap-2 px-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <h1 class="m-0 text-[19px] leading-none font-semibold tracking-tight whitespace-nowrap">
            RSI<span class="text-primary">+</span>
          </h1>
          {#if INCOGNITO}
            <HintBadge variant="muted" class="h-[18px] rounded-md px-1.5 text-[11px] font-semibold group-data-[collapsible=icon]:hidden" hint="Incognito: separate login, friends, hangar, reads and party mode">incognito</HintBadge>
          {/if}
        </div>
      </Sidebar.Header>
      <Sidebar.Content>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <nav aria-label="Sections" onkeydown={onKey}>
          {#each HUB_GROUPS as g (g.label)}
            <Sidebar.Group class="py-1">
              <Sidebar.GroupLabel>{g.label}</Sidebar.GroupLabel>
              <Sidebar.GroupContent>
                <Sidebar.Menu>
                  {#each g.items as it (it.tab)}
                    <NavItem id={`nav-${it.tab}`} label={it.label} sub={it.sub} icon={it.icon} active={it === current} count={it.tab === 'feed' ? unseen + notices.add + notices.remove : 0} badge={it.tab === 'feed' ? [unseen ? { text: String(unseen), tone: 'info' as const } : null, notices.add ? { text: `+${notices.add}`, tone: 'success' as const } : null, notices.remove ? { text: `−${notices.remove}`, tone: 'destructive' as const } : null].filter((b) => !!b) : []} onselect={() => select(it)} />
                  {/each}
                </Sidebar.Menu>
              </Sidebar.GroupContent>
            </Sidebar.Group>
          {/each}
        </nav>
      </Sidebar.Content>
      <Sidebar.Rail />
    </Sidebar.Root>

    <Sidebar.Inset class="min-w-0">
      <header class="bg-background sticky top-0 z-10 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
        <Sidebar.Trigger class="-ml-1" />
        <Separator orientation="vertical" class="h-5" />
        <div class="grid min-w-0 flex-1 leading-tight">
          <h2 id="hub-title" class="m-0 truncate text-base font-semibold">{current.label}</h2>
          <span class="text-muted-foreground truncate text-xs">{current.sub}</span>
        </div>
        <!-- One size in both states so the header doesn't jump; the state is the tone + aria-pressed, the words are in the tip. -->
        <TipButton
          variant={privacy.on ? 'outline' : 'ghost'}
          size="icon-sm"
          class={cn(privacy.on && 'border-warning/60 text-warning hover:text-warning')}
          aria-label="Screenshare mode"
          aria-pressed={privacy.on}
          onclick={togglePrivacy}
          tip={privacy.on ? 'Screenshare mode on — spend, credit and account names hidden. Click to show them.' : 'Screenshare mode: hide spend, store credit, buyback prices, spend charts and account names'}
        >
          <EyeOff aria-hidden="true" />
        </TipButton>
        <ProductTour steps={TOUR} />
        <TipButton
          id="nav-settings"
          variant="ghost"
          size="icon-sm"
          class={cn(tab === 'settings' && 'bg-accent text-primary')}
          aria-label={SETTINGS_PAGE.label}
          aria-pressed={tab === 'settings'}
          aria-controls="panel"
          onclick={() => select(SETTINGS_PAGE)}
          tip={`${SETTINGS_PAGE.label} — ${SETTINGS_PAGE.sub.toLowerCase()}`}
        >
          <Settings aria-hidden="true" />
        </TipButton>
        <AccountSwitch />
      </header>

      <main id="panel" class="mx-auto w-full max-w-[1800px] min-w-0 p-6 pb-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:px-3" aria-labelledby="hub-title" tabindex="-1">
        {#if !Panel}
          <SkeletonSwap ready={false} lines={8} lineHeight={44} label="Page"><div></div></SkeletonSwap>
        {:else if panelKey === 'hangar'}
          <!-- One instance for both pages: the melt ticks and filters survive switching between them. -->
          <Panel pane={paneTab === 'melt' ? 'melt' : 'pledges'} />
        {:else if panelKey === 'ships'}
          <Panel view={paneTab === 'fleet' ? 'ships' : paneTab === 'paint-rebuy' ? 'bundle' : 'paints'} />
        {:else if panelKey === 'ccu'}
          <Panel initialTo={ccuTo} initialAhead={ccuAhead} />
        {:else}
          <Panel />
        {/if}
      </main>
      <!-- Fankit: notice in an always-visible nav area (sidebar, short) and/or the home page — the footer carries the full one on every page. -->
      <HubFooter />
    </Sidebar.Inset>
  </Sidebar.Provider>
</Tooltip.Provider>
