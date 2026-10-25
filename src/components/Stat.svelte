<script lang="ts">
  /**
   * KPI tile (after 21st.dev's Stats Band, on a shadcn Card): the number counts up the first time it is in view and
   * rolls to new values; `label` under it, `sub` beneath, `context` swaps in for `sub` on hover / focus; optional
   * `trend` draws a tiny area chart; `delta` pill; a snippet below for anything else. Tones: `credit` (gold border),
   * `accent` (blue border); `valueTone` colours the number.
   */
  import type { Snippet, Component } from 'svelte';
  import { cn } from '@/lib/utils';
  import * as Card from '@/components/ui/card';
  import { Badge } from '@/components/ui/badge';
  import HintBadge from './HintBadge.svelte';
  import { countUp } from '@/lib/countup.svelte';

  let {
    value,
    label,
    delta = null,
    tone = null,
    valueTone = null,
    icon = null,
    sub = null,
    context = null,
    hint = null,
    trend = null,
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
    /** Replaces `sub` while the tile is hovered or focused — one line of context. */
    context?: string | null;
    /** Explanation of the number (Tooltip on the label). */
    hint?: string | null;
    /** Tiny trend chart under the label (oldest first). */
    trend?: number[] | null;
    size?: 'md' | 'lg';
    class?: string;
    children?: Snippet;
  } = $props();

  const text = $derived(String(value));
  // svelte-ignore state_referenced_locally
  const num = countUp(text);
  let el = $state<HTMLElement | null>(null);
  let seen = $state(false);
  $effect(() => {
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          num.arm(text);
          seen = true;
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  });
  $effect(() => {
    num.set(text);
  });
  let hover = $state(false);
  const line = $derived.by(() => {
    if (!trend || trend.length < 2) return null;
    const lo = Math.min(...trend),
      hi = Math.max(...trend),
      span = hi - lo || 1;
    const pts = trend.map((v, i) => [(i / (trend.length - 1)) * 100, 36 - ((v - lo) / span) * 32] as const);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    const [ex, ey] = pts[pts.length - 1]!;
    return { d, area: `${d} L100 40 L0 40 Z`, ex, ey };
  });
</script>

<Card.Root
  bind:ref={el}
  class={cn(
    'group/stat relative gap-0.5 rounded-xl px-3 py-2.5 shadow-none transition-colors hover:border-foreground/15 focus-within:border-foreground/15',
    size === 'lg' && 'px-4 py-3',
    tone === 'credit' && 'border-warning/35',
    tone === 'accent' && 'border-primary/35',
    className,
  )}
  tabindex={context ? 0 : undefined}
  onpointerenter={() => (hover = true)}
  onpointerleave={() => (hover = false)}
  onfocusin={() => (hover = true)}
  onfocusout={() => (hover = false)}
>
  {#if icon}{@const Icon = icon}<Icon class="text-muted-foreground absolute top-2.5 right-3 size-4" aria-hidden="true" />{/if}
  <strong class={cn('grid leading-tight font-semibold tabular-nums tracking-tight', size === 'lg' ? 'text-[24px]' : 'text-[19px]', valueTone === 'ok' && 'text-success', valueTone === 'err' && 'text-destructive', valueTone === 'warn' && 'text-warning')}>
    <!-- The final text reserves the width; the counting copy sits on top so nothing beside it moves. -->
    <span class="invisible col-start-1 row-start-1" aria-hidden="true">{text}</span>
    <span class="col-start-1 row-start-1" aria-hidden="true">{num.text}</span>
    <span class="sr-only">{text}</span>
  </strong>
  {#if hint}
    <HintBadge variant="ghost" {hint} class="text-muted-foreground h-auto w-fit border-0 p-0 text-[11.5px] font-normal underline decoration-dotted underline-offset-2">{label}</HintBadge>
  {:else}
    <span class="text-muted-foreground text-[11.5px]">{label}</span>
  {/if}
  {#if sub || context}
    <span class="text-muted-foreground min-h-[14px] text-[11px] transition-opacity">{hover && context ? context : (sub ?? '')}</span>
  {/if}
  {#if line}
    <svg class={cn('mt-1 h-7 w-full text-primary transition-[clip-path] duration-700 ease-out motion-reduce:transition-none', seen ? '[clip-path:inset(0_0_0_0)]' : '[clip-path:inset(0_100%_0_0)]')} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={line.area} fill="currentColor" opacity="0.12" />
      <path d={line.d} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      <circle cx={line.ex} cy={line.ey} r="2" fill="currentColor" vector-effect="non-scaling-stroke" />
    </svg>
  {/if}
  {#if delta}
    <Badge variant={delta.tone === 'up' ? 'success-soft' : delta.tone === 'down' ? 'destructive' : delta.tone === 'warn' ? 'warning-soft' : 'secondary'} class="mt-0.5 h-5 w-fit px-1.5 text-[11px] font-semibold">{delta.text}</Badge>
  {/if}
  {#if children}<div class="mt-1.5">{@render children()}</div>{/if}
</Card.Root>
