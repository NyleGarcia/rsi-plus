/**
 * Sounds from the background. A service worker can't play audio, so an offscreen document
 * (`entrypoints/offscreen`) does; it's created on first use and kept (cheap, closes with the browser).
 */
export const OFFSCREEN_DING = 'offscreen:ding';
const PAGE = '/offscreen.html';

async function ensureOffscreen() {
  const off = browser.offscreen;
  if (!off) throw new Error('offscreen API unavailable');
  const url = browser.runtime.getURL(PAGE as '/offscreen.html');
  const has =
    typeof off.hasDocument === 'function'
      ? await off.hasDocument()
      : (await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as never], documentUrls: [url] })).length > 0;
  if (has) return;
  await off.createDocument({ url: PAGE, reasons: ['AUDIO_PLAYBACK' as never], justification: 'Play a short ding when party mode accepts a friend request' }).catch((e: Error) => {
    if (!/single offscreen|already exists/i.test(e.message)) throw e; // raced with another create: fine
  });
}

/** Play the party ding; throws when offscreen documents are unsupported (caller logs and moves on). */
export async function ding() {
  await ensureOffscreen();
  await browser.runtime.sendMessage({ type: OFFSCREEN_DING });
}
