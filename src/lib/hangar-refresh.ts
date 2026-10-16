import { loadHangar, type Progress } from './account';
import type { Pledge } from './hangar';
import { hangarItem } from './settings';

export type HangarProgress = { page: number; pages?: number; count: number };

/**
 * Reload the whole hangar into `hangarItem` from any panel (Paint rebuy, CCU planner) — same pages, same storage as
 * the Hangar tab, so every panel watching the item updates in place. Each page is saved as it comes (a stopped load is
 * resumable from the Hangar tab); the saved credits ride along.
 */
export async function refreshHangar(onProgress?: (p: HangarProgress) => void, signal?: AbortSignal): Promise<Pledge[]> {
  const prev = await hangarItem.getValue();
  const credits = { credits: prev?.credits ?? null, creditsAt: prev?.creditsAt };
  const pledges = await loadHangar(
    async ({ page, pages, items }: Progress<Pledge>) => {
      onProgress?.({ page, pages, count: items.length });
      await hangarItem.setValue({ ...credits, at: Date.now(), pledges: items, complete: false, page });
    },
    signal,
  );
  await hangarItem.setValue({ ...credits, at: Date.now(), pledges, complete: true });
  return pledges;
}
