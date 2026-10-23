<script lang="ts">
  /**
   * Feed: everything RSI+ noticed for you, in two views — *Activity* (watched threads, channels, authors, keywords,
   * friends online / added / gone, friend requests, party mode, wishlist and CCU alerts, hangar changes) and *Store
   * changes* (what the pledge store added and removed, with dismiss). `#feed?view=store` (and the old `#notifications`)
   * opens the store view.
   */
  import { bg } from '@/lib/messages';
  import { feedItem, getSettings, lastPollItem, settingsItem, storeLogItem } from '@/lib/settings';
  import { cleanLog, tally } from '@/lib/storelog';
  import { EVENT_KINDS, type EventKind, type FeedEvent } from '@/lib/watch';
  import * as Card from '@/components/ui/card';
  import { Button } from '@/components/ui/button';
  import { ago } from '@/lib/dates';
  import Empty from './Empty.svelte';
  import Segmented from './Segmented.svelte';
  import StoreLog from './StoreLog.svelte';
  import SwitchRow from './SwitchRow.svelte';
  import Timeline, { type TimelineEvent } from './Timeline.svelte';
  import NewItemsPill from './NewItemsPill.svelte';
  import FilterChips from './FilterChips.svelte';
  import HintBadge from './HintBadge.svelte';
  import LazyTip from './LazyTip.svelte';
  import Rss from '@lucide/svelte/icons/rss';
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import Users from '@lucide/svelte/icons/users';
  import UserPlus from '@lucide/svelte/icons/user-plus';
  import PartyPopper from '@lucide/svelte/icons/party-popper';
  import Store from '@lucide/svelte/icons/store';
  import Warehouse from '@lucide/svelte/icons/warehouse';
  import Code from '@lucide/svelte/icons/code';
  import AtSign from '@lucide/svelte/icons/at-sign';
  import Hash from '@lucide/svelte/icons/hash';
  import { hashParam } from '@/lib/deep-link.svelte';

  type View = 'activity' | 'store';
  const viewFromHash = (): View => (location.hash.startsWith('#notifications') || hashParam('view') === 'store' ? 'store' : 'activity');
  let view = $state<View>(viewFromHash());
  $effect(() => {
    const on = () => (view = viewFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  });
  function setView(v: View) {
    view = v;
    history.replaceState(null, '', v === 'store' ? '#feed?view=store' : '#feed');
  }

  let feed = $state<FeedEvent[]>([]);
  let lastPoll = $state<{ at: number; error: string | null } | null>(null);
  let pollAuto = $state(true);
  let busy = $state(false);
  let notices = $state({ add: 0, remove: 0 });
  /** Kinds picked (empty = all) and the unseen-only switch — remembered. */
  const PREFS = 'rsiplus:feed';
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { kinds?: EventKind[]; unseenOnly?: boolean };
    } catch {
      return {};
    }
  })();
  let kinds = $state<EventKind[]>(saved.kinds ?? []);
  let unseenOnly = $state(saved.unseenOnly ?? false);
  $effect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ kinds: $state.snapshot(kinds), unseenOnly }));
    } catch {
      /* private mode */
    }
  });

  $effect(() => {
    feedItem.getValue().then((f) => (feed = f));
    lastPollItem.getValue().then((p) => (lastPoll = p));
    getSettings().then((s) => (pollAuto = s.pollAuto));
    storeLogItem.getValue().then((v) => (notices = tally(cleanLog(v))));
    const offs = [
      feedItem.watch((f) => (feed = f ?? [])),
      lastPollItem.watch((p) => (lastPoll = p)),
      settingsItem.watch(async () => (pollAuto = (await getSettings()).pollAuto)),
      storeLogItem.watch((v) => (notices = tally(cleanLog(v)))),
    ];
    return () => offs.forEach((off) => off());
  });

  const LABEL: Record<EventKind, string> = Object.fromEntries(EVENT_KINDS.map((k) => [k.id, k.label])) as Record<EventKind, string>;
  const KIND_TONE: Partial<Record<EventKind, string>> = { dev: 'text-accent-2', store: 'text-warning', friend: 'text-success', request: 'text-success', party: 'text-warning', replies: 'text-primary', keyword: 'text-info', hangar: 'text-info' };
  const base = $derived(unseenOnly ? feed.filter((e) => !e.seen) : feed);
  const count = $derived.by(() => {
    const m = new Map<EventKind, number>();
    for (const e of base) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  });
  const present = $derived(EVENT_KINDS.filter((k) => (count.get(k.id) ?? 0) > 0 || kinds.includes(k.id)));
  const shown = $derived(kinds.length ? base.filter((e) => kinds.includes(e.kind)) : base);
  const unseen = $derived(feed.filter((e) => !e.seen).length);
  const ICON: Record<EventKind, typeof Rss> = { replies: MessageSquare, thread: Rss, dev: Code, author: AtSign, keyword: Hash, friend: Users, request: UserPlus, party: PartyPopper, store: Store, hangar: Warehouse };
  const TONE: Partial<Record<EventKind, TimelineEvent['tone']>> = { friend: 'success', request: 'success', party: 'warning', store: 'warning', replies: 'info', keyword: 'info', hangar: 'info', dev: 'warning' };
  const rows = $derived<TimelineEvent[]>(shown.map((e) => ({ id: e.key, at: e.at, title: e.title, meta: e.body, href: e.url.startsWith('hub.html') ? e.url.replace(/^hub\.html/, '') : e.url, icon: ICON[e.kind], tone: TONE[e.kind] ?? 'neutral', muted: e.seen, kind: LABEL[e.kind] ?? e.kind, kindClass: KIND_TONE[e.kind] })));

  async function pollNow() {
    busy = true;
    try {
      await bg({ type: 'poll:now' });
    } finally {
      busy = false;
    }
  }
</script>

<div class="grid gap-4">
  <NewItemsPill count={feed.length} label={(n) => `${n} new`} />
  <Segmented
    options={[
      { id: 'activity', label: `Activity${unseen ? ` · ${unseen} unseen` : ''}`, hint: 'Watches, friends, requests, party mode, store alerts, hangar changes' },
      { id: 'store', label: `Store changes${notices.add + notices.remove ? ` · +${notices.add} −${notices.remove}` : ''}`, hint: 'What the pledge store added and removed since you last looked' },
    ]}
    value={view}
    onchange={setView}
    ariaLabel="Feed view"
  />

  {#if view === 'store'}
    <StoreLog />
  {:else}
    <Card.Root>
      <Card.Header>
        <Card.Description>
          {unseen} unseen · last check {lastPoll ? ago(lastPoll.at) : 'never'}{#if !pollAuto}
            ·
            <LazyTip tip="Automatic checks are off (Watching / Settings) — nothing runs in the background">
              {#snippet trigger({ props })}<button type="button" {...props} class="cursor-default">passive, Check now only</button>{/snippet}
            </LazyTip>
          {/if}
          {#if lastPoll?.error}
            <HintBadge variant="destructive" size="xs" hint={lastPoll.error}>some checks failed</HintBadge>
          {/if}
        </Card.Description>
        <Card.Action class="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={busy} onclick={pollNow}>{busy ? 'Checking…' : 'Check now'}</Button>
          <Button variant="outline" disabled={!unseen} onclick={() => bg({ type: 'feed:seen' })}>Mark all seen</Button>
        </Card.Action>
      </Card.Header>

      <Card.Content class="grid gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <FilterChips
            multiple
            ariaLabel="Kinds"
            options={present.map((k) => ({ id: k.id, label: k.label, hint: k.hint, count: count.get(k.id) ?? 0 }))}
            bind:value={() => new Set(kinds), (v) => (kinds = [...(v as Set<EventKind>)])}
          />
          <SwitchRow id="feed-unseen" label="Unseen only" size="sm" checked={unseenOnly} onchange={(v) => (unseenOnly = v)} class="ml-auto py-0" />
        </div>

        {#if !shown.length}
          <Empty>{feed.length ? (unseenOnly ? 'Nothing unseen.' : 'Nothing of that kind.') : 'No events yet. Watch threads (☆ on Spectrum rows), channels, authors or friends — they show up here, with friend requests, store alerts and hangar changes.'}</Empty>
        {:else}
          <Timeline events={rows} label="Activity" onopen={(e) => bg({ type: 'feed:seen', keys: [e.id] })} />
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
