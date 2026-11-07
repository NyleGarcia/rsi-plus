import type { ContentScriptContext } from 'wxt/utils/content-script-context';

/**
 * The page's current path, reactive, for the in-page Svelte UI (SiteBar, ThreadBar).
 *
 * RSI and Spectrum are SPAs, so the path changes without a reload. WXT only delivers its `wxt:locationchange` event
 * through `ctx.addEventListener` (the real event name is namespaced per extension + entrypoint), so a plain
 * `window.addEventListener('wxt:locationchange')` in a component never fires. The content script calls `trackPath`
 * once; components read `page.path`.
 *
 * Read the new URL from the event, not `location`: with the Navigation API WXT fires on `navigate`, before the URL
 * commits, so `location.pathname` is still the page being left.
 */
export const page = $state({ path: typeof location === 'undefined' ? '' : location.pathname });

export function trackPath(ctx: ContentScriptContext) {
  page.path = location.pathname;
  ctx.addEventListener(window, 'wxt:locationchange', (e) => (page.path = e.newUrl.pathname));
}
