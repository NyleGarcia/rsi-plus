<script lang="ts">
  import { bg, type HubTab } from '@/lib/messages';
  import { INCOGNITO, feedItem, getSettings, partyModeItem, patchSettings, type Settings } from '@/lib/settings';
  import { partyActive, type PartyMode } from '@/lib/friends';
  import AccountSwitch from '@/components/AccountSwitch.svelte';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import { Switch } from '@/components/ui/switch';
  import { Label } from '@/components/ui/label';
  import { cn } from '@/lib/utils';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import PartyPopper from '@lucide/svelte/icons/party-popper';
  import { privacy, setPrivacy } from '@/lib/privacy.svelte';

  const NAV: { tab: HubTab; label: string }[] = [
    { tab: 'feed', label: 'Feed' },
    { tab: 'friends', label: 'Friends' },
    { tab: 'hangar', label: 'Pledges' },
    { tab: 'melt', label: 'Melt calculator' },
    { tab: 'fleet', label: 'My ships' },
    { tab: 'wallet', label: 'Wallet' },
    { tab: 'store', label: 'Ship catalog' },
    { tab: 'browse', label: 'Browse store' },
    { tab: 'ccu', label: 'CCU planner' },
    { tab: 'paint-rebuy', label: 'Paint rebuy' },
    { tab: 'watching', label: 'Watching' },
    { tab: 'settings', label: 'Settings' },
  ];

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
    { key: 'pollAuto', label: 'Check watches automatically', hint: 'Off = passive: no background checks, the Feed updates only on Check now' },
    { key: 'notify', label: 'Desktop notifications' },
    { key: 'partySound', label: 'Ding on party auto-accept', hint: 'Short sound when party mode accepts a request' },
    { key: 'siteBar', label: 'RSI+ bar on store & account pages' },
  ];
</script>

<Tooltip.Provider delayDuration={300}>
  <main class="grid w-[300px] gap-3.5 p-3.5">
    <header class="flex items-center justify-between gap-2">
      <h1 class="m-0 flex items-center gap-1.5 text-[17px] font-semibold">
        <span>RSI<span class="text-primary">+</span></span>
        {#if INCOGNITO}<Badge variant="outline" class="text-muted-foreground h-[17px] rounded-md px-1.5 text-[10px]" title="Incognito: separate login, friends, hangar, reads and party mode">incognito</Badge>{/if}
      </h1>
      <Button variant="outline" size="xs" href="https://robertsspaceindustries.com/spectrum/community/SC" target="_blank" rel="noopener">Spectrum<ExternalLink aria-hidden="true" /></Button>
    </header>
    <AccountSwitch compact />

    <nav class="grid grid-cols-2 gap-1.5">
      {#each NAV as n (n.tab)}
        <Button variant="outline" size="sm" onclick={() => open(n.tab)}>{n.label}{n.tab === 'feed' && unseen ? ` (${unseen})` : ''}</Button>
      {/each}
    </nav>

    <Button
      variant="outline"
      class={cn(partyOn && 'border-warning text-warning hover:text-warning dark:border-warning')}
      onclick={toggleParty}
      title="Auto-accept friend requests (2 h) — details & log in Friends"
    >
      <PartyPopper aria-hidden="true" />
      {partyOn ? `Party mode ON${party?.until ? ` until ${new Date(party.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} — stop` : 'Start party mode (2 h)'}
    </Button>

    {#if s}
      <section class="grid gap-0.5">
        <div class="flex items-start gap-2.5 px-0.5 py-1.5">
          <Switch id="set-privacy" class="mt-px" checked={privacy.on} onCheckedChange={setPrivacy} />
          <Label for="set-privacy" class="grid flex-1 cursor-pointer gap-0.5 leading-snug font-normal">
            <span>Screenshare mode</span>
            <small class="text-muted-foreground text-[11px]">Hides spend, store credit and account names in the hub</small>
          </Label>
        </div>
        {#each TOGGLES as t (t.key)}
          <div class="flex items-start gap-2.5 px-0.5 py-1.5">
            <Switch id={`set-${t.key}`} class="mt-px" checked={!!s[t.key]} onCheckedChange={(v) => set(t.key, v as never)} />
            <Label for={`set-${t.key}`} class="grid flex-1 cursor-pointer gap-0.5 leading-snug font-normal">
              <span>{t.label}</span>
              {#if t.hint}<small class="text-muted-foreground text-[11px]">{t.hint}</small>{/if}
            </Label>
            {#if t.key === 'partySound'}<Button variant="outline" size="icon-xs" title="Play it" aria-label="Play the ding" onclick={() => bg({ type: 'sound:ding' }).catch(() => {})}>♪</Button>{/if}
          </div>
        {/each}
      </section>
    {/if}
  </main>
</Tooltip.Provider>
