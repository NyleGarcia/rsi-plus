<script lang="ts">
  /** Profile chip: who you are, switch to a saved login, save the current one, forget one. Hub header + popup. */
  import { captureProfile, forgetProfile, logoutLocal, switchTo, whoAmI, type Profiles } from '@/lib/accounts';
  import { INCOGNITO, profilesItem } from '@/lib/settings';
  import * as Popover from '@/components/ui/popover';
  import * as Collapsible from '@/components/ui/collapsible';
  import { mergeProps } from 'bits-ui';
  import { Button } from '@/components/ui/button';
  import TipButton from './TipButton.svelte';
  import LazyTip from './LazyTip.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import Empty from './Empty.svelte';
  import { fmtDateTime } from '@/lib/dates';
  import { cn } from '@/lib/utils';
  import { own } from '@/lib/privacy.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import X from '@lucide/svelte/icons/x';

  let { compact = false }: { compact?: boolean } = $props();
  let ps = $state<Profiles>({ active: null, list: [] });
  let me = $state<{ handle: string; displayname: string } | null | undefined>(undefined); // undefined = checking
  let open = $state(false);
  let busy = $state('');
  let msg = $state('');
  /** Opened from an incognito window while the extension runs in spanning mode (the dev build): there is no
   *  separate incognito jar or storage here — everything acts on the regular window's login. */
  let spanning = $state(false);

  $effect(() => {
    profilesItem.getValue().then((v) => (ps = v));
    whoAmI().then((w) => (me = w));
    browser.windows
      .getCurrent()
      .then((w) => (spanning = !!w.incognito && !INCOGNITO))
      .catch(() => {});
    const off = profilesItem.watch((v) => (ps = v));
    return off;
  });
  const active = $derived(ps.list.find((p) => p.id === ps.active) ?? null);
  /** Logged-in handle differs from the active profile → the jar changed outside RSI+ (manual login). */
  const drift = $derived(me && active && me.handle !== active.handle);
  const label = $derived(me === undefined ? '…' : me ? me.displayname || me.handle : 'logged out');

  async function run(what: string, fn: () => Promise<string>) {
    busy = what;
    msg = '';
    try {
      msg = await fn();
    } catch (e) {
      msg = (e as Error).message;
    } finally {
      busy = '';
    }
  }
  const save = () =>
    run('save', async () => {
      const before = ps.active;
      const p = await captureProfile();
      if (before && before !== p.id) setTimeout(() => location.reload(), 600); // previous account's data got parked
      return `Saved ${p.displayname} (${p.cookies.length} cookies).`;
    });
  const go = (id: string) =>
    run(id, async () => {
      const r = await switchTo(id);
      if (!r.loggedInAs) return `Switched cookies, but RSI doesn't recognise them — log in as ${r.profile.displayname} on RSI, then Save here.`;
      setTimeout(() => location.reload(), 600); // every panel re-reads its (restored) data
      return `Now ${r.profile.displayname}. Reloading…`;
    });
  const forget = (id: string) =>
    run('forget', async () => {
      await forgetProfile(id);
      return 'Forgotten.';
    });
  const logout = () =>
    run('logout', async () => {
      await logoutLocal();
      me = null;
      return 'RSI cookies cleared here (saved profiles untouched).';
    });
</script>

{#snippet trigger(props: Record<string, unknown>)}
  <!-- Popover/Collapsible trigger props merged with the (lazy) Tooltip's into the Button. -->
  <LazyTip side="bottom" tip={drift ? `Logged in as ${own(me?.handle ?? '')}, but profile ${own(active?.handle ?? '')} is active — Save to update it` : 'Accounts'}>
    {#snippet trigger({ props: tip })}
        <Button {...mergeProps(props, tip)} variant="outline" size={compact ? 'xs' : 'sm'} class={cn('rounded-full font-semibold', drift || active?.stale ? 'border-warning/60 dark:border-warning/60' : '')}>
          <span class={cn('size-2 rounded-full bg-muted-foreground', me && 'bg-success', me === null && 'bg-destructive')} aria-hidden="true"></span>
          {#if me}<span class="sr-only">Logged in as</span>{:else if me === undefined}<span class="sr-only">Checking login</span>{/if}
          <span class="sens">{label}</span>{#if ps.list.length}<span class="text-muted-foreground font-medium"><span class="sr-only">, saved logins:</span>{ps.list.length}</span>{/if}
          <ChevronDown class="text-muted-foreground" aria-hidden="true" />
        </Button>
    {/snippet}
  </LazyTip>
{/snippet}

{#snippet menu()}
  <div class="grid gap-2 text-[13px]">
    {#if ps.list.length}
      <ul class="m-0 grid list-none gap-0.5 p-0">
        {#each ps.list as p (p.id)}
          <li class="flex items-center gap-1">
            <TipButton
              variant="ghost"
              size="sm"
              class={cn('h-auto flex-1 justify-start gap-1.5 px-2 py-1.5 text-left font-normal disabled:opacity-100', p.id === ps.active && 'bg-muted/40')}
              disabled={!!busy || (p.id === ps.active && !drift)}
              onclick={() => go(p.id)}
              tip={`saved ${fmtDateTime(p.savedAt)}`}
            >
              <span class="sens">{p.displayname}<span class="text-muted-foreground">@{p.handle}</span></span>
              {#if p.id === ps.active}<em class="text-primary ml-auto text-[10px] not-italic">active</em>{/if}
              {#if p.stale}<em class={cn('text-warning text-[10px] not-italic', p.id !== ps.active && 'ml-auto')}>stale</em>{/if}
            </TipButton>
            <LazyTip tip="Forget this profile (cookies + parked data)">
              {#snippet trigger({ props })}
                <ConfirmButton {...props} variant="ghost" size="xs" class="text-muted-foreground px-1.5" disabled={!!busy} confirmLabel="sure?" onconfirm={() => forget(p.id)}
                  ><span class="sr-only">Forget this profile</span><X /></ConfirmButton
                >
              {/snippet}
            </LazyTip>
          </li>
        {/each}
      </ul>
    {:else}
      <Empty class="py-3 text-xs">No saved logins yet. Log in on RSI, then save it here; log in as someone else and save again — switch without passwords from then on.</Empty>
    {/if}
    <div class="flex flex-wrap gap-1.5">
      <Button variant="outline" size="xs" disabled={!!busy || me === null} onclick={save}>{busy === 'save' ? '…' : drift || !active ? 'Save current login' : 'Re-save current login'}</Button>
      <TipButton variant="outline" size="xs" disabled={!!busy || me === null} onclick={logout} tip="Remove RSI cookies from this browser (profiles stay)">Log out here</TipButton>
    </div>
    {#if msg}<div class={cn('text-[11px]', /doesn't|not |no |fail/i.test(msg) && 'text-destructive')}>{msg}</div>{/if}
    {#if spanning}<div class="text-destructive text-[11px]">This is the dev build (<code>incognito: spanning</code>): incognito shares the normal window's cookies and data, so switching here changes the normal window's login. Load the built extension (<code>.output/chrome-mv3</code>, "Allow in Incognito") for a separate incognito jar.</div>{/if}
    <div class="text-muted-foreground text-[11px]">Cookies are stored in this browser only (plain text, never synced). Melting still needs your password on RSI.</div>
  </div>
{/snippet}

{#if compact}
  <!-- Popup: the menu unfolds inline (a floating layer would be clipped by the popup window's size). -->
  <Collapsible.Root bind:open class="grid gap-2">
    <Collapsible.Trigger>
      {#snippet child({ props })}{@render trigger(props)}{/snippet}
    </Collapsible.Trigger>
    <Collapsible.Content>{@render menu()}</Collapsible.Content>
  </Collapsible.Root>
{:else}
  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}{@render trigger(props)}{/snippet}
    </Popover.Trigger>
    <Popover.Content align="end" class="w-auto max-w-[360px] min-w-[280px]">{@render menu()}</Popover.Content>
  </Popover.Root>
{/if}
