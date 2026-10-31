/**
 * Screenshare mode: one switch that masks what is *yours* — spend, melt values, store credit, buyback prices, spend
 * charts, account names — while store prices and ship names stay readable. Stored in `localStorage` `rsiplus:privacy`
 * (hub + popup share the origin and follow each other through the `storage` event) and mirrored as
 * `data-privacy="on"` on `<html>` so `app.css` can blur `.sens` elements (charts, names). Numbers go through `own()` /
 * `ownMoney()` / `ownUsd()`, which return `•••` while it is on, so nothing sensitive is even in the DOM.
 */
import { usd } from './store';
import { fmtUsd, moneySymbol } from './currency';

export const privacy = $state({ on: false });
export const MASK = '•••';
const KEY = 'rsiplus:privacy';

const apply = () => {
  if (typeof document !== 'undefined') document.documentElement.dataset.privacy = privacy.on ? 'on' : 'off';
};

export function initPrivacy() {
  try {
    privacy.on = localStorage.getItem(KEY) === '1';
  } catch {
    /* private mode */
  }
  apply();
  if (typeof window !== 'undefined')
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) ((privacy.on = e.newValue === '1'), apply());
    });
}

export function setPrivacy(on: boolean) {
  privacy.on = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* applies to this page anyway */
  }
  apply();
}
export const togglePrivacy = () => setPrivacy(!privacy.on);

/** A value that is yours (a name, a ratio): `•••` in screenshare mode. */
export const own = (s: string | number) => (privacy.on ? MASK : String(s));
/** Money that is yours: keeps the currency symbol so columns still read as money. */
export const ownMoney = (s: string) => (privacy.on ? `${moneySymbol()}${MASK}` : s);
/** `usd(cents)` for amounts that are yours (melt credit, what you paid). */
export const ownUsd = (cents: number) => ownMoney(usd(cents));
/** Dollars (not cents) that are yours: `$1,234` / `$12.50` (or the display currency); `$•••` in screenshare mode. */
export const ownDollars = (n: number) => ownMoney(fmtUsd(n));
