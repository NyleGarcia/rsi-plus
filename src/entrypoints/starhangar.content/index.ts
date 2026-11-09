/**
 * Star Hangar (opt-in: Settings → Integrations → Star Hangar). Registered at runtime by the background only while the
 * setting is on and star-hangar.com is granted (`registration: 'runtime'`: nothing in the manifest). Reads the listing
 * cards and product pages you open — no requests of its own, never the cart, checkout or account.
 *
 * Same as The Impound (lib/market-dom.ts): RSI price, markup and what you own on every listing, the filter / sort
 * toolbar over category and search results, and an RSI+ box on product pages.
 */
import { buybackItem, catalogItem, gameShipsItem, getSettings, hangarItem, paintCatalogItem, settingsItem, starhangarViewItem } from '@/lib/settings';
import { bg } from '@/lib/messages';
import { ownedCcus } from '@/lib/ccu';
import { ownedHulls, ownedTitleCounts } from '@/lib/owned-counts';
import { NO_IMP_FILTER, insuranceLabel, paidByTitle, paidLabel, priceCtx, rowOf, type ImpRow, type OwnCtx, type PriceCtx } from '@/lib/impound';
import { parseCard, parsePage, toListing } from '@/lib/starhangar';
import { applyView, badge, configureMarket, el, market, money, paintToolbar, pct, signed, tone } from '@/lib/market-dom';
import type { CatalogShip } from '@/lib/store';
import css from '../impound.content/style.css?inline';

let ships: CatalogShip[] = [];
let pctx: PriceCtx = priceCtx([], []);
let own: OwnCtx = { hulls: new Map(), ccus: [], titles: { exact: new Map(), cut: new Map() } };
let schedule = () => {};

export default defineContentScript({
  matches: ['https://star-hangar.com/*'],
  registration: 'runtime',
  runAt: 'document_idle',
  async main(ctx) {
    if (!(await getSettings()).starhangar) return;
    const style = document.createElement('style');
    style.id = 'rsiplus-sh-style';
    style.textContent = css;
    (document.head ?? document.documentElement).append(style);

    const saved = await starhangarViewItem.getValue();
    configureMarket({
      store: 'Star Hangar',
      view: { ...market.view, ...(saved ?? {}), f: { ...NO_IMP_FILTER, ...(saved?.f ?? {}) } },
      save: () => void starhangarViewItem.setValue(market.view).catch(() => {}),
      schedule: () => schedule(),
      // Star Hangar lists only what is for sale: no sold-out listings to hide.
      hide: ['inStock'],
    });
    await loadData();
    for (const it of [catalogItem, paintCatalogItem, hangarItem, buybackItem, gameShipsItem] as const) it.watch(() => loadData().then(schedule));
    settingsItem.watch(async () => {
      if (!(await getSettings()).starhangar) document.querySelectorAll('.rp-imp').forEach((n) => n.remove());
    });

    let timer = 0;
    schedule = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        try {
          paint();
        } catch (e) {
          console.warn('[RSI+] star hangar', e);
        }
      }, 200);
    };
    const mo = new MutationObserver((muts) => {
      if (muts.every((m) => [...m.addedNodes, ...m.removedNodes].every((n) => n instanceof HTMLElement && (n.classList.contains('rp-imp') || !!n.closest('.rp-imp'))))) return;
      schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => mo.disconnect());
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

/** A card's row: parsed fresh from the card each paint (Star Hangar cards carry everything). */
function rowFor(card: Element): ImpRow | null {
  const c = parseCard(card);
  return c ? rowOf(toListing(c, ships), pctx, own) : null;
}

function paint() {
  if (!document.body) return;
  paintProduct();
  const infos = [...document.querySelectorAll<HTMLElement>('.product-item-info')];
  if (!infos.length) return;
  // Main results (category / search, with Magento's toolbar) get the RSI+ toolbar; widget strips just the badges.
  const main = document.querySelector<HTMLElement>('.products.wrapper ol.product-items, .products.wrapper .product-items');
  const rows = new Map<HTMLElement, ImpRow | null>();
  for (const info of infos) {
    const r = rowFor(info);
    paintBadge(info, r, !main?.contains(info));
    if (main?.contains(info)) rows.set(info.closest<HTMLElement>('li.product-item') ?? info, r);
  }
  if (main && rows.size) {
    paintToolbar([...rows.keys()], [], main.closest<HTMLElement>('.products.wrapper') ?? main);
    applyView(rows);
  }
}

function paintBadge(info: HTMLElement, r: ImpRow | null, compact: boolean) {
  const host = info.querySelector('.product-details-wrapper') ?? info.querySelector('.product-item-details') ?? info;
  const key = r ? [r.variant.sku, r.variant.price, r.rsi.cents, r.own.label, r.own.paid?.cents, market.view.dimOwned, ships.length].join('|') : `none|${ships.length}`;
  (info.closest<HTMLElement>('li.product-item') ?? info).classList.toggle('rp-imp-owned', !!r?.own.owned && market.view.dimOwned);
  let box = host.querySelector<HTMLElement>(':scope > .rp-imp-card');
  if (box?.dataset.key === key) return;
  box?.remove();
  box = el('div', `rp-imp rp-imp-card${compact ? ' rp-imp-mini' : ''}`);
  box.dataset.key = key;
  if (!r) box.append(el('span', 'rp-imp-muted', ships.length ? '' : 'RSI+: open the RSI+ hub once to load RSI prices'));
  else badge(box, r, compact);
  if (box.textContent) host.append(box);
}

function paintProduct() {
  const c = parsePage(document);
  const host = document.querySelector('.product-info-main .product-info-price') ?? document.querySelector('.product-info-main');
  if (!c || !host) return;
  const r = rowOf(toListing(c, ships), pctx, own);
  const key = r ? [r.variant.sku, r.variant.price, r.rsi.cents, r.own.label, r.own.paid?.cents, ships.length].join('|') : 'none';
  let box = document.querySelector<HTMLElement>('.rp-imp-product');
  if (box?.dataset.key === key) return;
  box?.remove();
  if (!r) return;
  box = el('div', 'rp-imp rp-imp-product');
  box.dataset.key = key;
  const head = el('div', 'rp-imp-row');
  head.append(el('span', 'rp-imp-logo', 'RSI+'));
  if (r.rsi.cents != null && r.markup) {
    const s = el('span', `rp-imp-price big ${tone(r.markup)}`, `RSI ${money(r.rsi.cents)} · Star Hangar ${money(r.variant.price)} · ${signed(r.markup.cents)} (${pct(r.markup.pct)})`);
    s.title = r.rsi.basis;
    head.append(s);
  } else head.append(el('span', 'rp-imp-muted', ships.length ? 'No RSI price to compare for this one' : 'Open the RSI+ hub once to load RSI prices'));
  box.append(head);
  if (r.rsi.basis) box.append(el('div', 'rp-imp-muted', r.rsi.basis + (r.kind === 'ship' ? `. ${insuranceLabel(r.info.insurance) || 'Insurance'} and other extras are not priced in.` : '')));
  if (r.kind === 'other' && r.rsi.cents == null) box.append(el('div', 'rp-imp-muted', 'RSI+ matches ships, upgrades and paints by name; this one it could not place.'));
  if (r.own.label) box.append(el('div', `rp-imp-own ${r.own.owned || r.own.haveTo ? '' : 'part'}`, `${r.own.owned || r.own.haveTo ? '✓' : r.own.partial ? '◐' : '↑'} ${r.own.label}`));
  else if (!market.hasHangar) box.append(el('div', 'rp-imp-muted', 'Owned marks need your hangar: load Pledges in the RSI+ hub once.'));
  if (r.own.paid) {
    const t = paidLabel(r.own.paid, money);
    box.append(el('div', 'rp-imp-muted', `${t[0]!.toUpperCase()}${t.slice(1)}: ${r.own.paid.pledge} (melt value)`));
  }
  host.after(box);
}
