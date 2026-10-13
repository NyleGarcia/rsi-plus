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
  const lastSeen = (m: Member) => {
    if (isOnline(statusOf(m))) return '';
    const t = Math.max(notes[m.id]?.lastOnline ?? 0, (m.presence?.since ?? 0) * 1000);
    return t ? new Date(t).toLocaleDateString() : '';
  };
</script>

{#snippet friendRow(m: Member)}
  {@const n = notes[m.id]}
  {@const st = statusOf(m)}
  <tr class:sel={selected.has(m.id)}>
    <td><input type="checkbox" checked={selected.has(m.id)} onchange={() => toggle(m.id)} aria-label={`Select ${m.displayname}`} /></td>
    <td>
      <div class="who">
        {#if m.avatar}<img src={m.avatar} alt="" width="28" height="28" loading="lazy" />{/if}
        <div>
          <a href={memberUrl(m.nickname)} target="_blank" rel="noopener"><strong>{m.displayname}</strong></a>
          <div class="muted small">@{m.nickname}</div>
        </div>
      </div>
    </td>
    <td>
      <span class="dot s-{st}"></span>{STATUS_LABEL[st] ?? st}
      {#if m.presence?.info}<div class="muted small">{m.presence.info}</div>{/if}
      {#if lastSeen(m)}<div class="muted small">seen {lastSeen(m)}</div>{/if}
    </td>
    <td class="small">
      <span class:recent={!!n?.firstSeen && Date.now() - n.firstSeen < 86_400_000}>{addedLabel(m)}</span>
      {#if n?.party}<span class="chip party" title="Party friend">party</span>{/if}
    </td>
    <td class="orgs">
      {#each orgsOf(m) as o, i (`${i}:${o.sid}`)}
        {#if o.redacted}
          <span class="chip muted" title="Hidden by the member">Redacted</span>
        {:else}
          <a class="chip" class:main={o.main} href={`https://robertsspaceindustries.com/orgs/${o.sid}`} target="_blank" rel="noopener" title={`${o.name}${o.rank ? ` · ${o.rank}` : ''}${o.main ? ' · main org' : ''}`}>{o.sid}</a>
        {/if}
      {:else}
        <span class="muted small">—</span>
      {/each}
    </td>
    <td>
      {#if editing === m.id}
        <form class="edit" onsubmit={(e) => (e.preventDefault(), (editing = null))}>
          <input placeholder="tags, comma separated" value={(n?.tags ?? []).join(', ')} onchange={(e) => setNote(m.id, { tags: parseTags(e.currentTarget.value) })} />
          <input placeholder="note" value={n?.note ?? ''} onchange={(e) => setNote(m.id, { note: e.currentTarget.value })} />
          <button class="btn small">Done</button>
        </form>
      {:else}
        <button class="notes" onclick={() => (editing = m.id)} title="Edit tags and note">
          {#each n?.tags ?? [] as t}<span class="chip">{t}</span>{/each}
          {#if n?.note}<span class="muted small">{n.note}</span>{/if}
          {#if !n?.tags.length && !n?.note}<span class="muted small">+ tag / note</span>{/if}
        </button>
      {/if}
    </td>
    <td>
      <button class="bell" class:on={notifyAll || bells.includes(m.id)} disabled={notifyAll} title="Notify when online" onclick={() => toggleBell(m.id)}
        >{notifyAll || bells.includes(m.id) ? '🔔' : '🔕'}</button
      >
    </td>
  </tr>
{/snippet}

<div class="stack">
  <section class="card stack party" class:live={partyOn}>
    <div class="row spread">
      <div>
        <h2>Party mode {#if partyOn}<span class="chip live-chip">ON</span>{/if}</h2>
        <span class="muted">
          {#if partyOn}
            Auto-accepting friend requests every minute{party?.until ? ` until ${new Date(party.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' until you turn it off'} · accepted people are flagged
            <em>party</em>.
          {:else}
            Turn on before a party: every incoming friend request is accepted automatically, flagged <em>party</em> and logged here.
          {/if}
        </span>
      </div>
      <div class="row">
        {#if partyOn}
          <button class="btn danger" onclick={() => setPartyMode(false)}>Stop party mode</button>
        {:else}
          <select bind:value={partyFor} aria-label="Party mode duration">
            <option value="60">for 1 hour</option>
            <option value="120">for 2 hours</option>
            <option value="240">for 4 hours</option>
            <option value="480">for 8 hours</option>
            <option value="">until I stop it</option>
          </select>
          <button class="btn primary" onclick={() => setPartyMode(true)}>Start party mode</button>
        {/if}
      </div>
    </div>
    {#if partyLog.length}
      <div class="row spread">
        <strong>Log <span class="muted">({sessionLog.filter((l) => l.ok).length} accepted this session · {partyLog.length} total)</span></strong>
        <div class="row">
          <button class="btn small" onclick={() => ((added = 'party'), (view = 'list'))}>Show party friends</button>
          <button class="btn small" onclick={() => partyLogItem.setValue([])}>Clear log</button>
        </div>
      </div>
      <ul class="log">
        {#each partyLog.slice(0, 50) as l, i (`${l.requestId}:${l.at}:${i}`)}
          <li class:fail={!l.ok}>
            <span class="muted small">{new Date(l.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            {#if l.nickname}<a href={memberUrl(l.nickname)} target="_blank" rel="noopener">{l.displayname}</a> <span class="muted small">@{l.nickname}</span>{:else}{l.displayname}{/if}
            {#if l.ok}<span class="chip ok-chip">accepted</span>{:else}<span class="chip fail-chip" title={l.error}>failed{l.error ? `: ${l.error}` : ''}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if error}
    <section class="card row spread">
      <span class="err">{error}</span>
      <button class="btn" onclick={load}>Retry</button>
    </section>
  {/if}

  {#snippet who(member: Member | null, fallbackId: string, req: import('@/lib/types').FriendRequest)}
    <div class="who">
      {#if member?.avatar}<img src={member.avatar} alt="" width="28" height="28" loading="lazy" />{/if}
      <div>
        {#if member}
          <a href={memberUrl(member.nickname)} target="_blank" rel="noopener"><strong>{member.displayname}</strong></a>
          <span class="muted small">@{member.nickname}</span>
          {#if mainOrgFromBadges(member)}<span class="chip">{mainOrgFromBadges(member)!.sid}</span>{/if}
        {:else}
          <strong>Member {fallbackId}</strong>
        {/if}
        {#if req.time_created}<div class="muted small">{new Date(req.time_created * 1000).toLocaleString()}</div>{/if}
      </div>
    </div>
  {/snippet}

  {#if data}
    <section class="card stack">
      <div class="row spread">
        <h2>Friend requests <span class="muted">({requests.incoming.length} incoming · {requests.outgoing.length} sent)</span></h2>
        <button class="btn small" onclick={load} disabled={loading || !!busyReq}>Refresh</button>
      </div>
      {#if requests.incoming.length}
        <div class="row spread">
          <strong>Incoming</strong>
          <div class="row">
            <button class="btn small primary" disabled={!!busyReq} onclick={() => requestAction('accept', requests.incoming.map((r) => r.req.id))}>Accept all</button>
            <button class="btn small" disabled={!!busyReq} onclick={() => requestAction('accept', requests.incoming.map((r) => r.req.id), true)} title="Accept and flag as party friends for later cleanup">Accept all as party</button>
            <button class="btn small danger" disabled={!!busyReq} onclick={() => (confirmDeclineAll ? ((confirmDeclineAll = false), requestAction('decline', requests.incoming.map((r) => r.req.id))) : (confirmDeclineAll = true))}>
              {confirmDeclineAll ? `Confirm: decline ${requests.incoming.length}` : 'Decline all'}
            </button>
          </div>
        </div>
        {#each requests.incoming as { req, member } (req.id)}
          <div class="row spread line">
            {@render who(member, req.requesting_member_id, req)}
            <div class="row">
              <button class="btn small primary" disabled={!!busyReq} onclick={() => requestAction('accept', [req.id])}>{busyReq === req.id ? '…' : 'Accept'}</button>
              <button class="btn small" disabled={!!busyReq} onclick={() => requestAction('accept', [req.id], true)} title="Accept and flag as party friend">Accept as party</button>
              <button class="btn small" disabled={!!busyReq} onclick={() => requestAction('decline', [req.id])}>Decline</button>
            </div>
          </div>
        {/each}
      {:else}
        <span class="muted">No incoming requests.</span>
      {/if}
      {#if requests.outgoing.length}
        <strong>Sent</strong>
        {#each requests.outgoing as { req, member } (req.id)}
          <div class="row spread line">
            {@render who(member, req.target_member_id, req)}
            <button class="btn small" disabled={!!busyReq} onclick={() => requestAction('cancel', [req.id])}>Cancel</button>
          </div>
        {/each}
      {/if}
    </section>
  {/if}

  <section class="card stack">
    <div class="row spread">
      <div>
        <h2>Friends</h2>
        <p class="muted small hint">
          "Added" is recorded by RSI+ (Spectrum doesn't store it): friends present at the first snapshot show "before RSI+";
          anyone added later — including people you unfriend and re-add — is timestamped within one check interval (accepting here stamps
          instantly). Party flow: add people → select → <em>Mark party</em> → later filter <em>Party friends</em> → select all → <em>Unfriend</em>.
        </p>
        <span class="muted">{loading ? 'Loading…' : `${friends.length} friends · ${online} online`}</span>
        {#if data}
          <span class="muted small" title={data.warnings.join('\n')}>· source {data.source}{data.warnings.length ? ` · ${data.warnings.length} warning(s) — hover` : ''}</span>
        {/if}
      </div>
      <div class="row">
        <button class="btn" disabled={!!orgProgress || !friends.length} onclick={() => loadOrgs(false)} title="Reads each friend's public RSI citizen page (~1/s), cached 24 h">
          {orgProgress ? `Orgs ${orgProgress.done}/${orgProgress.total}…` : stale.length ? `Load all orgs (${stale.length})` : 'Orgs up to date'}
        </button>
        <button class="btn" onclick={exportCsv} disabled={!shown.length}>Export CSV</button>
        <button class="btn" onclick={load} disabled={loading}>Refresh</button>
      </div>
    </div>

    <div class="row">
      <input placeholder="Search name, handle, tag, note" bind:value={q} aria-label="Search friends" />
      <select bind:value={statusFilter} aria-label="Status">
        <option value="all">All statuses</option>
        <option value="online">Online</option>
        <option value="offline">Offline</option>
      </select>
      <select bind:value={org} aria-label="Org">
        <option value={null}>All orgs</option>
        {#each orgOptions as o (o.sid)}<option value={o.sid}>{o.sid} — {o.name} ({o.n})</option>{/each}
      </select>
      {#if tags.length}
        <select bind:value={tag} aria-label="Tag">
          <option value={null}>All tags</option>
          {#each tags as t}<option value={t}>{t}</option>{/each}
        </select>
      {/if}
      <select bind:value={added} aria-label="Added">
        <option value="">Added: any time</option>
        <option value="1">Added: last hour</option>
        <option value="6">Added: last 6 h</option>
        <option value="24">Added: last 24 h</option>
        <option value="168">Added: last 7 days</option>
        <option value="party">Party friends</option>
      </select>
      <select bind:value={view} aria-label="View">
        <option value="list">List</option>
        <option value="orgs">Group by org</option>
      </select>
      <label class="row muted" title="Feed + notification reminder to remove party friends (0 = off)">
        Party reminder after
        <input type="number" min="0" max="720" style="width:60px" bind:value={partyHours} onchange={() => patchSettings({ partyRemindHours: Math.max(0, Number(partyHours) || 0) })} /> h
      </label>
      <label class="row muted"><input type="checkbox" bind:checked={notifyAll} onchange={() => patchSettings({ notifyAllFriends: notifyAll })} /> Notify for every friend online</label>
    </div>

    {#if selected.size}
      <div class="row bulk">
        <strong>{selected.size} selected</strong>
        <input placeholder="add tags" bind:value={bulkTag} aria-label="Tags to add" />
        <button class="btn small" disabled={!bulkTag.trim()} onclick={tagSelected}>Tag</button>
        <button class="btn small" onclick={() => setParty(true)}>Mark party</button>
        <button class="btn small" onclick={() => setParty(false)}>Unmark party</button>
        <button class="btn small danger" onclick={removeSelected}>{confirmRemove ? `Confirm: unfriend ${selected.size}` : 'Unfriend'}</button>
        <button class="btn small" onclick={() => ((selected = new Set()), (confirmRemove = false))}>Clear</button>
      </div>
    {/if}
    {#if msg}<span class="muted">{msg}</span>{/if}

    {#if !shown.length}
      <p class="empty">{loading ? 'Loading…' : friends.length ? 'No friends match.' : 'No friends loaded.'}</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" checked={shown.every((r) => selected.has(r.member.id))} onchange={selectShown} aria-label="Select all shown" /></th>
            <SortTh key="name" bind:sort>Friend</SortTh>
            <SortTh key="status" bind:sort>Status</SortTh>
            <SortTh key="added" bind:sort firstDir="desc">Added</SortTh>
            <SortTh key="orgs" bind:sort>Orgs</SortTh>
            <SortTh key="tags" bind:sort>Tags / note</SortTh>
            <th></th>
          </tr>
        </thead>
        {#if view === 'list'}
          <tbody>
            {#each shown as r (r.member.id)}{@render friendRow(r.member)}{/each}
          </tbody>
        {:else}
          {#each groups as g (g.sid)}
            <tbody>
              <tr class="group">
                <th colspan="7">
                  {#if g.sid}<a href={`https://robertsspaceindustries.com/orgs/${g.sid}`} target="_blank" rel="noopener">{g.name}</a> <span class="muted">[{g.sid}]</span>{:else}{g.name}{/if}
                  <span class="muted">· {g.items.length}</span>
                </th>
              </tr>
              {#each g.items as r (r.member.id)}{@render friendRow(r.member)}{/each}
            </tbody>
          {/each}
        {/if}
      </table>
    {/if}
  </section>
</div>

<style>
  .who {
    display: flex;
    gap: 9px;
    align-items: center;
  }
  .who img {
    border-radius: 50%;
    object-fit: cover;
  }
  .who a {
    color: var(--text);
    text-decoration: none;
  }
  .who a:hover {
    color: var(--accent);
  }
  .small {
    font-size: 11px;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    background: #5b6270;
  }
  .s-online,
  .s-playing {
    background: var(--ok);
  }
  .s-away {
    background: #ffd166;
  }
  .s-do_not_disturb {
    background: var(--err);
  }
  .recent {
    color: var(--accent);
    font-weight: 600;
  }
  .chip.party {
    margin-left: 4px;
    color: #ffd166;
  }
  .orgs {
    max-width: 220px;
  }
  .orgs .chip {
    margin: 1px 2px 1px 0;
    text-decoration: none;
    color: var(--text);
  }
  .orgs .chip.main {
    border-color: var(--accent);
    color: var(--accent);
  }
  .notes {
    border: 0;
    background: none;
    padding: 0;
    text-align: left;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .edit {
    display: grid;
    gap: 4px;
  }
  .bell {
    border: 0;
    background: none;
    font-size: 15px;
    opacity: 0.45;
  }
  .bell.on {
    opacity: 1;
  }
  tr.sel td {
    background: rgb(60 200 255 / 0.06);
  }
  tr.group th {
    padding-top: 16px;
    color: var(--text);
    font-size: 13px;
  }
  tr.group a {
    color: var(--text);
  }
  .bulk {
    padding: 8px 10px;
    border-radius: 10px;
    background: rgb(60 200 255 / 0.08);
  }
  .line {
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }
  .party.live {
    border-color: rgb(255 209 102 / 0.5);
    box-shadow: 0 0 0 1px rgb(255 209 102 / 0.25) inset;
  }
  .live-chip {
    color: #ffd166;
    border-color: rgb(255 209 102 / 0.5);
    margin-left: 6px;
  }
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 260px;
    overflow: auto;
    display: grid;
  }
  .log li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 5px 0;
    border-bottom: 1px solid var(--line);
  }
  .log a {
    color: var(--text);
    font-weight: 600;
    text-decoration: none;
  }
  .ok-chip {
    color: var(--ok);
  }
  .fail-chip {
    color: var(--err);
  }
</style>
