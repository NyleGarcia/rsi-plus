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
   * Searchable single-select on shadcn Popover + Command: closed = an outline button showing the pick; open = a search
   * box over a grouped list. Filters label + sublabel by substring (our own filter, not Command's fuzzy one, so order and
   * matches stay predictable), arrow keys / Enter / Escape, click outside closes, optional clear (× or Backspace/Delete
   * on the closed button).
   */
  import * as Popover from '@/components/ui/popover';
  import * as Command from '@/components/ui/command';
  import { buttonVariants } from '@/components/ui/button';
  import { cn } from '@/lib/utils';
  import X from '@lucide/svelte/icons/x';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';

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
  /** Command's highlighted item (string form of an option value). */
  let highlighted = $state('');

  const selected = $derived(options.find((o) => o.value === value) ?? null);
  const needle = $derived(q.trim().toLowerCase());
  const shown = $derived(needle ? options.filter((o) => `${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(needle)) : options);
  /** Groups in first-seen order; ungrouped options sit in a heading-less group. */
  const groups = $derived.by(() => {
    const m = new Map<string, Option<V>[]>();
    for (const o of shown) {
      const g = o.group ?? '';
      const list = m.get(g);
      if (list) list.push(o);
      else m.set(g, [o]);
    }
    return [...m].map(([heading, items]) => ({ heading, items }));
  });

  function setOpen(v: boolean) {
    if (v && disabled) return;
    open = v;
    q = '';
    if (v) highlighted = selected ? String(selected.value) : (shown.find((o) => !o.disabled) ? String(shown.find((o) => !o.disabled)!.value) : '');
  }
  function pick(o: Option<V> | null) {
    if (o?.disabled) return;
    value = o?.value ?? null;
    onpick?.(value, o);
    open = false;
    q = '';
  }
  function onTriggerKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') (e.preventDefault(), setOpen(true));
    else if (clearable && (e.key === 'Backspace' || e.key === 'Delete') && value != null) (e.preventDefault(), pick(null));
  }

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

{#snippet marked(text: string)}{#each mark(text) as p, j (j)}{#if p.hit}<mark class="bg-transparent font-semibold text-primary">{p.t}</mark>{:else}{p.t}{/if}{/each}{/snippet}

<Popover.Root bind:open={() => open, setOpen}>
  <Popover.Trigger {disabled}>
    {#snippet child({ props })}
      <button
        {...props}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        onkeydown={(e) => {
          onTriggerKey(e);
          if (!e.defaultPrevented) (props.onkeydown as ((e: KeyboardEvent) => void) | undefined)?.(e);
        }}
        class={cn(
          buttonVariants({ variant: 'outline' }),
          'h-auto min-h-8 w-full min-w-0 justify-start gap-1.5 px-2.5 py-1.5 text-left font-normal',
          !selected && 'text-muted-foreground',
        )}
      >
        <span class="min-w-0 flex-1 truncate">
          {#if selected}
            {selected.label}{#if selected.sublabel}<span class="text-muted-foreground"> · {selected.sublabel}</span>{/if}
          {:else}
            {placeholder}
          {/if}
        </span>
        {#if clearable && selected && !disabled}
          <span
            class="text-muted-foreground hover:text-foreground -my-1 inline-flex rounded p-0.5"
            role="button"
            tabindex="-1"
            aria-label="Clear"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => (e.stopPropagation(), pick(null))}
            onkeydown={(e) => e.stopPropagation()}><X class="size-3.5" /></span
          >
        {/if}
        <ChevronsUpDown class="text-muted-foreground size-3.5 opacity-70" aria-hidden="true" />
      </button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="start" class="w-(--bits-popover-anchor-width) min-w-[260px] gap-0 p-0">
    <Command.Root shouldFilter={false} bind:value={highlighted} label={ariaLabel}>
      <Command.Input bind:value={q} placeholder="Type to search…" aria-label={ariaLabel} autocomplete="off" spellcheck="false" />
      <Command.List class="max-h-80">
        {#if !shown.length}
          <div class="text-muted-foreground py-6 text-center text-sm">{emptyText}</div>
        {/if}
        {#each groups as g (g.heading)}
          <Command.Group heading={g.heading || undefined} value={`group:${g.heading}`}>
            {#each g.items as o (o.value)}
              <Command.Item
                value={String(o.value)}
                disabled={o.disabled}
                data-checked={o.value === value}
                onSelect={() => pick(o)}
                class="gap-2"
              >
                <span class={cn('min-w-0 flex-1 truncate', o.value === value && 'font-semibold')}>{@render marked(o.label)}</span>
                {#if o.sublabel}<span class="text-muted-foreground text-xs whitespace-nowrap">{@render marked(o.sublabel)}</span>{/if}
              </Command.Item>
            {/each}
          </Command.Group>
        {/each}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
