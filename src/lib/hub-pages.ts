/**
 * The one list of hub pages: sidebar groups, popup shortcuts and in-app links all read it, so a label changes in one
 * place. `HubTab` (lib/messages.ts) stays the wire type for content scripts — they must not import icons.
 */
import type { Component } from 'svelte';
import type { HubTab } from './messages';
import Rss from '@lucide/svelte/icons/rss';
import Eye from '@lucide/svelte/icons/eye';
import Users from '@lucide/svelte/icons/users';
import VolumeX from '@lucide/svelte/icons/volume-x';
import Warehouse from '@lucide/svelte/icons/warehouse';
import Calculator from '@lucide/svelte/icons/calculator';
import Ship from '@lucide/svelte/icons/ship';
import Palette from '@lucide/svelte/icons/palette';
import Package from '@lucide/svelte/icons/package';
import Undo2 from '@lucide/svelte/icons/undo-2';
import Wallet from '@lucide/svelte/icons/wallet';
import BellRing from '@lucide/svelte/icons/bell-ring';
import Store from '@lucide/svelte/icons/store';
import LayoutGrid from '@lucide/svelte/icons/layout-grid';
import Route from '@lucide/svelte/icons/route';
import Paintbrush from '@lucide/svelte/icons/paintbrush';
import Settings from '@lucide/svelte/icons/settings';

export interface HubPage {
  tab: Exclude<HubTab, 'ships'>;
  label: string;
  /** One line under the label in the sidebar / its tooltip when collapsed. */
  sub: string;
  icon: Component;
  /** Shown in the popup's shortcut grid. */
  popup?: boolean;
}
export interface HubGroup {
  label: string;
  items: HubPage[];
}

export const HUB_GROUPS: HubGroup[] = [
  {
    label: 'Spectrum',
    items: [
      { tab: 'feed', label: 'Feed', sub: 'What your watches found', icon: Rss, popup: true },
      { tab: 'watching', label: 'Watching', sub: 'Threads, channels, authors, bells', icon: Eye },
      { tab: 'friends', label: 'Friends', sub: 'List, requests, orgs, party mode', icon: Users, popup: true },
      { tab: 'mutes', label: 'Mutes', sub: 'Authors, keywords, labels', icon: VolumeX },
    ],
  },
  {
    label: 'Hangar',
    items: [
      { tab: 'hangar', label: 'Pledges', sub: 'Every pledge in your hangar', icon: Warehouse, popup: true },
      { tab: 'melt', label: 'Melt calculator', sub: 'Tick pledges, see credit and losses', icon: Calculator },
      { tab: 'fleet', label: 'My ships', sub: 'Hulls, in-game ships, insurance, compare', icon: Ship, popup: true },
      { tab: 'paints', label: 'Paints by ship', sub: 'Owned vs missing paints per hull', icon: Palette },
      { tab: 'items', label: 'My items', sub: 'Everything else in your pledges', icon: Package },
      { tab: 'buyback', label: 'Buyback', sub: 'What you melted', icon: Undo2 },
      { tab: 'wallet', label: 'Wallet', sub: "Credits, spend, Chairman's Club, funding", icon: Wallet, popup: true },
    ],
  },
  {
    label: 'Store',
    items: [
      { tab: 'notifications', label: 'Notifications', sub: 'Store changes: what was added and removed', icon: BellRing, popup: true },
      { tab: 'store', label: 'Ship catalog', sub: 'Every hull · MSRP, CCUs, warbond, wishlist', icon: Store, popup: true },
      { tab: 'browse', label: 'Browse', sub: 'Paints, packs, gear · Concierge · Subscribers', icon: LayoutGrid },
      { tab: 'ccu', label: 'CCU planner', sub: 'Upgrade chains, cart', icon: Route, popup: true },
      { tab: 'paint-rebuy', label: 'Paint rebuy', sub: 'Melt paints, buy them back bundled', icon: Paintbrush },
    ],
  },
];
/** Settings sits in the hub header (gear), not the nav. */
export const SETTINGS_PAGE: HubPage = { tab: 'settings', label: 'Settings', sub: 'Theme, Spectrum, notifications', icon: Settings };
export const HUB_PAGES: HubPage[] = [...HUB_GROUPS.flatMap((g) => g.items), SETTINGS_PAGE];
const byTab = new Map(HUB_PAGES.map((p) => [p.tab, p]));
/** Page by tab (`ships` → My ships, the legacy alias). */
export const pageOf = (tab: HubTab): HubPage => byTab.get(tab === 'ships' ? 'fleet' : tab) ?? SETTINGS_PAGE;
export const isHubTab = (s: string): s is HubTab => byTab.has(s as HubPage['tab']) || s === 'ships';
