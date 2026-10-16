/**
 * Offscreen document (MV3 service workers have no audio): plays the party-mode ding on request.
 * Chromium only — the Firefox build's background is a page and plays the ding itself (lib/sound.ts).
 */
import { playDing } from '@/lib/ding-synth';
import { OFFSCREEN_DING } from '@/lib/sound';

browser.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === OFFSCREEN_DING) playDing();
});
