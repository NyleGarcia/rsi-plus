<script lang="ts" generics="V extends string | number">
  /**
   * Segmented control (pattern after 21st.dev's segmented controls): a radio group of a few options with a pill
   * that slides to the selection. Arrow keys move the selection; `hint` is the tooltip.
   */
  let {
    options,
    value = $bindable(),
    ariaLabel,
    size = 'md',
    onchange,
  }: {
    options: { id: V; label: string; hint?: string }[];
    value: V;
    ariaLabel: string;
    size?: 'sm' | 'md';
    onchange?: (v: V) => void;
  } = $props();

  let root = $state<HTMLDivElement | null>(null);
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
  function set(v: V) {
    if (v === value) return;
    value = v;
    onchange?.(v);
  }
  function onKey(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.id === value);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + options.length) % options.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = options.length - 1;
    if (n < 0) return;
    e.preventDefault();
    set(options[n]!.id);
    root?.querySelector<HTMLElement>(`[data-i="${n}"]`)?.focus();
  }
</script>

<div class="seg {size}" role="radiogroup" aria-label={ariaLabel} bind:this={root}>
  <span class="pill" class:ready={pill.ready} style="transform: translateX({pill.x}px); width: {pill.w}px" aria-hidden="true"></span>
  {#each options as o, i (o.id)}
    <button type="button" role="radio" aria-checked={o.id === value} class:on={o.id === value} data-i={i} tabindex={o.id === value ? 0 : -1} title={o.hint} onclick={() => set(o.id)} onkeydown={onKey}>
      {o.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    position: relative;
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgb(255 255 255 / 0.03);
    width: fit-content;
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .pill {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 0;
    border-radius: 7px;
    background: rgb(255 255 255 / 0.1);
    box-shadow: 0 1px 0 rgb(255 255 255 / 0.06) inset, 0 2px 8px rgb(0 0 0 / 0.35);
    opacity: 0;
    transition:
      transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
      width 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 120ms;
    pointer-events: none;
  }
  .pill.ready {
    opacity: 1;
  }
  button {
    position: relative;
    z-index: 1;
    border: 0;
    background: none;
    color: var(--muted);
    padding: 5px 11px;
    font-size: 12.5px;
    font-weight: 600;
    border-radius: 7px;
    white-space: nowrap;
    transition: color 150ms;
  }
  .sm button {
    padding: 3px 9px;
    font-size: 12px;
  }
  button:hover {
    color: var(--text);
  }
  button.on {
    color: var(--text);
  }
  button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgb(60 200 255 / 0.45);
  }
  @media (prefers-reduced-motion: reduce) {
    .pill {
      transition: none;
    }
  }
</style>
