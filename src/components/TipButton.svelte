<script lang="ts">
  /**
   * A Button with a Tooltip (replaces `title=`: keyboard-reachable, themed, newlines honoured via `whitespace-pre-line`).
   * The Tooltip mounts on the first hover / focus only — one per row in a long table is otherwise seconds of setup.
   */
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
  let armed = $state(false);
  let open = $state(false);
  const arm = () => {
    if (armed) return;
    armed = true;
    open = true;
  };
</script>

{#if !tip}
  <Button {...rest}>{@render children?.()}</Button>
{:else if !armed}
  <Button {...rest} onpointerenter={arm} onfocus={arm}>{@render children?.()}</Button>
{:else}
  <span class="inline-flex" role="presentation" onpointerleave={() => (open = false)}>
    <Tooltip.Root bind:open>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button {...props} {...rest}>{@render children?.()}</Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content {side} {align} class={`max-w-80 whitespace-pre-line ${tipClass}`}>
        {#if typeof tip === 'string'}{tip}{:else}{@render tip()}{/if}
      </Tooltip.Content>
    </Tooltip.Root>
  </span>
{/if}
