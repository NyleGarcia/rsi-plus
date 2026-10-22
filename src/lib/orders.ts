/**
 * Order history from RSI's billing page (`/account/billing?page=N&pagesize=100`) — the only place that says what each
 * order took in cash ("Total") and in store credit ("Credits used"). Markup as of 2026-10: `ul.orders-item > li >
 * .row` with `.basic-infos .col` lines (Order Placed / Amount / Order Id / Status / Payment / Fulfillment), a
 * `table.billing-summary` of lines (Item / Price / Qty / Discount / Total) and `.s-row` totals (Items / Additional
 * Discount / Credits used / Total before Tax / Total). The bill-to block is never read. Stays in this browser.
 */
import { SPECTRUM_ORIGIN } from './types';

export type PayKind = 'cash' | 'credit' | 'mixed' | 'free' | 'refund' | 'cancelled' | 'unknown';
export interface OrderLine {
  title: string;
  /** Unit price, USD. */
  price: number;
  qty: number;
  /** Line discount, USD (RSI's multi-paint tier, sales). */
  discount: number;
  /** Line total after the discount, USD. */
  total: number;
}
export interface Order {
  id: string;
  /** ms, RSI's "Order Placed" */
  at: number;
  /** Sum of the line totals, USD ("Items"). */
  items: number;
  /** "Additional Discount", USD. */
  discount: number;
  /** Store credit applied, USD ("Credits used"). */
  credits: number;
  /** Cash charged, USD ("Total"). */
  total: number;
  status: string;
  payment: string;
  fulfillment: string;
  /** Row class token naming the storefront (`pledge` = Pledge Store). */
  storefront: string;
  lines: OrderLine[];
  kind: PayKind;
}

const MONEY = /-?\$\s?(-?\d[\d,]*(?:\.\d{1,2})?)/;
const money = (s: string | null | undefined) => {
  const m = s?.match(MONEY);
  if (!m) return 0;
  const v = Number(m[1]!.replace(/,/g, ''));
  return (s!.includes('-$') ? -v : v) || 0;
};
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
/** "Order Placed: October 22, 2026 02:10" → ms (local time; RSI prints no zone). */
export function parseOrderDate(s: string): number {
  const m = clean(s).match(/([A-Z][a-z]+ \d{1,2},? \d{4})(?: (\d{1,2}:\d{2}))?/);
  if (!m) return NaN;
  return Date.parse(`${m[1]!.replace(',', '')} ${m[2] ?? '00:00'}`);
}

export function kindOf(o: Pick<Order, 'status' | 'payment' | 'total' | 'credits' | 'items'>): PayKind {
  const s = `${o.status} ${o.payment}`.toUpperCase();
  if (/REFUND/.test(s)) return 'refund';
  if (/CANCEL/.test(s)) return 'cancelled';
  if (o.total > 0 && o.credits > 0) return 'mixed';
  if (o.total > 0) return 'cash';
  if (o.credits > 0) return 'credit';
  if (o.items === 0 && o.total === 0) return 'free';
  return 'unknown';
}

/** "Label: value" columns of `.basic-infos` → map by label (lower-case, no colon). */
function cols(row: Element): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of row.querySelectorAll('.basic-infos .col')) {
    const label = clean(c.querySelector('span')?.textContent).replace(/:$/, '').toLowerCase();
    const value = clean(c.textContent).replace(/^[^:]*:\s*/, '');
    if (label) m.set(label, value);
  }
  return m;
}
/** `.s-row` totals: "Items:$69.22 USD" "Credits used:$69.22 USD" … → map by label. */
function sums(row: Element): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of row.querySelectorAll('.s-row strong')) {
    const label = clean(b.textContent).replace(/:$/, '').toLowerCase();
    let text = '';
    for (let n = b.nextSibling; n && n.nodeName !== 'STRONG' && n.nodeName !== 'BR'; n = n.nextSibling) text += n.textContent ?? '';
    if (label) m.set(label, money(text));
  }
  return m;
}

export function parseOrder(row: Element): Order | null {
  const c = cols(row);
  const id = c.get('order id') ?? '';
  const at = parseOrderDate(c.get('order placed') ?? '');
  if (!id || !Number.isFinite(at)) return null;
  const lines: OrderLine[] = [];
  for (const tr of row.querySelectorAll('table.billing-summary tr')) {
    const td = [...tr.querySelectorAll('td')].map((x) => clean(x.textContent));
    if (td.length < 5) continue;
    lines.push({ title: td[0]!, price: money(td[1]), qty: Number(td[2]) || 1, discount: money(td[3]), total: money(td[4]) });
  }
  const s = sums(row);
  const o: Omit<Order, 'kind'> = {
    id,
    at,
    items: s.get('items') ?? lines.reduce((n, l) => n + l.total, 0),
    discount: s.get('additional discount') ?? 0,
    credits: s.get('credits used') ?? 0,
    total: s.get('total') ?? money(c.get('amount')),
    status: c.get('status') ?? '',
    payment: c.get('payment') ?? '',
    fulfillment: c.get('fulfillment') ?? '',
    storefront: [...(row.querySelector('.row')?.classList ?? row.classList)].find((k) => !/^(row|dark|trans-|clearfix)/.test(k)) ?? '',
    lines,
  };
  return { ...o, kind: kindOf(o) };
}

/** Every order on one billing page, newest first as RSI lists them. */
export function parseOrders(doc: Document): Order[] {
  const out: Order[] = [];
  for (const li of doc.querySelectorAll('ul.orders-item > li')) {
    const o = parseOrder(li);
    if (o) out.push(o);
  }
  return out;
}
/** Highest page number in the pager (1 when there is none). */
export function lastPage(doc: Document): number {
  let last = 1;
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('.pager a[href*="page="]')) {
    const n = Number(a.getAttribute('href')?.match(/[?&]page=(\d+)/)?.[1]);
    if (n > last) last = n;
  }
  return last;
}

export interface OrdersResult {
  orders: Order[];
  pages: number;
  debug: string;
}

const PAGE_SIZE = 100;
/** Reads every billing page (100 orders each; the pager says how many). */
export async function fetchOrders(signal?: AbortSignal, maxPages = 40): Promise<OrdersResult> {
  const all = new Map<string, Order>();
  const debug: string[] = [];
  let pages = 0;
  let last = 1;
  for (let page = 1; page <= Math.min(last, maxPages); page++) {
    const res = await fetch(`${SPECTRUM_ORIGIN}/account/billing?page=${page}&pagesize=${PAGE_SIZE}`, { credentials: 'include', signal });
    if (!res.ok) {
      debug.push(`page ${page}: HTTP ${res.status}`);
      break;
    }
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    if (page === 1) last = lastPage(doc);
    const found = parseOrders(doc);
    pages++;
    if (!found.length) {
      debug.push(`page ${page}: no orders (${doc.querySelector('#billing') ? 'billing page without ul.orders-item' : doc.title || 'not the billing page — signed in?'})`);
      break;
    }
    for (const o of found) all.set(o.id, o);
  }
  return { orders: [...all.values()].sort((a, b) => b.at - a.at), pages, debug: debug.join(' ‖ ') };
}

/** Copies the orders block of the billing page (first 30k chars, bill-to removed) to the clipboard, for fixing the reader. */
export async function captureBilling(): Promise<string> {
  const res = await fetch(`${SPECTRUM_ORIGIN}/account/billing`, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('.bill-to, script, style')) el.remove();
  const main = doc.querySelector('.orders, #billing, #contentbody, body');
  const out = (main?.innerHTML ?? html).replace(/\s{2,}/g, ' ').slice(0, 30000);
  await navigator.clipboard.writeText(out);
  return `copied ${out.length.toLocaleString()} chars of ${doc.title || '/account/billing'}`;
}

export interface YearTotals {
  year: number;
  cash: number;
  credits: number;
  items: number;
  orders: number;
}
export interface OrderTotals {
  /** Cash charged, USD. */
  cash: number;
  /** Store credit applied, USD. */
  credits: number;
  /** Line + additional discounts, USD. */
  discounts: number;
  /** Sum of the line totals, USD (what the goods were priced at after line discounts). */
  items: number;
  refunds: number;
  count: number;
  /** Orders with nothing charged and nothing priced (gifts received, giveaways). */
  free: number;
  cancelled: number;
  byYear: YearTotals[];
}
export function orderTotals(orders: Order[]): OrderTotals {
  const t: OrderTotals = { cash: 0, credits: 0, discounts: 0, items: 0, refunds: 0, count: 0, free: 0, cancelled: 0, byYear: [] };
  const years = new Map<number, YearTotals>();
  for (const o of orders) {
    if (o.kind === 'cancelled') {
      t.cancelled++;
      continue;
    }
    t.count++;
    if (o.kind === 'refund') {
      t.refunds += o.total;
      continue;
    }
    if (o.kind === 'free') t.free++;
    t.cash += o.total;
    t.credits += o.credits;
    t.items += o.items;
    t.discounts += o.discount + o.lines.reduce((n, l) => n + l.discount, 0);
    const y = new Date(o.at).getFullYear();
    const b = years.get(y) ?? { year: y, cash: 0, credits: 0, items: 0, orders: 0 };
    b.cash += o.total;
    b.credits += o.credits;
    b.items += o.items;
    b.orders++;
    years.set(y, b);
  }
  t.byYear = [...years.values()].sort((a, b) => b.year - a.year);
  return t;
}

// ---- charts: the same buckets the hangar spend uses, from orders (cash charged, credit applied) ----
export interface OrderBucket {
  key: string;
  label: string;
  /** Cash charged, USD. */
  cash: number;
  /** Store credit applied, USD. */
  credits: number;
  count: number;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const r2 = (n: number) => Math.round(n * 100) / 100;
const counted = (o: Order) => o.kind !== 'cancelled' && o.kind !== 'refund';
/** Cash + credit per year, oldest first. */
export function ordersByYear(orders: Order[]): OrderBucket[] {
  const m = new Map<string, OrderBucket>();
  for (const o of orders) {
    if (!counted(o)) continue;
    const k = String(new Date(o.at).getFullYear());
    const b = m.get(k) ?? { key: k, label: k, cash: 0, credits: 0, count: 0 };
    b.cash = r2(b.cash + o.total);
    b.credits = r2(b.credits + o.credits);
    b.count++;
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}
/** Cash + credit per calendar month over the last `months` months, zeros kept. */
export function ordersByMonth(orders: Order[], months = 24, now = new Date()): OrderBucket[] {
  const m = new Map<string, OrderBucket>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    m.set(k, { key: k, label: MONTHS[d.getMonth()]!, cash: 0, credits: 0, count: 0 });
  }
  for (const o of orders) {
    if (!counted(o)) continue;
    const d = new Date(o.at);
    const b = m.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    if (!b) continue;
    b.cash = r2(b.cash + o.total);
    b.credits = r2(b.credits + o.credits);
    b.count++;
  }
  return [...m.values()];
}
/** Running cash total by month from the first order (for the area chart). */
export function ordersCumulative(orders: Order[], now = new Date()): { key: string; label: string; value: number }[] {
  const first = orders.filter(counted).reduce((t, o) => Math.min(t, o.at), Infinity);
  if (!Number.isFinite(first)) return [];
  const f = new Date(first);
  const span = (now.getFullYear() - f.getFullYear()) * 12 + (now.getMonth() - f.getMonth()) + 1;
  let acc = 0;
  return ordersByMonth(orders, Math.max(2, span), now).map((b) => ((acc = r2(acc + b.cash)), { key: b.key, label: b.label, value: acc }));
}
/** Donut slices: cash vs store credit, with how many orders used each. */
export function orderSlices(orders: Order[]): { key: string; label: string; value: number; count: number }[] {
  const live = orders.filter(counted);
  const cash = r2(live.reduce((n, o) => n + o.total, 0));
  const credits = r2(live.reduce((n, o) => n + o.credits, 0));
  return [
    { key: 'cash', label: 'cash', value: cash, count: live.filter((o) => o.total > 0).length },
    { key: 'credit', label: 'store credit', value: credits, count: live.filter((o) => o.credits > 0).length },
  ].filter((s) => s.value > 0);
}
