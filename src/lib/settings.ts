import { storage } from '#imports';
import { NO_MUTES, type MuteRules } from './filters';
import type { FriendNotes, PartyLogEntry, PartyMode } from './friends';
import type { GameShip } from './items';
import type { Labels } from './labels';
import type { OrgCache } from './orgs';
import type { Goal, SavedChain } from './ccu';
import type { BuybackItem, Credits, Pledge } from './hangar';
import type { Catalog, PaintCatalog, SaleHistory, StoreListing } from './store';
import type { StoreChange, StoreSnapshot } from './storelog';
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
  /** StarOrg Tools (when connected): send the hangar after every full load, and weekly when it changed (`lib/starorg.ts`). */
  starorgAutoSync: boolean;
  /** StarOrg Tools: include each pledge's value (`pledge_cost`); off = sent empty. */
  starorgSendCost: boolean;
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
  starorgAutoSync: false,
  starorgSendCost: false,
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
/** `handle`: the RSI handle (lowercase, `whoAmI`) logged in when the load started; StarOrg Tools sends only a hangar read as the handle logged in now. */
export const hangarItem = storage.defineItem<{ at: number; pledges: Pledge[]; complete?: boolean; page?: number; credits?: Credits | null; creditsAt?: number; handle?: string | null } | null>(acct('local:hangar'), { fallback: null });
/**
 * Written by the hangar loaders after a completed full load (`lib/hangar-refresh.ts` `saveCompleteLoad`): the signal the
 * background's StarOrg auto-sync listens to. Not in `ACCOUNT_ITEMS` and never written by a profile restore, so swapping
 * accounts (which rewrites `hangarItem`) is never mistaken for a load.
 */
export const hangarLoadItem = storage.defineItem<{ at: number; handle: string | null } | null>(acct('local:hangarLoad'), { fallback: null });
export const buybackItem = storage.defineItem<{ at: number; items: BuybackItem[]; complete?: boolean; page?: number } | null>(acct('local:buyback'), { fallback: null });
/** Order history imported from /account/billing (Wallet → Where the money went). */
/** v2 (2026-10): orders carry `lines`, `credits`, `items`; v1 saves (first beta reader) are dropped, the user re-imports. */
export const ordersItem = storage.defineItem<{ at: number; orders: import('./orders').Order[]; subs?: import('./orders').SubPayment[]; pages: number } | null>(acct('local:orders'), { fallback: null, version: 2, migrations: { 2: () => null } });
/** Saved CCU chains (planner): the CCUs they use are kept out of new plans when *Exclude saved chains* is on. */
export const ccuChainsItem = storage.defineItem<SavedChain[]>(acct('local:ccuChains'), { fallback: [] });
/** Your labels on pledges (`lib/labels.ts`): pledge id → labels. */
export const pledgeLabelsItem = storage.defineItem<Labels>(acct('local:pledgeLabels'), { fallback: {} });
/** Fleet plan (CCU planner, several goals): the goals in priority order, hulls never / preferably auto-upgraded, store start allowed. */
export const ccuGoalsItem = storage.defineItem<{ goals: Goal[]; keep: number[]; prefer?: number[]; storeStart: boolean }>(acct('local:ccuGoals'), { fallback: { goals: [], keep: [], prefer: [], storeStart: false } });
/** Pledge-store ship catalog + on-sale SKUs (public data), refreshed by the background. */
export const catalogItem = storage.defineItem<Catalog | null>('local:catalog', { fallback: null });
/** Per ship: when it was last seen on sale (CCU / standalone), stamped on every catalog refresh since install. */
export const saleHistoryItem = storage.defineItem<SaleHistory>('local:saleHistory', { fallback: {} });
/** Pledge-store paints (public), refreshed every 6 h on demand. */
/** Every pledge-store category (ships, paints, packs, gear …) — per account, since Concierge-only listings only show on a Concierge session. */
export const storeItemsItem = storage.defineItem<StoreListing | null>(acct('local:storeItems'), { fallback: null });
/** Chairman's Club status from /account/concierge (per account; null = not Concierge or never read). */
export const conciergeItem = storage.defineItem<Concierge | null>(acct('local:concierge'), { fallback: null });
export const paintCatalogItem = storage.defineItem<PaintCatalog | null>('local:paints', { fallback: null });
/** Star Citizen crowdfund stats per chart range (public), for the Wallet tab; refreshed hourly when open. */
/** Store changes log (`lib/storelog.ts`): last copy of each source + the add / remove groups, newest first. */
export const storeSnapshotItem = storage.defineItem<StoreSnapshot>('local:storeSnapshot', { fallback: {} });
export const storeLogItem = storage.defineItem<StoreChange[]>('local:storeLog', { fallback: [] });
export const fundingItem = storage.defineItem<Partial<Record<FundingRange, Funding>>>('local:funding', { fallback: {} });
/** Ships you want: notify when a warbond CCU / standalone sale appears or the price drops. */
export interface WishShip {
  id: number;
  name: string;
  /** Lowest CCU / standalone price (cents) seen when last checked — alert on a lower one. */
  lowest: number | null;
}
export const wishlistItem = storage.defineItem<WishShip[]>('sync:wishlist', { fallback: [] });
/** Ships you have in the game but not on the RSI account (aUEC-bought, earned) — counted as hulls for paints. */
export const gameShipsItem = storage.defineItem<GameShip[]>(acct('sync:gameShips'), { fallback: [] });
/** Party mode (auto-accept friend requests). Local: it acts on this browser's session only. */
export const partyModeItem = storage.defineItem<PartyMode | null>(acct('local:partyMode'), { fallback: null });
/** What party mode accepted (or failed to), newest first. */
export const partyLogItem = storage.defineItem<PartyLogEntry[]>(acct('local:partyLog'), { fallback: [] });
export const lastPollItem = storage.defineItem<{ at: number; error: string | null } | null>(acct('local:lastPoll'), { fallback: null });
/**
 * StarOrg Tools sign-in (`lib/starorg.ts`): the `aud=rsiplus` bearer token, when it expires, and who it belongs to.
 * `storage.local` only, never sync; per context through `acct()` so an incognito window never reuses the normal
 * window's token. Not in `ACCOUNT_ITEMS`: it is a StarOrg login, not RSI account data, and one StarOrg member can
 * verify several RSI handles (the server checks the pushed handle).
 */
export const starorgItem = storage.defineItem<import('./starorg').StarOrgAuth | null>(acct('local:starorg'), { fallback: null });
/** The last StarOrg Tools send: when, the result line, and the row-set hash the weekly check compares against. */
export const starorgSyncItem = storage.defineItem<import('./starorg').StarOrgSync | null>(acct('local:starorgSync'), { fallback: null });

/** Saved RSI logins for the account switcher (this context's cookie jar only — incognito has its own list). */
export const profilesItem = storage.defineItem<Profiles>(acct('local:profiles'), { fallback: { active: null, list: [] } });
/** Everything that belongs to one RSI account: swapped out / in with the cookies when switching profiles. */
export const ACCOUNT_ITEMS = [readItem, watchesItem, feedItem, friendNotesItem, presenceItem, seenRequestsItem, hangarItem, buybackItem, ordersItem, conciergeItem, storeItemsItem, ccuChainsItem, ccuGoalsItem, gameShipsItem, pledgeLabelsItem, partyModeItem, partyLogItem, lastPollItem] as const;
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
