<script lang="ts">
  /**
   * Toolbar popup (300 px wide, no scrollbar at ~600 px): who you are, a door into the hub (Open RSI+ + the pages marked
   * `popup` in lib/hub-pages), party mode, and the few switches people flip often (`quick` in lib/settings-ui). Hints
   * and every other setting live on the hub Settings page.
   */
  import FanNotice from '@/components/FanNotice.svelte';
  import { bg, type HubTab } from '@/lib/messages';
  import { INCOGNITO, feedItem, getSettings, partyModeItem, patchSettings, storeLogItem, type Settings } from '@/lib/settings';
  import { cleanLog, tally } from '@/lib/storelog';
  import { partyActive, type PartyMode } from '@/lib/friends';
  import { HUB_PAGES } from '@/lib/hub-pages';
  import { QUICK_TOGGLES } from '@/lib/settings-ui';
  import AccountSwitch from '@/components/AccountSwitch.svelte';
  import HintBadge from '@/components/HintBadge.svelte';
  import SwitchRow from '@/components/SwitchRow.svelte';
  import TipButton from '@/components/TipButton.svelte';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import { cn } from '@/lib/utils';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import PartyPopper from '@lucide/svelte/icons/party-popper';
  import { privacy, setPrivacy } from '@/lib/privacy.svelte';

  const SHORTCUTS = HUB_PAGES.filter((p) => p.popup);

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
    storeLogItem.getValue().then((v) => {
      const n = tally(cleanLog(v));
      unseen += n.add + n.remove;
    });
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
</script>

<Tooltip.Provider delayDuration={300}>
  <main class="grid w-[300px] gap-2.5 p-3">
    <header class="flex items-center justify-between gap-2">
      <h1 class="m-0 flex items-center gap-1.5 text-[17px] font-semibold">
        <span>RSI<span class="text-primary">+</span></span>
        {#if INCOGNITO}<HintBadge variant="muted" class="h-[17px] rounded-md px-1.5 text-[10px]" hint="Incognito: separate login, friends, hangar, reads and party mode">incognito</HintBadge>{/if}
      </h1>
      <Button variant="outline" size="xs" href="https://robertsspaceindustries.com/spectrum/community/SC" target="_blank" rel="noopener">Spectrum<ExternalLink aria-hidden="true" /></Button>
    </header>
    <AccountSwitch compact />

    <nav class="grid gap-1.5" aria-label="Hub pages">
      <Button onclick={() => open('feed')}>Open RSI+</Button>
      <div class="grid grid-cols-3 gap-1">
        {#each SHORTCUTS as p (p.tab)}
          <Button variant="ghost" size="sm" class="justify-start gap-1.5 px-1.5" onclick={() => open(p.tab)} aria-label={p.tab === 'feed' && unseen ? `${p.label}, ${unseen} unseen` : p.label}>
            <p.icon aria-hidden="true" />
            <span class="truncate">{p.short ?? p.label}</span>
            {#if p.tab === 'feed' && unseen}<Badge variant="success-soft" class="ml-auto h-4 px-1 tabular-nums">{unseen > 99 ? '99+' : unseen}</Badge>{/if}
          </Button>
        {/each}
      </div>
    </nav>

    <TipButton
      variant="outline"
      size="sm"
      class={cn(partyOn && 'border-warning text-warning hover:text-warning dark:border-warning')}
      onclick={toggleParty}
      tip="Auto-accept friend requests (2 h) — details & log in Friends"
    >
      <PartyPopper aria-hidden="true" />
      {partyOn ? `Party mode ON${party?.until ? ` until ${new Date(party.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} — stop` : 'Start party mode (2 h)'}
    </TipButton>

    {#if s}
      <section class="grid" aria-label="Quick settings">
        <SwitchRow id="set-privacy" size="sm" class="py-0.5" label="Screenshare mode" checked={privacy.on} onchange={setPrivacy} />
        {#each QUICK_TOGGLES as t (t.key)}
          <SwitchRow id={`set-${t.key}`} size="sm" class="py-0.5" label={t.label} checked={!!s[t.key]} onchange={(v) => set(t.key, v as never)} />
        {/each}
        <Button variant="link" size="xs" class="h-auto justify-self-start p-0 pt-1" onclick={() => open('settings')}>All settings →</Button>
      </section>
    {/if}
    <FanNotice variant="popup" class="border-t pt-2.5" />
  </main>
</Tooltip.Provider>
