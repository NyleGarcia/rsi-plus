<script lang="ts">
  import type { Component } from 'svelte';
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
  import BrowsePanel from '@/components/BrowsePanel.svelte';
  import CcuPanel from '@/components/CcuPanel.svelte';
  import SettingsPanel from '@/components/SettingsPanel.svelte';
  import AccountSwitch from '@/components/AccountSwitch.svelte';
  import NavItem from './NavItem.svelte';
  import SidebarSupport from './SidebarSupport.svelte';
  import FanNotice from '@/components/FanNotice.svelte';
  import SidebarFan from './SidebarFan.svelte';
  import * as Sidebar from '@/components/ui/sidebar';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Separator } from '@/components/ui/separator';
  import { Badge } from '@/components/ui/badge';
  import Rss from '@lucide/svelte/icons/rss';
  import Eye from '@lucide/svelte/icons/eye';
  import Users from '@lucide/svelte/icons/users';
  import VolumeX from '@lucide/svelte/icons/volume-x';
  import Warehouse from '@lucide/svelte/icons/warehouse';
  import Ship from '@lucide/svelte/icons/ship';
  import Package from '@lucide/svelte/icons/package';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Wallet from '@lucide/svelte/icons/wallet';
  import Store from '@lucide/svelte/icons/store';
  import Route from '@lucide/svelte/icons/route';
  import Paintbrush from '@lucide/svelte/icons/paintbrush';
  import Calculator from '@lucide/svelte/icons/calculator';
  import Palette from '@lucide/svelte/icons/palette';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Settings from '@lucide/svelte/icons/settings';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import { Button } from '@/components/ui/button';
  import { cn } from '@/lib/utils';
  import { privacy, togglePrivacy } from '@/lib/privacy.svelte';
  import type { HubTab } from '@/lib/messages';
  import { INCOGNITO } from '@/lib/settings';
  import { legacyHash } from '@/lib/hub-hash';

  type Tab = HubTab;
  /** A sidebar entry = one hub page (`#<tab>`). No second-level tab bars: every view people switch between is its own entry. */
  interface Item {
    tab: Tab;
    label: string;
    sub: string;
    icon: Component;
  }
  const GROUPS: { label: string; items: Item[] }[] = [
    {
      label: 'Spectrum',
      items: [
        { tab: 'feed', label: 'Feed', sub: 'What your watches found', icon: Rss },
        { tab: 'watching', label: 'Watching', sub: 'Threads, channels, authors, bells', icon: Eye },
        { tab: 'friends', label: 'Friends', sub: 'List, requests, orgs, party mode', icon: Users },
        { tab: 'mutes', label: 'Mutes', sub: 'Authors, keywords, labels', icon: VolumeX },
      ],
    },
    {
      label: 'Hangar',
      items: [
        { tab: 'hangar', label: 'Pledges', sub: 'Every pledge in your hangar', icon: Warehouse },
        { tab: 'melt', label: 'Melt calculator', sub: 'Tick pledges, see credit and losses', icon: Calculator },
        { tab: 'fleet', label: 'My ships', sub: 'Hulls, insurance, compare, export', icon: Ship },
        { tab: 'paints', label: 'Paints by ship', sub: 'Owned vs missing paints per hull', icon: Palette },
        { tab: 'items', label: 'My items', sub: 'Everything else in your pledges', icon: Package },
        { tab: 'buyback', label: 'Buyback', sub: 'What you melted', icon: Undo2 },
        { tab: 'wallet', label: 'Wallet', sub: "Credits, spend, Chairman's Club, funding", icon: Wallet },
      ],
    },
    {
      label: 'Store',
      items: [
        { tab: 'store', label: 'Ship catalog', sub: 'Every hull · MSRP, CCUs, warbond, wishlist', icon: Store },
        { tab: 'browse', label: 'Browse', sub: 'Paints, packs, gear · Concierge · Subscribers', icon: LayoutGrid },
        { tab: 'ccu', label: 'CCU planner', sub: 'Upgrade chains, cart', icon: Route },
        { tab: 'paint-rebuy', label: 'Paint rebuy', sub: 'Melt paints, buy them back bundled', icon: Paintbrush },
      ],
    },
  ];
  /** Settings sits in the header (gear) rather than the nav: 15 page entries + footer already fill an 800px window. */
  const SETTINGS: Item = { tab: 'settings', label: 'Settings', sub: 'Theme, Spectrum, notifications', icon: Settings };
  const ITEMS = [...GROUPS.flatMap((g) => g.items), SETTINGS];
  const TABS = new Set<string>(ITEMS.map((i) => i.tab));

  /** `#tab` or `#tab?key=value` (e.g. `#ccu?to=42` from Store / the RSI page button, `#browse?who=concierge`). */
  function fromHash(): Tab {
    const l = legacyHash(location.hash);
    if (l) history.replaceState(null, '', l);
    const h = location.hash.slice(1).split('?')[0] ?? '';
    return TABS.has(h) ? (h as Tab) : 'feed';
  }
  const hashParam = (k: string) => new URLSearchParams(location.hash.split('?')[1] ?? '').get(k);

  let tab = $state<Tab>(fromHash());
  let ccuTo = $state<number | null>(Number(hashParam('to')) || null);
  let ccuAhead = $state(hashParam('ahead') === '1'); // `#ccu?to=&ahead=1`: the hull isn't on sale, start with Plan ahead on

  $effect(() => {
    const onHash = () => ((tab = fromHash()), (ccuTo = Number(hashParam('to')) || null), (ccuAhead = hashParam('ahead') === '1'));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  const current = $derived(ITEMS.find((i) => i.tab === tab)!);

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
            <Badge variant="outline" class="text-muted-foreground h-[18px] rounded-md px-1.5 text-[11px] font-semibold group-data-[collapsible=icon]:hidden" title="Incognito: separate login, friends, hangar, reads and party mode">incognito</Badge>
          {/if}
        </div>
      </Sidebar.Header>
      <Sidebar.Content>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <nav aria-label="Sections" onkeydown={onKey}>
          {#each GROUPS as g (g.label)}
            <Sidebar.Group class="py-1">
              <Sidebar.GroupLabel>{g.label}</Sidebar.GroupLabel>
              <Sidebar.GroupContent>
                <Sidebar.Menu>
                  {#each g.items as it (it.tab)}
                    <NavItem id={`nav-${it.tab}`} label={it.label} sub={it.sub} icon={it.icon} active={it === current} onselect={() => select(it)} />
                  {/each}
                </Sidebar.Menu>
              </Sidebar.GroupContent>
            </Sidebar.Group>
          {/each}
        </nav>
      </Sidebar.Content>
      <Sidebar.Footer>
        <SidebarSupport />
        <SidebarFan />
      </Sidebar.Footer>
      <Sidebar.Rail />
    </Sidebar.Root>

    <Sidebar.Inset class="min-w-0">
      <header class="bg-background/85 sticky top-0 z-10 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 backdrop-blur">
        <Sidebar.Trigger class="-ml-1" />
        <Separator orientation="vertical" class="h-5" />
        <div class="grid min-w-0 flex-1 leading-tight">
          <h2 id="hub-title" class="m-0 truncate text-base font-semibold">{current.label}</h2>
          <span class="text-muted-foreground truncate text-xs">{current.sub}</span>
        </div>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant={privacy.on ? 'outline' : 'ghost'} size={privacy.on ? 'sm' : 'icon-sm'} class={cn(privacy.on && 'border-warning/60 text-warning hover:text-warning')} aria-pressed={privacy.on} onclick={togglePrivacy}>
                <EyeOff aria-hidden="true" />{#if privacy.on}Screenshare{/if}
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{privacy.on ? 'Screenshare mode on — spend, credit and account names hidden. Click to show them.' : 'Screenshare mode: hide spend, store credit, buyback prices, spend charts and account names'}</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button {...props} id="nav-settings" variant="ghost" size="icon-sm" class={cn(tab === 'settings' && 'bg-accent text-primary')} aria-pressed={tab === 'settings'} aria-controls="panel" onclick={() => select(SETTINGS)}>
                <Settings aria-hidden="true" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Settings — theme, Spectrum, notifications</Tooltip.Content>
        </Tooltip.Root>
        <AccountSwitch />
      </header>

      <main id="panel" class="mx-auto w-full max-w-[1800px] min-w-0 p-6 pb-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:px-3" aria-labelledby="hub-title" tabindex="-1">
        {#if tab === 'feed'}
          <FeedPanel />
        {:else if tab === 'watching'}
          <WatchingPanel />
        {:else if tab === 'friends'}
          <FriendsPanel />
        {:else if tab === 'hangar' || tab === 'melt'}
          <!-- One instance for both pages: the melt ticks and filters survive switching between them. -->
          <HangarPanel pane={tab === 'melt' ? 'melt' : 'pledges'} />
        {:else if tab === 'wallet'}
          <WalletPanel />
        {:else if tab === 'paints' || tab === 'fleet' || tab === 'paint-rebuy'}
          <ShipsPanel view={tab === 'fleet' ? 'ships' : tab === 'paint-rebuy' ? 'bundle' : 'paints'} />
        {:else if tab === 'items'}
          <ItemsPanel />
        {:else if tab === 'buyback'}
          <BuybackPanel />
        {:else if tab === 'store'}
          <StorePanel />
        {:else if tab === 'browse'}
          <BrowsePanel />
        {:else if tab === 'ccu'}
          <CcuPanel initialTo={ccuTo} initialAhead={ccuAhead} />
        {:else if tab === 'settings'}
          <SettingsPanel />
        {:else}
          <MutesPanel />
        {/if}
        <FanNotice variant="footer" class="mt-10" />
      </main>
    </Sidebar.Inset>
  </Sidebar.Provider>
</Tooltip.Provider>
