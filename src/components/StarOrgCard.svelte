<script lang="ts">
  /**
   * Settings → Integrations → StarOrg Tools: connect / disconnect, who StarOrg knows you as, the last send, *Send
   * hangar now*, the site (production / dev, fixed while connected), and the Auto-sync / Send pledge values switches.
   * Shown only while the *StarOrg Tools* switch above it is on. Every network call is in `lib/starorg.ts` and runs only
   * while connected. *What is sent* lists every field from `STARORG_FIELDS` before connecting; *Preview* builds the exact
   * body locally (`previewPayload`: a send's own checks and messages, no token, no StarOrg request) and shows it — in screenshare mode with the handle, ship names
   * and values masked on screen (*Copy JSON* still copies the real body).
   */
  import { connect, currentAuth, disconnect, originOf, usableAuth, previewPayload, requestCostAccess, sendHangar, status, STARORG_FIELDS, STARORG_TARGETS, type StarOrgAuth, type StarOrgSync, type StarOrgTarget, type SyncPayload } from '@/lib/starorg';
  import { catalogItem, getSettings, patchSettings, settingsItem, starorgItem, starorgSyncItem, type Settings } from '@/lib/settings';
  import { STARORG_TOGGLES } from '@/lib/settings-ui';
  import { bg } from '@/lib/messages';
  import { ago, fmtDateTime } from '@/lib/dates';
  import { MASK, own, privacy } from '@/lib/privacy.svelte';
  import { transient } from '@/lib/flash.svelte';
  import { LINK } from '@/lib/ui';
  import { Button } from '@/components/ui/button';
  import * as Alert from '@/components/ui/alert';
  import * as Collapsible from '@/components/ui/collapsible';
  import * as Dialog from '@/components/ui/dialog';
  import * as Select from '@/components/ui/select';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import SwitchRow from './SwitchRow.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import HintBadge from './HintBadge.svelte';
  import LazyTip from './LazyTip.svelte';

  let auth = $state<StarOrgAuth | null>(null);
  let sync = $state<StarOrgSync | null>(null);
  let s = $state<Settings | null>(null);
  let busy = $state<'connect' | 'send' | 'disconnect' | 'preview' | null>(null);
  let error = $state<string | null>(null);
  /** StarOrg's own record of the last push per RSI handle (GET /sync), newest first. */
  let remote = $state<{ rsi_handle: string; last_sync_at: string | null }[] | null>(null);

  $effect(() => {
    // currentAuth: an expired token reads as (and is forgotten as) not connected, so the card never shows a dead one.
    currentAuth().then((v) => (auth = v));
    starorgSyncItem.getValue().then((v) => (sync = v));
    getSettings().then((v) => (s = v));
    const offs = [
      starorgItem.watch((v) => (auth = usableAuth(v) ? v : null)),
      starorgSyncItem.watch((v) => (sync = v)),
      settingsItem.watch(() => getSettings().then((v) => (s = v))),
    ];
    return () => offs.forEach((off) => off());
  });

  // StarOrg's view of the last sync, refreshed when the connection or our last send changes.
  const connectedToken = $derived(auth?.token ?? '');
  const syncAt = $derived(sync?.at ?? 0);
  $effect(() => {
    void syncAt;
    if (!connectedToken) {
      remote = null;
      return;
    }
    let live = true;
    status().then((r) => live && (remote = r));
    return () => (live = false);
  });

  async function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    if (!s) return;
    s = { ...s, [k]: v };
    await patchSettings({ [k]: v } as Partial<Settings>);
  }
  /** Switch handler. *Send pledge values* on asks Firefox for the financial data category first, inside this click. */
  function toggle<K extends keyof Settings>(k: K, v: Settings[K]) {
    if (k !== 'starorgSendCost' || !v) return void set(k, v);
    error = null;
    requestCostAccess().then((ok) => {
      if (ok) set(k, v);
      else {
        error = 'The browser did not allow sending pledge values, so that stays off.';
        if (s) s = { ...s }; // re-render the switch as off
      }
    });
  }
  const unknownHulls = $derived(sync?.ok && sync.notFound?.length ? sync.notFound : null);

  async function run(kind: NonNullable<typeof busy>, task: () => Promise<unknown>) {
    busy = kind;
    error = null;
    try {
      await task();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = null;
    }
  }
  const targets = Object.entries(STARORG_TARGETS).map(([id, t]) => ({ id: id as StarOrgTarget, label: t.label }));
  /** The site shown: the connected token's, else the setting. */
  const origin = $derived(auth?.origin ?? originOf(s?.starorgTarget ?? 'prod'));
  const targetLabel = $derived(targets.find((t) => originOf(t.id) === origin)?.label ?? origin);
  // connect() asks for the host permission first, synchronously inside this click (browsers need the gesture).
  const onConnect = () => run('connect', () => connect(s?.starorgTarget ?? 'prod'));
  const onDisconnect = () => run('disconnect', disconnect);
  const loadCatalog = async () => ((await catalogItem.getValue()) ?? (await bg({ type: 'catalog:get' }))).ships;
  const onSend = () =>
    run('send', async () => {
      const r = await sendHangar(loadCatalog);
      if (!r) error = 'Not connected to StarOrg Tools.';
    });

  /** The body a send would carry, as last previewed. */
  let preview = $state<SyncPayload | null>(null);
  let previewOpen = $state(false);
  const copied = transient(2000);
  const onPreview = () =>
    run('preview', async () => {
      const r = await previewPayload(loadCatalog);
      if ('error' in r) throw new Error(r.error);
      preview = r.payload;
      previewOpen = true;
    });
  /** Screenshare: the handle, ship names and values are masked on screen only. */
  const previewText = $derived(
    !preview
      ? ''
      : JSON.stringify(
          privacy.on
            ? { ...preview, rsi_handle: MASK, rows: preview.rows.map((r) => ({ ...r, ship_name: MASK, pledge_cost: r.pledge_cost && `$${MASK}` })) }
            : preview,
          null,
          2,
        ),
  );
  async function onCopy() {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(preview, null, 2));
      copied.show('Copied');
    } catch {
      copied.show('Copy blocked — select the text instead');
    }
  }

  const lastRemote = $derived(remote?.[0] ?? null);
</script>

<div class="grid gap-3 rounded-lg border p-3">
  <div class="flex flex-wrap items-center gap-2">
    <h4 class="font-medium">StarOrg Tools</h4>
    {#if auth}<HintBadge variant="success" size="xs" hint={`Signed in until ${fmtDateTime(auth.expiresAt)}`}>connected</HintBadge>{/if}
    <div class="ml-auto flex flex-wrap items-center gap-2">
      {#if auth}
        <Button size="sm" onclick={onSend} disabled={busy !== null}>{busy === 'send' ? 'Sending…' : 'Send hangar now'}</Button>
        <ConfirmButton size="sm" variant="outline" onconfirm={onDisconnect} disabled={busy !== null}>Disconnect</ConfirmButton>
      {:else}
        <Button size="sm" onclick={onConnect} disabled={busy !== null || !s}>{busy === 'connect' ? 'Connecting…' : 'Connect'}</Button>
      {/if}
    </div>
  </div>

  <p class="text-muted-foreground text-xs">
    Optional: connect <a class={LINK} href={origin} target="_blank" rel="noopener noreferrer">StarOrg Tools</a> to send your ship list (each ship's model and maker, the name you gave it, LTI / warbond / insurance, pledge number and title; pledge values only if you turn that on) with your RSI handle. Nothing is sent until you press Connect, and nothing else from RSI is ever sent.
  </p>

  <Collapsible.Root>
    <Collapsible.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="link" size="xs" class="h-auto justify-self-start p-0">
          <ChevronDown class="transition-transform [[data-state=closed]>&]:-rotate-90" aria-hidden="true" />What is sent
        </Button>
      {/snippet}
    </Collapsible.Trigger>
    <Collapsible.Content class="grid gap-2 pt-2 text-xs">
      <p class="text-muted-foreground">
        Each send is one request to {origin}/api/fleet/hangar/sync, carrying your StarOrg sign-in token and this, exactly:
      </p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {#each Object.entries(STARORG_FIELDS.top) as [k, d] (k)}<dt><code>{k}</code></dt><dd class="text-muted-foreground">{d}</dd>{/each}
      </dl>
      <p class="text-muted-foreground">Each ship row (pledged hulls, plus the ships you added on <em>My ships</em>):</p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {#each Object.entries(STARORG_FIELDS.row) as [k, d] (k)}<dt><code>{k}</code></dt><dd class="text-muted-foreground">{d}</dd>{/each}
      </dl>
      <p class="text-muted-foreground">
        Never sent: pledge dates, store credit, buyback, orders or billing, the rest of a pledge (paints, gear, upgrades), your labels, Spectrum, friends, other saved logins, or your RSI cookies or RSI login. RSI+'s requests carry no cookies; only the sign-in window, an ordinary StarOrg / Discord page, uses StarOrg's and Discord's own. Besides sending, RSI+ talks to StarOrg Tools only to sign you in, to ask when it last got your hangar, and to sign out.
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onclick={onPreview} disabled={busy !== null}>{busy === 'preview' ? 'Building…' : 'Preview'}</Button>
        <span class="text-muted-foreground">Builds what a send would contain now, here in the browser. Nothing is sent.</span>
      </div>
    </Collapsible.Content>
  </Collapsible.Root>

  <Dialog.Root bind:open={previewOpen}>
    <Dialog.Content class="sm:max-w-2xl">
      <Dialog.Header>
        <Dialog.Title>What a send would contain</Dialog.Title>
        <Dialog.Description>
          {preview?.rows.length ?? 0} ship row{preview?.rows.length === 1 ? '' : 's'}, built here from your saved hangar. Nothing was sent.{#if privacy.on} Screenshare mode: your handle, ship names and values are masked here; <em>Copy JSON</em> copies the real list.{/if}
        </Dialog.Description>
      </Dialog.Header>
      <pre class="bg-muted max-h-[60vh] overflow-auto rounded-md p-3 text-xs">{previewText}</pre>
      <Dialog.Footer>
        {#if copied.text}<span class="text-muted-foreground self-center text-xs" role="status">{copied.text}</span>{/if}
        <Button size="sm" variant="outline" onclick={onCopy}>Copy JSON</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <div class="flex flex-wrap items-center gap-2 text-sm">
    <span id="starorg-site" class="text-muted-foreground">Site</span>
    <Select.Root type="single" value={s?.starorgTarget ?? 'prod'} onValueChange={(v) => v && set('starorgTarget', v as StarOrgTarget)} disabled={!!auth || busy !== null || !s}>
      <Select.Trigger size="sm" class="min-w-44" aria-labelledby="starorg-site">{targetLabel}</Select.Trigger>
      <Select.Content>
        {#each targets as t (t.id)}<Select.Item value={t.id} label={t.label}>{t.label}</Select.Item>{/each}
      </Select.Content>
    </Select.Root>
    {#if auth}<span class="text-muted-foreground text-xs">Disconnect to switch sites.</span>{/if}
  </div>

  {#if auth}
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt class="text-muted-foreground">StarOrg user</dt>
      <dd>{own(auth.user.username)}</dd>
      <dt class="text-muted-foreground">RSI handle</dt>
      <dd class="flex flex-wrap items-center gap-2">
        {#if auth.user.rsi_handle}
          {own(auth.user.rsi_handle)}
          {#if auth.user.rsi_verified}<HintBadge variant="success" size="xs" hint="Verified on StarOrg Tools: only this handle (or another verified one) can send">verified</HintBadge>{:else}<HintBadge variant="warning" size="xs" hint="Not verified on StarOrg Tools: any handle you send is accepted until you verify one">unverified</HintBadge>{/if}
        {:else}
          <span class="text-muted-foreground">none set on StarOrg Tools</span>
        {/if}
      </dd>
      <dt class="text-muted-foreground">Last send</dt>
      <dd>
        {#if sync}
          <LazyTip tip={fmtDateTime(sync.at)}>
            {#snippet trigger({ props })}<button type="button" {...props} class={sync?.ok ? '' : 'text-destructive'}>{ago(sync!.at)} — {sync!.message}</button>{/snippet}
          </LazyTip>
        {:else if lastRemote?.last_sync_at}
          <span>{ago(Date.parse(lastRemote.last_sync_at))} (as {own(lastRemote.rsi_handle)})</span>
        {:else}
          <span class="text-muted-foreground">never</span>
        {/if}
      </dd>
    </dl>
    {#if unknownHulls}
      <Alert.Root variant="warning">
        <Alert.Description>
          {sync?.unmatched ?? unknownHulls.length} hull{(sync?.unmatched ?? unknownHulls.length) === 1 ? '' : 's'} StarOrg Tools doesn't know yet (not imported): {unknownHulls.join(', ')}{(sync?.unmatched ?? 0) > unknownHulls.length ? ', …' : ''}
        </Alert.Description>
      </Alert.Root>
    {/if}
    {#if sync?.verifiedHandles}
      <Alert.Root variant="warning"><Alert.Description>{sync.message}</Alert.Description></Alert.Root>
    {/if}
  {/if}

  {#if error}<Alert.Root variant="destructive"><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}

  {#if s}
    <div class="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {#each STARORG_TOGGLES as t (t.key)}
        <SwitchRow id={`set-${t.key}`} label={t.label} hint={t.hint} checked={!!s[t.key]} onchange={(v) => toggle(t.key, v as never)} />
      {/each}
    </div>
  {/if}
</div>
