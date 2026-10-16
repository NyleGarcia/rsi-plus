<script lang="ts">
  /** Hub → Settings: appearance of the extension pages (theme / accent) and the Spectrum / site options the popup also shows. */
  import { ACCENTS, MODES, PALETTES, readTheme, resolveMode, saveTheme, type Accent, type Palette, type ThemePrefs } from '@/lib/theme';
  import { getSettings, patchSettings, settingsItem, type Settings } from '@/lib/settings';
  import { bg } from '@/lib/messages';
  import Segmented from './Segmented.svelte';
  import * as Card from '@/components/ui/card';
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import * as Select from '@/components/ui/select';
  import { Switch } from '@/components/ui/switch';
  import { Input } from '@/components/ui/input';
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
  const TOGGLES: { key: keyof Settings; label: string; hint?: string }[] = [
    { key: 'readTracking', label: 'Read tracking', hint: '"+N new" badges, read threads dimmed' },
    { key: 'hideRead', label: 'Hide read threads', hint: 'Unless they have new replies, are pinned or watched' },
    { key: 'devHighlight', label: 'Highlight dev posts' },
    { key: 'keyboard', label: 'Keyboard shortcuts', hint: 'Press ? on Spectrum' },
    { key: 'theme', label: 'Modern theme on Spectrum', hint: 'Spacing, readable widths, softer chrome on the RSI site itself' },
    { key: 'wide', label: 'Full-width threads' },
    { key: 'compact', label: 'Compact replies' },
    { key: 'muteReplies', label: 'Collapse replies by muted authors' },
    { key: 'pollAuto', label: 'Check watches automatically', hint: 'Off = passive: no background checks or traffic; the Feed updates only when you press Check now' },
    { key: 'notify', label: 'Desktop notifications' },
    { key: 'notifyAllFriends', label: 'Notify for every friend coming online', hint: 'Otherwise only friends marked with the bell' },
    { key: 'partySound', label: 'Ding on party auto-accept', hint: 'Short sound when party mode accepts a request' },
    { key: 'siteBar', label: 'RSI+ bar on store & account pages' },
  ];
</script>

<div class="grid gap-4">
  <Card.Root>
    <Card.Header>
      <Card.Title><h2 class="m-0 text-lg font-semibold">Appearance</h2></Card.Title>
      <Card.Description>The hub and the popup. RSI's own pages are not touched (Spectrum has its own toggle below).</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <div class="grid gap-1.5">
        <span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Theme</span>
        <Segmented options={MODES} value={theme.mode} ariaLabel="Theme" onchange={(v) => setTheme({ mode: v })} />
      </div>
      <div class="grid gap-1.5">
        <span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Surfaces · {shownMode}</span>
        <ToggleGroup.Root type="single" variant="outline" size="sm" spacing={1} class="flex-wrap" aria-label="Surface palette" bind:value={() => palette, (v) => v && setPalette(v as Palette)}>
          {#each palettes as p (p.id)}
            <ToggleGroup.Item value={p.id} class={cn('h-9 gap-2 rounded-lg px-2.5 text-xs', palette === p.id && 'border-primary')} title={p.hint} aria-label={p.label}>
              <span class="inline-flex overflow-hidden rounded-md ring-1 ring-black/20"><span class="block size-4" style={`background:${p.swatch[0]}`}></span><span class="block size-4" style={`background:${p.swatch[1]}`}></span></span>
              {p.label}
              {#if palette === p.id}<Check class="size-3" />{/if}
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
        <span class="text-muted-foreground text-xs">Background, cards, sidebar and borders. Dark and light each remember their own.</span>
      </div>
      <div class="grid gap-1.5">
        <span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Accent</span>
        <ToggleGroup.Root type="single" variant="outline" size="sm" spacing={1} class="flex-wrap" aria-label="Accent colour" bind:value={() => theme.accent, (v) => v && setTheme({ accent: v as Accent })}>
          {#each accentNames as a (a)}
            <ToggleGroup.Item value={a} class={cn('h-8 gap-1.5 rounded-full px-2.5 text-xs capitalize', theme.accent === a && 'border-primary')} aria-label={a}>
              <span class="inline-block size-3.5 rounded-full ring-1 ring-black/20" style={`background:${ACCENTS[a]}`}></span>
              {a}
              {#if theme.accent === a}<Check class="size-3" />{/if}
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
      </div>
      <div class="flex flex-wrap items-center gap-3 text-xs">
        <span class="text-muted-foreground">Preview:</span>
        <Button size="sm">Primary</Button>
        <Button size="sm" variant="outline">Outline</Button>
        <a class="text-primary hover:underline" href="#settings">a link</a>
        <span class="text-success">success</span>
        <span class="text-warning">warning</span>
        <span class="text-destructive">destructive</span>
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title><h2 class="m-0 text-lg font-semibold">Privacy</h2></Card.Title>
      <Card.Description>Also the eye button in the header, and in the popup.</Card.Description>
    </Card.Header>
    <Card.Content>
      <label class="flex items-start gap-2.5 text-sm">
        <Switch id="set-privacy" class="mt-px" checked={privacy.on} onCheckedChange={setPrivacy} />
        <span class="grid leading-tight">
          <span>Screenshare mode</span>
          <span class="text-muted-foreground text-xs">Hides what is yours: spend and melt values, store credit, buyback prices, spend charts, account names. Store prices and ship names stay readable.</span>
        </span>
      </label>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title><h2 class="m-0 text-lg font-semibold">Spectrum, notifications, site</h2></Card.Title>
      <Card.Description>Synced with your browser profile; the same switches live in the popup.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if !s}
        <span class="text-muted-foreground text-xs">Loading…</span>
      {:else}
        <div class="grid gap-2 sm:grid-cols-2">
          {#each TOGGLES as t (t.key)}
            <label class="flex items-start gap-2.5 text-sm">
              <Switch id={`set-${t.key}`} class="mt-px" checked={!!s[t.key]} onCheckedChange={(v) => set(t.key, v as never)} />
              <span class="grid leading-tight">
                <span>{t.label}</span>
                {#if t.hint}<span class="text-muted-foreground text-xs">{t.hint}</span>{/if}
              </span>
              {#if t.key === 'partySound'}<Button variant="outline" size="icon-xs" title="Play it" aria-label="Play the ding" onclick={() => bg({ type: 'sound:ding' }).catch(() => {})}>♪</Button>{/if}
            </label>
          {/each}
        </div>
        <div class="mt-2 grid gap-3 sm:grid-cols-3">
          <label class="grid gap-1 text-sm">
            <span>Muted threads</span>
            <Select.Root type="single" bind:value={() => s!.muteMode, (v) => set('muteMode', v as Settings['muteMode'])}>
              <Select.Trigger aria-label="Muted threads">{s.muteMode === 'hide' ? 'Removed from lists' : 'Collapsed to one faint line'}</Select.Trigger>
              <Select.Content>
                <Select.Item value="dim" label="Collapsed to one faint line" />
                <Select.Item value="hide" label="Removed from lists" />
              </Select.Content>
            </Select.Root>
          </label>
          <label class="grid gap-1 text-sm">
            <span>Watch poll interval (minutes){#if !s.pollAuto} <span class="text-muted-foreground">— off: passive, Check now only</span>{/if}</span>
            <Input type="number" min="2" step="1" disabled={!s.pollAuto} value={s.pollMinutes} onchange={(e) => set('pollMinutes', Math.max(2, Number((e.currentTarget as HTMLInputElement).value) || 5))} />
          </label>
          <label class="grid gap-1 text-sm">
            <span>Party reminder after (hours, 0 = never)</span>
            <Input type="number" min="0" step="1" value={s.partyRemindHours} onchange={(e) => set('partyRemindHours', Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0))} />
          </label>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
