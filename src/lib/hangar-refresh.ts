import { loadHangar, type Progress } from './account';
import { whoAmI } from './accounts';
import type { Pledge } from './hangar';
import { hangarItem, hangarLoadItem } from './settings';

export type HangarProgress = { page: number; pages?: number; count: number };
type Saved = NonNullable<Awaited<ReturnType<typeof hangarItem.getValue>>>;

/** The RSI handle a load is reading as (lowercase), or null when RSI doesn't say. Read at load start. */
export async function loadHandle(): Promise<string | null> {
  return (await whoAmI())?.handle ?? null;
}

/**
 * Save a completed full load and announce it on `hangarLoadItem` — the StarOrg auto-sync trigger. Every full-load
 * writer goes through here; partial pages, credits updates and profile restores write `hangarItem` only.
 */
export async function saveCompleteLoad(v: Saved & { complete: true }): Promise<void> {
  await hangarItem.setValue(v);
  await hangarLoadItem.setValue({ at: v.at, handle: v.handle ?? null });
}

/**
 * Reload the whole hangar into `hangarItem` from any panel (Paint rebuy, CCU planner) — same pages, same storage as
 * the Hangar tab, so every panel watching the item updates in place. Each page is saved as it comes (a stopped load is
 * resumable from the Hangar tab); the saved credits ride along. `handle` records whose hangar this is.
 */
export async function refreshHangar(onProgress?: (p: HangarProgress) => void, signal?: AbortSignal): Promise<Pledge[]> {
  const handle = await loadHandle();
  const prev = await hangarItem.getValue();
  const credits = { credits: prev?.credits ?? null, creditsAt: prev?.creditsAt };
  const pledges = await loadHangar(
    async ({ page, pages, items }: Progress<Pledge>) => {
      onProgress?.({ page, pages, count: items.length });
      await hangarItem.setValue({ ...credits, at: Date.now(), pledges: items, complete: false, page, handle });
    },
    signal,
  );
  await saveCompleteLoad({ ...credits, at: Date.now(), pledges, complete: true, handle });
  return pledges;
}
