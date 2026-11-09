<script lang="ts">
  /** Hub → Settings: appearance of the extension pages (theme / accent) and the Spectrum / site options the popup also shows. */
  import { ACCENTS, MODES, PALETTES, readTheme, resolveMode, saveTheme, type Accent, type Palette, type ThemePrefs } from '@/lib/theme';
  import { getSettings, patchSettings, settingsItem, type Settings } from '@/lib/settings';
  import { MUTE_MODES, PARTY_REMIND, POLL_MINUTES, SETTING_TOGGLES, STARORG_SWITCH, clampSetting, type NumberSetting } from '@/lib/settings-ui';
  import { bg } from '@/lib/messages';
  import { CURRENCIES } from '@/lib/currency';
  import Segmented from './Segmented.svelte';
  import SwitchRow from './SwitchRow.svelte';
  import StarOrgCard from './StarOrgCard.svelte';
  import TipButton from './TipButton.svelte';
  import LazyTip from './LazyTip.svelte';
  import { LINK } from '@/lib/ui';
  import * as Card from '@/components/ui/card';
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import { Input } from '@/components/ui/input';
  import { IC_HOSTS, IC_ORIGIN } from '@/lib/issue-council';
  import { IMPOUND_HOSTS, IMPOUND_ORIGIN } from '@/lib/impound';
  import { Label } from '@/components/ui/label';
  import { Button } from '@/components/ui/button';
  import { cn } from '@/lib/utils';
  import { privacy, setPrivacy } from '@/lib/privacy.svelte';
  import Check from '@lucide/svelte/icons/check';

  let theme = $state<ThemePrefs>(readTheme());
  const setTheme = (patch: Partial<ThemePrefs>) => saveTheme((theme = { ...theme, ...patch }));
  const accentNames = Object.keys(ACCENTS) as Accent[];
  /** Palettes for the mode on screen now (system → whichever the OS resolves to). */
  const shownMode = $derived(resolveMode(theme.mode));
  const palettes = $derived(PALETTES.filter((p) => p.mode === shownMode));
  const palette = $derived(shownMode === 'dark' ? theme.dark : theme.light);
  const setPalette = (id: Palette) => setTheme(shownMode === 'dark' ? { dark: id } : { light: id });

  let s = $state<Settings | null>(null);
  $effect(() => {
    getSettings().then((v) => (s = v));
    return settingsItem.watch(() => getSettings().then((v) => (s = v)));
  });
  async function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    if (!s) return;
    s = { ...s, [k]: v };
    await patchSettings({ [k]: v } as Partial<Settings>);
  }
  const caption = 'text-muted-foreground text-xs font-semibold tracking-wide uppercase';

  /**
   * Issue Council: on asks this browser for the optional host first (inside the click: browsers only grant during a
   * user gesture, which an earlier await would end), then saves the setting and has the background register the
   * content script. Off saves, drops the host and unregisters. Settings sync, grants don't: a device where the setting
   * came on through sync shows *Grant access* instead.
   */
  let icGranted = $state<boolean | null>(null);
  let icMsg = $state('');
  $effect(() => {
    browser.permissions.contains({ origins: IC_HOSTS }).then((v) => (icGranted = v), () => (icGranted = false));
  });
  function grantIssueCouncil() {
    icMsg = '';
    browser.permissions.request({ origins: IC_HOSTS }).then(
      async (ok) => {
        icGranted = ok;
        if (!ok) return void (icMsg = 'Access not granted, so RSI+ stays off on the Issue Council.');
        await set('issueCouncil', true);
        await bg({ type: 'ic:sync' }).catch(() => {});
      },
      (e) => (icMsg = `Could not ask for access: ${(e as Error).message}`),
    );
  }
  function setIssueCouncil(v: boolean) {
    if (v) return grantIssueCouncil();
    icMsg = '';
    set('issueCouncil', false)
      .then(() => browser.permissions.remove({ origins: IC_HOSTS }).catch(() => false))
      .then(() => ((icGranted = false), bg({ type: 'ic:sync' }).catch(() => {})));
  }

  /** The Impound: same grant-in-the-click pattern as the Issue Council. */
  let impGranted = $state<boolean | null>(null);
  let impMsg = $state('');
  $effect(() => {
    browser.permissions.contains({ origins: IMPOUND_HOSTS }).then((v) => (impGranted = v), () => (impGranted = false));
  });
  function grantImpound() {
    impMsg = '';
    browser.permissions.request({ origins: IMPOUND_HOSTS }).then(
      async (ok) => {
        impGranted = ok;
        if (!ok) return void (impMsg = 'Access not granted, so RSI+ stays off on The Impound.');
        await set('impound', true);
        await bg({ type: 'imp:sync' }).catch(() => {});
      },
      (e) => (impMsg = `Could not ask for access: ${(e as Error).message}`),
    );
  }
  function setImpound(v: boolean) {
    if (v) return grantImpound();
    impMsg = '';
    set('impound', false)
      .then(() => browser.permissions.remove({ origins: IMPOUND_HOSTS }).catch(() => false))
      .then(() => ((impGranted = false), bg({ type: 'imp:sync' }).catch(() => {})));
  }

  let debugNames = $state(false);
  let debugStore = $state(false);
  let debugMsg = $state('');
  async function exportDebug() {
    debugMsg = 'Building…';
    try {
      const { downloadDebugFile } = await import('@/lib/debug-export');
      const bytes = await downloadDebugFile(debugNames, debugStore);
      debugMsg = `Saved (${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB).`;
    } catch (e) {
      debugMsg = `Export failed: ${(e as Error).message}`;
    }
  }
</script>

{#snippet swatch(value: string, label: string, colors: readonly string[], active: boolean, hint?: string)}
  {#snippet item(props: Record<string, unknown> = {})}
    <ToggleGroup.Item {...props} {value} class={cn('h-8 gap-2 rounded-lg px-2.5 text-xs', active && 'border-primary')} aria-label={label}>
      <span class="inline-flex overflow-hidden rounded-full ring-1 ring-foreground/20">{#each colors as c, i (i)}<span class="block size-3.5" style={`background:${c}`}></span>{/each}</span>
      {label}
      {#if active}<Check class="size-3" />{/if}
    </ToggleGroup.Item>
  {/snippet}
  <LazyTip tip={hint}>
    {#snippet trigger({ props })}{@render item(props)}{/snippet}
  </LazyTip>
{/snippet}

{#snippet numberField(n: NumberSetting, value: number, disabled = false)}
  <Label class="text-muted-foreground gap-1.5 font-normal">
    {n.label}
    <Input type="number" min={n.min} max={n.max} step="1" class="w-16" {disabled} {value} onchange={(e) => set(n.key, clampSetting(n, (e.currentTarget as HTMLInputElement).value))} />
    {n.unit}
  </Label>
{/snippet}

<div class="grid gap-4">
  <Card.Root>
    <Card.Header>
      <Card.Title>Appearance</Card.Title>
      <Card.Description>The hub and the popup. RSI's own pages are not touched (Spectrum has its own toggle below).</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <div class="grid gap-1.5">
        <span class={caption} aria-hidden="true">Theme</span>
        <Segmented options={MODES} value={theme.mode} ariaLabel="Theme" onchange={(v) => setTheme({ mode: v })} />
      </div>
      <div class="grid gap-1.5">
        <span id="set-surfaces" class={caption}>Surfaces · {shownMode}</span>
        <ToggleGroup.Root type="single" variant="outline" size="sm" spacing={1} class="flex-wrap" aria-labelledby="set-surfaces" bind:value={() => palette, (v) => v && setPalette(v as Palette)}>
          {#each palettes as p (p.id)}{@render swatch(p.id, p.label, p.swatch, palette === p.id, p.hint)}{/each}
        </ToggleGroup.Root>
        <span class="text-muted-foreground text-xs">Background, cards, sidebar and borders. Dark and light each remember their own.</span>
      </div>
      <div class="grid gap-1.5">
        <span id="set-accent" class={caption}>Accent</span>
        <ToggleGroup.Root type="single" variant="outline" size="sm" spacing={1} class="flex-wrap" aria-labelledby="set-accent" bind:value={() => theme.accent, (v) => v && setTheme({ accent: v as Accent })}>
          {#each accentNames as a (a)}{@render swatch(a, a[0]!.toUpperCase() + a.slice(1), [ACCENTS[a]], theme.accent === a)}{/each}
        </ToggleGroup.Root>
      </div>
      {#if s}
        <div class="grid gap-1.5">
          <span id="set-currency" class={caption}>Currency</span>
          <div class="flex flex-wrap items-center gap-3">
            <select aria-labelledby="set-currency" class="border-input bg-background h-8 rounded-md border px-2 text-sm" value={s.currency} onchange={(e) => set('currency', (e.currentTarget as HTMLSelectElement).value)}>
              {#each CURRENCIES as c (c)}<option value={c}>{c}</option>{/each}
            </select>
            {#if s.currency !== 'USD'}
              <Label class="text-muted-foreground gap-1.5 font-normal">
                1 USD =
                <Input type="number" min="0.0001" step="any" class="w-24" value={s.usdRate} onchange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (v > 0 && Number.isFinite(v)) set('usdRate', v); }} />
                {s.currency}
              </Label>
            {/if}
          </div>
          <span class="text-muted-foreground text-xs">RSI charges and lists everything in USD. Another currency converts amounts on screen with the rate you type (nothing is fetched), so they are estimates; exports stay USD. The page reloads when you change it.</span>
        </div>
      {/if}
      <div class="flex flex-wrap items-center gap-3 text-xs">
        <span class="text-muted-foreground">Preview:</span>
        <Button size="sm">Primary</Button>
        <Button size="sm" variant="outline">Outline</Button>
        <a class={LINK} href="#settings">a link</a>
        <span class="text-success">success</span>
        <span class="text-warning">warning</span>
        <span class="text-destructive">destructive</span>
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Privacy</Card.Title>
      <Card.Description>Also the eye button in the header, and in the popup.</Card.Description>
    </Card.Header>
    <Card.Content>
      <SwitchRow
        id="set-privacy"
        label="Screenshare mode"
        hint="Hides what is yours: spend and melt values, store credit, buyback prices, spend charts, account names. Store prices and ship names stay readable."
        checked={privacy.on}
        onchange={setPrivacy}
      />
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Spectrum, notifications, site</Card.Title>
      <Card.Description>Synced with your browser profile; the most used switches are also in the popup.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if !s}
        <span class="text-muted-foreground text-xs">Loading…</span>
      {:else}
        <div class="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {#each SETTING_TOGGLES as t (t.key)}
            <SwitchRow id={`set-${t.key}`} label={t.label} hint={t.hint} checked={!!s[t.key]} onchange={(v) => set(t.key, v as never)}>
              {#if t.key === 'partySound'}<TipButton variant="outline" size="icon-xs" tip="Play it" aria-label="Play the ding" onclick={() => bg({ type: 'sound:ding' }).catch(() => {})}>♪</TipButton>{/if}
              {#if t.key === 'pollAuto'}{@render numberField(POLL_MINUTES, s.pollMinutes, !s.pollAuto)}{/if}
            </SwitchRow>
          {/each}
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm" aria-hidden="true">Muted threads</span>
            <Segmented options={MUTE_MODES} value={s.muteMode} ariaLabel="Muted threads" onchange={(v) => set('muteMode', v)} />
          </div>
          {@render numberField(PARTY_REMIND, s.partyRemindHours)}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Integrations</Card.Title>
      <Card.Description>Optional connections to other sites. Each one is off until you turn it on here and connect it, and RSI+ talks to nothing but RSI until then.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if !s}
        <span class="text-muted-foreground text-xs">Loading…</span>
      {:else}
        <SwitchRow id={`set-${STARORG_SWITCH.key}`} label={STARORG_SWITCH.label} hint={STARORG_SWITCH.hint} checked={s.starorg} onchange={(v) => set('starorg', v)} />
        <!-- Off: the background signs out and forgets both contexts' tokens and drops the hosts (`disconnectAll`). -->
        {#if s.starorg}<StarOrgCard />{/if}
        <SwitchRow
          id="set-issueCouncil"
          label="Issue Council"
          hint="Read tracking, watches and a report helper on the Issue Council. Asks for access to issue-council.robertsspaceindustries.com; RSI+ only reads the pages you open there, never your login, and keeps everything in this browser"
          checked={s.issueCouncil && !!icGranted}
          onchange={(v) => setIssueCouncil(v)}
        />
        {#if s.issueCouncil && icGranted === false}
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-muted-foreground">On in your synced settings, but this browser hasn't granted access to the Issue Council.</span>
            <Button size="sm" variant="outline" onclick={grantIssueCouncil}>Grant access</Button>
          </div>
        {/if}
        {#if icMsg}<p class="text-destructive text-xs" role="status">{icMsg}</p>{/if}
        {#if s.issueCouncil && icGranted}
          <div class="grid gap-1.5 rounded-md border p-3 text-sm">
            <p class="text-muted-foreground text-xs">
              Open the <a class={LINK} href={`${IC_ORIGIN}/projects/STAR-CITIZEN/`} target="_blank" rel="noopener">Issue Council</a>: issue cards show <b>+N new</b> and status changes since your last visit, issue pages mark what's new, and ☆ watches an issue. Issues you reported, contributed to or follow there are tracked too. Changes reach the Feed when an Issue Council page shows them: nothing arrives while it's closed.
            </p>
            <SwitchRow
              id="set-icPatchNotify"
              label="Notify when patch notes fix a tracked issue"
              hint="When a Spectrum patch-notes thread you open lists the code of an issue you track under Bug Fixes. Matches by title words are only marked in the notes (maybe), never notified"
              checked={s.icPatchNotify}
              onchange={(v) => set('icPatchNotify', v)}
            />
          </div>
        {/if}
        <SwitchRow
          id="set-impound"
          label="The Impound"
          hint="On theimpound.com: the RSI price and markup on every listing, what you already own, and extra filters and sorting. Asks for access to theimpound.com; RSI+ reads its pages and public product data only, never your cart or account there, and sends nothing anywhere"
          checked={s.impound && !!impGranted}
          onchange={(v) => setImpound(v)}
        />
        {#if s.impound && impGranted === false}
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-muted-foreground">On in your synced settings, but this browser hasn't granted access to The Impound.</span>
            <Button size="sm" variant="outline" onclick={grantImpound}>Grant access</Button>
          </div>
        {/if}
        {#if impMsg}<p class="text-destructive text-xs" role="status">{impMsg}</p>{/if}
        {#if s.impound && impGranted}
          <p class="text-muted-foreground rounded-md border p-3 text-xs">
            Open <a class={LINK} href={IMPOUND_ORIGIN} target="_blank" rel="noopener">The Impound</a>: listings show the RSI price (the store price, the upgrade price, or MSRP when RSI doesn't sell it) and the markup, and mark ships, upgrades and items you own. A toolbar above each grid filters and sorts; <b>Whole collection</b> lists every page of a collection in one table. Owned marks use your hangar as last loaded in Pledges.
          </p>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Debug</Card.Title>
      <Card.Description>One JSON file with everything RSI+ keeps in this browser, including RSI's raw pledge fields, for bug reports. Tokens and cookies are never in it. Nothing is sent: you share the file yourself.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <SwitchRow id="set-debug-names" label="Include names" hint="Your handle, friends' handles, ship names you gave and notes. Off: they are written as [masked]." checked={debugNames} onchange={(v) => (debugNames = v)} />
      <SwitchRow id="set-debug-store" label="Include store data" hint="RSI's public catalog, paints, listings and store log — most of the file's size. Off: a count and date in their place. Turn on for store or CCU planner bugs." checked={debugStore} onchange={(v) => (debugStore = v)} />
      <div class="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onclick={exportDebug}>Export debug file</Button>
        {#if debugMsg}<span class="text-muted-foreground text-xs" role="status">{debugMsg}</span>{/if}
      </div>
    </Card.Content>
  </Card.Root>
</div>
