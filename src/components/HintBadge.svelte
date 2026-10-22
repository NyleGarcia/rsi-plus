<script lang="ts">
  /** A Badge whose explanation is a Tooltip and reachable by keyboard (a Badge is a span: `title` would be mouse-only). */
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
</script>

{#if hint}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Badge {...props} {...rest} {variant} tabindex={0} class={cn('cursor-default', className)}>{@render children()}</Badge>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content {side} class="max-w-80 whitespace-pre-line">
      {#if typeof hint === 'string'}{hint}{:else}{@render hint()}{/if}
    </Tooltip.Content>
  </Tooltip.Root>
{:else}
  <Badge {...rest} {variant} class={className}>{@render children()}</Badge>
{/if}
