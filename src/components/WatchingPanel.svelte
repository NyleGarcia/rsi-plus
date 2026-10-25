<script lang="ts">
  import { bg } from '@/lib/messages';
  import { getSettings, getWatches, patchSettings, patchWatches, watchesItem } from '@/lib/settings';
  import { channelUrl, threadUrl, type Channel } from '@/lib/types';
  import { NO_WATCHES, type Watches } from '@/lib/watch';
  import { sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';
  import SwitchRow from './SwitchRow.svelte';
  import Chip from './Chip.svelte';
  import Empty from './Empty.svelte';
  import { LINK_QUIET } from '@/lib/ui';
  import { fmtDate } from '@/lib/dates';
  import { cn } from '@/lib/utils';
  import { POLL_MINUTES, clampSetting, toggleOf } from '@/lib/settings-ui';
  import * as Card from '@/components/ui/card';
  import * as Select from '@/components/ui/select';
  import * as Table from '@/components/ui/table';
  import * as Alert from '@/components/ui/alert';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Label } from '@/components/ui/label';

  let w = $state<Watches>(NO_WATCHES);
  let channels = $state<Channel[]>([]);
  let channelsError = $state('');
  let pick = $state('');
  let authorInput = $state('');
  let kwInput = $state('');
  /** Keyword scope: '' = every watched channel, else a channel id. */
  let kwChannel = $state('');
  /** Select sentinel: bits-ui treats '' as "nothing selected", and options can't be null. */
  const ANY = '__any__';
  let pollMinutes = $state(5);
  let pollAuto = $state(true);
  const autoPoll = toggleOf('pollAuto');
  let sort = $state<SortState<'subject' | 'replies' | 'added'>>({ key: 'added', dir: 'desc' });
  const threads = $derived(sortBy(w.threads, sort, { subject: (t) => t.subject, replies: (t) => t.replies, added: (t) => t.addedAt }));

  $effect(() => {
    getWatches().then((v) => (w = v));
    getSettings().then((s) => ((pollMinutes = s.pollMinutes), (pollAuto = s.pollAuto)));
    bg({ type: 'channels:list' })
      .then((c) => (channels = c.sort((a, b) => a.groupId - b.groupId || a.name.localeCompare(b.name))))
      .catch((e) => (channelsError = (e as Error).message));
    return watchesItem.watch(async () => (w = await getWatches()));
  });

  const unwatched = $derived(channels.filter((c) => !w.channels.some((x) => x.id === String(c.id))));
  const pickName = $derived(unwatched.find((c) => String(c.id) === pick)?.name);
  const link = cn(LINK_QUIET, 'font-semibold');

  function addChannel() {
    const c = channels.find((x) => String(x.id) === pick);
    if (!c) return;
    patchWatches((v) => ({ ...v, channels: [...v.channels, { id: String(c.id), name: c.name, lastThreadId: null, allThreads: false }] }));
    pick = '';
  }
  const channelName = (id: string | null) => (id == null ? 'every watched channel' : (channels.find((c) => String(c.id) === id)?.name ?? w.channels.find((c) => c.id === id)?.name ?? `channel ${id}`));
  const kwValid = $derived.by(() => {
    const k = kwInput.trim();
    const re = k.match(/^\/(.+)\/([a-z]*)$/);
    if (!re) return !!k;
    try {
      new RegExp(re[1]!, 'i');
      return true;
    } catch {
      return false;
    }
  });
  /** Adds the keyword; a channel scope that isn't watched yet gets watched too (quietly — keyword hits only), since that's where the poll looks. */
  function addKeyword() {
    const pattern = kwInput.trim();
    if (!pattern || !kwValid) return;
    const channelId = kwChannel || null;
    patchWatches((v) => {
      if (v.keywords.some((k) => k.pattern === pattern && k.channelId === channelId)) return v;
      const c = channelId && !v.channels.some((x) => x.id === channelId) ? channels.find((x) => String(x.id) === channelId) : null;
      return {
        ...v,
        keywords: [...v.keywords, { pattern, channelId, addedAt: Date.now() }],
        channels: c ? [...v.channels, { id: String(c.id), name: c.name, lastThreadId: null, allThreads: false }] : v.channels,
      };
    });
    kwInput = '';
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

<div class="grid gap-4">
  <Card.Root>
    <Card.Header>
      <Card.Title>Threads</Card.Title>
      <Card.Description>Notified when a watched thread gets new replies. Add with ☆ on a thread row or the bar on a thread page.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <SwitchRow id="watch-pollAuto" label={autoPoll.label} hint={autoPoll.hint} checked={pollAuto} onchange={(on) => ((pollAuto = on), patchSettings({ pollAuto: on }))}>
        <Label class="text-muted-foreground gap-1.5 font-normal">
          {POLL_MINUTES.label}
          <Input
            type="number"
            min={POLL_MINUTES.min}
            max={POLL_MINUTES.max}
            step="1"
            class="w-16"
            disabled={!pollAuto}
            bind:value={pollMinutes}
            onchange={() => patchSettings({ pollMinutes: clampSetting(POLL_MINUTES, pollMinutes) })}
          />
          {POLL_MINUTES.unit}
        </Label>
      </SwitchRow>
      {#if !w.threads.length}
        <Empty>No watched threads.</Empty>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <SortTh key="subject" bind:sort>Thread</SortTh>
              <SortTh key="replies" bind:sort firstDir="desc">Replies</SortTh>
              <SortTh key="added" bind:sort firstDir="desc">Since</SortTh>
              <Table.Head><span class="sr-only">Actions</span></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each threads as t (t.id)}
              <Table.Row>
                <Table.Cell class="whitespace-normal"><a class={link} href={threadUrl(t.channelId, t.slug)} target="_blank" rel="noopener">{t.subject}</a></Table.Cell>
                <Table.Cell>{t.replies}</Table.Cell>
                <Table.Cell class="text-muted-foreground">{fmtDate(t.addedAt)}</Table.Cell>
                <Table.Cell class="text-right">
                  <Button variant="outline" size="xs" onclick={() => patchWatches((v) => ({ ...v, threads: v.threads.filter((x) => x.id !== t.id) }))}>Unwatch</Button>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Channels</Card.Title>
      <Card.Description>New dev threads, dev replies and watched-author posts in these channels notify you. "All new threads" notifies for every new thread.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if w.channels.length}
        <Table.Root>
          <Table.Body>
            {#each w.channels as c (c.id)}
              <Table.Row>
                <Table.Cell><a class={link} href={channelUrl(c.id)} target="_blank" rel="noopener">{c.name}</a></Table.Cell>
                <Table.Cell>
                  <div class="flex items-center justify-end gap-3">
                    <SwitchRow
                      id={`watch-all-${c.id}`}
                      label="All new threads"
                      size="sm"
                      class="text-muted-foreground items-center"
                      checked={c.allThreads}
                      onchange={(on) => patchWatches((v) => ({ ...v, channels: v.channels.map((x) => (x.id === c.id ? { ...x, allThreads: on } : x)) }))}
                    />
                    <Button variant="outline" size="xs" onclick={() => patchWatches((v) => ({ ...v, channels: v.channels.filter((x) => x.id !== c.id) }))}>Unwatch</Button>
                  </div>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
      <div class="flex flex-wrap items-center gap-2">
        <Select.Root type="single" bind:value={pick}>
          <Select.Trigger aria-label="Channel to watch" class="min-w-56">{pickName ?? 'Add a channel…'}</Select.Trigger>
          <Select.Content class="max-h-80">
            {#each unwatched as c (c.id)}<Select.Item value={String(c.id)}>{c.name}</Select.Item>{/each}
          </Select.Content>
        </Select.Root>
        <Button variant="outline" disabled={!pick} onclick={addChannel}>Watch</Button>
      </div>
      {#if channelsError}<Alert.Root variant="destructive"><Alert.Description>{channelsError}</Alert.Description></Alert.Root>{/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Keywords</Card.Title>
      <Card.Description>Follow a topic: a new thread whose subject matches notifies you, in every watched channel or one channel. Plain text matches anywhere in the subject; <code>/regex/</code> is a regex (case-insensitive). Matching rows get a purple edge on Spectrum. Same syntax as Mutes.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if w.keywords.length}
        <Table.Root>
          <Table.Body>
            {#each w.keywords as k (k.pattern + '|' + k.channelId)}
              <Table.Row>
                <Table.Cell><code class="text-[12.5px]">{k.pattern}</code></Table.Cell>
                <Table.Cell class="text-muted-foreground">{k.channelId == null ? 'every watched channel' : channelName(k.channelId)}</Table.Cell>
                <Table.Cell class="text-muted-foreground">{fmtDate(k.addedAt)}</Table.Cell>
                <Table.Cell class="text-right">
                  <Button variant="outline" size="xs" onclick={() => patchWatches((v) => ({ ...v, keywords: v.keywords.filter((x) => !(x.pattern === k.pattern && x.channelId === k.channelId)) }))}>Remove</Button>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
      <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), addKeyword())}>
        <Input class="w-64" placeholder={'e.g. Polaris or /\\bwipe\\b/'} bind:value={kwInput} aria-label="Keyword or /regex/" aria-invalid={!!kwInput.trim() && !kwValid} />
        <Select.Root type="single" bind:value={() => kwChannel || ANY, (v) => (kwChannel = v === ANY ? '' : v)}>
          <Select.Trigger aria-label="Where" class="min-w-56">{kwChannel ? channelName(kwChannel) : 'Every watched channel'}</Select.Trigger>
          <Select.Content class="max-h-80">
            <Select.Item value={ANY}>Every watched channel</Select.Item>
            {#each channels as c (c.id)}<Select.Item value={String(c.id)}>{c.name}{w.channels.some((x) => x.id === String(c.id)) ? '' : ' (not watched yet — will be)'}</Select.Item>{/each}
          </Select.Content>
        </Select.Root>
        <Button type="submit" variant="outline" disabled={!kwValid}>Follow</Button>
      </form>
      {#if kwInput.trim() && !kwValid}<Alert.Root variant="destructive"><Alert.Description>Invalid regex.</Alert.Description></Alert.Root>{/if}
      {#if !w.channels.length && !kwChannel}<Empty class="py-3 text-xs">No watched channels yet — pick one above or here, keywords are only seen in watched channels.</Empty>{/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Authors</Card.Title>
      <Card.Description>Their new threads and latest replies in your watched channels notify you. Add from any reply ("Watch author") or by handle.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if w.authors.length}
        <div class="flex flex-wrap items-center gap-2">
          {#each w.authors as a (a.nickname)}
            <Chip removeLabel={`Unwatch ${a.nickname}`} onremove={() => patchWatches((v) => ({ ...v, authors: v.authors.filter((x) => x.nickname !== a.nickname) }))}
              >{a.displayname}{a.displayname !== a.nickname ? ` @${a.nickname}` : ''}</Chip
            >
          {/each}
        </div>
      {:else}
        <Empty class="py-2 text-left">None.</Empty>
      {/if}
      <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), addAuthor())}>
        <Input class="w-64" placeholder="Handle, e.g. Stamp-CIG" bind:value={authorInput} aria-label="Author handle" />
        <Button type="submit" variant="outline" disabled={!authorInput.trim()}>Watch author</Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
