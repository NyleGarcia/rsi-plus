/**
 * Order history from RSI's billing pages — the only place that says what was paid with cash, store credit, or came
 * as a gift. The markup is not documented; `parseOrders` reads rows that carry a date and a money amount and keeps
 * the payment words it finds, and `captureBilling` copies the raw page for fixing the parser when it reads nothing.
 * Stays in this browser.
 */
import { SPECTRUM_ORIGIN } from './types';

export type PayKind = 'cash' | 'credit' | 'gift' | 'refund' | 'unknown';
export interface Order {
  id: string;
  /** ms */
  at: number;
  /** USD */
  total: number;
  /** What RSI printed next to the total ("Credit Card", "PayPal", "Store Credit", "Gift" …). */
  method: string;
  kind: PayKind;
  /** Line text, trimmed. */
  text: string;
}

const MONEY = /\$\s?(-?\d[\d,]*(?:\.\d{2})?)/;
const DATE = /\b(?:\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{4})\b/;
/** Text nodes joined with spaces — `textContent` glues cells ("AB12345March 3, 2026$45.00"). */
const txt = (el: Element) => {
  const parts: string[] = [];
  const walk = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) parts.push(n.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};

export function kindOf(method: string, total: number): PayKind {
  const m = method.toLowerCase();
  if (total < 0 || /refund/.test(m)) return 'refund';
  if (/gift/.test(m)) return 'gift';
  if (/store credit|credits?\b/.test(m)) return 'credit';
  if (/card|paypal|visa|master|amex|bank|cash|sofort|ideal|crypto/.test(m)) return 'cash';
  return 'unknown';
}

/** Rows = the smallest elements that hold one date and one amount (table rows, list items, cards). */
export function parseOrders(doc: Document): Order[] {
  const rows = [...doc.querySelectorAll<HTMLElement>('tr, li, article, .order, .billing-item, .history-item, [class*="order"], [class*="transaction"]')].filter((el) => {
    const t = txt(el);
    return DATE.test(t) && MONEY.test(t) && !el.querySelector('tr, li, article');
  });
  const seen = new Set<string>();
  const out: Order[] = [];
  for (const el of rows) {
    const t = txt(el);
    const at = Date.parse(t.match(DATE)?.[0] ?? '');
    const total = Number((t.match(MONEY)?.[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(at) || !Number.isFinite(total)) continue;
    const method = t.match(/\b(store credit|credit card|debit card|paypal|visa|mastercard|amex|american express|gift(?:ed)?|refund(?:ed)?|bank transfer|sofort|ideal|crypto)\b/i)?.[0] ?? '';
    const id = t.match(/\b(?:order|invoice|#)\s*#?\s*([A-Z0-9-]{5,})/i)?.[1] ?? `${at}:${total}:${t.slice(0, 40)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, at, total, method, kind: kindOf(method, total), text: t.slice(0, 200) });
  }
  return out.sort((a, b) => b.at - a.at);
}

export interface OrdersResult {
  orders: Order[];
  pages: number;
  debug: string;
}

/** Reads /account/billing and its pages (`?page=N`) until a page adds nothing new. */
export async function fetchOrders(signal?: AbortSignal, maxPages = 40): Promise<OrdersResult> {
  const all = new Map<string, Order>();
  const debug: string[] = [];
  let pages = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${SPECTRUM_ORIGIN}/account/billing${page > 1 ? `?page=${page}` : ''}`, { credentials: 'include', signal });
    if (!res.ok) {
      debug.push(`page ${page}: HTTP ${res.status}`);
      break;
    }
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const found = parseOrders(doc);
    pages++;
    const before = all.size;
    for (const o of found) all.set(o.id, o);
    if (!found.length) {
      debug.push(`page ${page}: no order rows recognised (${doc.title || 'untitled'})`);
      break;
    }
    if (all.size === before) break;
  }
  return { orders: [...all.values()].sort((a, b) => b.at - a.at), pages, debug: debug.join(' ‖ ') };
}

/** Copies the billing page's body (first 30k chars) to the clipboard, for building the parser from real markup. */
export async function captureBilling(): Promise<string> {
  const res = await fetch(`${SPECTRUM_ORIGIN}/account/billing`, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = doc.querySelector('main, #contentbody, .account, body');
  const out = (main?.innerHTML ?? html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\s{2,}/g, ' ').slice(0, 30000);
  await navigator.clipboard.writeText(out);
  return `copied ${out.length.toLocaleString()} chars of ${doc.title || '/account/billing'}`;
}

export interface OrderTotals {
  cash: number;
  credit: number;
  gift: number;
  refund: number;
  unknown: number;
  count: number;
  byYear: { year: number; cash: number; credit: number; total: number }[];
}
export function orderTotals(orders: Order[]): OrderTotals {
  const t: OrderTotals = { cash: 0, credit: 0, gift: 0, refund: 0, unknown: 0, count: orders.length, byYear: [] };
  const years = new Map<number, { year: number; cash: number; credit: number; total: number }>();
  for (const o of orders) {
    const v = Math.abs(o.total);
    if (o.kind === 'refund') t.refund += v;
    else if (o.kind === 'gift') t.gift += v;
    else if (o.kind === 'credit') t.credit += v;
    else if (o.kind === 'cash') t.cash += v;
    else t.unknown += v;
    const y = new Date(o.at).getFullYear();
    const b = years.get(y) ?? { year: y, cash: 0, credit: 0, total: 0 };
    if (o.kind === 'cash') b.cash += v;
    if (o.kind === 'credit') b.credit += v;
    if (o.kind !== 'refund') b.total += v;
    years.set(y, b);
  }
  t.byYear = [...years.values()].sort((a, b) => b.year - a.year);
  return t;
}
