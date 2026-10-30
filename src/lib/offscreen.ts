/**
 * The Chromium offscreen document (`entrypoints/offscreen`): what an MV3 service worker can't do itself — play audio
 * (party-mode ding, `lib/sound.ts`) and parse HTML (the weekly StarOrg Tools hangar re-read, `lib/starorg-auto.ts`).
 * One document per profile; created on first use and kept. Firefox (MV2) has no offscreen API: its background is a
 * page with WebAudio and DOMParser and does both itself.
 */
import type { Pledge } from './hangar';

export const OFFSCREEN_DING = 'offscreen:ding';
/** Background → offscreen: read every hangar page; answers `{ pledges }` or `{ error }`. */
export const OFFSCREEN_HANGAR = 'offscreen:hangar';
/** Offscreen → background after each page: keeps the service worker awake during a long read. */
export const OFFSCREEN_PROGRESS = 'offscreen:progress';
const PAGE = '/offscreen.html';

/**
 * Make sure the offscreen document exists. An existing one is reused for a ding whatever it was created for (same page,
 * same listeners). A DOM_PARSER caller replaces a document that may have been created for AUDIO_PLAYBACK only: Chrome
 * closes such a document after ~30 s without sound, which would cut a long hangar read short.
 */
export async function ensureOffscreen(reason: 'AUDIO_PLAYBACK' | 'DOM_PARSER', justification: string): Promise<void> {
  const off = browser.offscreen;
  const url = browser.runtime.getURL(PAGE as '/offscreen.html');
  const has =
    typeof off.hasDocument === 'function'
      ? await off.hasDocument()
      : (await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as never], documentUrls: [url] })).length > 0;
  if (has) {
    if (reason !== 'DOM_PARSER') return;
    await off.closeDocument().catch(() => {}); // already gone: fine
  }
  await off.createDocument({ url: PAGE, reasons: [reason as never], justification }).catch((e: Error) => {
    if (!/single offscreen|already exists/i.test(e.message)) throw e; // raced with another create: fine
  });
}

/** Read the whole hangar in the offscreen document (Chromium service worker: no DOMParser here). */
export async function readHangarOffscreen(): Promise<Pledge[]> {
  await ensureOffscreen('DOM_PARSER', 'Read the RSI hangar pages for the weekly StarOrg Tools sync');
  const r = (await browser.runtime.sendMessage({ type: OFFSCREEN_HANGAR })) as { pledges?: Pledge[]; error?: string } | undefined;
  if (!Array.isArray(r?.pledges)) throw new Error(r?.error ?? 'the offscreen hangar read returned nothing');
  return r.pledges;
}
