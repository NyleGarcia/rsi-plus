<script lang="ts">
  /**
   * Rearrangeable widget grid (Svelte take on the "draggable widget grid" pattern): widgets have a size, the grid packs
   * them densely, and in edit mode you drag a widget onto another to take its place (FLIP-animated), cycle its size, or
   * move it with Alt + arrow keys. Columns follow the container width (`minCol` px each, up to `maxColumns`).
   */
  import type { Snippet } from 'svelte';
  import { flip } from 'svelte/animate';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Scaling from '@lucide/svelte/icons/scaling';
  import { cn } from '@/lib/utils';
  import TipButton from './TipButton.svelte';
  import { placeWidgets, SIZES, SIZE_LABELS, type Placement, type WidgetItem, type WidgetSize } from '@/lib/widgets';

  let {
    items = $bindable(),
    editable = false,
    labels = {},
    rowHeight = 210,
    gap = 12,
    minCol = 250,
    maxColumns = 4,
    onchange,
    widget,
  }: {
    items: WidgetItem[];
    editable?: boolean;
    /** Accessible name per widget id. */
    labels?: Record<string, string>;
    /** Minimum row height; a row grows to fit its tallest widget, so nothing scrolls inside a widget. */
    rowHeight?: number;
    gap?: number;
    minCol?: number;
    maxColumns?: number;
    /** After a drop, a size change or a keyboard move. */
    onchange?: (items: WidgetItem[]) => void;
    widget: Snippet<[string, WidgetSize]>;
  } = $props();

  let grid = $state<HTMLDivElement | null>(null);
  let columns = $state(1);
  $effect(() => {
    const el = grid;
    if (!el) return;
    const measure = () => (columns = Math.max(1, Math.min(maxColumns, Math.floor((el.clientWidth + gap) / (minCol + gap)))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const places = $derived(new Map(placeWidgets(items, columns).map((p) => [p.id, p])));
  /** What a widget renders as where it landed (a wide one in a single column is small; gap filling can grow it). */
  const shown = (p: Placement | undefined): WidgetSize => (!p ? 'sm' : p.w >= 2 ? (p.h >= 2 ? 'lg' : 'wide') : p.h >= 2 ? 'tall' : 'sm');

  function move(id: string, to: number) {
    const from = items.findIndex((i) => i.id === id);
    if (from < 0 || to < 0 || to >= items.length || from === to) return false;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    items = next;
    return true;
  }

  // ---- pointer drag: the held widget follows the pointer; hovering another widget's box takes its place ----
  let drag = $state<{ id: string; dx: number; dy: number } | null>(null);
  let grab = { x: 0, y: 0, el: null as HTMLElement | null, pid: 0, moved: false, last: 0 };
  const els: Record<string, HTMLElement> = {};

  function down(e: PointerEvent, id: string) {
    if (!editable || e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, select, textarea, [role=slider]')) return;
    const el = els[id];
    if (!el || !grid) return;
    const g = grid.getBoundingClientRect();
    grab = { x: e.clientX - g.left - el.offsetLeft, y: e.clientY - g.top - el.offsetTop, el, pid: e.pointerId, moved: false, last: 0 };
    el.setPointerCapture(e.pointerId);
    drag = { id, dx: 0, dy: 0 };
    e.preventDefault();
  }
  function moveP(e: PointerEvent) {
    if (!drag || e.pointerId !== grab.pid || !grid || !grab.el) return;
    const g = grid.getBoundingClientRect();
    drag = { id: drag.id, dx: e.clientX - g.left - grab.x - grab.el.offsetLeft, dy: e.clientY - g.top - grab.y - grab.el.offsetTop };
    const now = performance.now();
    if (now - grab.last < 140) return;
    for (const it of items) {
      if (it.id === drag.id) continue;
      const r = els[it.id]?.getBoundingClientRect();
      if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        if (move(drag.id, items.indexOf(it))) ((grab.last = now), (grab.moved = true));
        // Re-anchor at once so the widget stays under the pointer while its slot moves.
        queueMicrotask(() => moveP(e));
        break;
      }
    }
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== grab.pid) return;
    grab.el?.releasePointerCapture(e.pointerId);
    drag = null;
    if (grab.moved) onchange?.(items);
  }

  function key(e: KeyboardEvent, id: string) {
    if (!editable || !e.altKey) return;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    if (move(id, items.findIndex((i) => i.id === id) + d)) {
      onchange?.(items);
      queueMicrotask(() => els[id]?.focus());
    }
  }

  function resize(id: string) {
    items = items.map((i) => (i.id === id ? { ...i, size: SIZES[(SIZES.indexOf(i.size) + 1) % SIZES.length]! } : i));
    onchange?.(items);
  }
</script>

<div
  bind:this={grid}
  role="list"
  class="relative grid w-full"
  style={`gap:${gap}px;grid-template-columns:repeat(${columns},minmax(0,1fr));grid-auto-rows:minmax(${rowHeight}px,auto)`}
>
  {#each items as it (it.id)}
    {@const p = places.get(it.id)}
    {@const held = drag?.id === it.id}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (focusable + Alt+arrow moves only in edit mode) -->
    <div
      bind:this={els[it.id]}
      role="listitem"
      aria-label={labels[it.id] ?? it.id}
      aria-roledescription={editable ? 'movable widget' : undefined}
      tabindex={editable ? 0 : undefined}
      animate:flip={{ duration: held ? 0 : 280 }}
      class={cn(
        'group/widget relative min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring',
        editable && 'cursor-grab touch-none select-none',
        held && 'z-20 cursor-grabbing',
      )}
      style={`grid-column:${(p?.col ?? 0) + 1} / span ${p?.w ?? 1};grid-row:${(p?.row ?? 0) + 1} / span ${p?.h ?? 1};${held ? `transform:translate(${drag!.dx}px,${drag!.dy}px) scale(1.02);` : 'transition:transform .22s cubic-bezier(.2,.8,.2,1);'}`}
      onpointerdown={(e) => down(e, it.id)}
      onpointermove={moveP}
      onpointerup={up}
      onpointercancel={up}
      onkeydown={(e) => key(e, it.id)}
    >
      <div class={cn('h-full transition-shadow duration-200', held && 'shadow-2xl shadow-black/50', editable && 'pointer-events-none [&_button]:pointer-events-auto')}>
        {@render widget(it.id, shown(p))}
      </div>
      {#if editable}
        <div class="ring-primary/50 pointer-events-none absolute inset-0 rounded-xl ring-2 ring-dashed ring-inset"></div>
        <div class="absolute -top-3.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1">
          <TipButton
            variant="outline"
            size="xs"
            class="bg-background/90 text-muted-foreground hover:text-foreground text-[11px] shadow-sm"
            tip="Change size"
            aria-label={`Size: ${SIZE_LABELS[it.size]}. Change size of ${labels[it.id] ?? it.id}`}
            onclick={() => resize(it.id)}
          >
            <Scaling class="size-3.5" />{SIZE_LABELS[it.size]}
          </TipButton>
          <span class="bg-background/90 text-muted-foreground border-border inline-flex size-7 items-center justify-center rounded-md border shadow-sm" aria-hidden="true"><GripVertical class="size-4" /></span>
        </div>
      {/if}
    </div>
  {/each}
</div>
{#if editable}
  <p class="sr-only">Drag a widget onto another to swap places, or focus it and press Alt with the arrow keys.</p>
{/if}
