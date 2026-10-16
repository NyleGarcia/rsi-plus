/**
 * Chairman's Club (Concierge) status from `/account/concierge`: current level + since, the next level and RSI's own
 * "% until your next level" gauge, the levels earned so far, and the page's *Exclusive Store* carousel (Concierge-only
 * packages). One request with the user's own session; stored per account in `conciergeItem`. Non-Concierge accounts get
 * `null` (the page has no status block).
 */
import { SPECTRUM_ORIGIN } from './types';

export interface ConciergeStoreItem {
  sku: number;
  name: string;
  /** "Standalone Ships", "Package" … as the carousel labels it. */
  category: string;
  url: string;
  /** USD cents. */
  price: number;
  inStock: boolean;
}
export interface Concierge {
  at: number;
  level: string;
  /** "May 24, 2026" as shown. */
  since: string;
  next: string | null;
  /** RSI's gauge: percent of the way from the current level to the next (0–100), null when RSI shows none. */
  pct: number | null;
  /** Levels the page lists as earned, current first. */
  earned: string[];
  store: ConciergeStoreItem[];
}

/** Chairman's Club ladder with RSI's published total-spend thresholds (USD) — used only to turn the gauge into "≈ $ to go". */
export const TIERS: { name: string; usd: number }[] = [
  { name: 'High Admiral', usd: 1_000 },
  { name: 'Grand Admiral', usd: 2_500 },
  { name: 'Space Marshal', usd: 5_000 },
  { name: 'Wing Commander', usd: 10_000 },
  { name: 'Praetorian', usd: 15_000 },
  { name: 'Legatus Navium', usd: 25_000 },
];
const tier = (name: string | null) => TIERS.find((t) => t.name.toLowerCase() === (name ?? '').toLowerCase()) ?? null;

/** Rough USD still to spend for the next level: RSI's gauge × the gap between the two tiers' thresholds; null when either tier is unknown. */
export function usdToNext(c: Pick<Concierge, 'level' | 'next' | 'pct'>): number | null {
  const cur = tier(c.level), nxt = tier(c.next);
  if (!cur || !nxt || c.pct == null) return null;
  return Math.max(0, Math.round(((100 - c.pct) / 100) * (nxt.usd - cur.usd)));
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

export function parseConciergePage(root: ParentNode, now = Date.now()): Concierge | null {
  const level = text(root.querySelector('#js-status-level'));
  if (!level) return null;
  const since = text(root.querySelector('#js-status-date')).replace(/^since\s*/i, '');
  const next = text(root.querySelector('.c-next-level__title')) || null;
  const gauge = root.querySelector<HTMLElement>('#progress-gauge');
  const raw = gauge?.getAttribute('data-spend-until-next-rank') ?? text(root.querySelector('#gauge-counter'));
  const pct = raw && /^\d+(\.\d+)?$/.test(raw.trim()) ? Math.min(100, Math.max(0, Number(raw))) : null;
  const earned = [...root.querySelectorAll<HTMLElement>('.js-level-description[data-badge]')].map((e) => e.dataset.badge ?? '').filter((b) => b && !/^BADGE_/i.test(b));
  const store: ConciergeStoreItem[] = [];
  for (const it of root.querySelectorAll('#c-section--store .product-item')) {
    const cart = it.querySelector<HTMLElement>('[data-sku]');
    const sku = Number(cart?.dataset.sku);
    const title = it.querySelector('.title');
    const category = text(title?.querySelector('span')).replace(/^-\s*/, '');
    const name = text(title).replace(new RegExp(`\\s*-\\s*${category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '').trim() || cart?.dataset.name || '';
    const price = Number(it.querySelector<HTMLElement>('.final-price')?.dataset.value);
    const href = it.querySelector<HTMLAnchorElement>('a.more, a[href]')?.getAttribute('href') ?? '';
    if (!sku || !name) continue;
    store.push({ sku, name, category, url: href ? new URL(href, SPECTRUM_ORIGIN).href : '', price: Number.isFinite(price) ? price : 0, inStock: /in stock/i.test(text(it.querySelector('.state'))) });
  }
  return { at: now, level, since, next, pct, earned: earned.length ? earned : [level], store };
}

export async function fetchConcierge(): Promise<Concierge | null> {
  const res = await fetch(`${SPECTRUM_ORIGIN}/account/concierge`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Concierge page: HTTP ${res.status}`);
  if (/\/(connect|sign-?in|login)\b/i.test(new URL(res.url).pathname)) throw new Error('Log in on robertsspaceindustries.com first.');
  return parseConciergePage(new DOMParser().parseFromString(await res.text(), 'text/html'));
}
