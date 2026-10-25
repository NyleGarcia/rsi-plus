<script lang="ts">
  /**
   * First-run tour (after 21st.dev's Product Tour Popover): a popover on the header's sparkle button that walks
   * through the hub in a few icon-led steps with progress dots, Skip and Next. Opens itself once (`localStorage`
   * `rsiplus:tour`), then lives behind the button.
   */
  import type { Component } from 'svelte';
  import { fly } from 'svelte/transition';
  import * as Popover from '@/components/ui/popover';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Button } from '@/components/ui/button';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { cn } from '@/lib/utils';

  export interface TourStep {
    icon: Component;
    title: string;
    description: string;
    /** Hub hash to open with the step's link. */
    href?: string;
    linkLabel?: string;
  }
  let { steps, storageKey = 'rsiplus:tour' }: { steps: TourStep[]; storageKey?: string } = $props();
  let open = $state(false);
  let step = $state(0);
  let dir = $state(1);
  const seen = () => {
    try {
      return localStorage.getItem(storageKey) === 'done';
    } catch {
      return true;
    }
  };
  $effect(() => {
    if (!seen()) {
      const t = setTimeout(() => (open = true), 900);
      return () => clearTimeout(t);
    }
  });
  function finish() {
    open = false;
    try {
      localStorage.setItem(storageKey, 'done');
    } catch {
      /* private mode */
    }
  }
  const last = $derived(step === steps.length - 1);
  const go = (n: number) => ((dir = n > step ? 1 : -1), (step = n));
</script>

<Popover.Root
  bind:open
  onOpenChange={(o) => {
    if (o) step = 0;
    else finish();
  }}
>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props: tp })}
        <Popover.Trigger {...tp}>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label="Tour of RSI+"><Sparkles aria-hidden="true" /></Button>
          {/snippet}
        </Popover.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>Tour of RSI+</Tooltip.Content>
  </Tooltip.Root>
  <Popover.Content side="bottom" align="end" class="w-80 gap-4 overflow-hidden p-4">
    {#key step}
      {@const s = steps[step]!}
      {@const Icon = s.icon}
      <div class="flex items-start gap-3" in:fly={{ x: 16 * dir, duration: 200 }}>
        <span class="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg"><Icon class="size-4" /></span>
        <div class="grid min-w-0 gap-1 pt-0.5">
          <p class="m-0 text-sm font-medium">{s.title}</p>
          <p class="text-muted-foreground m-0 text-xs leading-relaxed">{s.description}</p>
          {#if s.href}<a class="text-primary text-xs" href={s.href} onclick={finish}>{s.linkLabel ?? 'Open'} →</a>{/if}
        </div>
      </div>
    {/key}
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {#each steps as st, i (st.title)}
          <button type="button" class={cn('h-1.5 rounded-full transition-all duration-300', i === step ? 'bg-primary w-4' : 'bg-muted hover:bg-muted-foreground/40 w-1.5')} aria-label={`Step ${i + 1}: ${st.title}`} onclick={() => go(i)}></button>
        {/each}
      </div>
      <div class="flex items-center gap-2">
        {#if !last}<Button variant="ghost" size="xs" class="text-muted-foreground" onclick={finish}>Skip</Button>{/if}
        <Button size="xs" onclick={() => (last ? finish() : go(step + 1))}>{last ? 'Got it' : 'Next'}</Button>
      </div>
    </div>
  </Popover.Content>
</Popover.Root>
