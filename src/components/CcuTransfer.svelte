<script lang="ts">
  /**
   * Export / import CCU chains as text (`lib/ccu-link.ts`): the route on screen and the saved chains as codes to copy
   * or download, and a box to paste codes (or pick a file) into — open one in the planner, or add them all to the
   * saved chains. A code holds the route and options, not your own CCUs.
   */
  import { transient } from '@/lib/flash.svelte';
  import { ccuCodesText, parseCcuCodes, type CcuLink } from '@/lib/ccu-link';
  import { dateStamp, downloadFile } from '@/lib/download';
  import * as Dialog from '@/components/ui/dialog';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Textarea } from '@/components/ui/textarea';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';

  let {
    code = null,
    saved = [],
    label = 'Import / export',
    onopen,
    onadd,
  }: {
    /** Code of the route on screen (null = none planned). */
    code?: string | null;
    /** Codes of the saved chains. */
    saved?: string[];
    /** Text of the button that opens the dialog. */
    label?: string;
    /** Open one imported chain in the planner. */
    onopen: (l: CcuLink) => void;
    /** Add imported chains to the saved chains; resolves to how many were added and how many could not be planned. */
    onadd: (l: CcuLink[]) => Promise<{ added: number; failed: number }>;
  } = $props();

  let open = $state(false);
  let text = $state('');
  let msg = $state('');
  const copied = transient(2000);
  const found = $derived(parseCcuCodes(text));

  async function copy(what: string, label: string) {
    try {
      await navigator.clipboard.writeText(what);
      copied.show(label);
    } catch {
      copied.show('Could not copy: select the text and copy it by hand');
    }
  }
  async function pickFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    text = await file.text();
    msg = parseCcuCodes(text).length ? '' : `${file.name}: no chain codes in this file`;
  }
  async function add() {
    const r = await onadd(found);
    msg = `${r.added} added to your saved chains${r.failed ? `, ${r.failed} could not be planned today (ship unknown, or no chain from that source)` : ''}`;
    if (r.added) text = '';
  }
  function openFirst() {
    const l = found[0];
    if (!l) return;
    onopen(l);
    open = false;
  }
</script>

<Button variant="outline" size="sm" onclick={() => ((open = true), (msg = ''))}><ArrowLeftRight />{label}</Button>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Import / export chains</Dialog.Title>
      <Dialog.Description>A chain code holds the source, target, stops and options. Your own CCUs are not in it: whoever imports a code gets the chain planned on their hangar and today's store.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4 text-sm">
      <section class="grid gap-1.5">
        <strong>Export</strong>
        {#if code}
          <div class="flex items-center gap-2">
            <Input readonly value={code} aria-label="Code of the chain on screen" class="font-mono text-xs" onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
            <Button variant="outline" size="sm" onclick={() => copy(code!, 'Copied the chain on screen')}>Copy</Button>
          </div>
        {:else}
          <span class="text-muted-foreground text-xs">Pick a source and a target to export the chain on screen.</span>
        {/if}
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!saved.length} onclick={() => copy(ccuCodesText(saved), `Copied ${saved.length} saved chains`)}>Copy saved chains ({saved.length})</Button>
          <Button variant="outline" size="sm" disabled={!saved.length} onclick={() => downloadFile(`rsi-plus-ccu-chains-${dateStamp()}.txt`, ccuCodesText(saved), 'text/plain')}>Download as a file</Button>
          {#if copied.text}<span class="text-success text-xs" role="status">{copied.text}</span>{/if}
        </div>
      </section>
      <section class="grid gap-1.5">
        <strong>Import</strong>
        <Textarea bind:value={text} rows={5} class="font-mono text-xs" placeholder="Paste one chain code per line (#ccu?from=…&to=…)" aria-label="Chain codes to import" />
        <div class="flex flex-wrap items-center gap-2">
          <label class="border-input hover:bg-accent inline-flex h-7 cursor-pointer items-center rounded-md border px-2.5 text-[0.8rem]">
            Choose a file…
            <input type="file" accept="text/plain,.txt" class="sr-only" onchange={pickFile} />
          </label>
          <Button size="sm" disabled={!found.length} onclick={openFirst}>{found.length > 1 ? 'Open the first in the planner' : 'Open in the planner'}</Button>
          <Button variant="outline" size="sm" disabled={!found.length} onclick={add}>Add {found.length || ''} to saved chains</Button>
          {#if text.trim() && !found.length}<span class="text-destructive text-xs">No chain code found in this text.</span>{/if}
          {#if msg}<span class="text-muted-foreground text-xs" role="status">{msg}</span>{/if}
        </div>
      </section>
    </div>
  </Dialog.Content>
</Dialog.Root>
