/**
 * StarOrg Tools *Auto-sync* (background): when to send without a click. Kept out of `entrypoints/background.ts` so the
 * rules are testable.
 *
 * - **After a load**: every completed full hangar load announces itself on `hangarLoadItem` (`saveCompleteLoad`);
 *   a new announcement sends the saved hangar. A profile restore rewrites `hangarItem` but never `hangarLoadItem`, so
 *   it is not a load and sends nothing.
 * - **Weekly** (`STARORG_ALARM`): re-reads the hangar from RSI — only when the saved one was read as the handle logged
 *   in now — saves it, and sends only if the row set changed since StarOrg last accepted it (`changeHash`).
 * - The weekly alarm exists only while connected, with Auto-sync on and outside passive mode (`pollAuto` off).
 */
import { whoAmI } from './accounts';
import type { Pledge } from './hangar';
import { getSettings, hangarItem, type Settings } from './settings';
import { currentAuth, sendHangar, type StarOrgSync } from './starorg';
import type { CatalogShip } from './store';

export const STARORG_ALARM = 'rsiplus:starorg';
/** Weekly StarOrg Tools check, in minutes. */
export const STARORG_PERIOD = 7 * 24 * 60;

type Catalog = () => Promise<CatalogShip[]>;
type LoadSignal = { at: number; handle: string | null } | null | undefined;

/** The weekly alarm is wanted only with the integration on, connected, Auto-sync on and not in passive mode. */
export const weeklyWanted = (s: Pick<Settings, 'pollAuto' | 'starorg' | 'starorgAutoSync'>, connected: boolean): boolean => s.starorg && s.pollAuto && s.starorgAutoSync && connected;

/** Add, keep or clear the weekly alarm to match the settings and the connection. */
export async function scheduleStarOrg(): Promise<void> {
  const s = await getSettings();
  if (!weeklyWanted(s, !!(await currentAuth()))) {
    await browser.alarms.clear(STARORG_ALARM);
    return;
  }
  const cur = await browser.alarms.get(STARORG_ALARM);
  if (cur?.periodInMinutes !== STARORG_PERIOD) await browser.alarms.create(STARORG_ALARM, { periodInMinutes: STARORG_PERIOD, delayInMinutes: STARORG_PERIOD });
}

/** A `hangarLoadItem` change is a new completed load (with a known handle), not a repeat or a clear. */
export const isNewLoad = (next: LoadSignal, prev: LoadSignal): boolean => !!next?.handle && next.at !== prev?.at;

/** After a completed load: send when Auto-sync is on (`sendHangar` itself needs a token and a matching handle). */
export async function afterLoad(catalog: Catalog): Promise<StarOrgSync | null> {
  const s = await getSettings();
  if (!s.starorg || !s.starorgAutoSync) return null;
  return sendHangar(catalog);
}

/**
 * Weekly: re-read the hangar (`readHangar`: the full RSI pages, parsed where a DOM exists) and send if it changed.
 * Skips (null) when off, passive, disconnected, or when the saved hangar is not the logged-in handle's — a weekly read
 * never overwrites another login's saved hangar.
 */
export async function weeklySync(catalog: Catalog, readHangar: () => Promise<Pledge[]>): Promise<StarOrgSync | null> {
  const s = await getSettings();
  if (!weeklyWanted(s, !!(await currentAuth()))) return null;
  const saved = await hangarItem.getValue();
  const me = await whoAmI();
  if (!saved?.complete || !me || saved.handle !== me.handle) return null;
  const pledges = await readHangar();
  // The RSI login can change during a multi-page read; pages read as someone else must not be saved as this handle's.
  if ((await whoAmI())?.handle !== me.handle) return null;
  const cur = await hangarItem.getValue();
  // Saved over meanwhile (a load in the hub): keep that one, it is at least as fresh.
  if (cur?.at === saved.at) await hangarItem.setValue({ ...cur, at: Date.now(), pledges, complete: true, handle: me.handle });
  return sendHangar(catalog, { onlyIfChanged: true });
}
