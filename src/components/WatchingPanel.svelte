<script lang="ts">
  import { bg } from '@/lib/messages';
  import { getSettings, getWatches, patchSettings, patchWatches, watchesItem } from '@/lib/settings';
  import { channelUrl, threadUrl, type Channel } from '@/lib/types';
  import { NO_WATCHES, type Watches } from '@/lib/watch';
  import { sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';
  import * as Card from '@/components/ui/card';
  import * as Select from '@/components/ui/select';
  import * as Table from '@/components/ui/table';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import { Label } from '@/components/ui/label';
  import { Switch } from '@/components/ui/switch';
  import X from '@lucide/svelte/icons/x';

  let w = $state<Watches>(NO_WATCHES);
  let channels = $state<Channel[]>([]);
  let channelsError = $state('');
  let pick = $state('');
  let authorInput = $state('');
  let kwInput = $state('');
  /** Keyword scope: '' = every watched channel, else a channel id. */
  let kwChannel = $state('');
  const ALL_CH = 'all';
  let pollMinutes = $state(5);
  let pollAuto = $state(true);
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
  const link = 'text-foreground hover:text-primary font-semibold no-underline';

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
      <Card.Action class="flex flex-wrap items-center gap-3">
        <Label class="text-muted-foreground font-normal" title="Off = passive: nothing runs in the background, the Feed only updates when you press Check now">
          <Switch checked={pollAuto} onCheckedChange={(on) => ((pollAuto = on), patchSettings({ pollAuto: on }))} />
          Check automatically
        </Label>
        <Label class="text-muted-foreground font-normal">
          every
          <Input
            type="number"
            min="2"
            max="120"
            class="w-16"
            disabled={!pollAuto}
            bind:value={pollMinutes}
            onchange={() => patchSettings({ pollMinutes: Math.max(2, Number(pollMinutes) || 5) })}
          /> min
        </Label>
      </Card.Action>
    </Card.Header>
    <Card.Content>
      {#if !w.threads.length}
        <p class="text-muted-foreground py-6 text-center">No watched threads.</p>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <SortTh key="subject" bind:sort>Thread</SortTh>
              <SortTh key="replies" bind:sort firstDir="desc">Replies</SortTh>
              <SortTh key="added" bind:sort firstDir="desc">Since</SortTh>
              <Table.Head></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each threads as t (t.id)}
              <Table.Row>
                <Table.Cell class="whitespace-normal"><a class={link} href={threadUrl(t.channelId, t.slug)} target="_blank" rel="noopener">{t.subject}</a></Table.Cell>
                <Table.Cell>{t.replies}</Table.Cell>
                <Table.Cell class="text-muted-foreground">{new Date(t.addedAt).toLocaleDateString()}</Table.Cell>
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
                    <Label class="text-muted-foreground font-normal">
                      <Checkbox
                        checked={c.allThreads}
                        onCheckedChange={(on) => patchWatches((v) => ({ ...v, channels: v.channels.map((x) => (x.id === c.id ? { ...x, allThreads: on } : x)) }))}
                      />
                      All new threads
                    </Label>
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
        {#if channelsError}<span class="text-destructive">{channelsError}</span>{/if}
      </div>
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
                <Table.Cell class="text-muted-foreground">{new Date(k.addedAt).toLocaleDateString()}</Table.Cell>
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
        <Select.Root type="single" value={kwChannel || ALL_CH} onValueChange={(v) => (kwChannel = v === ALL_CH ? '' : v)}>
          <Select.Trigger aria-label="Where" class="min-w-56">{kwChannel ? channelName(kwChannel) : 'Every watched channel'}</Select.Trigger>
          <Select.Content class="max-h-80">
            <Select.Item value={ALL_CH}>Every watched channel</Select.Item>
            {#each channels as c (c.id)}<Select.Item value={String(c.id)}>{c.name}{w.channels.some((x) => x.id === String(c.id)) ? '' : ' (not watched yet — will be)'}</Select.Item>{/each}
          </Select.Content>
        </Select.Root>
        <Button type="submit" variant="outline" disabled={!kwValid}>Follow</Button>
        {#if kwInput.trim() && !kwValid}<span class="text-destructive text-xs">Invalid regex.</span>{/if}
        {#if !w.channels.length && !kwChannel}<span class="text-muted-foreground text-xs">No watched channels yet — pick one above or here, keywords are only seen in watched channels.</span>{/if}
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Authors</Card.Title>
      <Card.Description>Their new threads and latest replies in your watched channels notify you. Add from any reply ("Watch author") or by handle.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        {#each w.authors as a (a.nickname)}
          <Badge variant="secondary" class="pr-0.5">
            {a.displayname}{a.displayname !== a.nickname ? ` @${a.nickname}` : ''}
            <Button
              variant="ghost"
              size="icon-xs"
              class="size-4 rounded-full"
              aria-label={`Unwatch ${a.nickname}`}
              onclick={() => patchWatches((v) => ({ ...v, authors: v.authors.filter((x) => x.nickname !== a.nickname) }))}><X /></Button
            >
          </Badge>
        {:else}
          <span class="text-muted-foreground">None.</span>
        {/each}
      </div>
      <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), addAuthor())}>
        <Input class="w-64" placeholder="Handle, e.g. Stamp-CIG" bind:value={authorInput} aria-label="Author handle" />
        <Button type="submit" variant="outline" disabled={!authorInput.trim()}>Watch author</Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
