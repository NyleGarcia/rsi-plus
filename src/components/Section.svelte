<script lang="ts">
  /**
   * A foldable block of a flow. `done` (judged by the panel) folds it the moment it turns true and unfolds it again if
   * it turns false; the user can open / close it any time in between (remembered per `id` in `localStorage`
   * `rsiplus:sections`). `summary` sits next to the title, `actions` on the right and never toggles the fold.
   */
  import type { Snippet } from 'svelte';
  import * as Collapsible from '@/components/ui/collapsible';
  import { Badge } from '@/components/ui/badge';
  import { cn } from '@/lib/utils';
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';

  let {
    id,
    title,
    summary,
    done = false,
    doneText = 'done',
    defaultOpen = true,
    actions,
    children,
    class: className,
  }: {
    id: string;
    title: string;
    summary?: string;
    done?: boolean;
    doneText?: string;
    defaultOpen?: boolean;
    actions?: Snippet;
    children: Snippet;
    class?: string;
  } = $props();

  const KEY = 'rsiplus:sections';
  const read = (): Record<string, boolean> => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  };
  // svelte-ignore state_referenced_locally
  let open = $state(read()[id] ?? (done ? false : defaultOpen));
  // svelte-ignore state_referenced_locally
  let wasDone = done;
  $effect(() => {
    if (done === wasDone) return;
    wasDone = done;
    open = !done; // finished → fold; undone again → unfold
  });
  function setOpen(v: boolean) {
    open = v;
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: v }));
    } catch {
      /* fine */
    }
  }
</script>

<Collapsible.Root {open} onOpenChange={setOpen} class={cn('grid gap-2', className)}>
  <div class="flex flex-wrap items-center gap-2">
    <Collapsible.Trigger class="focus-visible:ring-ring/50 flex min-w-0 cursor-pointer items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2">
      {#if open}<ChevronDown class="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />{:else}<ChevronRight class="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />{/if}
      <strong class={cn(done && 'text-muted-foreground')}>{title}</strong>
      {#if summary}<span class="text-muted-foreground text-xs">{summary}</span>{/if}
      {#if done}<Badge variant="success-soft"><Check /> {doneText}</Badge>{/if}
    </Collapsible.Trigger>
    {#if actions}
      <span class="flex-1"></span>
      {@render actions()}
    {/if}
  </div>
  <Collapsible.Content class="grid gap-2">
    {@render children()}
  </Collapsible.Content>
</Collapsible.Root>
