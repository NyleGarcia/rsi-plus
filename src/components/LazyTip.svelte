<script lang="ts">
  /**
   * Tooltip around any trigger (a Checkbox, a link, a span) that mounts bits-ui only on the first hover / focus:
   * a Tooltip per row made a 500-row table take a second to build, the bare trigger costs nothing. The `trigger`
   * snippet gets the props to spread on the element (the arming handlers before, the Tooltip's after).
   */
  import type { Snippet } from 'svelte';
  import * as Tooltip from '@/components/ui/tooltip';
  import { cn } from '@/lib/utils';

  let {
    tip,
    side = 'top',
    class: className,
    trigger,
  }: {
    tip?: string | Snippet | null;
    side?: 'top' | 'bottom' | 'left' | 'right';
    /** Class for the wrapper span once the Tooltip is mounted (the trigger itself is unwrapped before). */
    class?: string;
    trigger: Snippet<[{ props: Record<string, unknown> }]>;
  } = $props();
  let armed = $state(false);
  let open = $state(false);
  const arm = () => {
    if (armed) return;
    armed = true;
    open = true;
  };
</script>

{#if !tip}
  {@render trigger({ props: {} })}
{:else if !armed}
  {@render trigger({ props: { onpointerenter: arm, onfocus: arm } })}
{:else}
  <span class={cn('inline-flex', className)} role="presentation" onpointerleave={() => (open = false)}>
    <Tooltip.Root bind:open>
      <Tooltip.Trigger>
        {#snippet child({ props })}{@render trigger({ props })}{/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content {side} class="max-w-80 whitespace-pre-line">
        {#if typeof tip === 'string'}{tip}{:else}{@render tip()}{/if}
      </Tooltip.Content>
    </Tooltip.Root>
  </span>
{/if}
