<script lang="ts">
  // Floating bar (shadow root): thread actions on thread pages, channel actions on channel pages, toasts, key help.
  import { ui } from '@/lib/state.svelte';
  import { page } from '@/lib/page-path.svelte';
  import { parsePath } from '@/lib/types';
  import type { Actions } from '@/entrypoints/spectrum.content/index';
  import * as api from '@/lib/api';
  import { issueUrl } from '@/lib/issue-council';
  import './site-bar.css';

  let { actions }: { actions: Actions } = $props();

  const route = $derived(parsePath(page.path));
  /** Settings → "RSI+ bar on Spectrum" (and "Spectrum tools"). Off hides the bar and its S+ pip; toasts and the key help still show. */
  const barOn = $derived(ui.settings.spectrumTools && ui.settings.spectrumBar);
  const channelPage = $derived(!!route.channelId && !route.slug);

  let channelNames = $state<Record<string, string>>({});
  let channelWatched = $state(false);
  $effect(() => {
    if (!channelPage || channelNames[route.channelId!]) return;
    api
      .channels()
      .then((list) => (channelNames = Object.fromEntries(list.map((c) => [String(c.id), c.name]))))
      .catch(() => {});
  });
  $effect(() => {
    // Re-evaluate when the route or watched list changes (ui.watched flips on watch edits).
    void ui.watched;
    channelWatched = !!route.channelId && actions.isChannelWatched(route.channelId);
  });
  let collapsed = $state(false);
  /** Link the open thread to an Issue Council issue: search what RSI+ has seen, or paste a code / URL. */
  let linking = $state(false);
  let q = $state('');
  let linkErr = $state('');
  const picks = $derived(linking ? actions.icPick(q) : []);
  async function link(input: string) {
    linkErr = '';
    if (await actions.linkIssue(input)) ((linking = false), (q = ''));
    else linkErr = 'Not an issue code: use STARC-123456, the number, or the issue URL';
  }
  const KEYS = [
    ['j / k', 'next / previous thread or reply'],
    ['o / Enter', 'open focused thread'],
    ['w', 'watch / unwatch thread'],
    ['m / u', 'mark read / unread'],
    ['n', 'jump to first new reply'],
    ['?', 'this help'],
  ];
</script>

<div class="sp rp" style:--lift="{ui.barLift}px">
  {#if !barOn}
    <!-- bar turned off in Settings -->
  {:else if ui.view && !collapsed}
    {@const v = ui.view}
    <div class="bar rp-surface" role="toolbar" aria-label="RSI+ thread actions">
      <span class="logo">S+</span>
      {#if v.firstVisit}
        <span class="muted">First visit</span>
      {:else if v.newCount > 0}
        <span class="new">+{v.newCount} new since last visit</span>
        {#if v.firstNewUrl}<a class="btn" href={v.firstNewUrl} aria-keyshortcuts="n">Jump to first new</a>{/if}
      {:else}
        <span class="muted">No new replies</span>
      {/if}
      <button class="btn" class:on={ui.watched} onclick={() => actions.toggleWatch(v.thread)} aria-keyshortcuts="w">
        {ui.watched ? '★ Watching' : '☆ Watch'}
      </button>
      <button class="btn" onclick={() => actions.markUnread(v.thread)} aria-keyshortcuts="u">Mark unread</button>
      {#each ui.linked as code (code)}
        <span class="chip">
          <a href={issueUrl(code)} target="_blank" rel="noopener" title={actions.icIssue(code)?.title || 'Linked Issue Council issue'}>{code}</a>
          <button class="x" aria-label={`Unlink ${code}`} title="Unlink" onclick={() => actions.unlinkIssue(code)}>×</button>
        </span>
      {/each}
      {#if ui.settings.issueCouncil}
        <button class="btn" class:on={linking} aria-expanded={linking} onclick={() => ((linking = !linking), (linkErr = ''))} title="Link this thread to an Issue Council issue">Link issue</button>
      {/if}
      <button class="x" aria-label="Collapse" onclick={() => (collapsed = true)}>×</button>
    </div>
    {#if linking}
      <div class="picker rp-surface" role="dialog" aria-label="Link an Issue Council issue">
        <form onsubmit={(e) => (e.preventDefault(), link(picks[0] && !/\d{3,}/.test(q) ? picks[0].code : q))}>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="in" placeholder="STARC-123456, a link, or search issues you've seen" bind:value={q} autofocus onkeydown={(e) => e.key === 'Escape' && (linking = false)} />
        </form>
        {#if linkErr}<div class="err">{linkErr}</div>{/if}
        {#each picks as i (i.code)}
          <button class="pick" onclick={() => link(i.code)}>
            <b>{i.code}</b> {i.title || ''}
            <span class="muted">{i.status ? i.status.replace(/-/g, ' ') : ''}{i.rel.length ? ' · yours' : ''}</span>
          </button>
        {:else}
          <div class="muted">{q ? 'No issue RSI+ has seen matches: press Enter to link the code you typed.' : 'Issues you opened on the Issue Council show here (yours first).'}</div>
        {/each}
      </div>
    {/if}
  {:else if channelPage && !collapsed}
    {@const id = route.channelId!}
    <div class="bar rp-surface" role="toolbar" aria-label="RSI+ channel actions">
      <span class="logo">S+</span>
      <span class="muted">{channelNames[id] ?? `Channel ${id}`}</span>
      <button
        class="btn"
        class:on={channelWatched}
        onclick={async () => {
          await actions.toggleWatchChannel(id, channelNames[id] ?? `Channel ${id}`);
          channelWatched = actions.isChannelWatched(id);
        }}>{channelWatched ? '★ Watching channel' : '☆ Watch channel'}</button
      >
      <button class="btn" onclick={() => actions.markAllListedRead()}>Mark listed read</button>
      <button class="btn" onclick={() => actions.openHub('feed')}>Hub</button>
      <button class="x" aria-label="Collapse" onclick={() => (collapsed = true)}>×</button>
    </div>
  {:else if collapsed && (ui.view || channelPage)}
    <button class="pip rp-surface" onclick={() => (collapsed = false)} aria-label="Show RSI+ bar" title="Show the RSI+ bar (turn it off for good in RSI+ Settings)">S+</button>
  {/if}

  {#if ui.toast}
    <div class="toast rp-surface" role="status">
      {ui.toast.text}
      {#if ui.toast.undo}
        <button class="link" onclick={() => (ui.toast?.undo?.(), (ui.toast = null))}>Undo</button>
      {/if}
    </div>
  {/if}

  {#if ui.help}
    <div class="help rp-surface" role="dialog" aria-label="Keyboard shortcuts">
      <strong>RSI+ shortcuts</strong>
      <dl>
        {#each KEYS as [k, d]}<dt>{k}</dt><dd>{d}</dd>{/each}
      </dl>
      <button class="btn" onclick={() => (ui.help = false)}>Close</button>
    </div>
  {/if}
</div>

<style>
  /* Palette, surface, buttons, logo: site-bar.css (shared with SiteBar). */
  .bar,
  .toast,
  .help,
  .pip {
    position: fixed;
  }
  .bar {
    right: 18px;
    bottom: calc(18px + var(--lift, 0px));
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px 7px 10px;
  }
  .logo {
    letter-spacing: -0.02em;
  }
  .new {
    color: var(--rp-accent);
    font-weight: 600;
  }
  .btn.on {
    border-color: rgb(255 209 102 / 0.4);
  }
  .x {
    padding: 0 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 1px solid rgb(60 200 255 / 0.35);
    border-radius: 999px;
    padding: 0 2px 0 8px;
  }
  .chip a {
    color: var(--rp-accent);
    text-decoration: none;
    font-weight: 600;
  }
  .picker {
    position: fixed;
    right: 18px;
    bottom: calc(64px + var(--lift, 0px));
    width: min(440px, 92vw);
    max-height: 50vh;
    overflow: auto;
    display: grid;
    gap: 4px;
    padding: 10px;
  }
  .in {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    color: inherit;
    background: rgb(255 255 255 / 0.06);
    border: 1px solid rgb(255 255 255 / 0.18);
    border-radius: 6px;
    padding: 6px 8px;
  }
  .pick {
    text-align: left;
    font: inherit;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 6px;
    padding: 5px 6px;
    cursor: pointer;
  }
  .pick:hover,
  .pick:focus-visible {
    background: rgb(60 200 255 / 0.12);
  }
  .err {
    color: #ff7a7a;
  }
  .pip {
    right: 18px;
    bottom: calc(18px + var(--lift, 0px));
    padding: 6px 9px;
    color: var(--rp-accent);
    font-weight: 800;
    cursor: pointer;
  }
  .toast {
    left: 50%;
    bottom: calc(70px + var(--lift, 0px));
    transform: translateX(-50%);
    padding: 9px 14px;
    display: flex;
    gap: 12px;
    align-items: center;
    max-width: min(560px, 90vw);
  }
  .link {
    border: 0;
    background: none;
    color: var(--rp-accent);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .help {
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 16px 18px;
    min-width: 300px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 12px 0;
  }
  dt {
    font-family: ui-monospace, monospace;
    color: var(--rp-accent);
  }
  dd {
    margin: 0;
    color: #c4ccd8;
  }
</style>
