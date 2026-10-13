<script lang="ts">
  import { bg, type HubTab } from '@/lib/messages';
  import { INCOGNITO, feedItem, getSettings, partyModeItem, patchSettings, type Settings } from '@/lib/settings';
  import { partyActive, type PartyMode } from '@/lib/friends';
  import AccountSwitch from '@/components/AccountSwitch.svelte';

  let s = $state<Settings | null>(null);
  let unseen = $state(0);
  let party = $state<PartyMode | null>(null);
  $effect(() => {
    partyModeItem.getValue().then((m) => (party = m));
  });
  const partyOn = $derived(partyActive(party, Date.now()));
  async function toggleParty() {
    const t = Date.now();
    party = partyOn ? { ...party!, on: false } : { on: true, startedAt: t, until: t + 120 * 60_000 };
    await partyModeItem.setValue(party);
  }
  $effect(() => {
    getSettings().then((v) => (s = v));
    feedItem.getValue().then((f) => (unseen = f.filter((e) => !e.seen).length));
  });

  async function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    if (!s) return;
    s[k] = v;
    await patchSettings({ [k]: v } as Partial<Settings>);
  }
  /** Pass our window so the hub opens here (an incognito popup → incognito hub, not the normal window). */
  const open = async (tab: HubTab) => {
    const windowId = await browser.windows
      .getCurrent()
      .then((w) => w.id)
      .catch(() => undefined);
    await bg({ type: 'hub:open', tab, windowId });
    window.close();
  };

  const TOGGLES: { key: keyof Settings; label: string; hint?: string }[] = [
    { key: 'readTracking', label: 'Read tracking', hint: '"+N new" badges, read threads dimmed' },
    { key: 'hideRead', label: 'Hide read threads', hint: 'Unless they have new replies, are pinned or watched' },
    { key: 'devHighlight', label: 'Highlight dev posts' },
    { key: 'keyboard', label: 'Keyboard shortcuts', hint: 'Press ? on Spectrum' },
    { key: 'theme', label: 'Modern theme' },
    { key: 'wide', label: 'Full-width threads' },
    { key: 'compact', label: 'Compact replies' },
    { key: 'notify', label: 'Desktop notifications' },
    { key: 'partySound', label: 'Ding on party auto-accept', hint: 'Short sound when party mode accepts a request' },
    { key: 'siteBar', label: 'RSI+ bar on store & account pages' },
  ];
</script>

<main>
  <header class="row spread">
    <h1>RSI<span>+</span>{#if INCOGNITO}<em class="incog" title="Incognito: separate login, friends, hangar, reads and party mode">incognito</em>{/if}</h1>
    <a class="btn small" href="https://robertsspaceindustries.com/spectrum/community/SC" target="_blank" rel="noopener">Spectrum</a>
  </header>
  <AccountSwitch compact />

  <nav class="grid">
    <button class="btn" onclick={() => open('feed')}>Feed{unseen ? ` (${unseen})` : ''}</button>
    <button class="btn" onclick={() => open('friends')}>Friends</button>
    <button class="btn" onclick={() => open('hangar')}>Hangar</button>
    <button class="btn" onclick={() => open('wallet')}>Wallet</button>
    <button class="btn" onclick={() => open('ships')}>Ships & paints</button>
    <button class="btn" onclick={() => open('items')}>Items</button>
    <button class="btn" onclick={() => open('store')}>Store</button>
    <button class="btn" onclick={() => open('ccu')}>CCU planner</button>
    <button class="btn" onclick={() => open('watching')}>Watching</button>
  </nav>

  <button class="btn party" class:on={partyOn} onclick={toggleParty} title="Auto-accept friend requests (2 h) — details & log in Friends">
    {partyOn ? `🎉 Party mode ON${party?.until ? ` until ${new Date(party.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} — stop` : '🎉 Start party mode (2 h)'}
  </button>

  {#if s}
    <section>
      {#each TOGGLES as t (t.key)}
        <label class="toggle">
          <input type="checkbox" checked={!!s[t.key]} onchange={(e) => set(t.key, e.currentTarget.checked as never)} />
          <span>{t.label}{#if t.hint}<small class="muted">{t.hint}</small>{/if}</span>
          {#if t.key === 'partySound'}<button class="btn small" type="button" title="Play it" onclick={(e) => (e.preventDefault(), bg({ type: 'sound:ding' }).catch(() => {}))}>♪</button>{/if}
        </label>
      {/each}
    </section>
  {/if}
</main>

<style>
  main {
    width: 300px;
    padding: 14px;
    display: grid;
    gap: 14px;
  }
  h1 {
    margin: 0;
    font-size: 17px;
  }
  .incog {
    margin-left: 6px;
    padding: 1px 5px;
    border: 1px solid var(--line);
    border-radius: 6px;
    font-size: 10px;
    font-style: normal;
    color: var(--muted);
    vertical-align: middle;
  }
  h1 span {
    color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  section {
    display: grid;
    gap: 2px;
  }
  .toggle {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    padding: 5px 2px;
    cursor: pointer;
  }
  .toggle span {
    display: grid;
  }
  small {
    font-size: 11px;
  }
  .party.on {
    border-color: #ffd166;
    color: #ffd166;
  }
  a.btn {
    text-decoration: none;
    color: inherit;
  }
</style>
