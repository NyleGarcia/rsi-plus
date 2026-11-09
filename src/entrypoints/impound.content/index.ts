/**
 * The Impound (opt-in: Settings → Integrations → The Impound). Registered at runtime by the background only while the
 * setting is on and theimpound.com is granted (`registration: 'runtime'`: nothing in the manifest, a store install
 * asks for nothing new). Reads the store's own pages and its public Shopify product JSON; never its cart or account.
 *
 * - Every listing (collection / search grids): RSI price, markup, and what you already own.
 * - A toolbar over the grid: search, kind, owned / can apply / in stock / LTI / at most RSI price, and sorting.
 * - *Whole collection*: every listing of the collection in one table with the same filters (reads all its pages).
 * - A product page: each variant (upgrade from …, insurance) with its RSI price, markup and whether you own it.
 */
import { buybackItem, catalogItem, gameShipsItem, getSettings, hangarItem, impoundCacheItem, impoundViewItem, paintCatalogItem, settingsItem } from '@/lib/settings';
import { bg } from '@/lib/messages';
import { ownedCcus } from '@/lib/ccu';
import { ownedHulls, ownedTitleCounts } from '@/lib/owned-counts';
import {
  IMP_SORTS,
  KIND_LABEL,
  NO_IMP_FILTER,
  collectionOf,
  filterRows,
  fresh,
  handleFromUrl,
  insuranceLabel,
  markup,
  ownershipFull,
  paidByTitle,
  paidLabel,
  pageOf,
  parseSku,
  priceCtx,
  productFromPage,
  putProducts,
  rowOf,
  rsiPrice,
  sortRows,
  toProduct,
  type ImpCache,
  type ImpFilter,
  type ImpProduct,
  type ImpRow,
  type ImpSort,
  type OwnCtx,
  type PriceCtx,
  type SkuKind,
} from '@/lib/impound';
import type { CatalogShip } from '@/lib/store';
import { applyView, badge, configureMarket, el, market, money, paintToolbar, pct, signed, tone } from '@/lib/market-dom';
import css from './style.css?inline';

let ships: CatalogShip[] = [];
let pctx: PriceCtx = priceCtx([], []);
let own: OwnCtx = { hulls: new Map(), ccus: [], titles: { exact: new Map(), cut: new Map() } };
let cache: ImpCache = {};
let schedule = () => {};

export default defineContentScript({
  matches: ['https://theimpound.com/*'],
  registration: 'runtime',
  runAt: 'document_idle',
  async main(ctx) {
    if (!(await getSettings()).impound) return;
    const style = document.createElement('style');
    style.id = 'rsiplus-imp-style';
    style.textContent = css;
    (document.head ?? document.documentElement).append(style);

    const saved = await impoundViewItem.getValue();
    configureMarket({
      store: 'The Impound',
      view: { ...market.view, ...(saved ?? {}), f: { ...NO_IMP_FILTER, ...(saved?.f ?? {}) } },
      save: () => void impoundViewItem.setValue(market.view).catch(() => {}),
      schedule: () => schedule(),
    });
    cache = await impoundCacheItem.getValue();
    await loadData();
    for (const it of [catalogItem, paintCatalogItem, hangarItem, buybackItem, gameShipsItem] as const) it.watch(() => loadData().then(schedule));
    settingsItem.watch(async () => {
      if (!(await getSettings()).impound) document.querySelectorAll('.rp-imp').forEach((n) => n.remove());
    });

    let timer = 0;
    schedule = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        paint().catch((e) => console.warn('[RSI+] impound', e));
      }, 200);
    };
    const mo = new MutationObserver((muts) => {
      if (muts.every((m) => [...m.addedNodes, ...m.removedNodes].every((n) => n instanceof HTMLElement && (n.classList.contains('rp-imp') || !!n.closest('.rp-imp'))))) return;
      schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => mo.disconnect());
    ctx.addEventListener(window, 'wxt:locationchange', schedule);
    // Variant picked on a product page: the URL gets ?variant=… (history.replaceState) and the select changes.
    ctx.addEventListener(document, 'change', schedule, { capture: true });
    schedule();
  },
});

async function loadData() {
  let cat = await catalogItem.getValue();
  if (!cat?.ships.length) cat = await bg({ type: 'catalog:get' }).catch(() => null);
  let paints = await paintCatalogItem.getValue();
  if (!paints?.paints.length) paints = await bg({ type: 'paints:get' }).catch(() => null);
  ships = cat?.ships ?? [];
  pctx = priceCtx(ships, paints?.paints ?? []);
  const hangar = await hangarItem.getValue();
  const game = await gameShipsItem.getValue();
  const pledges = hangar?.pledges ?? [];
  own = { hulls: ownedHulls(pledges, game, ships), ccus: ships.length ? ownedCcus(pledges, [], ships).owned : [], titles: ownedTitleCounts(pledges), paid: paidByTitle(pledges) };
  market.hasHangar = !!hangar?.pledges.length;
}

/* ---------------------------------------------------------------- fetching ---------------------------------------------------------------- */

let saving = 0;
function remember(list: ImpProduct[]) {
  if (!list.length) return;
  cache = putProducts(cache, list, Date.now());
  clearTimeout(saving);
  saving = window.setTimeout(() => impoundCacheItem.setValue(cache).catch(() => {}), 800);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inflight = new Set<string>();
let backoffUntil = 0;

async function getJson(url: string): Promise<any | null> {
  if (Date.now() < backoffUntil) return null;
  const r = await fetch(url, { credentials: 'omit', headers: { accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) backoffUntil = Date.now() + 60_000;
  return r?.ok ? r.json().catch(() => null) : null;
}

/** All products of a collection (Shopify `products.json`, 250 a page), politely one page at a time. */
async function collectionProducts(handle: string, onPage?: (n: number) => void): Promise<ImpProduct[]> {
  const out: ImpProduct[] = [];
  for (let page = 1; page <= 20; page++) {
    const j = await getJson(`/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`);
    const list = ((j?.products ?? []) as unknown[]).map((p) => toProduct(p)).filter((p): p is ImpProduct => !!p);
    out.push(...list);
    remember(list);
    onPage?.(out.length);
    if (list.length < 250) break;
    await wait(500);
  }
  return out;
}

/** Products for the cards on screen that the cache doesn't hold (fresh): the collection's JSON, else one by one. */
async function ensure(handles: string[]) {
  const now = Date.now();
  const missing = handles.filter((h) => !fresh(cache, h, now) && !inflight.has(h));
  if (!missing.length) return false;
  missing.forEach((h) => inflight.add(h));
  try {
    const coll = collectionOf(location.pathname);
    if (coll && pageOf(location.pathname) === 'collection') {
      const want = new Set(missing);
      for (let page = 1; page <= 20 && want.size; page++) {
        const j = await getJson(`/collections/${encodeURIComponent(coll)}/products.json?limit=250&page=${page}`);
        const list = ((j?.products ?? []) as unknown[]).map((p) => toProduct(p)).filter((p): p is ImpProduct => !!p);
        remember(list);
        list.forEach((p) => want.delete(p.handle));
        if (list.length < 250) break;
        await wait(500);
      }
      missing.splice(0, missing.length, ...missing.filter((h) => want.has(h)));
    }
    // Search results, or cards from another collection: one product each (`.js`, prices in cents), 3 at a time.
    const queue = missing.slice(0, 80);
    const worker = async () => {
      for (let h = queue.shift(); h; h = queue.shift()) {
        const p = toProduct(await getJson(`/products/${encodeURIComponent(h)}.js`), true);
        if (p) remember([p]);
        await wait(150);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return true;
  } finally {
    missing.forEach((h) => inflight.delete(h));
  }
}

/* ---------------------------------------------------------------- painting ---------------------------------------------------------------- */

async function paint() {
  if (!document.body) return;
  const page = pageOf(location.pathname);
  if (page === 'product') paintProduct();
  // Grid cards on collection / search pages only: on a product page they are "related" strips (shown as previews).
  const cards = page === 'product' ? [] : [...document.querySelectorAll<HTMLElement>('.grid-product[data-product-handle]')];
  const minis = miniCards();
  if (page === 'product') for (const c of document.querySelectorAll<HTMLElement>('.grid-product[data-product-handle]')) minis.set(c, c.dataset.productHandle!);
  if (cards.length) {
    paintToolbar(cards, wholeButton());
    paintCards(cards);
  }
  paintMinis(minis);
  const handles = [...new Set([...cards.map((c) => c.dataset.productHandle!), ...minis.values()].filter(Boolean))];
  if (await ensure(handles)) {
    if (cards.length) paintCards([...document.querySelectorAll<HTMLElement>('.grid-product[data-product-handle]')]);
    paintMinis(miniCards());
  }
}

function rowFor(handle: string): ImpRow | null {
  const p = cache[handle]?.p;
  return p ? rowOf(p, pctx, own) : null;
}

/** RSI price line under each card's price, owned marks, then the toolbar's filter and order. */
function paintCards(cards: HTMLElement[]) {
  const rows = new Map<HTMLElement, ImpRow | null>(cards.map((c) => [c, rowFor(c.dataset.productHandle!)]));
  for (const [card, r] of rows) {
    const meta = card.querySelector('.grid-product__meta') ?? card.querySelector('.grid-product__content');
    if (!meta) continue;
    const key = r ? [r.variant.id, r.variant.price, r.rsi.cents, r.own.label, market.view.dimOwned].join('|') : 'none';
    let box = meta.querySelector<HTMLElement>(':scope > .rp-imp-card');
    card.classList.toggle('rp-imp-owned', !!r?.own.owned && market.view.dimOwned);
    if (box?.dataset.key === key) continue;
    box?.remove();
    box = el('div', 'rp-imp rp-imp-card');
    box.dataset.key = key;
    if (!r) box.append(el('span', 'rp-imp-muted', ships.length ? 'RSI+ …' : 'RSI+: open the RSI+ hub once to load RSI prices'));
    else badge(box, r);
    meta.append(box);
  }
  applyView(rows);
}

/* ---------------------------------------------------------------- small previews ---------------------------------------------------------------- */

/** Product links outside the main grid: menu minis, home page strips, "you may also like", the search drawer. */
const MINI_CARD = '.gm-product-mini, .tise-card, [class*="ai-collection-grid__product"], .predictive-search__item, .predictive__item, li, article';
function miniCards(): Map<HTMLElement, string> {
  const out = new Map<HTMLElement, string>();
  const self = pageOf(location.pathname) === 'product' ? handleFromUrl(location.pathname) : null;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/products/"]')) {
    if (a.closest('.grid-product, .rp-imp, .product-single__meta, form')) continue;
    const h = handleFromUrl(a.getAttribute('href') ?? '');
    if (!h || h === self) continue;
    const card = a.closest<HTMLElement>(MINI_CARD) ?? a.parentElement;
    if (!card || card === document.body || out.has(card)) continue;
    // A container holding several products (a whole list) isn't one card.
    if (new Set([...card.querySelectorAll<HTMLAnchorElement>('a[href*="/products/"]')].map((x) => handleFromUrl(x.getAttribute('href') ?? ''))).size > 1) continue;
    out.set(card, h);
  }
  return out;
}
function paintMinis(cards: Map<HTMLElement, string>) {
  for (const [card, h] of cards) {
    const r = rowFor(h);
    const key = r ? [r.variant.id, r.rsi.cents, r.own.label, r.own.paid?.cents].join('|') : 'none';
    let box = card.querySelector<HTMLElement>(':scope .rp-imp-mini');
    if (box?.dataset.key === key) continue;
    box?.remove();
    if (!r) continue;
    box = el('span', 'rp-imp rp-imp-mini');
    box.dataset.key = key;
    badge(box, r, true);
    if (!box.childElementCount) continue;
    const price = card.querySelector('.money')?.closest('[class*="price"]') ?? card.querySelector('.money');
    if (price) price.after(box);
    else card.append(box);
  }
}

/* ---------------------------------------------------------------- whole collection ---------------------------------------------------------------- */

function wholeButton(): HTMLElement[] {
  const coll = collectionOf(location.pathname);
  if (!coll || pageOf(location.pathname) !== 'collection') return [];
  const all = el('button', 'rp-imp-btn primary', 'Whole collection');
  all.title = 'Every listing of this collection (all pages) in one table, with these filters';
  all.addEventListener('click', () => openTable(coll));
  return [all];
}

async function openTable(coll: string) {
  document.querySelector('.rp-imp-overlay')?.remove();
  const ov = el('div', 'rp-imp rp-imp-overlay');
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'RSI+: whole collection');
  const panel = el('div', 'rp-imp-panel');
  const head = el('div', 'rp-imp-row');
  const title = el('strong', '', `RSI+ · ${document.querySelector('h1')?.textContent?.trim() || coll}`);
  const status = el('span', 'rp-imp-muted', 'Reading the collection…');
  const close = el('button', 'rp-imp-btn', 'Close');
  close.addEventListener('click', () => ov.remove());
  head.append(title, status, close);
  const body = el('div', 'rp-imp-tablewrap');
  panel.append(head, el('div', 'rp-imp-muted', 'Uses the filters and sort of the toolbar. Click a heading to sort.'), body);
  ov.append(panel);
  ov.addEventListener('click', (e) => e.target === ov && ov.remove());
  ov.addEventListener('keydown', (e) => e.key === 'Escape' && ov.remove());
  document.body.append(ov);
  close.focus();
  const list = await collectionProducts(coll, (n) => (status.textContent = `Reading the collection… ${n}`));
  const render = () => {
    const rows = sortRows(filterRows(list.map((p) => rowOf(p, pctx, own)).filter((r): r is ImpRow => !!r), market.view.f), market.view.sort);
    status.textContent = `${rows.length} of ${list.length} listings`;
    const t = el('table', 'rp-imp-table');
    const hr = el('tr', '');
    const cols: [string, ImpSort | null][] = [['Listing', 'title'], ['Kind', null], ['The Impound', 'price'], ['RSI', null], ['Markup', 'markup-pct'], ['You', null], ['Stock', null]];
    for (const [c, s] of cols) {
      const th = el('th', s ? 'sortable' : '', c);
      if (s) th.addEventListener('click', () => ((market.view.sort = market.view.sort === s && s === 'price' ? 'price-desc' : s), market.save(), render(), schedule()));
      hr.append(th);
    }
    t.append(el('thead', ''));
    t.tHead!.append(hr);
    const tb = el('tbody', '');
    for (const r of rows.slice(0, 1500)) {
      const tr = el('tr', r.own.owned ? 'owned' : '');
      const a = el('a', '', r.product.title);
      a.href = `/products/${r.product.handle}${r.product.variants.length > 1 ? `?variant=${r.variant.id}` : ''}`;
      const c0 = el('td', '');
      c0.append(a);
      if (r.product.variants.length > 1) c0.append(el('div', 'rp-imp-muted', `${r.variant.title}${r.product.variants.length > 1 ? ` · ${r.product.variants.length} options` : ''}`));
      const ins = insuranceLabel(r.info.insurance);
      tr.append(
        c0,
        el('td', '', `${KIND_LABEL[r.kind]}${ins ? ` · ${ins}` : ''}`),
        el('td', 'num', money(r.variant.price)),
        Object.assign(el('td', 'num', r.rsi.cents != null ? money(r.rsi.cents) : '—'), { title: r.rsi.basis }),
        el('td', `num ${tone(r.markup)}`, r.markup ? `${signed(r.markup.cents)} (${pct(r.markup.pct)})` : '—'),
        el('td', r.own.owned ? 'own' : '', r.own.label),
        el('td', '', r.available ? 'in stock' : 'sold out'),
      );
      tb.append(tr);
    }
    t.append(tb);
    body.replaceChildren(t);
    if (rows.length > 1500) body.append(el('div', 'rp-imp-muted', `First 1500 of ${rows.length}: narrow the filters.`));
  };
  render();
}

/* ---------------------------------------------------------------- product page ---------------------------------------------------------------- */

function selectedVariant(): number | null {
  const v = new URLSearchParams(location.search).get('variant');
  if (v) return Number(v);
  const sel = document.querySelector<HTMLSelectElement>('select[name="id"]');
  return sel?.value ? Number(sel.value) : null;
}

function paintProduct() {
  const handle = handleFromUrl(location.pathname);
  if (!handle) return;
  const p = productFromPage(document, handle) ?? cache[handle]?.p ?? null;
  const host = document.querySelector('.product-block--price') ?? document.querySelector('.product-single__meta');
  if (!p || !host) return;
  const sel = selectedVariant() ?? p.variants[0]?.id ?? null;
  const rows = p.variants.map((v) => ({ v, info: parseSku(v.sku), rsi: rsiPrice(p, v, pctx), own: ownershipFull(p, v, own, pctx) }));
  const key = [handle, sel, ships.length, own.hulls.size, own.ccus.length, rows.map((r) => r.v.price).join(',')].join('|');
  let box = document.querySelector<HTMLElement>('.rp-imp-product');
  if (box?.dataset.key === key) return;
  box?.remove();
  box = el('div', 'rp-imp rp-imp-product');
  box.dataset.key = key;
  const cur = rows.find((r) => r.v.id === sel) ?? rows[0]!;
  const m = markup(cur.v.price, cur.rsi);
  const head = el('div', 'rp-imp-row');
  head.append(el('span', 'rp-imp-logo', 'RSI+'));
  if (cur.rsi.cents != null && m) {
    const s = el('span', `rp-imp-price big ${tone(m)}`, `RSI ${money(cur.rsi.cents)} · The Impound ${money(cur.v.price)} · ${signed(m.cents)} (${pct(m.pct)})`);
    s.title = cur.rsi.basis;
    head.append(s);
  } else head.append(el('span', 'rp-imp-muted', ships.length ? 'No RSI price to compare for this one' : 'Open the RSI+ hub once to load RSI prices'));
  box.append(head);
  if (cur.rsi.basis) box.append(el('div', 'rp-imp-muted', cur.rsi.basis + (cur.info.kind === 'ship' || cur.info.kind === 'pack' ? '. LTI, original-concept extras and availability are not priced in.' : '')));
  if (cur.own.label) box.append(el('div', `rp-imp-own ${cur.own.owned || cur.own.haveTo ? '' : 'part'}`, `${cur.own.owned || cur.own.haveTo ? '✓' : cur.own.partial ? '◐' : '↑'} ${cur.own.label}`));
  if (cur.own.paid) {
    const pd = el('div', 'rp-imp-muted', `${paidLabel(cur.own.paid, money)[0]!.toUpperCase()}${paidLabel(cur.own.paid, money).slice(1)}: ${cur.own.paid.pledge} (melt value)`);
    box.append(pd);
  }
  if (cur.own.contents?.length) {
    const ul = el('ul', 'rp-imp-contents');
    for (const c of cur.own.contents) ul.append(el('li', c.have ? 'have' : '', `${c.have ? '✓' : '·'} ${c.name}`));
    box.append(el('div', 'rp-imp-muted', `Inside (as RSI+ reads the listing): ${cur.own.contents.filter((c) => c.have).length}/${cur.own.contents.length} in your hangar`), ul);
  }
  if (!cur.own.label && !market.hasHangar) box.append(el('div', 'rp-imp-muted', 'Owned marks need your hangar: load Pledges in the RSI+ hub once.'));

  if (rows.length > 1) {
    const usable = rows.filter((r) => r.info.kind === 'ccu' && r.own.haveFrom);
    const t = el('table', 'rp-imp-table');
    const hr = el('tr', '');
    for (const c of [rows[0]!.info.kind === 'ccu' ? 'Upgrade from' : 'Option', 'The Impound', 'RSI', 'Markup', 'You', '']) hr.append(el('th', '', c));
    t.append(el('thead', ''));
    t.tHead!.append(hr);
    const tb = el('tbody', '');
    const order = [...rows].sort((a, b) => Number(b.own.haveFrom) - Number(a.own.haveFrom) || Number(b.v.available) - Number(a.v.available) || (markup(a.v.price, a.rsi)?.pct ?? 9) - (markup(b.v.price, b.rsi)?.pct ?? 9));
    for (const r of order) {
      const mk = markup(r.v.price, r.rsi);
      const tr = el('tr', `${r.v.id === sel ? 'sel' : ''} ${r.v.available ? '' : 'out'} ${r.own.haveFrom ? 'usable' : ''}`);
      const pick = el('a', 'rp-imp-link', r.v.id === sel ? 'shown' : 'pick');
      pick.href = `?variant=${r.v.id}`;
      tr.append(
        el('td', '', `${r.v.title}${r.v.available ? '' : ' (sold out)'}`),
        el('td', 'num', money(r.v.price)),
        Object.assign(el('td', 'num', r.rsi.cents != null ? money(r.rsi.cents) : '—'), { title: r.rsi.basis }),
        el('td', `num ${tone(mk)}`, mk ? `${signed(mk.cents)} (${pct(mk.pct)})` : '—'),
        el('td', r.own.owned || r.own.haveFrom ? 'own' : '', r.info.kind === 'ccu' ? (r.own.owned ? 'own this' : r.own.haveFrom ? 'you own the from ship' : '') : r.own.label),
        Object.assign(el('td', ''), {}),
      );
      tr.lastElementChild!.append(pick);
      tb.append(tr);
    }
    t.append(tb);
    const det = el('details', 'rp-imp-variants');
    det.open = rows.length <= 12 || usable.length > 0;
    det.append(el('summary', '', `All ${rows.length} options${usable.length ? ` · ${usable.length} from ships you own (listed first)` : ''}`), t);
    box.append(det);
  }
  host.after(box);
}
