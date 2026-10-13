import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: ({ command }) => ({
    name: 'RSI+',
    description: 'Roberts Space Industries, better: Spectrum read tracking + mutes + watches, friends manager, hangar/buyback explorer, store prices, wishlist alerts and a CCU chain planner.',
    // unlimitedStorage: big hangars/buybacks + read marks can pass storage.local's 10 MB default quota.
    // cookies: read the Rsi-Token cookie so the background can call Spectrum's API (X-Rsi-Token header) without a tab.
    // offscreen: a service worker can't play audio; the party-mode ding plays in an offscreen document.
    permissions: ['storage', 'unlimitedStorage', 'alarms', 'notifications', 'cookies', 'offscreen'],
    host_permissions: ['https://robertsspaceindustries.com/*'],
    // split: incognito gets its own background (own cookie jar → its own RSI login, polling, party mode) and its
    // hub/popup open in incognito. Account data is namespaced per context in lib/settings.ts (storage is shared).
    // Spanning would be simpler, but Chrome refuses to show extension pages inside incognito windows in that mode
    // (the hub always lands in a normal window) and there is only one cookie jar. Dev (`wxt`) is split too: its hot
    // reload registers content scripts from both backgrounds and the loser throws "Duplicate script ID" — harmless
    // (registration is extension-wide), swallowed in background.ts.
    incognito: 'split',
  }),
});
