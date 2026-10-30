<script lang="ts">
  /**
   * Settings → Integrations → StarOrg Tools: connect / disconnect, who StarOrg knows you as, the last send, *Send
   * hangar now*, the site (production / dev, fixed while connected), and the Auto-sync / Send pledge values switches.
   * Shown only while the *StarOrg Tools* switch above it is on. Every network call is in `lib/starorg.ts` and runs only
   * while connected.
   */
  import { connect, currentAuth, disconnect, originOf, usableAuth, requestCostAccess, sendHangar, status, STARORG_TARGETS, type StarOrgAuth, type StarOrgSync, type StarOrgTarget } from '@/lib/starorg';
  import { catalogItem, getSettings, patchSettings, settingsItem, starorgItem, starorgSyncItem, type Settings } from '@/lib/settings';
  import { STARORG_TOGGLES } from '@/lib/settings-ui';
  import { bg } from '@/lib/messages';
  import { ago, fmtDateTime } from '@/lib/dates';
  import { own } from '@/lib/privacy.svelte';
  import { LINK } from '@/lib/ui';
  import { Button } from '@/components/ui/button';
  import * as Alert from '@/components/ui/alert';
  import * as Select from '@/components/ui/select';
  import SwitchRow from './SwitchRow.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import HintBadge from './HintBadge.svelte';
  import LazyTip from './LazyTip.svelte';

  let auth = $state<StarOrgAuth | null>(null);
  let sync = $state<StarOrgSync | null>(null);
  let s = $state<Settings | null>(null);
  let busy = $state<'connect' | 'send' | 'disconnect' | null>(null);
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
  const onSend = () =>
    run('send', async () => {
      const r = await sendHangar(async () => ((await catalogItem.getValue()) ?? (await bg({ type: 'catalog:get' }))).ships);
      if (!r) error = 'Not connected to StarOrg Tools.';
    });

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
    Optional: connect <a class={LINK} href={origin} target="_blank" rel="noopener noreferrer">StarOrg Tools</a> to send your ship list (hull, nickname, LTI / warbond / insurance, pledge id and pledge name; pledge values only if you turn that on). Off until you press Connect; nothing else ever leaves RSI.
  </p>

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
