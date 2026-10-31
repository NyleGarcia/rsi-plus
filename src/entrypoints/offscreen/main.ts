/**
 * Offscreen document (MV3 service workers have no audio and no DOMParser): plays the party-mode ding, and reads the
 * hangar pages for the weekly StarOrg Tools sync (it has no storage access, so the pledges go back to the background,
 * which saves them). Chromium only — the Firefox build's background is a page and does both itself (lib/offscreen.ts).
 */
import { loadHangar } from '@/lib/account';
import { playDing } from '@/lib/ding-synth';
import { OFFSCREEN_DING, OFFSCREEN_HANGAR, OFFSCREEN_PROGRESS } from '@/lib/offscreen';

browser.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg?.type === OFFSCREEN_DING) playDing();
  if (msg?.type === OFFSCREEN_HANGAR) {
    loadHangar(() => {
      browser.runtime.sendMessage({ type: OFFSCREEN_PROGRESS }).catch(() => undefined);
    }).then(
      (pledges) => sendResponse({ pledges }),
      (e: unknown) => sendResponse({ error: e instanceof Error ? e.message : String(e) }),
    );
    return true; // async response
  }
});
