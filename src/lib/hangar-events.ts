/** Feed events from a hangar reload / update: pledges that appeared, pledges that left (melted, gifted, upgraded away). */
import type { Pledge } from './hangar';
import type { FeedEvent } from './watch';

const names = (list: Pledge[], max = 4) => {
  const n = list.map((p) => p.name);
  return n.length > max ? `${n.slice(0, max).join(', ')} +${n.length - max} more` : n.join(', ');
};

export function hangarEvents(before: Pledge[], after: Pledge[], now: number): FeedEvent[] {
  if (!before.length) return []; // first load: nothing to compare with
  const was = new Set(before.map((p) => p.id));
  const is = new Set(after.map((p) => p.id));
  const added = after.filter((p) => !was.has(p.id));
  const gone = before.filter((p) => !is.has(p.id));
  const out: FeedEvent[] = [];
  if (added.length)
    out.push({ key: `hangar-added:${added.map((p) => p.id).join(',')}`, kind: 'hangar', title: `${added.length} new pledge${added.length === 1 ? '' : 's'} in your hangar`, body: names(added), url: 'hub.html#hangar', at: now, seen: false });
  if (gone.length)
    out.push({ key: `hangar-gone:${gone.map((p) => p.id).join(',')}`, kind: 'hangar', title: `${gone.length} pledge${gone.length === 1 ? '' : 's'} left your hangar`, body: `${names(gone)} — melted, gifted or upgraded`, url: 'hub.html#buyback', at: now, seen: false });
  return out;
}
