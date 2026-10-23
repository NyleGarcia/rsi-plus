<script lang="ts" generics="V extends string | number">
  /**
   * Segmented control on shadcn ToggleGroup (type="single"): a radio group of a few options with a pill that slides to
   * the selection (progressive — `data-state=on` styles the item without it). bits-ui handles the roving focus and
   * arrow keys; clicking the active option keeps it (no empty state). `hint` is a Tooltip (mounted on first hover). Ids may be numbers — the
   * ToggleGroup works on their string form.
   */
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import LazyTip from './LazyTip.svelte';
  import { cn } from '@/lib/utils';

  let {
    options,
    value = $bindable(),
    ariaLabel,
    size = 'md',
    disabled = false,
    class: className = '',
    onchange,
  }: {
    options: { id: V; label: string; hint?: string }[];
    value: V;
    ariaLabel: string;
    size?: 'sm' | 'md';
    disabled?: boolean;
    class?: string;
    onchange?: (v: V) => void;
  } = $props();

  let root = $state<HTMLElement | null>(null);
  let pill = $state({ x: 0, w: 0, ready: false });

  function measure() {
    const el = root?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!el || !root) return (pill = { ...pill, ready: false });
    pill = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
  }
  $effect(() => {
    void value;
    void options.length;
    requestAnimationFrame(measure);
  });
  $effect(() => {
    if (!root) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
  });
  /** ToggleGroup speaks strings; map back to the option id (and ignore the "deselect" that clicking the active one sends). */
  function fromString(s: string) {
    const o = options.find((x) => String(x.id) === s);
    if (!o || o.id === value) return;
    value = o.id;
    onchange?.(o.id);
  }
  const itemCls = $derived(
    cn(
      'relative z-[1] rounded-[7px] border-0 bg-transparent font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45 data-[state=on]:text-foreground',
      !pill.ready && 'data-[state=on]:bg-accent',
      size === 'sm' ? 'h-auto px-[9px] py-[3px] text-xs' : 'h-auto px-[11px] py-[5px] text-[12.5px]',
    ),
  );
</script>

<ToggleGroup.Root
  type="single"
  bind:ref={root}
  bind:value={() => String(value), (s: string) => fromString(s)}
  aria-label={ariaLabel}
  {disabled}
  class={cn('relative max-w-full gap-0.5 overflow-x-auto rounded-[10px] border border-border bg-muted/40 p-[3px] [scrollbar-width:none]', disabled && 'opacity-50', className)}
>
  <span
    class={cn(
      'pointer-events-none absolute top-[3px] bottom-[3px] left-0 rounded-[7px] bg-accent opacity-0 shadow-sm transition-[transform,width,opacity] duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none',
      pill.ready && 'opacity-100',
    )}
    style="transform: translateX({pill.x}px); width: {pill.w}px"
    aria-hidden="true"
  ></span>
  {#each options as o (o.id)}
    <LazyTip tip={o.hint}>
      {#snippet trigger({ props })}<ToggleGroup.Item {...props} value={String(o.id)} class={itemCls}>{o.label}</ToggleGroup.Item>{/snippet}
    </LazyTip>
  {/each}
</ToggleGroup.Root>
