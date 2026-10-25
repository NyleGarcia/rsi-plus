<script lang="ts">
  /**
   * Activity feed grouped by day (after 21st.dev's Timeline): sticky day labels with a rolling count, a connector line
   * that draws down the feed as rows come into view, rows that expand in place, new rows that slide in on top.
   * Arrow keys move between expandable rows, Enter / Space expands.
   */
  import type { Component, Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Dot from '@lucide/svelte/icons/dot';
  import { cn } from '@/lib/utils';
  import { fmtDateTime } from '@/lib/dates';
  import LazyTip from './LazyTip.svelte';

  export interface TimelineEvent {
    id: string;
    /** ms */
    at: number;
    title: string;
    meta?: string;
    /** Opens in a new tab unless it is an in-app `#hash`. */
    href?: string;
    /** Shown in place when the row is expanded. */
    detail?: string;
    icon?: Component;
    tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info';
    /** Dimmed (already seen). */
    muted?: boolean;
    /** Text next to the icon (kind label). */
    kind?: string;
    kindClass?: string;
  }
  let {
    events,
    now = Date.now(),
    label,
    onopen,
    empty,
  }: { events: TimelineEvent[]; now?: number; label: string; onopen?: (e: TimelineEvent) => void; empty?: Snippet } = $props();

  const dayKey = (t: number) => new Date(t).toDateString();
  const groups = $derived.by(() => {
    const today = dayKey(now),
      yesterday = dayKey(now - 864e5);
    const by = new Map<string, TimelineEvent[]>();
    for (const e of [...events].sort((a, b) => b.at - a.at)) by.set(dayKey(e.at), [...(by.get(dayKey(e.at)) ?? []), e]);
    return [...by].map(([day, rows]) => ({ day, rows, label: day === today ? 'Today' : day === yesterday ? 'Yesterday' : new Date(rows[0]!.at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }));
  });
  const when = (t: number) => {
    const m = Math.max(0, Math.floor((now - t) / 60000));
    if (dayKey(t) === dayKey(now) && m < 12 * 60) return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
    return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };
  let expanded = $state<Set<string>>(new Set());
  const toggle = (id: string) => (expanded = new Set(expanded.has(id) ? [...expanded].filter((x) => x !== id) : [...expanded, id]));
  /** Rows seen at mount don't slide in; later ones do. */
  // svelte-ignore state_referenced_locally
  let known = new Set(events.map((e) => e.id));
  const fresh = (id: string) => !known.has(id);
  $effect(() => {
    const ids = events.map((e) => e.id);
    queueMicrotask(() => (known = new Set(ids)));
  });
  /** The connector draws when a row scrolls into view; rows revealed together are a beat apart. */
  let shown = $state<Set<string>>(new Set());
  let list = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!list) return;
    let next = 0;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const id = (en.target as HTMLElement).dataset.row!;
          if (shown.has(id)) continue;
          const nowS = performance.now() / 1000;
          const start = Math.min(Math.max(nowS, next), nowS + 0.45);
          next = start + 0.09;
          (en.target as HTMLElement).style.setProperty('--d', `${Math.max(0, start - nowS)}s`);
          shown = new Set([...shown, id]);
          io.unobserve(en.target);
        }
      },
      { threshold: 0.2 },
    );
    for (const row of list.querySelectorAll<HTMLElement>('[data-row]')) if (!shown.has(row.dataset.row!)) io.observe(row);
    return () => io.disconnect();
  });
  function onKey(e: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...(list?.querySelectorAll<HTMLElement>('[data-trigger]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), items.length - 1)]?.focus();
  }
  const TONE: Record<NonNullable<TimelineEvent['tone']>, string> = { neutral: 'bg-muted text-muted-foreground', success: 'bg-success/15 text-success', danger: 'bg-destructive/15 text-destructive', warning: 'bg-warning/15 text-warning', info: 'bg-primary/15 text-primary' };
  const isHub = (h?: string) => !!h && h.startsWith('#');
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="grid" role="region" aria-label={label} bind:this={list} onkeydown={onKey}>
  {#each groups as g (g.day)}
    <section class="relative" aria-labelledby={`tl-${g.day.replace(/\W/g, '')}`}>
      <h3 id={`tl-${g.day.replace(/\W/g, '')}`} class="bg-background/95 text-muted-foreground sticky top-0 z-10 m-0 flex items-baseline gap-2 py-2 text-[11px] font-semibold tracking-wide uppercase backdrop-blur">
        {g.label}
        <span class="font-normal normal-case tabular-nums">{g.rows.length} {g.rows.length === 1 ? 'update' : 'updates'}</span>
      </h3>
      <ol class="m-0 grid list-none p-0">
        {#each g.rows as e, i (e.id)}
          {@const Icon = e.icon ?? Dot}
          {@const open = expanded.has(e.id)}
          {@const last = i === g.rows.length - 1}
          <li class={cn('relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 pb-1', e.muted && 'opacity-55')} data-row={e.id} transition:slide={{ duration: fresh(e.id) ? 260 : 0 }} style="--d:0s">
            <span class={cn('mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border transition-[transform,opacity] duration-300 motion-reduce:transition-none', TONE[e.tone ?? 'neutral'], shown.has(e.id) ? 'scale-100 opacity-100' : 'scale-50 opacity-0')} style="transition-delay: var(--d)" aria-hidden="true"><Icon class="size-3.5" /></span>
            {#if !last}<span class={cn('bg-border absolute top-9 bottom-0 left-[13.5px] w-px origin-top transition-transform duration-300 motion-reduce:transition-none', shown.has(e.id) ? 'scale-y-100' : 'scale-y-0')} style="transition-delay: calc(var(--d) + 0.1s)" aria-hidden="true"></span>{/if}
            <div class="min-w-0">
              <div class="flex items-start gap-2 py-1.5">
                <div class="grid min-w-0 flex-1 gap-0.5">
                  <span class="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    {#if e.kind}<span class={cn('text-[10.5px] font-semibold tracking-wide uppercase', e.kindClass ?? 'text-muted-foreground')}>{e.kind}</span>{/if}
                    {#if e.href}
                      <a class="text-foreground hover:text-primary min-w-0 font-semibold no-underline" href={e.href} target={isHub(e.href) ? undefined : '_blank'} rel={isHub(e.href) ? undefined : 'noopener'} onclick={() => onopen?.(e)}>{e.title}</a>
                    {:else}
                      <span class="font-semibold">{e.title}</span>
                    {/if}
                  </span>
                  {#if e.meta}<span class="text-muted-foreground text-sm">{e.meta}</span>{/if}
                </div>
                <!-- the row shows "5m" / a time of day: the exact moment is in the tip -->
                <LazyTip tip={fmtDateTime(e.at)} class="shrink-0">
                  {#snippet trigger({ props })}
                    <button type="button" {...props} class="text-muted-foreground shrink-0 cursor-default pt-0.5 text-xs tabular-nums"><time datetime={new Date(e.at).toISOString()}>{when(e.at)}</time></button>
                  {/snippet}
                </LazyTip>
                {#if e.detail}
                  <button type="button" data-trigger class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mr-1 rounded p-1 outline-none focus-visible:ring-2" aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'} onclick={() => toggle(e.id)}>
                    <ChevronDown class={cn('size-4 transition-transform', open && 'rotate-180')} />
                  </button>
                {/if}
              </div>
              {#if open && e.detail}
                <div class="text-muted-foreground pb-2 text-sm whitespace-pre-line" transition:slide={{ duration: 200 }}>{e.detail}</div>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    </section>
  {:else}
    {@render empty?.()}
  {/each}
</div>
