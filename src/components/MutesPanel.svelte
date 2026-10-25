<script lang="ts">
  import { norm, type MuteRules } from '@/lib/filters';
  import { getSettings, patchSettings, settingsItem, type Settings } from '@/lib/settings';
  import { MUTE_MODES, toggleOf } from '@/lib/settings-ui';
  import Segmented from './Segmented.svelte';
  import SwitchRow from './SwitchRow.svelte';
  import Chip from './Chip.svelte';
  import Empty from './Empty.svelte';
  import * as Card from '@/components/ui/card';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';

  let s = $state<Settings | null>(null);
  const inputs = $state({ authors: '', keywords: '', labels: '' });

  $effect(() => {
    getSettings().then((v) => (s = v));
    return settingsItem.watch(async () => (s = await getSettings()));
  });

  type ListKey = 'authors' | 'keywords' | 'labels';
  const SECTIONS: { key: ListKey; title: string; hint: string; placeholder: string }[] = [
    { key: 'authors', title: 'Authors', hint: 'Handles (the @name). Their threads leave your lists; their replies collapse.', placeholder: 'handle' },
    { key: 'keywords', title: 'Keywords', hint: 'Thread subjects containing these. /regex/ works.', placeholder: 'e.g. refund or /\\bwipe\\b/' },
    { key: 'labels', title: 'Labels', hint: 'Channel labels, e.g. "Concern".', placeholder: 'label name' },
  ];

  async function mutate(fn: (m: MuteRules) => MuteRules) {
    const cur = await getSettings();
    await patchSettings({ mutes: fn(cur.mutes) });
  }
  function add(key: ListKey) {
    const raw = inputs[key].trim();
    if (!raw) return;
    const value = key === 'keywords' ? raw : norm(raw);
    mutate((m) => (m[key].includes(value) ? m : { ...m, [key]: [...m[key], value] }));
    inputs[key] = '';
  }
</script>

{#if s}
  <div class="grid gap-4">
    <Card.Root>
      <Card.Header>
        <Card.Title>How muted things look</Card.Title>
      </Card.Header>
      <Card.Content class="grid gap-3">
        <Segmented options={MUTE_MODES} value={s.muteMode} ariaLabel="Mute mode" class="justify-self-start" onchange={(v) => patchSettings({ muteMode: v })} />
        <div class="grid gap-1">
          <SwitchRow id="mute-replies" label={toggleOf('muteReplies').label} checked={s.muteReplies} onchange={(v) => patchSettings({ muteReplies: v })} />
          <SwitchRow id="mute-bumps" label="Also mute threads whose latest reply is by a muted author" checked={s.mutes.hideBumps} onchange={(v) => mutate((m) => ({ ...m, hideBumps: v }))} />
        </div>
        <p class="text-muted-foreground m-0 text-sm">Pinned threads are never muted. Reload Spectrum after switching to "Hide" so already-loaded lists are refetched.</p>
      </Card.Content>
    </Card.Root>

    {#each SECTIONS as sec (sec.key)}
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2">{sec.title} <Badge variant="secondary">{s.mutes[sec.key].length}</Badge></Card.Title>
          <Card.Description>{sec.hint}</Card.Description>
        </Card.Header>
        <Card.Content class="grid gap-3">
          {#if s.mutes[sec.key].length}
            <div class="flex flex-wrap items-center gap-2">
              {#each s.mutes[sec.key] as v (v)}
                <Chip removeLabel={`Unmute ${v}`} onremove={() => mutate((m) => ({ ...m, [sec.key]: m[sec.key].filter((x) => x !== v) }))}>{sec.key === 'authors' ? `@${v}` : v}</Chip>
              {/each}
            </div>
          {:else}
            <Empty class="py-2 text-left">None.</Empty>
          {/if}
          <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), add(sec.key))}>
            <Input class="w-64" placeholder={sec.placeholder} bind:value={inputs[sec.key]} aria-label={`Add ${sec.title}`} />
            <Button type="submit" variant="outline" disabled={!inputs[sec.key].trim()}>Mute</Button>
          </form>
        </Card.Content>
      </Card.Root>
    {/each}
  </div>
{/if}
