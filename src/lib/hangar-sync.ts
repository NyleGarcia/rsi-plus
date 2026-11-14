/**
 * Bring the saved hangar up to date after upgrades were applied, without reading it all again. RSI's hangar log names
 * the upgrade that was used up and the pledge it went onto (`lib/hangar-log.ts`); the upgrade leaves the saved hangar
 * and only that pledge is read again (`patchHangar`). Runs in a page with a DOM and RSI's session: the RSI content
 * script (right after an apply) or the hub (*Check with RSI* found the CCU gone).
 */
import { HANGAR_PAGE, parseHangarPage, patchHangar, type Pledge } from './hangar';
import { fetchHangarLogPage, findInHangarLog, type LogEntry } from './hangar-log';
import { refreshHangar } from './hangar-refresh';
import { hangarItem } from './settings';
import { SPECTRUM_ORIGIN } from './types';

export interface AppliedSync {
  /** Upgrades found used up, and where each went. */
  used: { id: number; pledgeId: number }[];
  /** Upgrades asked about (`ids`) that are gone without having been applied: melted or gifted. */
  lost: number[];
  /** The whole hangar had to be read after all (the log had nothing yet, or a pledge was not where it was). */
  full: boolean;
}

/**
 * `since`: upgrades used up since then (ms; the log prints minutes, so two minutes of slack). `ids`: these upgrades,
 * whenever they were applied — one not found applied is reported as `lost` and taken out of the saved hangar too
 * (RSI no longer has it). `here`: a hangar page already on screen, read for free. Returns null when there is no
 * complete saved hangar to update.
 */
export async function syncApplied(opts: { since?: number; ids?: number[]; here?: { root: ParentNode; page: number }; onStep?: (text: string) => void; fullWhenUnknown?: boolean }): Promise<AppliedSync | null> {
  const say = opts.onStep ?? (() => undefined);
  const cur = await hangarItem.getValue();
  if (!cur?.pledges.length || cur.complete === false) return null;
  const has = (id: number) => cur.pledges.some((p) => p.id === id);
  let log: LogEntry[];
  if (opts.ids?.length) log = await findInHangarLog(opts.ids, 4);
  else log = (await fetchHangarLogPage(1)).entries;
  const consumed = log.filter((e) => e.kind === 'consumed' && e.pledgeId != null && has(e.id));
  const used = consumed.filter((e) => (opts.ids?.length ? opts.ids.includes(e.id) : !(e.at < (opts.since ?? 0) - 120_000)));
  const lost = (opts.ids ?? []).filter((id) => has(id) && !used.some((e) => e.id === id));
  const full = async (why: string): Promise<AppliedSync> => {
    say(`${why} Reading your hangar again…`);
    await refreshHangar((p) => say(`Reading your hangar again… page ${p.page}${p.pages ? ` / ${p.pages}` : ''}`));
    return { used: used.map((e) => ({ id: e.id, pledgeId: e.pledgeId! })), lost, full: true };
  };
  if (!used.length && !lost.length) return opts.fullWhenUnknown ? full("RSI's hangar log does not show the upgrade yet.") : { used: [], lost: [], full: false };

  // the pledges the upgrades went onto, as they read now
  const targets = [...new Set(used.map((e) => e.pledgeId!))].filter(has);
  const fresh = new Map<number, Pledge>();
  const take = (root: ParentNode, page: number) => {
    for (const p of parseHangarPage(root)) if (targets.includes(p.id) && !fresh.has(p.id)) fresh.set(p.id, { ...p, page });
  };
  const tried = new Set<number>();
  if (opts.here) take(opts.here.root, opts.here.page), tried.add(opts.here.page);
  for (const id of targets) {
    const saved = cur.pledges.find((p) => p.id === id)?.page ?? 1;
    for (const page of [saved, saved - 1, saved + 1]) {
      if (fresh.has(id)) break;
      if (page < 1 || tried.has(page)) continue;
      tried.add(page);
      say(`Reading pledge #${id} again (hangar page ${page})…`);
      const res = await fetch(`${SPECTRUM_ORIGIN}/account/pledges?page=${page}&pagesize=${HANGAR_PAGE}`, { credentials: 'include' });
      if (res.ok) take(new DOMParser().parseFromString(await res.text(), 'text/html'), page);
    }
  }
  if (targets.some((id) => !fresh.has(id))) return full('A pledge is not where it was.');
  const latest = (await hangarItem.getValue()) ?? cur;
  const pledges = patchHangar(latest.pledges, [...used.map((e) => e.id), ...lost], [...fresh.values()]);
  if (pledges !== latest.pledges) await hangarItem.setValue({ ...latest, pledges, at: Date.now() });
  return { used: used.map((e) => ({ id: e.id, pledgeId: e.pledgeId! })), lost, full: false };
}
