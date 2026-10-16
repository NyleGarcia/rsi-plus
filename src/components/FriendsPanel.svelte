<script lang="ts">
  import {
    allTags,
    blankNote,
    filterRows,
    parseTags,
    rows,
    sortRows,
    splitRequests,
    statusOf,
    toCsv,
    type FriendNotes,
    STATUS_ORDER,
    type StatusFilter,
  } from '@/lib/friends';
  import { bg, type BulkResult } from '@/lib/messages';
  import { sortBy, type SortState } from '@/lib/sort';
  import SortTh from './SortTh.svelte';
  import { groupByOrg, mainOrgFromBadges, ORG_TTL, type Org, type OrgCache } from '@/lib/orgs';
  import { friendNotesItem, getSettings, getWatches, orgCacheItem, partyLogItem, partyModeItem, patchSettings, patchWatches, watchesItem } from '@/lib/settings';
  import { partyActive, type PartyLogEntry, type PartyMode } from '@/lib/friends';
  import type { FriendsData } from '@/lib/api';
  import { memberUrl, type Member } from '@/lib/types';
  import { isOnline } from '@/lib/watch';
  import { cn } from '@/lib/utils';
  import * as Alert from '@/components/ui/alert';
  import * as Card from '@/components/ui/card';
  import * as Collapsible from '@/components/ui/collapsible';
  import * as Select from '@/components/ui/select';
  import * as Table from '@/components/ui/table';
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import * as Tooltip from '@/components/ui/tooltip';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Checkbox } from '@/components/ui/checkbox';
  import { Input } from '@/components/ui/input';
  import { Label } from '@/components/ui/label';
  import { Switch } from '@/components/ui/switch';
  import Bell from '@lucide/svelte/icons/bell';
  import BellOff from '@lucide/svelte/icons/bell-off';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let data = $state<FriendsData | null>(null);
  let error = $state('');
  let loading = $state(false);
  let notes = $state<FriendNotes>({});
  let orgCache = $state<OrgCache>({});
  let bells = $state<string[]>([]);
  let notifyAll = $state(false);

  let q = $state('');
  let statusFilter = $state<StatusFilter>('all');
  let tag = $state<string | null>(null);
  let org = $state<string | null>(null);
  type Col = 'name' | 'status' | 'added' | 'orgs' | 'tags';
  let sort = $state<SortState<Col>>({ key: 'status', dir: 'asc' });
  let view = $state<'list' | 'orgs'>('list');
  /** Added-since filter: '' any, hours as string, or 'party'. */
  let added = $state('');
  let partyHours = $state(12);
  let selected = $state<Set<string>>(new Set());
  let confirmRemove = $state(false);
  let bulkTag = $state('');
  let msg = $state('');
  let orgProgress = $state<{ done: number; total: number } | null>(null);
  let editing = $state<string | null>(null);

  // ---- party mode ----
  let party = $state<PartyMode | null>(null);
  let partyLog = $state<PartyLogEntry[]>([]);
  let partyFor = $state('120'); // minutes, '' = until off
  let now = $state(Date.now());
  $effect(() => {
    partyModeItem.getValue().then((m) => (party = m));
    partyLogItem.getValue().then((l) => (partyLog = l));
    const offs = [partyModeItem.watch((m) => (party = m)), partyLogItem.watch((l) => ((partyLog = l ?? []), load()))];
    const t = setInterval(() => (now = Date.now()), 15_000);
    return () => (offs.forEach((o) => o()), clearInterval(t));
  });
  const partyOn = $derived(partyActive(party, now));
  async function setPartyMode(on: boolean) {
    const t = Date.now();
    await partyModeItem.setValue(on ? { on: true, startedAt: t, until: partyFor ? t + Number(partyFor) * 60_000 : null } : { ...(party ?? { startedAt: t, until: null }), on: false });
  }
  const sessionLog = $derived(party ? partyLog.filter((l) => l.at >= party!.startedAt) : []);

  $effect(() => {
    friendNotesItem.getValue().then((n) => (notes = n));
    orgCacheItem.getValue().then((c) => (orgCache = c));
    getWatches().then((w) => (bells = w.friendsOnline));
    getSettings().then((s) => ((notifyAll = s.notifyAllFriends), (partyHours = s.partyRemindHours)));
    load();
    const offs = [
      friendNotesItem.watch((n) => (notes = n ?? {})),
      orgCacheItem.watch((c) => (orgCache = c ?? {})),
      watchesItem.watch(async () => (bells = (await getWatches()).friendsOnline)),
    ];
    return () => offs.forEach((off) => off());
  });

  async function load() {
    loading = true;
    error = '';
    try {
      data = await bg({ type: 'friends:get' });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  const friends = $derived<Member[]>(Array.isArray(data?.friends) ? data!.friends : []);
  const members = $derived(new Map(friends.map((f) => [f.id, f])));
  const requests = $derived(splitRequests(Array.isArray(data?.requests) ? data!.requests : [], data?.me.id ?? null, members));
  const tags = $derived(allTags(notes));

  /** Known orgs: full list from the citizen page when loaded, else the main-org badge. */
  function orgsOf(m: Member): Org[] {
    const c = orgCache[m.nickname.toLowerCase()];
    if (c && !c.error) return c.orgs;
    const main = mainOrgFromBadges(m);
    return main ? [{ ...main, rank: null, main: true, members: null, redacted: false }] : [];
  }
  const orgOptions = $derived(
    groupByOrg(friends, orgsOf)
      .filter((g) => g.sid)
      .map((g) => ({ sid: g.sid, name: g.name, n: g.items.length })),
  );
  /** ms last seen online (online now = newest). */
  const seenMs = (m: Member) => (isOnline(statusOf(m)) ? Number.MAX_SAFE_INTEGER : Math.max(notes[m.id]?.lastOnline ?? 0, (m.presence?.since ?? 0) * 1000));
  const shown = $derived(
    sortBy(
      // Name order first so every column's ties read alphabetically.
      sortRows(
        filterRows(rows(friends, notes), q, statusFilter, tag, added === 'party' ? 'party' : added ? Date.now() - Number(added) * 3600_000 : null).filter(
          (r) => !org || orgsOf(r.member).some((o) => o.sid === org),
        ),
        'name',
      ),
      sort,
      {
        name: (r) => r.member.displayname,
        // Online/playing first, then most recently seen.
        status: (r) => STATUS_ORDER[statusOf(r.member)] * 1e16 - Math.min(seenMs(r.member), 1e16 - 1),
        added: (r) => r.note?.firstSeen || null, // 0 = before RSI+ → sorts last
        orgs: (r) => orgsOf(r.member).find((o) => !o.redacted)?.sid ?? null,
        tags: (r) => [...(r.note?.tags ?? []), r.note?.note ?? ''].join(' ').trim() || null,
      },
    ),
  );
  const groups = $derived(groupByOrg(shown, (r) => orgsOf(r.member)));
  const online = $derived(friends.filter((f) => isOnline(statusOf(f))).length);
  const stale = $derived(friends.filter((f) => {
    const c = orgCache[f.nickname.toLowerCase()];
    return !c || Date.now() - c.at > ORG_TTL;
  }));

  async function loadOrgs(force = false) {
    const list = (force ? friends : stale).map((f) => f.nickname);
    orgProgress = { done: 0, total: list.length };
    try {
      for (let i = 0; i < list.length; i += 10) {
        await bg({ type: 'orgs:get', nicknames: list.slice(i, i + 10), force });
        orgProgress = { done: Math.min(list.length, i + 10), total: list.length };
      }
    } catch (e) {
      msg = (e as Error).message;
    } finally {
      orgProgress = null;
    }
  }

  async function setNote(id: string, patch: Partial<{ note: string; tags: string[]; party: boolean }>) {
    const cur = await friendNotesItem.getValue();
    await friendNotesItem.setValue({ ...cur, [id]: { ...(cur[id] ?? blankNote()), ...patch } });
  }

  function toggleBell(id: string) {
    patchWatches((w) => ({ ...w, friendsOnline: w.friendsOnline.includes(id) ? w.friendsOnline.filter((x) => x !== id) : [...w.friendsOnline, id] }));
  }

  function toggle(id: string) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    selected = s;
    confirmRemove = false;
  }
  function selectShown() {
    selected = shown.every((r) => selected.has(r.member.id)) ? new Set() : new Set(shown.map((r) => r.member.id));
    confirmRemove = false;
  }

  function report(r: BulkResult, verb: string) {
    msg = `${verb} ${r.done.length}` + (r.failed.length ? ` · ${r.failed.length} failed: ${r.failed[0]!.error}` : '');
  }

  async function removeSelected() {
    if (!confirmRemove) return (confirmRemove = true);
    confirmRemove = false;
    const r = await bg({ type: 'friends:remove', ids: [...selected] });
    report(r, 'Removed');
    selected = new Set();
    await load();
  }

  async function tagSelected() {
    const add = parseTags(bulkTag);
    if (!add.length) return;
    const cur = await friendNotesItem.getValue();
    const next = { ...cur };
    for (const id of selected) {
      const n = next[id] ?? blankNote();
      next[id] = { ...n, tags: [...new Set([...n.tags, ...add])] };
    }
    await friendNotesItem.setValue(next);
    bulkTag = '';
    msg = `Tagged ${selected.size}`;
  }

  async function setParty(on: boolean) {
    const cur = await friendNotesItem.getValue();
    const next = { ...cur };
    for (const id of selected) next[id] = { ...(next[id] ?? blankNote()), party: on, partyAt: on ? Date.now() : undefined };
    await friendNotesItem.setValue(next);
    msg = on ? `Marked ${selected.size} as party friends` : `Unmarked ${selected.size}`;
  }

  const addedLabel = (m: Member) => {
    const t = notes[m.id]?.firstSeen;
    if (t == null) return '';
    if (t === 0) return 'before RSI+';
    const h = (Date.now() - t) / 3600_000;
    return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : new Date(t).toLocaleDateString();
  };

  let busyReq = $state<string | null>(null);
  let confirmDeclineAll = $state(false);

  async function requestAction(action: 'accept' | 'decline' | 'cancel', ids: string[], party = false) {
    busyReq = ids.length === 1 ? ids[0]! : 'bulk';
    try {
      const r = await bg({ type: 'friends:request', action, ids });
      report(r, { accept: 'Accepted', decline: 'Declined', cancel: 'Cancelled' }[action]);
      if (action === 'accept' && r.done.length) {
        // Stamp the add time now (exact) rather than at the next snapshot — also when re-adding someone (keeps tags/note).
        const cur = await friendNotesItem.getValue();
        const next = { ...cur };
        const now = Date.now();
        for (const id of r.done) {
          const other = requests.incoming.find((x) => x.req.id === id)?.req.requesting_member_id;
          if (other)
            next[other] = { ...(next[other] ?? blankNote()), firstSeen: now, party, partyAt: party ? now : undefined, removedAt: undefined };
        }
        await friendNotesItem.setValue(next);
      }
    } catch (e) {
      msg = (e as Error).message;
    } finally {
      busyReq = null;
      await load();
    }
  }

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([toCsv(shown, orgsOf)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `spectrum-friends-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const STATUS_LABEL: Record<string, string> = {
    online: 'Online',
    playing: 'Playing',
    away: 'Away',
    do_not_disturb: 'Busy',
    invisible: 'Invisible',
    offline: 'Offline',
  };
  const STATUS_DOT: Record<string, string> = { online: 'bg-success', playing: 'bg-success', away: 'bg-warning', do_not_disturb: 'bg-destructive' };

  // Select sentinels: bits-ui treats '' as "nothing selected", and options can't be null.
  const ANY = '__any__';
  const PARTY_FOR: Record<string, string> = { '60': 'for 1 hour', '120': 'for 2 hours', '240': 'for 4 hours', '480': 'for 8 hours', [ANY]: 'until I stop it' };
  const STATUS_FILTER: Record<string, string> = { all: 'All statuses', online: 'Online', offline: 'Offline' };
  const ADDED: Record<string, string> = {
    [ANY]: 'Added: any time',
    '1': 'Added: last hour',
    '6': 'Added: last 6 h',
    '24': 'Added: last 24 h',
    '168': 'Added: last 7 days',
    party: 'Party friends',
  };
  const orgLabel = $derived.by(() => {
    const o = orgOptions.find((x) => x.sid === org);
    return o ? `${o.sid} — ${o.name} (${o.n})` : 'All orgs';
  });
  const allShownSelected = $derived(shown.every((r) => selected.has(r.member.id)));
  const link = 'text-foreground hover:text-primary no-underline';

  const lastSeen = (m: Member) => {
    if (isOnline(statusOf(m))) return '';
    const t = Math.max(notes[m.id]?.lastOnline ?? 0, (m.presence?.since ?? 0) * 1000);
    return t ? new Date(t).toLocaleDateString() : '';
  };
</script>

{#snippet friendRow(m: Member)}
  {@const n = notes[m.id]}
  {@const st = statusOf(m)}
  {@const bellOn = notifyAll || bells.includes(m.id)}
  <Table.Row data-state={selected.has(m.id) ? 'selected' : undefined}>
    <Table.Cell><Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(m.id)} aria-label={`Select ${m.displayname}`} /></Table.Cell>
    <Table.Cell>
      <div class="flex items-center gap-2">
        {#if m.avatar}<img class="size-7 rounded-full object-cover" src={m.avatar} alt="" width="28" height="28" loading="lazy" />{/if}
        <div>
          <a class={link} href={memberUrl(m.nickname)} target="_blank" rel="noopener"><strong>{m.displayname}</strong></a>
          <div class="text-muted-foreground text-[11px]">@{m.nickname}</div>
        </div>
      </div>
    </Table.Cell>
    <Table.Cell>
      <span class={cn('mr-1.5 inline-block size-2 rounded-full bg-[#5b6270]', STATUS_DOT[st])}></span>{STATUS_LABEL[st] ?? st}
      {#if m.presence?.info}<div class="text-muted-foreground text-[11px]">{m.presence.info}</div>{/if}
      {#if lastSeen(m)}<div class="text-muted-foreground text-[11px]">seen {lastSeen(m)}</div>{/if}
    </Table.Cell>
    <Table.Cell class="text-[11px]">
      <span class={cn(!!n?.firstSeen && Date.now() - n.firstSeen < 86_400_000 && 'text-primary font-semibold')}>{addedLabel(m)}</span>
      {#if n?.party}<Badge variant="outline" class="text-warning ml-1" title="Party friend">party</Badge>{/if}
    </Table.Cell>
    <Table.Cell class="max-w-56 whitespace-normal">
      <div class="flex flex-wrap gap-1">
        {#each orgsOf(m) as o, i (`${i}:${o.sid}`)}
          {#if o.redacted}
            <Badge variant="outline" class="text-muted-foreground" title="Hidden by the member">Redacted</Badge>
          {:else}
            <Badge
              variant="outline"
              class={cn('no-underline', o.main && 'border-primary text-primary')}
              href={`https://robertsspaceindustries.com/orgs/${o.sid}`}
              target="_blank"
              rel="noopener"
              title={`${o.name}${o.rank ? ` · ${o.rank}` : ''}${o.main ? ' · main org' : ''}`}>{o.sid}</Badge
            >
          {/if}
        {:else}
          <span class="text-muted-foreground text-[11px]">—</span>
        {/each}
      </div>
    </Table.Cell>
    <Table.Cell class="whitespace-normal">
      {#if editing === m.id}
        <form class="grid min-w-48 gap-1" onsubmit={(e) => (e.preventDefault(), (editing = null))}>
          <Input class="h-7" placeholder="tags, comma separated" value={(n?.tags ?? []).join(', ')} onchange={(e) => setNote(m.id, { tags: parseTags(e.currentTarget.value) })} />
          <Input class="h-7" placeholder="note" value={n?.note ?? ''} onchange={(e) => setNote(m.id, { note: e.currentTarget.value })} />
          <Button type="submit" variant="outline" size="xs" class="justify-self-start">Done</Button>
        </form>
      {:else}
        <button type="button" class="flex flex-wrap items-center gap-1 text-left" onclick={() => (editing = m.id)} title="Edit tags and note">
          {#each n?.tags ?? [] as t (t)}<Badge variant="secondary">{t}</Badge>{/each}
          {#if n?.note}<span class="text-muted-foreground text-[11px]">{n.note}</span>{/if}
          {#if !n?.tags.length && !n?.note}<span class="text-muted-foreground text-[11px]">+ tag / note</span>{/if}
        </button>
      {/if}
    </Table.Cell>
    <Table.Cell>
      <Button
        variant="ghost"
        size="icon-sm"
        class={cn(bellOn ? 'text-primary' : 'text-muted-foreground opacity-60')}
        disabled={notifyAll}
        title="Notify when online"
        aria-label="Notify when online"
        aria-pressed={bellOn}
        onclick={() => toggleBell(m.id)}
      >
        {#if bellOn}<Bell />{:else}<BellOff />{/if}
      </Button>
    </Table.Cell>
  </Table.Row>
{/snippet}

{#snippet who(member: Member | null, fallbackId: string, req: import('@/lib/types').FriendRequest)}
  <div class="flex items-center gap-2">
    {#if member?.avatar}<img class="size-7 rounded-full object-cover" src={member.avatar} alt="" width="28" height="28" loading="lazy" />{/if}
    <div>
      <div class="flex flex-wrap items-center gap-1.5">
        {#if member}
          <a class={link} href={memberUrl(member.nickname)} target="_blank" rel="noopener"><strong>{member.displayname}</strong></a>
          <span class="text-muted-foreground text-[11px]">@{member.nickname}</span>
          {#if mainOrgFromBadges(member)}<Badge variant="secondary">{mainOrgFromBadges(member)!.sid}</Badge>{/if}
        {:else}
          <strong>Member {fallbackId}</strong>
        {/if}
      </div>
      {#if req.time_created}<div class="text-muted-foreground text-[11px]">{new Date(req.time_created * 1000).toLocaleString()}</div>{/if}
    </div>
  </div>
{/snippet}
  <div class="grid gap-4">
    <Card.Root class={cn(partyOn && 'ring-warning/50 shadow-[inset_0_0_0_1px_rgb(255_209_102/0.25)]')}>
      <Card.Header>
        <Card.Title class="flex items-center gap-2">Party mode {#if partyOn}<Badge variant="outline" class="text-warning border-warning/50">ON</Badge>{/if}</Card.Title>
        <Card.Description>
          {#if partyOn}
            Auto-accepting friend requests every minute{party?.until ? ` until ${new Date(party.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' until you turn it off'} · accepted people are flagged
            <em>party</em>.
          {:else}
            Turn on before a party: every incoming friend request is accepted automatically, flagged <em>party</em> and logged here.
          {/if}
        </Card.Description>
        <Card.Action class="flex flex-wrap items-center gap-2">
          {#if partyOn}
            <Button variant="destructive" onclick={() => setPartyMode(false)}>Stop party mode</Button>
          {:else}
            <Select.Root type="single" bind:value={() => partyFor || ANY, (v) => (partyFor = v === ANY ? '' : v)}>
              <Select.Trigger aria-label="Party mode duration">{PARTY_FOR[partyFor || ANY]}</Select.Trigger>
              <Select.Content>
                {#each Object.entries(PARTY_FOR) as [v, l] (v)}<Select.Item value={v}>{l}</Select.Item>{/each}
              </Select.Content>
            </Select.Root>
            <Button onclick={() => setPartyMode(true)}>Start party mode</Button>
          {/if}
        </Card.Action>
      </Card.Header>
      {#if partyLog.length}
        <Card.Content class="grid gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <strong>Log <span class="text-muted-foreground font-normal">({sessionLog.filter((l) => l.ok).length} accepted this session · {partyLog.length} total)</span></strong>
            <div class="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="xs" onclick={() => ((added = 'party'), (view = 'list'))}>Show party friends</Button>
              <Button variant="outline" size="xs" onclick={() => partyLogItem.setValue([])}>Clear log</Button>
            </div>
          </div>
          <ul class="grid max-h-64 overflow-auto">
            {#each partyLog.slice(0, 50) as l, i (`${l.requestId}:${l.at}:${i}`)}
              <li class="flex flex-wrap items-center gap-2 border-b py-1.5 last:border-0">
                <span class="text-muted-foreground text-[11px]">{new Date(l.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                {#if l.nickname}<a class={cn(link, 'font-semibold')} href={memberUrl(l.nickname)} target="_blank" rel="noopener">{l.displayname}</a>
                  <span class="text-muted-foreground text-[11px]">@{l.nickname}</span>{:else}{l.displayname}{/if}
                {#if l.ok}<Badge variant="outline" class="text-success">accepted</Badge>{:else}<Badge variant="outline" class="text-destructive max-w-full" title={l.error}
                    >failed{l.error ? `: ${l.error}` : ''}</Badge
                  >{/if}
              </li>
            {/each}
          </ul>
        </Card.Content>
      {/if}
    </Card.Root>

    {#if error}
      <Alert.Root variant="destructive">
        <TriangleAlert />
        <Alert.Description>{error}</Alert.Description>
        <Alert.Action><Button variant="outline" size="sm" onclick={load}>Retry</Button></Alert.Action>
      </Alert.Root>
    {/if}

    {#if data}
      <Card.Root>
        <Card.Header>
          <Card.Title>Friend requests <span class="text-muted-foreground font-normal">({requests.incoming.length} incoming · {requests.outgoing.length} sent)</span></Card.Title>
          <Card.Action><Button variant="outline" size="xs" onclick={load} disabled={loading || !!busyReq}>Refresh</Button></Card.Action>
        </Card.Header>
        <Card.Content class="grid gap-3">
          {#if requests.incoming.length}
            <div class="flex flex-wrap items-center justify-between gap-2">
              <strong>Incoming</strong>
              <div class="flex flex-wrap items-center gap-2">
                <Button size="xs" disabled={!!busyReq} onclick={() => requestAction('accept', requests.incoming.map((r) => r.req.id))}>Accept all</Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!!busyReq}
                  onclick={() => requestAction('accept', requests.incoming.map((r) => r.req.id), true)}
                  title="Accept and flag as party friends for later cleanup">Accept all as party</Button
                >
                <Button
                  variant="destructive"
                  size="xs"
                  disabled={!!busyReq}
                  onclick={() =>
                    confirmDeclineAll
                      ? ((confirmDeclineAll = false),
                        requestAction(
                          'decline',
                          requests.incoming.map((r) => r.req.id),
                        ))
                      : (confirmDeclineAll = true)}
                >
                  {confirmDeclineAll ? `Confirm: decline ${requests.incoming.length}` : 'Decline all'}
                </Button>
              </div>
            </div>
            <Table.Root>
              <Table.Body>
                {#each requests.incoming as { req, member } (req.id)}
                  <Table.Row>
                    <Table.Cell>{@render who(member, req.requesting_member_id, req)}</Table.Cell>
                    <Table.Cell>
                      <div class="flex items-center justify-end gap-2">
                        <Button size="xs" disabled={!!busyReq} onclick={() => requestAction('accept', [req.id])}>{busyReq === req.id ? '…' : 'Accept'}</Button>
                        <Button variant="outline" size="xs" disabled={!!busyReq} onclick={() => requestAction('accept', [req.id], true)} title="Accept and flag as party friend"
                          >Accept as party</Button
                        >
                        <Button variant="outline" size="xs" disabled={!!busyReq} onclick={() => requestAction('decline', [req.id])}>Decline</Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {:else}
            <span class="text-muted-foreground">No incoming requests.</span>
          {/if}
          {#if requests.outgoing.length}
            <strong>Sent</strong>
            <Table.Root>
              <Table.Body>
                {#each requests.outgoing as { req, member } (req.id)}
                  <Table.Row>
                    <Table.Cell>{@render who(member, req.target_member_id, req)}</Table.Cell>
                    <Table.Cell class="text-right">
                      <Button variant="outline" size="xs" disabled={!!busyReq} onclick={() => requestAction('cancel', [req.id])}>Cancel</Button>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}

    <Card.Root>
      <Card.Header>
        <Card.Title>Friends</Card.Title>
        <Card.Description class="grid gap-1">
          <p class="max-w-3xl text-[11px]">
            "Added" is recorded by RSI+ (Spectrum doesn't store it): friends present at the first snapshot show "before RSI+"; anyone added later — including people you
            unfriend and re-add — is timestamped within one check interval (accepting here stamps instantly). Party flow: add people → select → <em>Mark party</em> → later
            filter <em>Party friends</em> → select all → <em>Unfriend</em>.
          </p>
          <span>
            {loading ? 'Loading…' : `${friends.length} friends · ${online} online`}
            {#if data}
              {#if data.warnings.length}
                <Tooltip.Root>
                  <Tooltip.Trigger class="text-[11px]">· source {data.source} · {data.warnings.length} warning(s) — hover</Tooltip.Trigger>
                  <Tooltip.Content class="whitespace-pre-line">{data.warnings.join('\n')}</Tooltip.Content>
                </Tooltip.Root>
              {:else}
                <span class="text-[11px]">· source {data.source}</span>
              {/if}
            {/if}
          </span>
        </Card.Description>
        <Card.Action class="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!!orgProgress || !friends.length} onclick={() => loadOrgs(false)} title="Reads each friend's public RSI citizen page (~1/s), cached 24 h">
            {orgProgress ? `Orgs ${orgProgress.done}/${orgProgress.total}…` : stale.length ? `Load all orgs (${stale.length})` : 'Orgs up to date'}
          </Button>
          <Button variant="outline" onclick={exportCsv} disabled={!shown.length}>Export CSV</Button>
          <Button variant="outline" onclick={load} disabled={loading}>Refresh</Button>
        </Card.Action>
      </Card.Header>

      <Card.Content class="grid gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Input class="w-64" placeholder="Search name, handle, tag, note" bind:value={q} aria-label="Search friends" />
          <Select.Root type="single" bind:value={statusFilter}>
            <Select.Trigger aria-label="Status">{STATUS_FILTER[statusFilter]}</Select.Trigger>
            <Select.Content>
              {#each Object.entries(STATUS_FILTER) as [v, l] (v)}<Select.Item value={v}>{l}</Select.Item>{/each}
            </Select.Content>
          </Select.Root>
          <Select.Root type="single" bind:value={() => org ?? ANY, (v) => (org = v === ANY ? null : v)}>
            <Select.Trigger aria-label="Org" class="max-w-64">{orgLabel}</Select.Trigger>
            <Select.Content class="max-h-80">
              <Select.Item value={ANY}>All orgs</Select.Item>
              {#each orgOptions as o (o.sid)}<Select.Item value={o.sid}>{o.sid} — {o.name} ({o.n})</Select.Item>{/each}
            </Select.Content>
          </Select.Root>
          {#if tags.length}
            <Select.Root type="single" bind:value={() => tag ?? ANY, (v) => (tag = v === ANY ? null : v)}>
              <Select.Trigger aria-label="Tag">{tag ?? 'All tags'}</Select.Trigger>
              <Select.Content class="max-h-80">
                <Select.Item value={ANY}>All tags</Select.Item>
                {#each tags as t (t)}<Select.Item value={t}>{t}</Select.Item>{/each}
              </Select.Content>
            </Select.Root>
          {/if}
          <Select.Root type="single" bind:value={() => added || ANY, (v) => (added = v === ANY ? '' : v)}>
            <Select.Trigger aria-label="Added">{ADDED[added || ANY]}</Select.Trigger>
            <Select.Content>
              {#each Object.entries(ADDED) as [v, l] (v)}<Select.Item value={v}>{l}</Select.Item>{/each}
            </Select.Content>
          </Select.Root>
          <ToggleGroup.Root
            type="single"
            variant="outline"
            aria-label="View"
            value={view}
            onValueChange={(v) => {
              if (v === 'list' || v === 'orgs') view = v;
            }}
          >
            <ToggleGroup.Item value="list">List</ToggleGroup.Item>
            <ToggleGroup.Item value="orgs">Group by org</ToggleGroup.Item>
          </ToggleGroup.Root>
          <Label class="text-muted-foreground font-normal" title="Feed + notification reminder to remove party friends (0 = off)">
            Party reminder after
            <Input
              type="number"
              min="0"
              max="720"
              class="w-16"
              bind:value={partyHours}
              onchange={() => patchSettings({ partyRemindHours: Math.max(0, Number(partyHours) || 0) })}
            /> h
          </Label>
          <Label class="text-muted-foreground font-normal">
            <Switch bind:checked={notifyAll} onCheckedChange={(v) => patchSettings({ notifyAllFriends: v })} />
            Notify for every friend online
          </Label>
        </div>

        {#if selected.size}
          <div class="bg-primary/8 flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2">
            <strong>{selected.size} selected</strong>
            <Input class="h-7 w-48" placeholder="add tags" bind:value={bulkTag} aria-label="Tags to add" />
            <Button variant="outline" size="xs" disabled={!bulkTag.trim()} onclick={tagSelected}>Tag</Button>
            <Button variant="outline" size="xs" onclick={() => setParty(true)}>Mark party</Button>
            <Button variant="outline" size="xs" onclick={() => setParty(false)}>Unmark party</Button>
            <Button variant="destructive" size="xs" onclick={removeSelected}>{confirmRemove ? `Confirm: unfriend ${selected.size}` : 'Unfriend'}</Button>
            <Button variant="outline" size="xs" onclick={() => ((selected = new Set()), (confirmRemove = false))}>Clear</Button>
          </div>
        {/if}
        {#if msg}<span class="text-muted-foreground">{msg}</span>{/if}

        {#if !shown.length}
          <p class="text-muted-foreground py-6 text-center">{loading ? 'Loading…' : friends.length ? 'No friends match.' : 'No friends loaded.'}</p>
        {:else}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head><Checkbox checked={allShownSelected} onCheckedChange={selectShown} aria-label="Select all shown" /></Table.Head>
                <SortTh key="name" bind:sort>Friend</SortTh>
                <SortTh key="status" bind:sort>Status</SortTh>
                <SortTh key="added" bind:sort firstDir="desc">Added</SortTh>
                <SortTh key="orgs" bind:sort>Orgs</SortTh>
                <SortTh key="tags" bind:sort>Tags / note</SortTh>
                <Table.Head></Table.Head>
              </Table.Row>
            </Table.Header>
            {#if view === 'list'}
              <Table.Body>
                {#each shown as r (r.member.id)}{@render friendRow(r.member)}{/each}
              </Table.Body>
            {:else}
              {#each groups as g (g.sid)}
                <Collapsible.Root open={true}>
                  {#snippet child()}
                    <tbody data-slot="table-body">
                      <Table.Row class="hover:bg-transparent">
                        <Table.Head colspan={7} class="text-foreground pt-4 text-[13px]">
                          <div class="flex items-center gap-1.5">
                            <Collapsible.Trigger>
                              {#snippet child({ props })}
                                <Button {...props} variant="ghost" size="icon-xs" aria-label={`Toggle ${g.name}`}>
                                  <ChevronDown class="transition-transform [[data-state=closed]>&]:-rotate-90" />
                                </Button>
                              {/snippet}
                            </Collapsible.Trigger>
                            {#if g.sid}<a class="text-foreground hover:text-primary" href={`https://robertsspaceindustries.com/orgs/${g.sid}`} target="_blank" rel="noopener">{g.name}</a>
                              <span class="text-muted-foreground font-normal">[{g.sid}]</span>{:else}{g.name}{/if}
                            <span class="text-muted-foreground font-normal">· {g.items.length}</span>
                          </div>
                        </Table.Head>
                      </Table.Row>
                    </tbody>
                    <Collapsible.Content>
                      {#snippet child({ props, open })}
                        <tbody {...props} data-slot="table-body">
                          {#if open}{#each g.items as r (r.member.id)}{@render friendRow(r.member)}{/each}{/if}
                        </tbody>
                      {/snippet}
                    </Collapsible.Content>
                  {/snippet}
                </Collapsible.Root>
              {/each}
            {/if}
          </Table.Root>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
