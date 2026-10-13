import type { OrgCache } from './orgs';
import type { Catalog, PaintCatalog } from './store';
import type { FriendsData } from './api';
import type { Channel } from './types';

export type BgRequest =
  | { type: 'poll:now' }
  /** `windowId`: open the hub in that window (popup passes its own; content scripts are placed by the sender's tab). */
  | { type: 'hub:open'; tab?: HubTab; params?: Record<string, string>; windowId?: number }
  | { type: 'feed:seen'; keys?: string[] }
  | { type: 'channels:list' }
  | { type: 'friends:get' }
  | { type: 'friends:remove'; ids: string[] }
  | { type: 'friends:request'; action: 'accept' | 'decline' | 'cancel'; ids: string[] }
  | { type: 'orgs:get'; nicknames: string[]; force?: boolean }
  | { type: 'catalog:get'; fresh?: boolean }
  | { type: 'paints:get'; fresh?: boolean }
  /** Play the party-mode ding now (settings preview). */
  | { type: 'sound:ding' };

export type HubTab = 'feed' | 'watching' | 'friends' | 'mutes' | 'hangar' | 'wallet' | 'ships' | 'items' | 'buyback' | 'store' | 'ccu';

export interface BulkResult {
  done: string[];
  failed: { id: string; error: string }[];
}

export interface BgResponses {
  'poll:now': { events: number; error: string | null };
  'hub:open': { ok: true };
  'feed:seen': { ok: true };
  'channels:list': Channel[];
  'friends:get': FriendsData;
  'friends:remove': BulkResult;
  'friends:request': BulkResult;
  'orgs:get': OrgCache;
  'catalog:get': Catalog;
  'paints:get': PaintCatalog;
  'sound:ding': { ok: true };
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export async function bg<K extends BgRequest['type']>(msg: Extract<BgRequest, { type: K }>): Promise<BgResponses[K]> {
  const r = (await browser.runtime.sendMessage(msg)) as Envelope<BgResponses[K]> | undefined;
  if (!r) throw new Error('Background did not respond');
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export function respond<T>(p: Promise<T>): Promise<Envelope<T>> {
  return p.then(
    (data) => ({ ok: true as const, data }),
    (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
  );
}
