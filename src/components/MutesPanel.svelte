<script lang="ts">
  import { norm, type MuteRules } from '@/lib/filters';
  import { getSettings, patchSettings, settingsItem, type Settings } from '@/lib/settings';

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
  <div class="stack">
    <section class="card stack">
      <h2>How muted things look</h2>
      <div class="row">
        <label class="row"><input type="radio" name="mode" checked={s.muteMode === 'dim'} onchange={() => patchSettings({ muteMode: 'dim' })} /> Dim (hover to peek)</label>
        <label class="row"><input type="radio" name="mode" checked={s.muteMode === 'hide'} onchange={() => patchSettings({ muteMode: 'hide' })} /> Hide completely</label>
      </div>
      <label class="row"><input type="checkbox" checked={s.muteReplies} onchange={(e) => patchSettings({ muteReplies: e.currentTarget.checked })} /> Collapse replies by muted authors inside threads</label>
      <label class="row"
        ><input type="checkbox" checked={s.mutes.hideBumps} onchange={(e) => mutate((m) => ({ ...m, hideBumps: e.currentTarget.checked }))} /> Also mute threads whose latest reply is by a muted author</label
      >
      <span class="muted">Pinned threads are never muted. Reload Spectrum after switching to "Hide" so already-loaded lists are refetched.</span>
    </section>

    {#each SECTIONS as sec (sec.key)}
      <section class="card stack">
        <div>
          <h2>{sec.title} <span class="muted">({s.mutes[sec.key].length})</span></h2>
          <span class="muted">{sec.hint}</span>
        </div>
        <div class="row">
          {#each s.mutes[sec.key] as v (v)}
            <span class="chip">{sec.key === 'authors' ? `@${v}` : v}<button aria-label={`Unmute ${v}`} onclick={() => mutate((m) => ({ ...m, [sec.key]: m[sec.key].filter((x) => x !== v) }))}>×</button></span>
          {:else}
            <span class="muted">None.</span>
          {/each}
        </div>
        <form class="row" onsubmit={(e) => (e.preventDefault(), add(sec.key))}>
          <input placeholder={sec.placeholder} bind:value={inputs[sec.key]} aria-label={`Add ${sec.title}`} />
          <button class="btn" disabled={!inputs[sec.key].trim()}>Mute</button>
        </form>
      </section>
    {/each}
  </div>
{/if}
