/**
 * Sounds from the background. A Chromium service worker can't play audio, so the offscreen document
 * (`entrypoints/offscreen`, `lib/offscreen.ts`) does; it's created on first use and kept (cheap, closes with the browser).
 * Firefox (MV2) has no offscreen API but its background is a page with WebAudio, so it plays the ding directly.
 */
import { playDing } from './ding-synth';
import { ensureOffscreen, OFFSCREEN_DING } from './offscreen';

export { OFFSCREEN_DING };

/** Play the party ding; throws when neither offscreen documents nor WebAudio exist (caller logs and moves on). */
export async function ding() {
  if (!browser.offscreen) {
    if (typeof AudioContext === 'undefined') throw new Error('no offscreen API and no WebAudio in this background');
    playDing(); // Firefox: background page
    return;
  }
  await ensureOffscreen('AUDIO_PLAYBACK', 'Play a short ding when party mode accepts a friend request');
  await browser.runtime.sendMessage({ type: OFFSCREEN_DING });
}
