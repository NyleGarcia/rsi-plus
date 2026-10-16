/** Widget grid layout: sizes, saved-layout merging and gap-free placement (used by `WidgetGrid.svelte`). */
/** Column × row span: `sm` 1×1, `wide` 2×1, `tall` 1×2, `lg` 2×2. */
export type WidgetSize = 'sm' | 'wide' | 'tall' | 'lg';
export interface WidgetItem {
  id: string;
  size: WidgetSize;
}
export const SIZES: WidgetSize[] = ['sm', 'wide', 'tall', 'lg'];
const SPANS: Record<WidgetSize, { col: number; row: number }> = { sm: { col: 1, row: 1 }, wide: { col: 2, row: 1 }, tall: { col: 1, row: 2 }, lg: { col: 2, row: 2 } };
export const SIZE_LABELS: Record<WidgetSize, string> = { sm: 'Small', wide: 'Wide', tall: 'Tall', lg: 'Large' };

/** Saved layout merged onto the defaults: unknown ids dropped, new widgets appended with their default size. */
export function mergeLayout(saved: unknown, defaults: WidgetItem[]): WidgetItem[] {
  const known = new Map(defaults.map((d) => [d.id, d]));
  const out: WidgetItem[] = [];
  if (Array.isArray(saved))
    for (const s of saved as Partial<WidgetItem>[])
      if (s && typeof s.id === 'string' && known.has(s.id) && !out.some((o) => o.id === s.id)) out.push({ id: s.id, size: SIZES.includes(s.size as WidgetSize) ? (s.size as WidgetSize) : known.get(s.id)!.size });
  for (const d of defaults) if (!out.some((o) => o.id === d.id)) out.push({ ...d });
  return out;
}

export interface Placement {
  id: string;
  col: number;
  row: number;
  w: number;
  h: number;
}

/**
 * Dense first-fit placement in order, then gap filling: an empty cell widens the widget on its left (or, failing
 * that, the one above grows down) when that widget's whole span is free there — so no holes are left at any width.
 */
export function placeWidgets(items: WidgetItem[], columns: number): Placement[] {
  const cols = Math.max(1, columns);
  const taken: boolean[][] = [];
  const busy = (r: number, c: number) => !!taken[r]?.[c];
  const mark = (p: Placement) => {
    for (let r = p.row; r < p.row + p.h; r++) for (let c = p.col; c < p.col + p.w; c++) (taken[r] ??= [])[c] = true;
  };
  const out: Placement[] = [];
  for (const it of items) {
    const w = Math.min(SPANS[it.size].col, cols);
    const h = SPANS[it.size].row;
    search: for (let r = 0; ; r++)
      for (let c = 0; c + w <= cols; c++) {
        let free = true;
        for (let y = r; y < r + h && free; y++) for (let x = c; x < c + w && free; x++) if (busy(y, x)) free = false;
        if (free) {
          const p = { id: it.id, col: c, row: r, w, h };
          out.push(p);
          mark(p);
          break search;
        }
      }
  }
  const rows = out.reduce((n, p) => Math.max(n, p.row + p.h), 0);
  for (let changed = true; changed; ) {
    changed = false;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (busy(r, c)) continue;
        const left = out.find((p) => p.col + p.w === c && p.row <= r && r < p.row + p.h);
        if (left && Array.from({ length: left.h }, (_, i) => !busy(left.row + i, c)).every(Boolean)) {
          left.w++;
          mark(left);
          changed = true;
          continue;
        }
        const above = out.find((p) => p.row + p.h === r && p.col <= c && c < p.col + p.w);
        if (above && Array.from({ length: above.w }, (_, i) => !busy(r, above.col + i)).every(Boolean)) {
          above.h++;
          mark(above);
          changed = true;
        }
      }
  }
  return out;
}
