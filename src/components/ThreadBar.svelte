<script lang="ts">
  // Floating bar (shadow root): thread actions on thread pages, channel actions on channel pages, toasts, key help.
  import { ui } from '@/lib/state.svelte';
  import { parsePath } from '@/lib/types';
  import type { Actions } from '@/entrypoints/spectrum.content/index';
  import * as api from '@/lib/api';

  let { actions }: { actions: Actions } = $props();

  let path = $state(location.pathname);
  $effect(() => {
    const on = () => (path = location.pathname);
    window.addEventListener('wxt:locationchange', on);
    return () => window.removeEventListener('wxt:locationchange', on);
  });
  const route = $derived(parsePath(path));
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
  const KEYS = [
    ['j / k', 'next / previous thread or reply'],
    ['o / Enter', 'open focused thread'],
    ['w', 'watch / unwatch thread'],
    ['m / u', 'mark read / unread'],
    ['n', 'jump to first new reply'],
    ['?', 'this help'],
  ];
</script>

<div class="sp">
  {#if ui.view && !collapsed}
    {@const v = ui.view}
    <div class="bar" role="toolbar" aria-label="RSI+ thread actions">
      <span class="logo">S+</span>
      {#if v.firstVisit}
        <span class="muted">First visit</span>
      {:else if v.newCount > 0}
        <span class="new">+{v.newCount} new since last visit</span>
        {#if v.firstNewUrl}<a class="btn" href={v.firstNewUrl} title="n">Jump to first new</a>{/if}
      {:else}
        <span class="muted">No new replies</span>
      {/if}
      <button class="btn" class:on={ui.watched} onclick={() => actions.toggleWatch(v.thread)} title="w">
        {ui.watched ? '★ Watching' : '☆ Watch'}
      </button>
      <button class="btn" onclick={() => actions.markUnread(v.thread)} title="u">Mark unread</button>
      <button class="x" aria-label="Collapse" onclick={() => (collapsed = true)}>×</button>
    </div>
  {:else if channelPage && !collapsed}
    {@const id = route.channelId!}
    <div class="bar" role="toolbar" aria-label="RSI+ channel actions">
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
    <button class="pip" onclick={() => (collapsed = false)} aria-label="Show RSI+ bar">S+</button>
  {/if}

  {#if ui.toast}
    <div class="toast" role="status">
      {ui.toast.text}
      {#if ui.toast.undo}
        <button class="link" onclick={() => (ui.toast?.undo?.(), (ui.toast = null))}>Undo</button>
      {/if}
    </div>
  {/if}

  {#if ui.help}
    <div class="help" role="dialog" aria-label="Keyboard shortcuts">
      <strong>RSI+ shortcuts</strong>
      <dl>
        {#each KEYS as [k, d]}<dt>{k}</dt><dd>{d}</dd>{/each}
      </dl>
      <button class="btn" onclick={() => (ui.help = false)}>Close</button>
    </div>
  {/if}
</div>

<style>
  .sp {
    font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #e8edf3;
  }
  .bar,
  .toast,
  .help,
  .pip {
    position: fixed;
    background: rgb(14 18 24 / 0.94);
    border: 1px solid rgb(255 255 255 / 0.1);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
    backdrop-filter: blur(8px);
    border-radius: 12px;
  }
  .bar {
    right: 18px;
    bottom: 18px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px 7px 10px;
  }
  .logo {
    font-weight: 800;
    color: #3cc8ff;
    letter-spacing: -0.02em;
  }
  .muted {
    color: #8b95a5;
  }
  .new {
    color: #3cc8ff;
    font-weight: 600;
  }
  .btn {
    border: 1px solid rgb(255 255 255 / 0.12);
    background: rgb(255 255 255 / 0.05);
    color: inherit;
    border-radius: 8px;
    padding: 4px 10px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .btn:hover {
    background: rgb(255 255 255 / 0.12);
  }
  .btn.on {
    color: #ffd166;
    border-color: rgb(255 209 102 / 0.4);
  }
  .x {
    border: 0;
    background: none;
    color: #8b95a5;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
  }
  .pip {
    right: 18px;
    bottom: 18px;
    padding: 6px 9px;
    color: #3cc8ff;
    font-weight: 800;
    cursor: pointer;
  }
  .toast {
    left: 50%;
    bottom: 70px;
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
    color: #3cc8ff;
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
    color: #3cc8ff;
  }
  dd {
    margin: 0;
    color: #c4ccd8;
  }
</style>
