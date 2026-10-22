<script lang="ts">
  /**
   * A Badge whose explanation is a Tooltip and reachable by keyboard (a Badge is a span: `title` would be mouse-only).
   * The Tooltip mounts on the first hover / focus only: a bits-ui Tooltip per badge made a 500-row table take seconds
   * to build; a bare Badge costs nothing.
   */
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Badge, type BadgeVariant } from '@/components/ui/badge';
  import { cn } from '@/lib/utils';

  let {
    hint,
    variant = 'outline',
    side = 'top',
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLSpanElement> & {
    hint?: string | Snippet | null;
    variant?: BadgeVariant;
    side?: 'top' | 'bottom' | 'left' | 'right';
    class?: string;
    children: Snippet;
  } = $props();
  let armed = $state(false);
  let open = $state(false);
  const arm = () => {
    if (armed) return;
    armed = true;
    open = true;
  };
</script>

{#if !hint}
  <Badge {...rest} {variant} class={className}>{@render children()}</Badge>
{:else if !armed}
  <Badge {...rest} {variant} tabindex={0} class={cn('cursor-default', className)} onpointerenter={arm} onfocus={arm}>{@render children()}</Badge>
{:else}
  <span class="inline-flex" role="presentation" onpointerleave={() => (open = false)}>
    <Tooltip.Root bind:open>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Badge {...props} {...rest} {variant} tabindex={0} class={cn('cursor-default', className)}>{@render children()}</Badge>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content {side} class="max-w-80 whitespace-pre-line">
        {#if typeof hint === 'string'}{hint}{:else}{@render hint()}{/if}
      </Tooltip.Content>
    </Tooltip.Root>
  </span>
{/if}
