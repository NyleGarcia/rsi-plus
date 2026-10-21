import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

/**
 * Version label for a local build of commits not released yet: `0.5.0-dev (local a31e2a6)` instead of the last
 * release's number, so a reloaded unpacked build shows it is newer. WXT derives the manifest `version` from it (0.5.0).
 * Untouched in CI (the Prerelease workflow sets `X.Y.Z-dev.N` itself; release builds keep `X.Y.Z`), for a
 * prerelease package.json version, and on a commit tagged with the package.json version.
 */
function localVersionName(): string | undefined {
  if (process.env.CI) return undefined;
  try {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
    if (version.includes('-')) return undefined;
    const sh = (cmd: string) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const tags = sh('git tag --points-at HEAD').split('\n');
    if (tags.includes(`v${version}`)) return undefined;
    const next = sh('bash scripts/next-prerelease.sh').replace(/-dev.*$/, '');
    const dirty = sh('git status --porcelain --untracked-files=no') ? '+' : '';
    return `${next}-dev (local ${sh('git rev-parse --short HEAD')}${dirty})`;
  } catch {
    return undefined;
  }
}
const versionName = localVersionName();

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  // Tailwind v4 (shadcn-svelte) — imported only by the hub / popup pages; content scripts stay vanilla so nothing
  // bleeds into RSI's own pages.
  // RSIPLUS_NOMINIFY=1: readable function names in Chrome profiles.
  vite: () => ({ plugins: [tailwindcss()], ...(process.env.RSIPLUS_NOMINIFY ? { build: { minify: false } } : {}) }),
  // Targets: chrome, edge, brave (same MV3 build as chrome, own file name), firefox. `wxt zip -b <target>`; CI builds all four.
  manifest: ({ browser }) => {
    const firefox = browser === 'firefox';
    return {
      name: 'RSI+',
      ...(versionName ? { version_name: versionName } : {}),
      description: 'RSI, better: Spectrum read tracking, mutes, watches, friends, hangar & buyback explorer, store prices, wishlist alerts, CCU planner.',
      // unlimitedStorage: big hangars/buybacks + read marks can pass storage.local's 10 MB default quota.
      // cookies: read the Rsi-Token cookie so the background can call Spectrum's API (X-Rsi-Token header) without a tab.
      // offscreen (Chromium): a service worker can't play audio; the party-mode ding plays in an offscreen document.
      // Firefox has no such permission — its MV2 background is a page and plays the ding itself (lib/sound.ts).
      permissions: ['storage', 'unlimitedStorage', 'alarms', 'notifications', 'cookies', ...(firefox ? [] : ['offscreen'])],
      host_permissions: ['https://robertsspaceindustries.com/*'],
      // split (Chromium): incognito gets its own background (own cookie jar → its own RSI login, polling, party mode)
      // and its hub/popup open in incognito. Account data is namespaced per context in lib/settings.ts (storage is
      // shared). Spanning would be simpler, but Chrome refuses to show extension pages inside incognito windows in that
      // mode (the hub always lands in a normal window) and there is only one cookie jar. Dev (`wxt`) is split too: its
      // hot reload registers content scripts from both backgrounds and the loser throws "Duplicate script ID" —
      // harmless (registration is extension-wide), swallowed in background.ts.
      // Firefox installs `split` as `not_allowed` (private windows invisible), so the key is left out there: spanning,
      // one login shared with private windows, like the dev build.
      ...(firefox ? {} : { incognito: 'split' as const }),
      ...(firefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'rsi-plus@nylegarcia.github.io',
                // 128: `world: "MAIN"` content scripts in the manifest (spectrum-hook).
                strict_min_version: '128.0',
                // AMO requires a data-collection declaration for new submissions; nothing leaves the browser (PRIVACY.md).
                data_collection_permissions: { required: ['none'] },
              },
            },
          }
        : {}),
    };
  },
  // Firefox's sources zip (for AMO review) needs the code, not the store kit, docs or screenshots.
  zip: { excludeSources: ['store/**', 'docs/**', 'public/undo/**', '*.zip', '.claude/**'] },
});
