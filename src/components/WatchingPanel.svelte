<script lang="ts">
  import { bg } from '@/lib/messages';
  import { getSettings, getWatches, patchSettings, patchWatches, watchesItem } from '@/lib/settings';
  import { channelUrl, threadUrl, type Channel } from '@/lib/types';
  import { NO_WATCHES, type Watches } from '@/lib/watch';
  import { sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';

  let w = $state<Watches>(NO_WATCHES);
  let channels = $state<Channel[]>([]);
  let channelsError = $state('');
  let pick = $state('');
  let authorInput = $state('');
  let pollMinutes = $state(5);
  let sort = $state<SortState<'subject' | 'replies' | 'added'>>({ key: 'added', dir: 'desc' });
  const threads = $derived(sortBy(w.threads, sort, { subject: (t) => t.subject, replies: (t) => t.replies, added: (t) => t.addedAt }));

  $effect(() => {
    getWatches().then((v) => (w = v));
    getSettings().then((s) => (pollMinutes = s.pollMinutes));
    bg({ type: 'channels:list' })
      .then((c) => (channels = c.sort((a, b) => a.groupId - b.groupId || a.name.localeCompare(b.name))))
      .catch((e) => (channelsError = (e as Error).message));
    return watchesItem.watch(async () => (w = await getWatches()));
  });

  const unwatched = $derived(channels.filter((c) => !w.channels.some((x) => x.id === String(c.id))));

  function addChannel() {
    const c = channels.find((x) => String(x.id) === pick);
    if (!c) return;
    patchWatches((v) => ({ ...v, channels: [...v.channels, { id: String(c.id), name: c.name, lastThreadId: null, allThreads: false }] }));
    pick = '';
  }
  function addAuthor() {
    const nick = authorInput.trim().replace(/^@/, '');
    if (!nick) return;
    patchWatches((v) =>
      v.authors.some((a) => a.nickname.toLowerCase() === nick.toLowerCase()) ? v : { ...v, authors: [...v.authors, { nickname: nick, displayname: nick }] },
    );
    authorInput = '';
  }
</script>

<div class="stack">
  <section class="card stack">
    <div class="row spread">
      <div>
        <h2>Threads</h2>
        <span class="muted">Notified when a watched thread gets new replies. Add with ☆ on a thread row or the bar on a thread page.</span>
      </div>
      <label class="row muted">
        Check every
        <input
          type="number"
          min="2"
          max="120"
          style="width:64px"
          bind:value={pollMinutes}
          onchange={() => patchSettings({ pollMinutes: Math.max(2, Number(pollMinutes) || 5) })}
        /> min
      </label>
    </div>
    {#if !w.threads.length}
      <p class="empty">No watched threads.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <SortTh key="subject" bind:sort>Thread</SortTh>
            <SortTh key="replies" bind:sort firstDir="desc">Replies</SortTh>
            <SortTh key="added" bind:sort firstDir="desc">Since</SortTh>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each threads as t (t.id)}
            <tr>
              <td><a href={threadUrl(t.channelId, t.slug)} target="_blank" rel="noopener">{t.subject}</a></td>
              <td>{t.replies}</td>
              <td class="muted">{new Date(t.addedAt).toLocaleDateString()}</td>
              <td><button class="btn small" onclick={() => patchWatches((v) => ({ ...v, threads: v.threads.filter((x) => x.id !== t.id) }))}>Unwatch</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="card stack">
    <div>
      <h2>Channels</h2>
      <span class="muted">New dev threads, dev replies and watched-author posts in these channels notify you. "All new threads" notifies for every new thread.</span>
    </div>
    {#each w.channels as c (c.id)}
      <div class="row spread line">
        <a href={channelUrl(c.id)} target="_blank" rel="noopener">{c.name}</a>
        <div class="row">
          <label class="row muted">
            <input
              type="checkbox"
              checked={c.allThreads}
              onchange={(e) =>
                patchWatches((v) => ({ ...v, channels: v.channels.map((x) => (x.id === c.id ? { ...x, allThreads: e.currentTarget.checked } : x)) }))}
            /> All new threads
          </label>
          <button class="btn small" onclick={() => patchWatches((v) => ({ ...v, channels: v.channels.filter((x) => x.id !== c.id) }))}>Unwatch</button>
        </div>
      </div>
    {/each}
    <div class="row">
      <select bind:value={pick} aria-label="Channel to watch">
        <option value="">Add a channel…</option>
        {#each unwatched as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
      </select>
      <button class="btn" disabled={!pick} onclick={addChannel}>Watch</button>
      {#if channelsError}<span class="err">{channelsError}</span>{/if}
    </div>
  </section>

  <section class="card stack">
    <div>
      <h2>Authors</h2>
      <span class="muted">Their new threads and latest replies in your watched channels notify you. Add from any reply ("Watch author") or by handle.</span>
    </div>
    <div class="row">
      {#each w.authors as a (a.nickname)}
        <span class="chip">
          {a.displayname}{a.displayname !== a.nickname ? ` @${a.nickname}` : ''}
          <button aria-label={`Unwatch ${a.nickname}`} onclick={() => patchWatches((v) => ({ ...v, authors: v.authors.filter((x) => x.nickname !== a.nickname) }))}>×</button>
        </span>
      {:else}
        <span class="muted">None.</span>
      {/each}
    </div>
    <form class="row" onsubmit={(e) => (e.preventDefault(), addAuthor())}>
      <input placeholder="Handle, e.g. Stamp-CIG" bind:value={authorInput} aria-label="Author handle" />
      <button class="btn" disabled={!authorInput.trim()}>Watch author</button>
    </form>
  </section>
</div>

<style>
  .line {
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }
  td a,
  .line a {
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
  }
  td a:hover,
  .line a:hover {
    color: var(--accent);
  }
</style>
