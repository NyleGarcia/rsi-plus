<script lang="ts">
  /**
   * KPI tile (shadcn Card): big value, small label, optional delta badge and an optional snippet below (sparkline).
   * Tones: `credit` (gold border), `accent` (blue border); `valueTone` colours the number.
   */
  import type { Snippet } from 'svelte';
  import { cn } from '@/lib/utils';
  import * as Card from '@/components/ui/card';
  import { Badge } from '@/components/ui/badge';

  let {
    value,
    label,
    delta = null,
    tone = null,
    valueTone = null,
    class: className = '',
    children,
  }: {
    value: string | number;
    label: string;
    /** Small pill under the value: text + direction tone. */
    delta?: { text: string; tone?: 'up' | 'down' | 'warn' | 'neutral' } | null;
    tone?: 'credit' | 'accent' | null;
    valueTone?: 'ok' | 'err' | 'warn' | null;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<Card.Root
  class={cn(
    'gap-0.5 rounded-xl px-3 py-2.5 shadow-none transition-colors hover:border-white/15',
    tone === 'credit' && 'border-warning/35',
    tone === 'accent' && 'border-primary/35',
    className,
  )}
>
  <strong class={cn('text-[19px] leading-tight font-semibold tabular-nums tracking-tight', valueTone === 'ok' && 'text-success', valueTone === 'err' && 'text-destructive', valueTone === 'warn' && 'text-warning')}>{value}</strong>
  <span class="text-muted-foreground text-[11.5px]">{label}</span>
  {#if delta}
    <Badge
      variant="secondary"
      class={cn(
        'mt-0.5 h-5 w-fit px-1.5 text-[11px] font-semibold',
        delta.tone === 'up' && 'bg-success/15 text-success',
        delta.tone === 'down' && 'bg-destructive/15 text-destructive',
        delta.tone === 'warn' && 'bg-warning/15 text-warning',
      )}>{delta.text}</Badge
    >
  {/if}
  {#if children}<div class="mt-1.5">{@render children()}</div>{/if}
</Card.Root>
