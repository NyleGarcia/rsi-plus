<script lang="ts">
  /**
   * A store thumbnail (paint or ship) that opens a large preview on hover: RSI serves every media id in several
   * sizes, so the thumb's URL with `slideshow.jpg` as the file is the big version; when that 404s the thumb itself is shown.
   * A Tooltip, not a HoverCard: the preview is look-only, and bits-ui's HoverCard keeps a document `pointerup` listener
   * that reads its context after the card is torn down (Svelte's `derived_inert` warning on every click).
   */
  import * as Tooltip from '@/components/ui/tooltip';
  import { cn } from '@/lib/utils';

  let {
    src,
    name,
    width = 48,
    height = 27,
    class: className,
  }: {
    src: string | null | undefined;
    /** Caption under the big image (the paint / ship name). */
    name: string;
    width?: number;
    height?: number;
    class?: string;
  } = $props();

  /**
   * The Tooltip mounts on the first hover only: a bits-ui Tooltip per row (state, ids, floating setup) made a
   * 550-row store table take ~1 s to build; a bare <img> costs nothing. The first hover swaps the img for the
   * trigger under the pointer and opens the preview; from then on the Tooltip handles hovers itself.
   */
  let armed = $state(false);
  let open = $state(false);
  const arm = () => {
    if (armed) return;
    armed = true;
    open = true;
  };
  const bigOf = (thumb: string) => thumb.replace(/\/[^/]+\.(jpe?g|png|webp)(\?.*)?$/i, '/slideshow.jpg');
  /** Fall back to the thumb when the store has no slideshow image for this media id. */
  const fallback = (e: Event, thumb: string) => {
    const img = e.currentTarget as HTMLImageElement;
    if (img.src !== thumb) img.src = thumb;
  };
</script>

<!-- One wrapper for both states: the first hover swaps the <img> for the trigger under the pointer, and if the pointer
     leaves before the Tooltip's own listeners are attached nothing would ever close it — the wrapper's leave does. -->
{#if src}
  <span class="inline-flex shrink-0" role="presentation" onpointerleave={() => (open = false)}>
  {#if armed}
    <Tooltip.Root delayDuration={150} bind:open>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <img {...props} class={cn('inline-block shrink-0 cursor-zoom-in rounded-md object-cover align-middle', className)} {src} alt="" {width} {height} loading="lazy" />
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right" align="start" sideOffset={6} class="bg-popover text-popover-foreground grid max-w-[520px] gap-0 border p-1.5 shadow-md" arrowClasses="bg-popover fill-popover">
        <img class="block h-auto w-[508px] max-w-[calc(100vw-32px)] rounded-md" src={bigOf(src)} alt="" onerror={(e) => fallback(e, src!)} />
        <div class="px-1 pt-1.5 pb-0.5 text-xs font-semibold">{name}</div>
      </Tooltip.Content>
    </Tooltip.Root>
  {:else}
    <img class={cn('inline-block shrink-0 cursor-zoom-in rounded-md object-cover align-middle', className)} {src} alt="" {width} {height} loading="lazy" onpointerenter={arm} />
  {/if}
  </span>
{/if}
