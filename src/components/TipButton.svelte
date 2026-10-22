<script lang="ts">
  /** A Button with a Tooltip (replaces `title=`: keyboard-reachable, themed, newlines honoured via `whitespace-pre-line`). */
  import type { Snippet } from 'svelte';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Button, type ButtonProps } from '@/components/ui/button';

  let {
    tip,
    side = 'top',
    align = 'center',
    tipClass = '',
    children,
    ...rest
  }: ButtonProps & {
    tip: string | Snippet;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    tipClass?: string;
    children?: Snippet;
  } = $props();
</script>

{#if tip}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button {...props} {...rest}>{@render children?.()}</Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content {side} {align} class={`max-w-80 whitespace-pre-line ${tipClass}`}>
      {#if typeof tip === 'string'}{tip}{:else}{@render tip()}{/if}
    </Tooltip.Content>
  </Tooltip.Root>
{:else}
  <Button {...rest}>{@render children?.()}</Button>
{/if}
