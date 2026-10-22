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
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { cn } from '@/lib/utils';
  import Empty from './Empty.svelte';
  import Segmented from './Segmented.svelte';
  import StoreLog from './StoreLog.svelte';
  import SwitchRow from './SwitchRow.svelte';
  import { CHIP } from './FilterChips.svelte';
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
  /** Same-day events share a date heading. */
  const day = (ms: number) => new Date(ms).toDateString();
  const isHub = (url: string) => url.startsWith('hub.html');
</script>

<div class="grid gap-4">
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
            <Tooltip.Root>
              <Tooltip.Trigger> · passive, Check now only</Tooltip.Trigger>
              <Tooltip.Content>Automatic checks are off (Watching / Settings) — nothing runs in the background</Tooltip.Content>
            </Tooltip.Root>
          {/if}
          {#if lastPoll?.error}
            <Tooltip.Root>
              <Tooltip.Trigger class="text-destructive"> · some checks failed</Tooltip.Trigger>
              <Tooltip.Content class="whitespace-pre-line">{lastPoll.error}</Tooltip.Content>
            </Tooltip.Root>
          {/if}
        </Card.Description>
        <Card.Action class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onclick={pollNow}>{busy ? 'Checking…' : 'Check now'}</Button>
          <Button variant="outline" size="sm" disabled={!unseen} onclick={() => bg({ type: 'feed:seen' })}>Mark all seen</Button>
        </Card.Action>
      </Card.Header>

      <Card.Content class="grid gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <ToggleGroup.Root type="multiple" variant="outline" size="sm" spacing={1} class="flex-wrap" aria-label="Kinds" bind:value={() => kinds, (v) => (kinds = v as EventKind[])}>
            {#each present as k (k.id)}
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <ToggleGroup.Item {...props} value={k.id} class={CHIP}>{k.label} <span class="opacity-70">· {count.get(k.id) ?? 0}</span></ToggleGroup.Item>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content class="max-w-72">{k.hint}</Tooltip.Content>
              </Tooltip.Root>
            {/each}
          </ToggleGroup.Root>
          <SwitchRow id="feed-unseen" label="Unseen only" size="sm" checked={unseenOnly} onchange={(v) => (unseenOnly = v)} class="ml-auto py-0" />
        </div>

        {#if !shown.length}
          <Empty>{feed.length ? (unseenOnly ? 'Nothing unseen.' : 'Nothing of that kind.') : 'No events yet. Watch threads (☆ on Spectrum rows), channels, authors or friends — they show up here, with friend requests, store alerts and hangar changes.'}</Empty>
        {:else}
          <ul class="grid">
            {#each shown as e, i (e.key)}
              {#if i === 0 || day(e.at) !== day(shown[i - 1]!.at)}
                <li class="text-muted-foreground mt-2 px-1 pb-1 text-[11px] font-semibold tracking-wide uppercase first:mt-0">{day(e.at) === day(Date.now()) ? 'Today' : new Date(e.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</li>
              {/if}
              <li
                class={cn(
                  "grid grid-cols-[92px_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b px-1 py-2.5 [grid-template-areas:'kind_title_when''kind_body_when'] last:border-0",
                  e.seen && 'opacity-55',
                )}
              >
                <Badge variant="outline" class={cn('[grid-area:kind] self-start justify-self-start', KIND_TONE[e.kind])}>{LABEL[e.kind] ?? e.kind}</Badge>
                <a
                  class="text-foreground hover:text-primary font-semibold no-underline [grid-area:title]"
                  href={isHub(e.url) ? e.url.replace(/^hub\.html/, '') : e.url}
                  target={isHub(e.url) ? undefined : '_blank'}
                  rel={isHub(e.url) ? undefined : 'noopener'}
                  onclick={() => bg({ type: 'feed:seen', keys: [e.key] })}>{e.title}</a
                >
                <span class="text-muted-foreground [grid-area:body]">{e.body}</span>
                <span class="text-muted-foreground text-xs whitespace-nowrap [grid-area:when]">{ago(e.at)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
