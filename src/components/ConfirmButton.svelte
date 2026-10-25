<script lang="ts">
  /** Destructive action in two clicks: the first turns the button into "Sure?" for a few seconds, the second fires. */
  import type { Snippet } from 'svelte';
  import { Button, type ButtonProps } from '@/components/ui/button';

  let {
    onconfirm,
    confirmLabel = 'Sure?',
    ms = 3000,
    variant = 'destructive',
    size = 'xs',
    children,
    ...rest
  }: ButtonProps & { onconfirm: () => void; confirmLabel?: string; ms?: number; children: Snippet } = $props();
  let armed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function click() {
    if (armed) {
      armed = false;
      clearTimeout(timer);
      onconfirm();
      return;
    }
    armed = true;
    clearTimeout(timer);
    timer = setTimeout(() => (armed = false), ms);
  }
</script>

<Button {...rest} {variant} {size} onclick={click} aria-live="polite">{#if armed}{confirmLabel}{:else}{@render children()}{/if}</Button>
