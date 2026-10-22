<script lang="ts">
  /**
   * Loading placeholder that crossfades into the real content with no layout shift (after 21st.dev's Skeleton
   * Swap): the box keeps `reserve` (or `lines × lineHeight`) px until ready; the skeleton only appears after `delay`
   * ms (a fast load never flashes it) and stays at least `minVisible` ms (no blink).
   */
  import type { Snippet } from 'svelte';
  import { Skeleton } from '@/components/ui/skeleton';
  import { cn } from '@/lib/utils';

  let {
    ready,
    lines = 4,
    lineHeight = 24,
    reserve = null,
    delay = 120,
    minVisible = 380,
    label = '',
    class: className = '',
    skeleton,
    children,
  }: {
    ready: boolean;
    lines?: number;
    lineHeight?: number;
    /** Height to hold while loading; defaults to lines × lineHeight. Once ready the box grows with the content. */
    reserve?: number | null;
    delay?: number;
    minVisible?: number;
    label?: string;
    class?: string;
    skeleton?: Snippet;
    children: Snippet;
  } = $props();

  let visible = $state(false);
  let shownAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    clearTimeout(timer);
    if (!ready) {
      if (visible) return;
      timer = setTimeout(() => ((shownAt = performance.now()), (visible = true)), delay);
    } else if (visible) {
      timer = setTimeout(() => (visible = false), Math.max(0, minVisible - (performance.now() - shownAt)));
    }
    return () => clearTimeout(timer);
  });
  const WIDTHS = [100, 93, 97, 88, 95, 91];
  const widthFor = (i: number) => (lines > 1 && i === lines - 1 ? 62 : WIDTHS[(i * 7 + 3) % WIDTHS.length]!);
</script>

<div class={cn('relative grid', className)} style={!ready ? `min-height:${reserve ?? lines * lineHeight}px` : undefined} aria-busy={!ready} aria-label={label || undefined}>
  <div class={cn('col-start-1 row-start-1 min-w-0 origin-top-left transition-[opacity,filter,transform] duration-300 motion-reduce:transition-none', visible && 'pointer-events-none scale-[0.99] opacity-0 blur-[3px]')}>
    {@render children()}
  </div>
  {#if visible}
    <div class="pointer-events-none col-start-1 row-start-1 w-full self-start transition-opacity duration-300" aria-hidden="true">
      {#if skeleton}
        {@render skeleton()}
      {:else}
        {#each Array.from({ length: lines }, (_, i) => i) as i (i)}
          <div class="flex items-center" style={`height:${lineHeight}px`}><Skeleton class="h-2.5 rounded-[5px]" style={`width:${widthFor(i)}%`} /></div>
        {/each}
      {/if}
    </div>
  {/if}
  {#if label}<span role="status" class="sr-only">{ready ? `${label} loaded` : ''}</span>{/if}
</div>
