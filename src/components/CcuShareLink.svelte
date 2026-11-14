<script lang="ts">
  /** *Copy link*: the hub URL with this route and its options in the hash (`lib/ccu-link.ts`), then "Copied" briefly. */
  import { transient } from '@/lib/flash.svelte';
  import { cn } from '@/lib/utils';
  import TipButton from './TipButton.svelte';
  import Link from '@lucide/svelte/icons/link';

  let { hash }: { hash: string } = $props();

  const note = transient(2000);
  async function copy() {
    try {
      await navigator.clipboard.writeText(location.href.split('#')[0] + hash);
      note.show('Copied');
    } catch {
      note.show('Could not copy');
    }
  }
</script>

<TipButton variant="outline" size="sm" type="button" onclick={copy} tip="Copies a link to this route with its options. Your own CCUs and ignored steps are not in it.">
  <Link />Copy link
</TipButton>
{#if note.text}<span class={cn('text-[11px]', note.text === 'Copied' ? 'text-success' : 'text-destructive')} role="status">{note.text}</span>{/if}
