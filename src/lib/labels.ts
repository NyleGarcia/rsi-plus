/**
 * Your own labels on pledges ("LTI token", "Keep", …), stored per account in `local:pledgeLabels`
 * (pledge id → labels). A few preset labels drive the planners:
 * - `Keep`: never picked by the melt planners (dedupe / target) and its hull copy is never auto-upgraded by a fleet plan;
 * - `LTI token`, `CCU fodder`: a fleet plan's Auto upgrades these hulls first (like *Prefer to upgrade*);
 * - `Melt`: one click picks them in the melt calculator.
 * Any other text is a plain label for filtering. Comparison is case-insensitive; the first spelling used is kept.
 */
export type Labels = Record<string, string[]>;

export const PRESET_LABELS: { name: string; hint: string }[] = [
  { name: 'LTI token', hint: 'Cheap LTI hull to CCU up — fleet plans upgrade it first' },
  { name: 'CCU fodder', hint: 'A hull you don\'t mind upgrading — fleet plans upgrade it first' },
  { name: 'Keep', hint: 'Never melted by the planners, never auto-upgraded by a fleet plan' },
  { name: 'Melt', hint: 'Meant to be melted — one click picks them in the melt calculator' },
  { name: 'Gift', hint: 'Meant for someone else' },
];
export const KEEP = 'keep';
export const PREFER = ['lti token', 'ccu fodder'];
export const MELT = 'melt';

const norm = (l: string) => l.trim().replace(/\s+/g, ' ').toLowerCase();

/** One pledge's labels as a string array, whatever was stored (a reactive proxy once saved as `{"0": "Keep"}`). */
const list = (v: unknown): string[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []).filter((x): x is string => typeof x === 'string');
/** A plain, well-formed copy of stored labels — arrays only, empty lists dropped. Safe to put in storage. */
export function cleanLabels(labels: unknown): Labels {
  const out: Labels = {};
  if (labels && typeof labels === 'object') for (const [id, v] of Object.entries(labels)) {
    const ls = list(v);
    if (ls.length) out[id] = [...ls];
  }
  return out;
}

export const labelsOf = (labels: Labels, id: number): string[] => list(labels[id]);
export const hasLabel = (labels: Labels, id: number, name: string) => labelsOf(labels, id).some((l) => norm(l) === norm(name));
/** Pledge ids carrying any of `names`. */
export function idsWith(labels: Labels, names: string | string[]): Set<number> {
  const want = new Set((Array.isArray(names) ? names : [names]).map(norm));
  return new Set(Object.entries(labels).filter(([, ls]) => list(ls).some((l) => want.has(norm(l)))).map(([id]) => Number(id)));
}
/** Every label in use (first spelling), presets first, then A→Z, with how many pledges carry it. */
export function allLabels(labels: Labels): { name: string; count: number }[] {
  const m = new Map<string, { name: string; count: number }>();
  for (const ls of Object.values(labels)) for (const l of list(ls)) {
    const k = norm(l);
    const e = m.get(k) ?? { name: l, count: 0 };
    e.count++;
    m.set(k, e);
  }
  const preset = (n: string) => PRESET_LABELS.findIndex((p) => norm(p.name) === norm(n));
  return [...m.values()].sort((a, b) => (preset(a.name) + 1 || 99) - (preset(b.name) + 1 || 99) || a.name.localeCompare(b.name));
}
/** Add (`on`) or remove a label on several pledges; empty lists are dropped. Returns a new map. */
export function setLabel(labels: Labels, ids: number[], name: string, on: boolean): Labels {
  const l = name.trim().replace(/\s+/g, ' ');
  if (!l) return labels;
  const known = allLabels(labels).find((x) => norm(x.name) === norm(l))?.name ?? PRESET_LABELS.find((p) => norm(p.name) === norm(l))?.name ?? l;
  const out = cleanLabels(labels);
  for (const id of ids) {
    const cur = list(out[id]).filter((x) => norm(x) !== norm(l));
    const next = on ? [...cur, known] : cur;
    if (next.length) out[id] = next;
    else delete out[id];
  }
  return out;
}
