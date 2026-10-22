<script lang="ts">
  /**
   * "n new ↑" pill (after 21st.dev's New Items Pill) for a page-scrolled feed: shows when items arrived while you
   * were scrolled away from the top; click scrolls back and clears. The page tells it how many items it has.
   */
  import { fly } from 'svelte/transition';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import { Button } from '@/components/ui/button';

  let { count, label = (n: number) => `${n} new ${n === 1 ? 'item' : 'items'}`, threshold = 80, onjump }: { count: number; label?: (n: number) => string; threshold?: number; onjump?: () => void } = $props();
  // svelte-ignore state_referenced_locally
  let prev = $state(count);
  let unread = $state(0);
  $effect(() => {
    const added = count - prev;
    prev = count;
    if (added > 0 && window.scrollY > threshold) unread += added;
  });
  $effect(() => {
    const on = () => {
      if (window.scrollY <= threshold) unread = 0;
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  });
  function jump() {
    unread = 0;
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    onjump?.();
  }
</script>

{#if unread > 0}
  <div class="pointer-events-none sticky top-2 z-20 flex justify-center" transition:fly={{ y: -10, duration: 180 }}>
    <Button variant="outline" size="sm" class="bg-popover pointer-events-auto gap-1 rounded-lg shadow-md" onclick={jump} aria-live="polite"><ArrowUp /> {unread > 99 ? '99+ new' : label(unread)}</Button>
  </div>
{/if}
