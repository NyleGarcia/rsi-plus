<script lang="ts">
  /**
   * Label chips for one pledge (or a stack of identical ones) plus a "+ label" popover: preset labels with what they
   * do, labels already in use, and a box for a new one. A stack's chips show "n/m" when only some copies carry it.
   */
  import { allLabels, labelsOf, PRESET_LABELS, setLabel, type Labels } from '@/lib/labels';
  import * as Popover from '@/components/ui/popover';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Badge, type BadgeVariant } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import { Label } from '@/components/ui/label';
  import Tag from '@lucide/svelte/icons/tag';
  import X from '@lucide/svelte/icons/x';

  let { ids, labels, onchange }: { ids: number[]; labels: Labels; onchange: (next: Labels) => void } = $props();

  const norm = (l: string) => l.trim().toLowerCase();
  /** Labels on these pledges with how many of them carry each. */
  const here = $derived.by(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const id of ids) for (const l of labelsOf(labels, id)) {
      const e = m.get(norm(l)) ?? { name: l, n: 0 };
      e.n++;
      m.set(norm(l), e);
    }
    return [...m.values()];
  });
  const choices = $derived.by(() => {
    const seen = new Set<string>();
    const out: { name: string; hint?: string }[] = [];
    for (const c of [...PRESET_LABELS, ...allLabels(labels)]) if (!seen.has(norm(c.name))) (seen.add(norm(c.name)), out.push(c));
    return out;
  });
  const onAll = (name: string) => here.find((h) => norm(h.name) === norm(name))?.n === ids.length;
  const set = (name: string, on: boolean) => onchange(setLabel(labels, ids, name, on));
  let text = $state('');
  let open = $state(false);
  let armed = $state(false);
  let tipOpen = $state(false);
  /** Mount the Popover (+ its Tooltip); `tip` opens the tooltip straight away (the pointer is already over the button), `pop` the popover (a click). */
  const arm = (tip: boolean, pop = false) => {
    armed = true;
    if (tip && !pop) tipOpen = true;
    if (pop) open = true;
  };
  /** Preset labels keep their colour; your own labels are plain outline. */
  const TONE: Record<string, BadgeVariant> = { keep: 'success', 'lti token': 'warning', 'ccu fodder': 'info', melt: 'destructive' };
</script>

<div class="flex flex-wrap items-center gap-1">
  {#each here as h (h.name)}
    <Badge variant={TONE[norm(h.name)] ?? 'outline'} class="gap-0.5 pr-0.5">
      {h.name}{#if ids.length > 1 && h.n < ids.length}<span class="opacity-70"> {h.n}/{ids.length}</span>{/if}
      <Button variant="ghost" size="icon-xs" class="size-4" aria-label={`Remove label ${h.name}`} onclick={() => set(h.name, false)}><X /></Button>
    </Badge>
  {/each}
  {#if !armed}
    <!-- Bare button until the first hover / focus / click: a Popover + Tooltip per table row cost a second to mount. -->
    <Button variant="ghost" size="xs" class="text-muted-foreground h-5 px-1.5" aria-label="Edit labels" onpointerenter={() => arm(true)} onfocus={() => arm(true)} onclick={() => arm(true, true)}><Tag class="size-3" /></Button>
  {:else}
  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <span class="inline-flex" role="presentation" onpointerleave={() => (tipOpen = false)}>
          <Tooltip.Root bind:open={tipOpen}>
            <Tooltip.Trigger {...props}>
              {#snippet child({ props: tip })}
                <Button {...tip} variant="ghost" size="xs" class="text-muted-foreground h-5 px-1.5" aria-label="Edit labels"><Tag class="size-3" /></Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>{ids.length > 1 ? `Label all ${ids.length} copies (unstack to label one)` : 'Add your own label'}</Tooltip.Content>
          </Tooltip.Root>
        </span>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content align="start" class="w-72 gap-1.5 p-2">
      {#each choices as c (c.name)}
        <Label class="hover:bg-muted cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 font-normal">
          <Checkbox class="mt-0.5" checked={onAll(c.name)} onCheckedChange={(v) => set(c.name, !!v)} />
          <span class="grid gap-0.5 leading-snug"><span>{c.name}</span>{#if c.hint}<span class="text-muted-foreground text-[11px]">{c.hint}</span>{/if}</span>
        </Label>
      {/each}
      <form class="flex gap-1.5 pt-1" onsubmit={(e) => (e.preventDefault(), text.trim() && (set(text, true), (text = '')))}>
        <Input placeholder="New label…" bind:value={text} aria-label="New label" />
        <Button type="submit" disabled={!text.trim()}>Add</Button>
      </form>
    </Popover.Content>
  </Popover.Root>
  {/if}
</div>
