<script lang="ts">
  /**
   * KPI tile (shadcn Card): big value, small label, optional delta badge and an optional snippet below (sparkline).
   * Tones: `credit` (gold border), `accent` (blue border); `valueTone` colours the number.
   */
  import type { Snippet } from 'svelte';
  import { cn } from '@/lib/utils';
  import type { Component } from 'svelte';
  import * as Card from '@/components/ui/card';
  import { Badge } from '@/components/ui/badge';
  import HintBadge from './HintBadge.svelte';

  let {
    value,
    label,
    delta = null,
    tone = null,
    valueTone = null,
    icon = null,
    sub = null,
    hint = null,
    size = 'md',
    class: className = '',
    children,
  }: {
    value: string | number;
    label: string;
    /** Small pill under the value: text + direction tone. */
    delta?: { text: string; tone?: 'up' | 'down' | 'warn' | 'neutral' } | null;
    tone?: 'credit' | 'accent' | null;
    valueTone?: 'ok' | 'err' | 'warn' | null;
    /** Lucide icon in the corner (hero tiles). */
    icon?: Component | null;
    /** Second line under the label. */
    sub?: string | null;
    /** Explanation of the number (Tooltip on the label). */
    hint?: string | null;
    size?: 'md' | 'lg';
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<Card.Root
  class={cn(
    'relative gap-0.5 rounded-xl px-3 py-2.5 shadow-none transition-colors hover:border-foreground/15',
    size === 'lg' && 'px-4 py-3',
    tone === 'credit' && 'border-warning/35',
    tone === 'accent' && 'border-primary/35',
    className,
  )}
>
  {#if icon}{@const Icon = icon}<Icon class="text-muted-foreground absolute top-2.5 right-3 size-4" aria-hidden="true" />{/if}
  <strong class={cn('leading-tight font-semibold tabular-nums tracking-tight', size === 'lg' ? 'text-[24px]' : 'text-[19px]', valueTone === 'ok' && 'text-success', valueTone === 'err' && 'text-destructive', valueTone === 'warn' && 'text-warning')}>{value}</strong>
  {#if hint}
    <HintBadge variant="ghost" {hint} class="text-muted-foreground h-auto w-fit border-0 p-0 text-[11.5px] font-normal underline decoration-dotted underline-offset-2">{label}</HintBadge>
  {:else}
    <span class="text-muted-foreground text-[11.5px]">{label}</span>
  {/if}
  {#if sub}<span class="text-muted-foreground text-[11px]">{sub}</span>{/if}
  {#if delta}
    <Badge variant={delta.tone === 'up' ? 'success-soft' : delta.tone === 'down' ? 'destructive' : delta.tone === 'warn' ? 'warning-soft' : 'secondary'} class="mt-0.5 h-5 w-fit px-1.5 text-[11px] font-semibold">{delta.text}</Badge>
  {/if}
  {#if children}<div class="mt-1.5">{@render children()}</div>{/if}
</Card.Root>
