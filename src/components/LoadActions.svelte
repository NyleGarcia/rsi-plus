<script lang="ts">
  /** Stop / Resume from page n / Update / Reload all | Load <noun> — the button ladder next to `LoadStatus`. */
  import type { Snippet } from 'svelte';
  import { Button } from '@/components/ui/button';
  import TipButton from './TipButton.svelte';

  let {
    loading,
    data,
    noun,
    onstop,
    onload,
    onupdate = null,
    updateHint = 'Reads from the newest entry down and stops at the first page that matches what is saved; older changes need Reload all.',
    canUpdate = true,
    size = 'default',
    children,
  }: {
    loading: unknown;
    data: { complete?: boolean; page?: number } | null;
    /** For the first button: `Load hangar`, `Load buyback`. */
    noun: string;
    onstop: () => void;
    onload: (resume: boolean) => void;
    onupdate?: (() => void) | null;
    updateHint?: string;
    canUpdate?: boolean;
    size?: 'default' | 'sm';
    /** More buttons after the ladder (exports, cart). */
    children?: Snippet;
  } = $props();
</script>

{#if loading}
  <Button variant="outline" {size} onclick={onstop}>Stop</Button>
{:else}
  {#if data && data.complete === false}
    <Button {size} onclick={() => onload(true)}>Resume from page {(data.page ?? 0) + 1}</Button>
  {/if}
  {#if onupdate && data?.complete !== false && canUpdate}
    <TipButton {size} onclick={onupdate} tip={updateHint}>Update</TipButton>
  {/if}
  <Button variant={data ? 'outline' : 'default'} {size} onclick={() => onload(false)}>{data ? 'Reload all' : `Load ${noun}`}</Button>
{/if}
{@render children?.()}
