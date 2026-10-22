<script lang="ts">
  /** A setting as a switch with its label and hint — the one row shape for Settings, the popup, Watching, Friends. */
  import type { Snippet } from 'svelte';
  import { Switch } from '@/components/ui/switch';
  import { Label } from '@/components/ui/label';
  import { cn } from '@/lib/utils';

  let {
    id,
    label,
    hint = null,
    checked,
    onchange,
    disabled = false,
    size = 'default',
    class: className = '',
    children,
  }: {
    id: string;
    label: string;
    hint?: string | null;
    checked: boolean;
    onchange: (v: boolean) => void;
    disabled?: boolean;
    size?: 'default' | 'sm';
    class?: string;
    /** Trailing control (a play button, a number field). */
    children?: Snippet;
  } = $props();
</script>

<div class={cn('flex items-start gap-2.5 py-1', className)}>
  <Switch {id} {size} class="mt-px" {checked} {disabled} onCheckedChange={onchange} />
  <Label for={id} class="grid flex-1 cursor-pointer gap-0.5 leading-snug font-normal">
    <span>{label}</span>
    {#if hint}<span class="text-muted-foreground text-xs">{hint}</span>{/if}
  </Label>
  {@render children?.()}
</div>
