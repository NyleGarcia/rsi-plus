<script lang="ts">
  import { bg } from '@/lib/messages';
  import { feedItem, getSettings, lastPollItem, settingsItem } from '@/lib/settings';
  import type { EventKind, FeedEvent } from '@/lib/watch';
  import * as Card from '@/components/ui/card';
  import * as Select from '@/components/ui/select';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { cn } from '@/lib/utils';

  let feed = $state<FeedEvent[]>([]);
  let lastPoll = $state<{ at: number; error: string | null } | null>(null);
  let pollAuto = $state(true);
  let busy = $state(false);
  let filter = $state<EventKind | 'all' | 'unseen'>('unseen');

  $effect(() => {
    feedItem.getValue().then((f) => (feed = f));
    lastPollItem.getValue().then((p) => (lastPoll = p));
    getSettings().then((s) => (pollAuto = s.pollAuto));
    const offs = [feedItem.watch((f) => (feed = f ?? [])), lastPollItem.watch((p) => (lastPoll = p)), settingsItem.watch(async () => (pollAuto = (await getSettings()).pollAuto))];
    return () => offs.forEach((off) => off());
  });

  const LABEL: Record<EventKind, string> = { replies: 'Replies', thread: 'New thread', dev: 'Dev', author: 'Author', keyword: 'Keyword', friend: 'Friend', store: 'Store' };
  const KIND_TONE: Partial<Record<EventKind, string>> = { dev: 'text-[#ffb547]', store: 'text-warning', friend: 'text-success', replies: 'text-primary', keyword: 'text-[#c084fc]' };
  const FILTER_LABEL: Record<string, string> = { unseen: 'Unseen', all: 'All', ...LABEL };
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

<Card.Root>
  <Card.Header>
    <Card.Title>Feed</Card.Title>
    <Card.Description>
      {unseen} unseen · last check {lastPoll ? ago(lastPoll.at) : 'never'}{#if !pollAuto} · <span title="Automatic checks are off (Watching / Settings) — nothing runs in the background">passive, Check now only</span>{/if}
      {#if lastPoll?.error}
          <Tooltip.Root>
            <Tooltip.Trigger class="text-destructive"> · some checks failed</Tooltip.Trigger>
            <Tooltip.Content class="whitespace-pre-line">{lastPoll.error}</Tooltip.Content>
          </Tooltip.Root>
      {/if}
    </Card.Description>
    <Card.Action class="flex flex-wrap items-center gap-2">
      <Select.Root type="single" bind:value={filter}>
        <Select.Trigger aria-label="Filter">{FILTER_LABEL[filter]}</Select.Trigger>
        <Select.Content>
          <Select.Item value="unseen">Unseen</Select.Item>
          <Select.Item value="all">All</Select.Item>
          {#each Object.entries(LABEL) as [k, l] (k)}<Select.Item value={k}>{l}</Select.Item>{/each}
        </Select.Content>
      </Select.Root>
      <Button variant="outline" disabled={busy} onclick={pollNow}>{busy ? 'Checking…' : 'Check now'}</Button>
      <Button variant="outline" disabled={!unseen} onclick={() => bg({ type: 'feed:seen' })}>Mark all seen</Button>
    </Card.Action>
  </Card.Header>

  <Card.Content>
    {#if !shown.length}
      <p class="text-muted-foreground py-6 text-center">
        {feed.length ? 'Nothing here.' : 'No events yet. Watch threads (☆ on Spectrum rows), channels, authors or friends — they show up here.'}
      </p>
    {:else}
      <ul class="grid">
        {#each shown as e (e.key)}
          <li
            class={cn(
              "grid grid-cols-[92px_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b px-1 py-2.5 [grid-template-areas:'kind_title_when''kind_body_when'] last:border-0",
              e.seen && 'opacity-55',
            )}
          >
            <Badge variant="outline" class={cn('[grid-area:kind] self-start justify-self-start', KIND_TONE[e.kind])}>{LABEL[e.kind]}</Badge>
            <a
              class="text-foreground hover:text-primary font-semibold no-underline [grid-area:title]"
              href={e.url}
              target="_blank"
              rel="noopener"
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
