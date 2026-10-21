import { storeLogItem, storeSnapshotItem } from './settings';
import { recordStore, type StoreChange, type StoreEntry, type StoreSnapshot } from './storelog';

let queue: Promise<unknown> = Promise.resolve();
/** Fold a fresh copy of one store source into the saved snapshot + log (one at a time, so two copies never race). */
export function saveStoreCopy(source: keyof StoreSnapshot, entries: StoreEntry[], now = Date.now()): Promise<StoreChange[]> {
  const run = queue.then(async () => {
    const r = recordStore(await storeSnapshotItem.getValue(), await storeLogItem.getValue(), source, entries, now);
    await storeSnapshotItem.setValue(r.snap);
    if (r.logged.length) await storeLogItem.setValue(r.log);
    return r.logged;
  });
  queue = run.catch(() => {});
  return run;
}
