import { storage } from '#imports';
import { NO_MUTES, type MuteRules } from './filters';
import type { FriendNotes, PartyLogEntry, PartyMode } from './friends';
import type { OrgCache } from './orgs';
import type { SavedChain } from './ccu';
import type { BuybackItem, Credits, Pledge } from './hangar';
import type { Catalog, PaintCatalog, StoreListing } from './store';
import type { Concierge } from './concierge';
import type { Profiles } from './accounts';
import type { ReadState } from './read';
import type { Funding, FundingRange } from './wallet';
import { NO_WATCHES, type FeedEvent, type Watches } from './watch';

/**
 * True in an incognito context (manifest `incognito: 'split'` → separate background / pages / content scripts).
 * Incognito can be logged into another RSI account, so account data lives under `incognito.`-prefixed keys;
 * UI prefs (settings, mutes), the public catalog, org cache and wishlist stay shared.
 */
export const INCOGNITO = (globalThis as { chrome?: { extension?: { inIncognitoContext?: boolean } } }).chrome?.extension?.inIncognitoContext === true;
const acct = <K extends string>(key: `${'local' | 'sync'}:${K}`) => key.replace(':', INCOGNITO ? ':incognito.' : ':') as `${'local' | 'sync'}:${K}`;

export interface Settings {
  /** Modern dark theme tweaks (spacing, readable widths, softer chrome). */
  theme: boolean;
  /** Let thread content use the full window width. */
  wide: boolean;
  /** Tighter replies (less padding, smaller avatars). */
  compact: boolean;
  /** Outline staff/dev replies and mark dev threads in lists. */
  devHighlight: boolean;
  /** j/k/o/w/m/u/? keyboard shortcuts. */
  keyboard: boolean;
  /** Local read tracking: "+N new" badges, read threads dimmed. */
  readTracking: boolean;
  /** Hide (instead of dim) read threads with no new replies in channel lists. Pinned threads always stay. */
  hideRead: boolean;
  /** Muted threads: removed from the list ('hide') or collapsed to one faint line ('dim'). */
  muteMode: 'hide' | 'dim';
  /** Collapse replies by muted authors inside threads. */
  muteReplies: boolean;
  mutes: MuteRules;
  /** Background poll interval for watches (minutes, ≥ 2). */
  pollMinutes: number;
  /** Check watches on a timer (true) or passively — only when you press *Check now* (false: no alarm, no background traffic). */
  pollAuto: boolean;
  /** Desktop notifications for feed events. */
  notify: boolean;
  /** Notify when *any* friend comes online (otherwise only friends marked with the bell). */
  notifyAllFriends: boolean;
  /** Remind to remove party friends this many hours after they were added (0 = never). */
  partyRemindHours: number;
  /** Play a short ding when party mode auto-accepts a friend request. */
  partySound: boolean;
  /** RSI+ bar on store ship pages and account pages. */
  siteBar: boolean;
}

export const DEFAULTS: Settings = {
  theme: true,
  wide: false,
  compact: false,
  devHighlight: true,
  keyboard: true,
  readTracking: true,
  hideRead: false,
  muteMode: 'dim',
  muteReplies: true,
  mutes: NO_MUTES,
  pollMinutes: 5,
  pollAuto: true,
  notify: true,
  notifyAllFriends: false,
  partyRemindHours: 12,
  partySound: true,
  siteBar: true,
};

export const settingsItem = storage.defineItem<Settings>('sync:settings', { fallback: DEFAULTS });
/** Read marks are local (can be thousands of entries — too big for sync quota). */
export const readItem = storage.defineItem<ReadState>(acct('local:read'), { fallback: {} });
export const watchesItem = storage.defineItem<Watches>(acct('sync:watches'), { fallback: NO_WATCHES });
export const feedItem = storage.defineItem<FeedEvent[]>(acct('local:feed'), { fallback: [] });
export const friendNotesItem = storage.defineItem<FriendNotes>(acct('local:friendNotes'), { fallback: {} });
/** member id -> presence status at the last poll (for "came online" events). */
export const presenceItem = storage.defineItem<Record<string, string>>(acct('local:presence'), { fallback: {} });
/** Friends' orgs from RSI citizen pages (nickname lower-case → orgs), refreshed after 24 h. */
export const orgCacheItem = storage.defineItem<OrgCache>('local:orgs', { fallback: {} });
/** Incoming friend request ids at the last poll (null = never polled → first poll is a silent baseline). */
export const seenRequestsItem = storage.defineItem<string[] | null>(acct('local:seenRequests'), { fallback: null });
/** Last full hangar / buyback load (local only — personal account data never leaves the browser). */
/** `complete: false` + `page` = a load that stopped part-way (refresh, error, Stop) — resumable from `page + 1`. */
export const hangarItem = storage.defineItem<{ at: number; pledges: Pledge[]; complete?: boolean; page?: number; credits?: Credits | null; creditsAt?: number } | null>(acct('local:hangar'), { fallback: null });
export const buybackItem = storage.defineItem<{ at: number; items: BuybackItem[]; complete?: boolean; page?: number } | null>(acct('local:buyback'), { fallback: null });
/** Saved CCU chains (planner): the CCUs they use are kept out of new plans when *Exclude saved chains* is on. */
export const ccuChainsItem = storage.defineItem<SavedChain[]>(acct('local:ccuChains'), { fallback: [] });
/** Pledge-store ship catalog + on-sale SKUs (public data), refreshed by the background. */
export const catalogItem = storage.defineItem<Catalog | null>('local:catalog', { fallback: null });
/** Pledge-store paints (public), refreshed every 6 h on demand. */
/** Every pledge-store category (ships, paints, packs, gear …) — per account, since Concierge-only listings only show on a Concierge session. */
export const storeItemsItem = storage.defineItem<StoreListing | null>(acct('local:storeItems'), { fallback: null });
/** Chairman's Club status from /account/concierge (per account; null = not Concierge or never read). */
export const conciergeItem = storage.defineItem<Concierge | null>(acct('local:concierge'), { fallback: null });
export const paintCatalogItem = storage.defineItem<PaintCatalog | null>('local:paints', { fallback: null });
/** Star Citizen crowdfund stats per chart range (public), for the Wallet tab; refreshed hourly when open. */
export const fundingItem = storage.defineItem<Partial<Record<FundingRange, Funding>>>('local:funding', { fallback: {} });
/** Ships you want: notify when a warbond CCU / standalone sale appears or the price drops. */
export interface WishShip {
  id: number;
  name: string;
  /** Lowest CCU / standalone price (cents) seen when last checked — alert on a lower one. */
  lowest: number | null;
}
export const wishlistItem = storage.defineItem<WishShip[]>('sync:wishlist', { fallback: [] });
/** Party mode (auto-accept friend requests). Local: it acts on this browser's session only. */
export const partyModeItem = storage.defineItem<PartyMode | null>(acct('local:partyMode'), { fallback: null });
/** What party mode accepted (or failed to), newest first. */
export const partyLogItem = storage.defineItem<PartyLogEntry[]>(acct('local:partyLog'), { fallback: [] });
export const lastPollItem = storage.defineItem<{ at: number; error: string | null } | null>(acct('local:lastPoll'), { fallback: null });

/** Saved RSI logins for the account switcher (this context's cookie jar only — incognito has its own list). */
export const profilesItem = storage.defineItem<Profiles>(acct('local:profiles'), { fallback: { active: null, list: [] } });
/** Everything that belongs to one RSI account: swapped out / in with the cookies when switching profiles. */
export const ACCOUNT_ITEMS = [readItem, watchesItem, feedItem, friendNotesItem, presenceItem, seenRequestsItem, hangarItem, buybackItem, ccuChainsItem, partyModeItem, partyLogItem, lastPollItem] as const;
/** Key for a profile's parked account data (`local:profileData.<id>`, incognito-prefixed like the rest). */
export const profileDataKey = (id: string) => acct(`local:profileData.${id}`);

export async function getSettings(): Promise<Settings> {
  const s = await settingsItem.getValue();
  return { ...DEFAULTS, ...s, mutes: { ...NO_MUTES, ...(s?.mutes ?? {}) } };
}

export async function patchSettings(patch: Partial<Settings>) {
  await settingsItem.setValue({ ...(await getSettings()), ...patch });
}

export async function getWatches(): Promise<Watches> {
  return { ...NO_WATCHES, ...(await watchesItem.getValue()) };
}

export async function patchWatches(fn: (w: Watches) => Watches) {
  await watchesItem.setValue(fn(await getWatches()));
}
