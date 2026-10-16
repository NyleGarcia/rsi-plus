<script lang="ts">
  import { norm, type MuteRules } from '@/lib/filters';
  import { getSettings, patchSettings, settingsItem, type Settings } from '@/lib/settings';
  import * as Card from '@/components/ui/card';
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import { Label } from '@/components/ui/label';
  import X from '@lucide/svelte/icons/x';

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
        <ToggleGroup.Root
          type="single"
          variant="outline"
          aria-label="Mute mode"
          value={s.muteMode}
          onValueChange={(v) => {
            if (v === 'dim' || v === 'hide') patchSettings({ muteMode: v });
          }}
        >
          <ToggleGroup.Item value="dim">Dim (hover to peek)</ToggleGroup.Item>
          <ToggleGroup.Item value="hide">Hide completely</ToggleGroup.Item>
        </ToggleGroup.Root>
        <Label class="font-normal">
          <Checkbox checked={s.muteReplies} onCheckedChange={(v) => patchSettings({ muteReplies: v })} />
          Collapse replies by muted authors inside threads
        </Label>
        <Label class="font-normal">
          <Checkbox checked={s.mutes.hideBumps} onCheckedChange={(v) => mutate((m) => ({ ...m, hideBumps: v }))} />
          Also mute threads whose latest reply is by a muted author
        </Label>
        <span class="text-muted-foreground">Pinned threads are never muted. Reload Spectrum after switching to "Hide" so already-loaded lists are refetched.</span>
      </Card.Content>
    </Card.Root>

    {#each SECTIONS as sec (sec.key)}
      <Card.Root>
        <Card.Header>
          <Card.Title>{sec.title} <span class="text-muted-foreground font-normal">({s.mutes[sec.key].length})</span></Card.Title>
          <Card.Description>{sec.hint}</Card.Description>
        </Card.Header>
        <Card.Content class="grid gap-3">
          <div class="flex flex-wrap items-center gap-2">
            {#each s.mutes[sec.key] as v (v)}
              <Badge variant="secondary" class="pr-0.5">
                {sec.key === 'authors' ? `@${v}` : v}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  class="size-4 rounded-full"
                  aria-label={`Unmute ${v}`}
                  onclick={() => mutate((m) => ({ ...m, [sec.key]: m[sec.key].filter((x) => x !== v) }))}><X /></Button
                >
              </Badge>
            {:else}
              <span class="text-muted-foreground">None.</span>
            {/each}
          </div>
          <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), add(sec.key))}>
            <Input class="w-64" placeholder={sec.placeholder} bind:value={inputs[sec.key]} aria-label={`Add ${sec.title}`} />
            <Button type="submit" variant="outline" disabled={!inputs[sec.key].trim()}>Mute</Button>
          </form>
        </Card.Content>
      </Card.Root>
    {/each}
  </div>
{/if}
