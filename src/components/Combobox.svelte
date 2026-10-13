<script module lang="ts">
  export interface Option<V> {
    value: V;
    label: string;
    sublabel?: string;
    /** Group header; options keep their given order inside a group, groups in first-seen order. */
    group?: string;
    disabled?: boolean;
  }
</script>

<script lang="ts" generics="V extends string | number">
  /**
   * Searchable single-select (pattern after SC-ORG-BOT's Combobox): closed = a button showing the pick; open = a
   * search box over a grouped listbox. Filters label + sublabel by substring, arrow keys / Enter / Escape, click
   * outside closes, optional clear. No portal — the hub page has no clipping containers.
   */
  import { tick } from 'svelte';

  let {
    options,
    value = $bindable(null),
    placeholder = 'Pick…',
    ariaLabel,
    clearable = true,
    disabled = false,
    emptyText = 'No matches',
    onpick,
  }: {
    options: Option<V>[];
    value?: V | null;
    placeholder?: string;
    ariaLabel: string;
    clearable?: boolean;
    disabled?: boolean;
    emptyText?: string;
    /** Called after a pick (also on clear with null). */
    onpick?: (value: V | null, option: Option<V> | null) => void;
  } = $props();

  let open = $state(false);
  let q = $state('');
  let active = $state(-1);
  let root = $state<HTMLDivElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let list = $state<HTMLDivElement | null>(null);
  const id = `cb${Math.random().toString(36).slice(2, 8)}`;

  const selected = $derived(options.find((o) => o.value === value) ?? null);
  const needle = $derived(q.trim().toLowerCase());
  const shown = $derived(needle ? options.filter((o) => `${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(needle)) : options);
  /** Rows in render order: group headers interleaved; `index` counts only options (for keyboard navigation). */
  const rows = $derived.by(() => {
    const out: ({ kind: 'header'; label: string } | { kind: 'option'; option: Option<V>; index: number })[] = [];
    let last: string | undefined;
    let i = 0;
    for (const o of shown) {
      if (o.group && o.group !== last) out.push({ kind: 'header', label: o.group });
      last = o.group ?? last;
      out.push({ kind: 'option', option: o, index: i++ });
    }
    return out;
  });
  const enabled = $derived(shown.filter((o) => !o.disabled));

  async function show() {
    if (disabled) return;
    open = true;
    q = '';
    active = selected ? Math.max(0, shown.findIndex((o) => o.value === selected.value)) : -1;
    await tick();
    input?.focus();
    scrollActive();
  }
  function hide() {
    open = false;
    q = '';
  }
  function pick(o: Option<V> | null) {
    if (o?.disabled) return;
    value = o?.value ?? null;
    onpick?.(value, o);
    hide();
  }
  function move(d: number) {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + d + shown.length) % shown.length;
      if (!shown[i]?.disabled) break;
    }
    active = i;
    scrollActive();
  }
  function scrollActive() {
    list?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
    else if (e.key === 'Home') (e.preventDefault(), (active = 0), scrollActive());
    else if (e.key === 'End') (e.preventDefault(), (active = shown.length - 1), scrollActive());
    else if (e.key === 'Enter') {
      e.preventDefault();
      const o = shown[active] ?? (enabled.length === 1 ? enabled[0] : null);
      if (o) pick(o);
    } else if (e.key === 'Escape') (e.preventDefault(), hide());
    else if (e.key === 'Tab') hide();
  }
  function onTriggerKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') (e.preventDefault(), show());
    else if (clearable && (e.key === 'Backspace' || e.key === 'Delete') && value != null) pick(null);
  }
  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) hide();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  });
  // Reset the highlight when the filter changes.
  $effect(() => {
    void needle;
    active = enabled.length ? shown.indexOf(enabled[0]!) : -1;
  });

  function mark(text: string): { t: string; hit: boolean }[] {
    if (!needle) return [{ t: text, hit: false }];
    const i = text.toLowerCase().indexOf(needle);
    if (i < 0) return [{ t: text, hit: false }];
    return [
      { t: text.slice(0, i), hit: false },
      { t: text.slice(i, i + needle.length), hit: true },
      { t: text.slice(i + needle.length), hit: false },
    ].filter((p) => p.t);
  }
</script>

<div class="cb" class:open bind:this={root}>
  {#if open}
    <input
      bind:this={input}
      bind:value={q}
      type="search"
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded="true"
      aria-controls="{id}-list"
      aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
      aria-autocomplete="list"
      placeholder="Type to search…"
      autocomplete="off"
      spellcheck="false"
      onkeydown={onKey}
    />
    <div class="pop" id="{id}-list" role="listbox" aria-label={ariaLabel} bind:this={list}>
      {#if !shown.length}
        <div class="none muted">{emptyText}</div>
      {/if}
      {#each rows as r, k (r.kind === 'header' ? `h:${r.label}` : `o:${String(r.option.value)}`)}
        {#if r.kind === 'header'}
          <div class="head">{r.label}</div>
        {:else}
          <!-- Keyboard goes through the search input (aria-activedescendant), so rows are not focusable themselves. -->
          <!-- svelte-ignore a11y_interactive_supports_focus -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            id="{id}-{r.index}"
            class="opt"
            class:active={r.index === active}
            class:selected={r.option.value === value}
            class:disabled={r.option.disabled}
            role="option"
            aria-selected={r.option.value === value}
            aria-disabled={r.option.disabled || undefined}
            data-i={r.index}
            onpointermove={() => (active = r.index)}
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => pick(r.option)}
          >
            <span class="label">{#each mark(r.option.label) as p, j (j)}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>
            {#if r.option.sublabel}<span class="sub muted">{#each mark(r.option.sublabel) as p, j (j)}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>{/if}
            {#if r.option.value === value}<span class="check" aria-hidden="true">✓</span>{/if}
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <button
      type="button"
      class="trigger"
      class:placeholder={!selected}
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded="false"
      aria-haspopup="listbox"
      aria-controls="{id}-list"
      {disabled}
      onclick={show}
      onkeydown={onTriggerKey}
    >
      <span class="text">
        {#if selected}
          {selected.label}{#if selected.sublabel}<span class="sub muted"> · {selected.sublabel}</span>{/if}
        {:else}
          {placeholder}
        {/if}
      </span>
      {#if clearable && selected && !disabled}
        <span class="x" role="button" tabindex="-1" aria-label="Clear" onclick={(e) => (e.stopPropagation(), pick(null))} onkeydown={(e) => e.stopPropagation()}>×</span>
      {/if}
      <span class="chev" aria-hidden="true">⌄</span>
    </button>
  {/if}
</div>

<style>
  .cb {
    position: relative;
    min-width: 0;
    width: 100%;
  }
  .trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    background: rgb(255 255 255 / 0.05);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 9px;
    color: var(--text);
    min-height: 32px;
  }
  .trigger:hover {
    border-color: rgb(255 255 255 / 0.18);
  }
  .trigger:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgb(60 200 255 / 0.25);
  }
  .trigger.placeholder .text {
    color: var(--muted);
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .x {
    color: var(--muted);
    padding: 0 4px;
    font-size: 15px;
    line-height: 1;
  }
  .x:hover {
    color: var(--text);
  }
  .chev {
    color: var(--muted);
    line-height: 0.6;
    font-size: 16px;
    transform: translateY(-3px);
  }
  input {
    width: 100%;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgb(60 200 255 / 0.25);
  }
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    min-width: 260px;
    max-height: 320px;
    overflow: auto;
    z-index: 50;
    background: rgb(28 31 39 / 0.92);
    backdrop-filter: blur(12px);
    border: 1px solid rgb(255 255 255 / 0.12);
    border-radius: 10px;
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.6);
    padding: 4px;
  }
  .head {
    position: sticky;
    top: 0;
    background: rgb(28 31 39 / 0.98);
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 6px 8px 4px;
  }
  .opt {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 7px;
    cursor: pointer;
  }
  .opt.active {
    background: rgb(60 200 255 / 0.16);
  }
  .opt.selected .label {
    font-weight: 600;
  }
  .opt.disabled {
    opacity: 0.5;
    cursor: default;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    white-space: nowrap;
  }
  .check {
    color: var(--accent);
  }
  mark {
    background: none;
    color: var(--accent);
    font-weight: 600;
  }
  .none {
    padding: 10px;
    text-align: center;
  }
</style>
