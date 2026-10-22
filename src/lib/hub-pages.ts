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
import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';

export interface HubPage {
  tab: Exclude<HubTab, 'ships'>;
  label: string;
  /** One line under the label in the sidebar / its tooltip when collapsed. */
  sub: string;
  icon: Component;
  /** Shown in the popup's shortcut grid. */
  popup?: boolean;
  /** Shorter label for the popup grid (a third of 300 px); `label` when absent. */
  short?: string;
}
export interface HubGroup {
  label: string;
  items: HubPage[];
}

export const HUB_GROUPS: HubGroup[] = [
  {
    label: 'Spectrum',
    items: [
      { tab: 'feed', label: 'Feed', sub: 'What your watches found', icon: Rss, popup: true, short: 'Feed' },
      { tab: 'watching', label: 'Watching', sub: 'Threads, channels, authors, bells', icon: Eye },
      { tab: 'friends', label: 'Friends', sub: 'List, requests, orgs, party mode', icon: Users, popup: true, short: 'Friends' },
      { tab: 'mutes', label: 'Mutes', sub: 'Authors, keywords, labels', icon: VolumeX },
    ],
  },
  {
    label: 'Hangar',
    items: [
      { tab: 'hangar', label: 'Pledges', sub: 'Every pledge, filters, exports', icon: Warehouse, popup: true, short: 'Pledges' },
      { tab: 'fleet', label: 'Ships', sub: 'Hulls you own: insurance, size, stage, compare', icon: Ship, popup: true, short: 'Ships' },
      { tab: 'ccus', label: 'CCUs', sub: 'Upgrades you hold, in the hangar and buyback', icon: ArrowUpRight, popup: true, short: 'CCUs' },
      { tab: 'items', label: 'Items', sub: 'Gear, paints, flair in your pledges', icon: Package },
      { tab: 'paints', label: 'Paints by ship', sub: 'Owned vs missing paints per hull', icon: Palette },
      { tab: 'buyback', label: 'Buyback', sub: 'What you melted', icon: Undo2 },
      { tab: 'wallet', label: 'Wallet', sub: "Credits, spend, Chairman's Club, funding", icon: Wallet, popup: true, short: 'Wallet' },
    ],
  },
  {
    label: 'Store',
    items: [
      { tab: 'store', label: 'Ship catalog', sub: 'Every hull · MSRP, CCUs, warbond, size, stage', icon: Store, popup: true, short: 'Catalog' },
      { tab: 'browse', label: 'Browse', sub: 'Paints, packs, gear · limited time, new, special', icon: LayoutGrid },
      { tab: 'notifications', label: 'Store changes', sub: 'What was added and removed', icon: BellRing, popup: true, short: 'Changes' },
    ],
  },
  {
    label: 'Plan',
    items: [
      { tab: 'ccu', label: 'CCU planner', sub: 'Upgrade chains, cart', icon: Route, popup: true, short: 'Planner' },
      { tab: 'paint-rebuy', label: 'Paint rebuy', sub: 'Melt paints, buy them back bundled', icon: Paintbrush },
      { tab: 'melt', label: 'Melt calculator', sub: 'Tick pledges, see credit and losses', icon: Calculator },
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
