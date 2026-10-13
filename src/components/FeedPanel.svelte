<script lang="ts">
  import { bg } from '@/lib/messages';
  import { feedItem, lastPollItem } from '@/lib/settings';
  import type { EventKind, FeedEvent } from '@/lib/watch';

  let feed = $state<FeedEvent[]>([]);
  let lastPoll = $state<{ at: number; error: string | null } | null>(null);
  let busy = $state(false);
  let filter = $state<EventKind | 'all' | 'unseen'>('unseen');

  $effect(() => {
    feedItem.getValue().then((f) => (feed = f));
    lastPollItem.getValue().then((p) => (lastPoll = p));
    const offs = [feedItem.watch((f) => (feed = f ?? [])), lastPollItem.watch((p) => (lastPoll = p))];
    return () => offs.forEach((off) => off());
  });

  const LABEL: Record<EventKind, string> = { replies: 'Replies', thread: 'New thread', dev: 'Dev', author: 'Author', friend: 'Friend', store: 'Store' };
  const shown = $derived(feed.filter((e) => (filter === 'all' ? true : filter === 'unseen' ? !e.seen : e.kind === filter)));
  const unseen = $derived(feed.filter((e) => !e.seen).length);

  async function pollNow() {
    busy = true;
    try {
      await bg({ type: 'poll:now' });
    } finally {
      busy = false;
    }
  }
  const ago = (ms: number) => {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
</script>

<section class="card stack">
  <div class="row spread">
    <div>
      <h2>Feed</h2>
      <span class="muted">
        {unseen} unseen · last check {lastPoll ? ago(lastPoll.at) : 'never'}
        {#if lastPoll?.error}<span class="err" title={lastPoll.error}> · some checks failed</span>{/if}
      </span>
    </div>
    <div class="row">
      <select bind:value={filter} aria-label="Filter">
        <option value="unseen">Unseen</option>
        <option value="all">All</option>
        {#each Object.entries(LABEL) as [k, l]}<option value={k}>{l}</option>{/each}
      </select>
      <button class="btn" disabled={busy} onclick={pollNow}>{busy ? 'Checking…' : 'Check now'}</button>
      <button class="btn" disabled={!unseen} onclick={() => bg({ type: 'feed:seen' })}>Mark all seen</button>
    </div>
  </div>

  {#if !shown.length}
    <p class="empty">
      {feed.length ? 'Nothing here.' : 'No events yet. Watch threads (☆ on Spectrum rows), channels, authors or friends — they show up here.'}
    </p>
  {:else}
    <ul class="list">
      {#each shown as e (e.key)}
        <li class:seen={e.seen}>
          <span class="chip kind-{e.kind}">{LABEL[e.kind]}</span>
          <a href={e.url} target="_blank" rel="noopener" onclick={() => bg({ type: 'feed:seen', keys: [e.key] })}>{e.title}</a>
          <span class="muted body">{e.body}</span>
          <span class="muted when">{ago(e.at)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  li {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr) auto;
    grid-template-areas: 'kind title when' 'kind body when';
    gap: 2px 12px;
    padding: 10px 4px;
    border-bottom: 1px solid var(--line);
  }
  li.seen {
    opacity: 0.55;
  }
  .chip {
    grid-area: kind;
    justify-self: start;
    align-self: start;
  }
  a {
    grid-area: title;
    color: var(--text);
    font-weight: 600;
    text-decoration: none;
  }
  a:hover {
    color: var(--accent);
  }
  .body {
    grid-area: body;
  }
  .when {
    grid-area: when;
    font-size: 12px;
    white-space: nowrap;
  }
  .kind-dev {
    color: #ffb547;
  }
  .kind-store {
    color: #ffd166;
  }
  .kind-friend {
    color: var(--ok);
  }
  .kind-replies {
    color: var(--accent);
  }
</style>
