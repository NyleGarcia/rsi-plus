/**
 * Shared page UI for the grey-market store integrations (The Impound): the RSI price / markup / owned
 * badge, the filter + sort toolbar over a listing grid, and hiding / reordering cards. Each content script is its own
 * bundle, so the module state below is per site: `configureMarket` sets it once.
 */
import { IMP_SORTS, KIND_LABEL, NO_IMP_FILTER, filterRows, paidLabel, sortRows, type ImpFilter, type ImpRow, type ImpSort, type SkuKind } from './impound';
import { fmtGrouped } from '@/lib/fmt';

export interface MarketView {
  f: ImpFilter;
  sort: ImpSort;
  /** Cards for things you own: dimmed (true) or left as the store draws them. */
  dimOwned: boolean;
}
export const market = {
  /** Store name in tooltips ("The Impound: $20.99"). */
  store: '',
  view: { f: { ...NO_IMP_FILTER }, sort: 'store', dimOwned: true } as MarketView,
  hasHangar: false,
  save: () => {},
  schedule: () => {},
  /** Toggles this store can't support (no stock data …): left out of the toolbar. */
  hide: [] as (keyof ImpFilter)[],
};
export function configureMarket(c: Partial<typeof market>) {
  Object.assign(market, c);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text != null) n.textContent = text;
  if (n instanceof HTMLButtonElement) n.type = 'button';
  return n;
}
export const money = (c: number) => `$${fmtGrouped(c / 100, { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const signed = (c: number) => `${c < 0 ? '−' : '+'}${money(Math.abs(c))}`;
export const pct = (p: number) => `${p < 0 ? '−' : '+'}${Math.round(Math.abs(p) * 100)}%`;
/** Markup tone: below RSI (good), up to 25 % over, more. */
export const tone = (m: { pct: number } | null) => (!m ? 'na' : m.pct <= 0 ? 'good' : m.pct <= 0.25 ? 'mid' : 'high');

/** The RSI price / markup line and the owned line for one listing (grid cards and small previews). */
export function badge(box: HTMLElement, r: ImpRow, compact = false) {
  const paid = r.own.paid ? paidLabel(r.own.paid, money) : '';
  if (r.rsi.cents != null && r.markup) {
    const line = el('span', `rp-imp-price ${tone(r.markup)}`, compact ? `RSI ${money(r.rsi.cents)} · ${pct(r.markup.pct)}` : `RSI ${money(r.rsi.cents)} · ${signed(r.markup.cents)} (${pct(r.markup.pct)})`);
    line.title = `${r.rsi.basis}\n${market.store}: ${money(r.variant.price)}${r.variant.title && r.variant.title !== 'Default Title' ? ` (${r.variant.title})` : ''}${paid ? `\n${paid}` : ''}`;
    box.append(line);
  } else if (r.own.owned && r.own.paid) {
    // Nothing at RSI to compare with: what you paid for yours is the useful number.
    const line = el('span', 'rp-imp-price paid', compact ? `paid ${money(r.own.paid.cents)}` : paid);
    line.title = `No RSI price to compare. From your hangar: ${r.own.paid.pledge} (melt value)`;
    box.append(line);
  } else if (!compact) box.append(el('span', 'rp-imp-muted', 'no RSI price to compare'));
  const tip = r.own.contents?.map((c) => `${c.have ? '✓' : '·'} ${c.name}`).join('\n') ?? '';
  let own: HTMLElement | null = null;
  if (r.own.owned) own = el('span', 'rp-imp-own', `✓ ${compact ? (r.own.partial ? `have all ${r.own.partial.of}` : 'owned') : r.own.label || 'owned'}`);
  else if (r.own.partial?.have) own = el('span', 'rp-imp-own part', `◐ ${compact ? `have ${r.own.partial.have}/${r.own.partial.of}` : r.own.label}`);
  else if (r.kind === 'ccu' && (r.own.haveFrom || r.own.haveTo)) own = el('span', `rp-imp-own ${r.own.haveTo ? '' : 'part'}`, r.own.haveTo ? `✓ ${compact ? 'own target' : r.own.label}` : `↑ ${compact ? 'can apply' : r.own.label}`);
  if (own) {
    if (tip) own.title = tip;
    else if (compact && r.own.label) own.title = r.own.label;
    box.append(own);
  }
}

/** Hide cards the filter drops and put the rest in the chosen order (cards RSI+ hasn't read yet stay where they are). */
export function applyView(rows: Map<HTMLElement, ImpRow | null>) {
  const known = [...rows].filter((e): e is [HTMLElement, ImpRow] => !!e[1]);
  const keep = new Set(filterRows(known.map(([, r]) => r), market.view.f));
  let shown = 0;
  for (const [card, r] of rows) {
    const hide = !!r && !keep.has(r);
    card.classList.toggle('rp-imp-hidden', hide);
    if (!hide) shown++;
  }
  const bar = document.querySelector<HTMLElement>('.rp-imp-bar .rp-imp-count');
  if (bar) bar.textContent = `${shown} of ${rows.size} on this page`;
  if (market.view.sort === 'store') return restoreOrder([...rows.keys()]);
  const sorted = sortRows(known.map(([, r]) => r), market.view.sort);
  const byHandle = new Map(known.map(([c, r]) => [r.product.handle, c]));
  const parent = known[0]?.[0].parentElement;
  if (!parent) return;
  rememberOrder([...rows.keys()]);
  const want = sorted.map((r) => byHandle.get(r.product.handle)!).filter(Boolean);
  const cur = [...parent.children].filter((c) => want.includes(c as HTMLElement));
  if (cur.every((c, i) => c === want[i])) return;
  placeInOrder(parent, cur[0], want);
}
/**
 * Move `cards` (in order) to where `first` is now. Anchored on a marker, not on `first`: `first` is one of the cards,
 * and inserting it before itself leaves it in place, so it would end up last.
 */
function placeInOrder(parent: Element, first: Element | undefined, cards: HTMLElement[]) {
  const mark = document.createComment('rp-imp');
  parent.insertBefore(mark, first ?? null);
  for (const c of cards) parent.insertBefore(c, mark);
  mark.remove();
}
/** The store's own order, so *Store order* can put the cards back. */
function rememberOrder(cards: HTMLElement[]) {
  cards.forEach((c, i) => (c.dataset.rpOrder ??= String(i)));
}
function restoreOrder(cards: HTMLElement[]) {
  const withOrder = cards.filter((c) => c.dataset.rpOrder != null);
  if (!withOrder.length) return;
  const parent = withOrder[0]!.parentElement;
  if (!parent) return;
  const sorted = [...withOrder].sort((a, b) => Number(a.dataset.rpOrder) - Number(b.dataset.rpOrder));
  const cur = [...parent.children].filter((c) => withOrder.includes(c as HTMLElement));
  if (cur.every((c, i) => c === sorted[i])) return;
  placeInOrder(parent, cur[0], sorted);
}

const KINDS: SkuKind[] = ['ship', 'ccu', 'pack', 'paint', 'gear', 'other'];
const TOGGLES: { k: keyof ImpFilter; label: string; tip: string }[] = [
  { k: 'hideOwned', label: 'Hide owned', tip: 'Hide what you already own (ships, upgrades, pledge titles in your RSI+ hangar)' },
  { k: 'onlyOwned', label: 'Owned only', tip: 'Only what you own, own part of, or (upgrades) own the ship it upgrades from' },
  { k: 'canApply', label: 'Upgrades I can apply', tip: 'Upgrades from a ship you own' },
  { k: 'inStock', label: 'In stock', tip: 'Hide sold-out listings' },
  { k: 'lti', label: 'LTI', tip: 'Listings with lifetime insurance' },
  { k: 'priced', label: 'Has RSI price', tip: 'Only listings RSI+ can compare with an RSI price' },
];

/** Toolbar above the grid: search, kinds, toggles, markup cap, sort, *Whole collection*. Built once per grid. */
export function paintToolbar(cards: HTMLElement[], extra: HTMLElement[] = [], grid = cards[0]!.parentElement) {
  if (!grid || grid.previousElementSibling?.classList.contains('rp-imp-bar')) return syncToolbar();
  document.querySelectorAll('.rp-imp-bar').forEach((n) => n.remove());
  const bar = el('div', 'rp-imp rp-imp-bar');
  const top = el('div', 'rp-imp-row');
  top.append(el('span', 'rp-imp-logo', 'RSI+'));
  const q = el('input', 'rp-imp-input');
  q.type = 'search';
  q.placeholder = 'Filter this page: words, -exclude';
  q.value = market.view.f.q;
  q.dataset.k = 'q';
  q.addEventListener('input', () => ((market.view.f.q = q.value), market.save(), market.schedule()));
  const sort = el('select', 'rp-imp-select');
  sort.dataset.k = 'sort';
  for (const s of IMP_SORTS) sort.append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));
  sort.value = market.view.sort;
  sort.addEventListener('change', (e) => (e.stopPropagation(), (market.view.sort = sort.value as ImpSort), market.save(), market.schedule()));
  const cap = el('select', 'rp-imp-select');
  cap.dataset.k = 'cap';
  cap.title = 'Markup over the RSI price';
  for (const [v, t] of [['', 'Any markup'], ['0', 'At or below RSI'], ['0.1', 'Up to +10%'], ['0.25', 'Up to +25%'], ['0.5', 'Up to +50%']])
    cap.append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
  cap.value = market.view.f.maxMarkup == null ? '' : String(market.view.f.maxMarkup);
  cap.addEventListener('change', (e) => (e.stopPropagation(), (market.view.f.maxMarkup = cap.value === '' ? null : Number(cap.value)), market.save(), market.schedule()));
  top.append(q, cap, sort);
  top.append(...extra);
  top.append(el('span', 'rp-imp-muted rp-imp-count'));
  const chips = el('div', 'rp-imp-row');
  for (const k of KINDS) {
    const b = el('button', 'rp-imp-chip', KIND_LABEL[k]);
    b.dataset.kind = k;
    b.addEventListener('click', () => ((market.view.f.kinds = market.view.f.kinds.includes(k) ? market.view.f.kinds.filter((x) => x !== k) : [...market.view.f.kinds, k]), market.save(), syncToolbar(), market.schedule()));
    chips.append(b);
  }
  chips.append(el('span', 'rp-imp-sep'));
  for (const t of TOGGLES.filter((x) => !market.hide.includes(x.k))) {
    const b = el('button', 'rp-imp-chip', t.label);
    b.dataset.toggle = t.k;
    b.title = t.tip;
    b.addEventListener('click', () => {
      (market.view.f as unknown as Record<string, boolean>)[t.k] = !market.view.f[t.k];
      if (t.k === 'hideOwned' && market.view.f.hideOwned) market.view.f.onlyOwned = false;
      if (t.k === 'onlyOwned' && market.view.f.onlyOwned) market.view.f.hideOwned = false;
      market.save();
      syncToolbar();
      market.schedule();
    });
    chips.append(b);
  }
  const dim = el('button', 'rp-imp-chip', 'Dim owned');
  dim.dataset.dim = '1';
  dim.title = 'Fade the cards of things you already own';
  dim.addEventListener('click', () => ((market.view.dimOwned = !market.view.dimOwned), market.save(), syncToolbar(), market.schedule()));
  const reset = el('button', 'rp-imp-btn', 'Reset');
  reset.addEventListener('click', () => {
    market.view = { f: { ...NO_IMP_FILTER }, sort: 'store', dimOwned: market.view.dimOwned };
    market.save();
    q.value = '';
    sort.value = 'store';
    cap.value = '';
    syncToolbar();
    market.schedule();
  });
  chips.append(dim, reset);
  bar.append(top, chips);
  if (!market.hasHangar) bar.append(el('div', 'rp-imp-muted', 'Owned marks need your hangar: load Pledges in the RSI+ hub once.'));
  grid.before(bar);
  syncToolbar();
}
export function syncToolbar() {
  for (const b of document.querySelectorAll<HTMLElement>('.rp-imp-bar [data-kind]')) b.classList.toggle('on', market.view.f.kinds.includes(b.dataset.kind as SkuKind));
  for (const b of document.querySelectorAll<HTMLElement>('.rp-imp-bar [data-toggle]')) b.classList.toggle('on', !!market.view.f[b.dataset.toggle as keyof ImpFilter]);
  document.querySelector('.rp-imp-bar [data-dim]')?.classList.toggle('on', market.view.dimOwned);
  for (const b of document.querySelectorAll<HTMLElement>('.rp-imp-bar [data-kind], .rp-imp-bar [data-toggle], .rp-imp-bar [data-dim]')) b.setAttribute('aria-pressed', String(b.classList.contains('on')));
}

