<script lang="ts">
  /** Profile chip: who you are, switch to a saved login, save the current one, forget one. Hub header + popup. */
  import { captureProfile, forgetProfile, logoutLocal, switchTo, whoAmI, type Profiles } from '@/lib/accounts';
  import { INCOGNITO, profilesItem } from '@/lib/settings';

  let { compact = false }: { compact?: boolean } = $props();
  let ps = $state<Profiles>({ active: null, list: [] });
  let me = $state<{ handle: string; displayname: string } | null | undefined>(undefined); // undefined = checking
  let open = $state(false);
  let busy = $state('');
  let msg = $state('');
  let confirmForget = $state<string | null>(null);
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
      confirmForget = null;
      return 'Forgotten.';
    });
  const logout = () =>
    run('logout', async () => {
      await logoutLocal();
      me = null;
      return 'RSI cookies cleared here (saved profiles untouched).';
    });
</script>

<div class="acct" class:compact>
  <button class="who" class:warn={drift || active?.stale} onclick={() => (open = !open)} aria-expanded={open} title={drift ? `Logged in as ${me?.handle}, but profile ${active?.handle} is active — Save to update it` : 'Accounts'}>
    <span class="dot" class:on={!!me} class:off={me === null}></span>
    {label}{#if ps.list.length}<span class="n">{ps.list.length}</span>{/if}
    <span class="caret">▾</span>
  </button>
  {#if open}
    <div class="menu">
      {#if ps.list.length}
        <ul>
          {#each ps.list as p (p.id)}
            <li class:active={p.id === ps.active}>
              <button class="pick" disabled={!!busy || (p.id === ps.active && !drift)} onclick={() => go(p.id)} title={`saved ${new Date(p.savedAt).toLocaleString()}`}>
                {p.displayname}<span class="muted">@{p.handle}</span>
                {#if p.id === ps.active}<em>active</em>{/if}
                {#if p.stale}<em class="stale">stale</em>{/if}
              </button>
              {#if confirmForget === p.id}
                <button class="x danger" disabled={!!busy} onclick={() => forget(p.id)}>sure?</button>
              {:else}
                <button class="x" disabled={!!busy} onclick={() => (confirmForget = p.id)} title="Forget this profile (cookies + parked data)">✕</button>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <div class="muted small">No saved logins yet. Log in on RSI, then save it here; log in as someone else and save again — switch without passwords from then on.</div>
      {/if}
      <div class="row">
        <button class="btn small" disabled={!!busy || me === null} onclick={save}>{busy === 'save' ? '…' : drift || !active ? 'Save current login' : 'Re-save current login'}</button>
        <button class="btn small" disabled={!!busy || me === null} onclick={logout} title="Remove RSI cookies from this browser (profiles stay)">Log out here</button>
      </div>
      {#if msg}<div class="small" class:err={/doesn't|not |no |fail/i.test(msg)}>{msg}</div>{/if}
      {#if spanning}<div class="small err">This is the dev build (<code>incognito: spanning</code>): incognito shares the normal window's cookies and data, so switching here changes the normal window's login. Load the built extension (<code>.output/chrome-mv3</code>, "Allow in Incognito") for a separate incognito jar.</div>{/if}
      <div class="muted small">Cookies are stored in this browser only (plain text, never synced). Melting still needs your password on RSI.</div>
    </div>
  {/if}
</div>

<style>
  .acct {
    position: relative;
    font-size: 13px;
  }
  .who {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    border-radius: 999px;
    padding: 4px 10px;
    cursor: pointer;
    font-weight: 600;
    white-space: nowrap;
  }
  .who.warn {
    border-color: rgb(255 181 71 / 0.6);
  }
  .compact .who {
    padding: 2px 8px;
    font-size: 12px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .dot.on {
    background: var(--ok);
  }
  .dot.off {
    background: var(--err);
  }
  .n {
    color: var(--muted);
    font-weight: 500;
  }
  .caret {
    color: var(--muted);
    font-size: 10px;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 20;
    min-width: 280px;
    max-width: 360px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px;
    display: grid;
    gap: 8px;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.4);
  }
  .compact .menu {
    position: static;
    min-width: 0;
    box-shadow: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  li {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  li.active .pick {
    background: rgb(255 255 255 / 0.06);
  }
  .pick {
    flex: 1;
    text-align: left;
    border: 0;
    background: none;
    color: var(--text);
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .pick:not(:disabled):hover {
    background: rgb(255 255 255 / 0.08);
  }
  .pick:disabled {
    cursor: default;
  }
  .pick em {
    font-style: normal;
    font-size: 10px;
    color: var(--accent);
    margin-left: auto;
  }
  .pick em.stale {
    color: #ffb547;
  }
  .x {
    border: 0;
    background: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 6px;
  }
  .x.danger {
    color: var(--err);
    font-weight: 600;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 11px;
  }
  .err {
    color: var(--err);
  }
</style>
