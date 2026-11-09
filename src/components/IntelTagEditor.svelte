<script lang="ts">
  /** Tag a player or org (hostile … ally), with a note and labels. Saved to `intelItem` as you change it. */
  import { intelItem } from '@/lib/settings';
  import { INTEL_TAGS, intelKey, removeTag, setTag, type Intel, type IntelEntry, type IntelTag } from '@/lib/intel';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Textarea } from '@/components/ui/textarea';
  import { cn } from '@/lib/utils';
  import { TAG_TONE } from './intel-tone';

  let { kind, id, name, compact = false }: { kind: IntelEntry['kind']; id: string; name?: string; compact?: boolean } = $props();
  let intel = $state<Intel>({});
  $effect(() => {
    intelItem.getValue().then((v) => (intel = v));
    return intelItem.watch((v) => (intel = v ?? {}));
  });
  const entry = $derived(intel[intelKey(kind, id)]);
  let note = $state('');
  let labels = $state('');
  $effect(() => {
    note = entry?.note ?? '';
    labels = (entry?.labels ?? []).join(', ');
  });
  async function tag(t: IntelTag | null) {
    const cur = await intelItem.getValue();
    await intelItem.setValue(t ? setTag(cur, { kind, id, name, tag: t, note, labels: labels.split(',') }, Date.now()) : removeTag(cur, kind, id));
  }
  async function saveText() {
    if (!entry) return;
    const cur = await intelItem.getValue();
    await intelItem.setValue(setTag(cur, { kind, id, name, tag: entry.tag, note, labels: labels.split(',') }, Date.now()));
  }
</script>

{#if compact}
  <select
    class={cn('bg-background rounded-md border px-2 py-0.5 text-xs', entry && TAG_TONE[entry.tag])}
    value={entry?.tag ?? ''}
    onchange={(e) => tag(((e.currentTarget as HTMLSelectElement).value || null) as IntelTag | null)}
    aria-label={`Tag ${kind === 'org' ? 'org' : 'player'} ${id}`}
  >
    <option value="">No tag</option>
    {#each INTEL_TAGS as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
  </select>
{:else}
<div class="grid gap-2">
  <div class="flex flex-wrap items-center gap-1" role="group" aria-label={`Tag ${kind === 'org' ? 'org' : 'player'} ${id}`}>
    {#each INTEL_TAGS as t (t.id)}
      <Button size="xs" variant="outline" class={cn(entry?.tag === t.id && TAG_TONE[t.id])} aria-pressed={entry?.tag === t.id} onclick={() => tag(entry?.tag === t.id ? null : t.id)}>{t.label}</Button>
    {/each}
    {#if entry}<Button size="xs" variant="ghost" onclick={() => tag(null)}>Clear</Button>{/if}
  </div>
  {#if entry}
    <Textarea rows={2} class="text-xs" placeholder="Note (stays in this browser; shared only if you export)" bind:value={note} onchange={saveText} aria-label="Note" />
    <Input class="h-7 text-xs" placeholder="Labels, comma separated: pirate, griefer, trade partner" bind:value={labels} onchange={saveText} aria-label="Labels" />
    {#if entry.source}<span class="text-muted-foreground text-xs">Imported from {entry.source}</span>{/if}
  {/if}
</div>
{/if}
