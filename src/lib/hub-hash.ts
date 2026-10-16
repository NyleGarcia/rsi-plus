import type { HubTab } from './messages';

/**
 * Hub hashes from before the flat sidebar (bookmarks, RSI page buttons, old notifications) → today's page:
 * `#hangar?view=melt` → `#melt`; `#ships[?view=paints|ships|bundle]` → `#paints` / `#fleet` / `#paint-rebuy`;
 * `#store?view=items[&cat=…]` → `#browse[?who=…|cat=…]`. Other params (`to`, `cat`) ride along. Null = already current.
 */
export function legacyHash(hash: string): string | null {
  const [h = '', qs = ''] = hash.replace(/^#/, '').split('?');
  const p = new URLSearchParams(qs);
  const view = p.get('view');
  let to: HubTab | null = null;
  if (h === 'hangar' && view === 'melt') to = 'melt';
  else if (h === 'ships') to = view === 'bundle' ? 'paint-rebuy' : view === 'ships' ? 'fleet' : 'paints';
  else if (h === 'store' && view === 'items') to = 'browse';
  if (!to) return null;
  p.delete('view');
  const cat = p.get('cat');
  if (to === 'browse' && (cat === 'concierge' || cat === 'subscribers')) {
    p.delete('cat');
    p.set('who', cat);
  }
  const q = p.toString();
  return `#${to}${q ? `?${q}` : ''}`;
}
