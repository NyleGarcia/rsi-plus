<script lang="ts">
  /**
   * Hub → Org lookup: look up a player or org on RSI's public pages (cached 24 h; *Refresh* re-reads), tag players
   * and orgs, browse an org's members with your tags on them, and manage / export / import your tags (lib/intel.ts).
   */
  import { fmtNum } from '@/lib/fmt';
  import { intelCacheItem, intelItem, intelSuspectsItem } from '@/lib/settings';
  import { bg } from '@/lib/messages';
  import {
    INTEL_TAGS,
    MEMBERS_PAGE,
    RSI,
    addSuspect,
    cachedLookups,
    exportIntel,
    filterIntel,
    importIntel,
    importSuspects,
    removeSuspect,
    suspectedMembers,
    suspectedOrgs,
    intelKey,
    parseLookup,
    setTag,
    spectrumPostsUrl,
    tagLabel,
    threatOf,
    type Intel,
    type IntelCache,
    type IntelEntry,
    type IntelTag,
    type OrgLookup,
    type OrgMember,
    type PlayerLookup,
    type Suspects,
  } from '@/lib/intel';
  import { NO_INTEL_CACHE } from '@/lib/intel';
  import { ago } from '@/lib/dates';
  import { dateStamp, downloadFile } from '@/lib/download';
  import { LINK_QUIET } from '@/lib/ui';
  import { cn } from '@/lib/utils';
  import IntelTagEditor from './IntelTagEditor.svelte';
  import Empty from './Empty.svelte';
  import { BADGE_VARIANT, TAG_TONE } from './intel-tone';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import { Input } from '@/components/ui/input';

  let intel = $state<Intel>({});
  let cache = $state<IntelCache>(NO_INTEL_CACHE);
  let suspects = $state<Suspects>({});
  $effect(() => {
    intelItem.getValue().then((v) => (intel = v));
    intelCacheItem.getValue().then((v) => (cache = v));
    intelSuspectsItem.getValue().then((v) => (suspects = v));
    const offs = [intelItem.watch((v) => (intel = v ?? {})), intelCacheItem.watch((v) => (cache = v ?? NO_INTEL_CACHE)), intelSuspectsItem.watch((v) => (suspects = v ?? {}))];
    return () => offs.forEach((o) => o());
  });

  /* ---- lookup ---- */
  let input = $state('');
  let busy = $state(false);
  let err = $state('');
  let player = $state<PlayerLookup | null>(null);
  let org = $state<OrgLookup | null>(null);
  const parsed = $derived(parseLookup(input));
  async function lookPlayer(handle: string, force = false) {
    err = '';
    cacheMsg = '';
    busy = true;
    try {
      const r = await bg({ type: 'intel:player', handle, force });
      if (!r.citizen) err = r.error ? `${handle}: ${r.error}` : `${handle}: no such citizen`;
      else ((player = r), (org = null), (members = null), (input = r.citizen.handle));
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function lookOrg(sid: string, force = false) {
    err = '';
    cacheMsg = '';
    busy = true;
    try {
      const r = await bg({ type: 'intel:org', sid, force });
      if (!r.org) err = `${sid}: ${r.error ?? 'no such org'}`;
      else ((org = r), (player = null), (input = r.org.sid), (members = null), void loadMembers(1, force));
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  function go(kind: 'player' | 'org') {
    if (!parsed.id) return void (err = 'Type a handle, an org SID, or paste an RSI citizen / org link');
    return kind === 'player' ? lookPlayer(parsed.id) : lookOrg(parsed.id);
  }
  function openRecent(key: string) {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    return kind === 'org' ? lookOrg(id) : lookPlayer(id);
  }
  /**
   * Forget every cached lookup (citizen pages, org pages, member lists, the Recent list). Tags and suspected orgs are
   * yours and stay; so do players' org lists, which live in the org cache shared with Friends (*Refresh* re-reads one).
   */
  let cacheMsg = $state('');
  const nCached = $derived(cachedLookups(cache));
  async function clearCache() {
    const n = nCached;
    await intelCacheItem.setValue({ citizens: {}, orgs: {}, members: {}, recent: [] });
    player = null;
    org = null;
    members = null;
    err = '';
    cacheMsg = `Cleared ${n} cached lookup${n === 1 ? '' : 's'}. Your tags and suspected orgs are kept.`;
  }
  const recentLabel = (key: string) => {
    const id = key.slice(key.indexOf(':') + 1);
    return key.startsWith('org:') ? `[${id}]` : `@${cache.citizens[id.toLowerCase()]?.citizen?.handle ?? id}`;
  };

  /** `#intel?player=<handle>` / `#intel?org=<SID>` (a Spectrum flag, a Friends row): look it up on arrival. */
  $effect(() => {
    const fromHash = () => {
      const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
      const p = q.get('player');
      const o = q.get('org');
      if (p) void lookPlayer(p);
      else if (o) void lookOrg(o);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  });

  /* ---- org members ---- */
  let members = $state<{ total: number; pages: number; list: OrgMember[]; at: number } | null>(null);
  let memberQ = $state('');
  let loadingMembers = $state(false);
  async function loadMembers(page: number, force = false) {
    if (!org?.org) return;
    loadingMembers = true;
    try {
      members = await bg({ type: 'intel:members', sid: org.org.sid, page, force });
    } catch (e) {
      err = (e as Error).message;
    } finally {
      loadingMembers = false;
    }
  }
  const shownMembers = $derived(
    (members?.list ?? []).filter((m) => !memberQ.trim() || `${m.handle} ${m.name} ${m.rank ?? ''}`.toLowerCase().includes(memberQ.trim().toLowerCase())),
  );

  const threat = $derived(player?.citizen ? threatOf(player.citizen.handle, player.orgs, intel, suspects) : null);

  /* ---- suspected orgs: your guesses (a REDACTED membership, or one RSI doesn't list) ---- */
  let guessSid = $state('');
  let guessHandle = $state('');
  let guessMsg = $state('');
  const orgName = (sid: string) => cache.orgs[sid.toUpperCase()]?.org?.name ?? intel[intelKey('org', sid)]?.name;
  async function addGuess(handle: string, sid: string) {
    guessMsg = '';
    const cur = await intelSuspectsItem.getValue();
    const next = addSuspect(cur, { handle, sid, name: orgName(sid.trim().replace(/^\[|\]$/g, '')) }, Date.now());
    if (next === cur) return void (guessMsg = 'Type an org SID (letters and digits, like BLKSYN) and a handle.');
    await intelSuspectsItem.setValue(next);
    guessSid = '';
    guessHandle = '';
  }
  async function dropGuess(handle: string, sid: string) {
    await intelSuspectsItem.setValue(removeSuspect(await intelSuspectsItem.getValue(), handle, sid));
  }
  const playerGuesses = $derived(player?.citizen ? suspectedOrgs(suspects, player.citizen.handle) : []);
  const orgGuesses = $derived(org?.org ? suspectedMembers(suspects, org.org.sid) : []);
  const hiddenOrgs = $derived((player?.orgs ?? []).filter((o) => o.redacted).length);
  const tagOf = (kind: IntelEntry['kind'], id: string) => intel[intelKey(kind, id)]?.tag ?? null;

  /* ---- your tags ---- */
  let fKind = $state<'' | 'player' | 'org'>('');
  let fTags = $state<IntelTag[]>([]);
  let fQ = $state('');
  const list = $derived(filterIntel(intel, { kind: fKind, tags: fTags, q: fQ }));
  async function retag(e: IntelEntry, t: IntelTag) {
    await intelItem.setValue(setTag(await intelItem.getValue(), { ...e, tag: t }, Date.now()));
  }
  async function untag(e: IntelEntry) {
    const cur = await intelItem.getValue();
    delete cur[intelKey(e.kind, e.id)];
    await intelItem.setValue(cur);
  }
  /** Export all: every guess too. Export shown: the guesses about the players and orgs shown. */
  function doExport(all: boolean) {
    const entries = all ? Object.values(intel) : list;
    const shown = new Set(entries.map((e) => intelKey(e.kind, e.id)));
    const guesses = Object.values(suspects).filter((g) => all || shown.has(intelKey('player', g.handle)) || shown.has(intelKey('org', g.sid)));
    downloadFile(`rsi-plus-intel-${dateStamp()}.json`, exportIntel(entries, Date.now(), guesses), 'application/json');
  }
  let overwrite = $state(false);
  let importMsg = $state('');
  async function doImport(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const r = importIntel(await intelItem.getValue(), text, { overwrite, source: file.name, now: Date.now() });
      await intelItem.setValue(r.intel);
      const g = importSuspects(await intelSuspectsItem.getValue(), text, { source: file.name, now: Date.now() });
      if (g.added) await intelSuspectsItem.setValue(g.suspects);
      importMsg = `${file.name}: ${r.added} added, ${r.updated} updated, ${r.skipped} skipped${!overwrite && r.skipped ? ' (yours kept: tick Overwrite to take theirs)' : ''}${g.added ? `; ${g.added} suspected membership${g.added === 1 ? '' : 's'} added (their guesses, not facts)` : ''}.`;
    } catch (x) {
      importMsg = `${file.name}: ${(x as Error).message}`;
    }
  }
</script>

<div class="grid gap-4">
  <Card.Root>
    <Card.Header>
      <Card.Title>Org lookup</Card.Title>
      <Card.Description>
        Look up a player or an org on RSI's public pages, tag them (hostile, caution, neutral, friendly, ally) with a note, and see your tags on Spectrum replies and in Friends. Lookups are cached for a day; tags stay in this browser unless you export them.
      </Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), go(parsed.kind ?? 'player'))}>
        <Input class="w-80" placeholder="Handle, org SID, @handle, [SID] or an RSI link" bind:value={input} aria-label="Handle or org SID" />
        <Button type="submit" disabled={busy || !parsed.id} variant={parsed.kind === 'org' ? 'outline' : 'default'} onclick={(e) => (e.preventDefault(), go('player'))}>Look up player</Button>
        <Button type="button" disabled={busy || !parsed.id} variant={parsed.kind === 'org' ? 'default' : 'outline'} onclick={() => go('org')}>Look up org</Button>
        {#if busy}<span class="text-muted-foreground text-xs">Reading RSI…</span>{/if}
      </form>
      {#if err}<p class="text-destructive text-sm" role="status">{err}</p>{/if}
      {#if cache.recent.length || nCached}
        <div class="flex flex-wrap items-center gap-1.5 text-xs">
          {#if cache.recent.length}<span class="text-muted-foreground">Recent (cached):</span>{/if}
          {#each cache.recent.slice(0, 5) as key (key)}
            {@const k = key.startsWith('org:') ? 'org' : 'player'}
            {@const t = tagOf(k, key.slice(key.indexOf(':') + 1))}
            <Button size="xs" variant="outline" class={cn(t && TAG_TONE[t])} onclick={() => openRecent(key)}>{recentLabel(key)}</Button>
          {/each}
          <Button size="xs" variant="ghost" class="ml-auto" disabled={busy} title="Forget every cached lookup (players, orgs, member lists, this Recent list). Your tags and suspected orgs are kept" onclick={clearCache}>Clear cache ({nCached})</Button>
        </div>
      {/if}
      {#if cacheMsg}<p class="text-muted-foreground text-xs" role="status">{cacheMsg}</p>{/if}
    </Card.Content>
  </Card.Root>

  {#if player?.citizen}
    {@const c = player.citizen}
    <Card.Root>
      <Card.Header>
        <div class="flex flex-wrap items-start gap-4">
          {#if c.avatar}<img src={c.avatar} alt="" class="size-16 rounded-md object-cover" />{/if}
          <div class="grid min-w-0 flex-1 gap-1">
            <Card.Title class="flex flex-wrap items-center gap-2">
              <a class={LINK_QUIET} href={`${RSI}/citizens/${encodeURIComponent(c.handle)}`} target="_blank" rel="noopener">{c.moniker}</a>
              {#if c.moniker !== c.handle}<span class="text-muted-foreground text-sm font-normal">@{c.handle}</span>{/if}
              {#if threat?.tag}<Badge variant={BADGE_VARIANT[threat.tag]}>{tagLabel(threat.tag)}</Badge>{/if}
            </Card.Title>
            <Card.Description>
              {[c.title, c.record ? `Record ${c.record}` : '', c.enlisted ? `Enlisted ${c.enlisted}` : '', c.location, c.fluency ? `Speaks ${c.fluency}` : ''].filter(Boolean).join(' · ')}
            </Card.Description>
            <p class="text-sm">
              <a class={LINK_QUIET} href={spectrumPostsUrl(c.handle)} target="_blank" rel="noopener" title={`Opens Spectrum's search for every thread and reply by @${c.handle}, newest first`}>Spectrum posts by @{c.handle} ↗</a>
            </p>
          </div>
          <div class="text-muted-foreground flex items-center gap-2 text-xs">
            Cached {ago(player.at)}
            <Button size="xs" variant="outline" disabled={busy} onclick={() => lookPlayer(c.handle, true)}>Refresh</Button>
          </div>
        </div>
      </Card.Header>
      <Card.Content class="grid gap-4">
        {#if threat?.reasons.length}
          <div class={cn('grid gap-1 rounded-md border p-3 text-sm', threat.tag && TAG_TONE[threat.tag])}>
            {#each threat.reasons as r}<span>{r.text}</span>{/each}
          </div>
        {/if}
        <div class="grid gap-1.5">
          <span class="text-sm font-medium">Your tag on @{c.handle}</span>
          <IntelTagEditor kind="player" id={c.handle} name={c.moniker} />
        </div>
        <div class="grid gap-1.5">
          <span class="text-sm font-medium">Orgs</span>
          {#if !player.orgs.length}
            <Empty class="py-2 text-left">In no org (or RSI didn't list any).</Empty>
          {:else}
            <Table.Root>
              <Table.Body>
                {#each player.orgs as o, n (o.sid || `hidden-${n}`)}
                  <Table.Row>
                    {#if o.redacted}
                      <Table.Cell colspan={3} class="text-muted-foreground">{o.main ? 'Main org' : 'Affiliation'} hidden by the player (RSI shows REDACTED)</Table.Cell>
                    {:else}
                      <Table.Cell class="whitespace-normal">
                        <button class={cn(LINK_QUIET, 'text-left')} onclick={() => lookOrg(o.sid)}>{o.name}</button>
                        <span class="text-muted-foreground block text-xs">[{o.sid}] · {o.main ? 'main' : 'affiliate'}{o.rank ? ` · ${o.rank}` : ''}{o.members != null ? ` · ${fmtNum(o.members)} members` : ''}</span>
                      </Table.Cell>
                      <Table.Cell class="w-0"><IntelTagEditor kind="org" id={o.sid} name={o.name} compact /></Table.Cell>
                    {/if}
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {/if}
        </div>
        <div class="grid gap-1.5">
          <span class="text-sm font-medium">Suspected orgs <span class="text-muted-foreground font-normal">(your guess)</span></span>
          <p class="text-muted-foreground text-xs">
            {hiddenOrgs ? `${hiddenOrgs} membership${hiddenOrgs === 1 ? ' is' : 's are'} hidden on RSI. ` : ''}If you think you know an org this player is in, add its SID. It is your guess, not something RSI says: it is marked with ? wherever it shows, counts only once you tag that org, and stays in this browser unless you export it.
          </p>
          {#if Array.isArray(playerGuesses) && playerGuesses.length}
            <ul class="grid gap-1 text-sm">
              {#each playerGuesses as g (g.sid)}
                {@const gt = tagOf('org', g.sid)}
                <li class="flex flex-wrap items-center gap-2">
                  <button class={cn(LINK_QUIET, 'text-left')} onclick={() => lookOrg(g.sid)}>{orgName(g.sid) ?? g.name ?? g.sid}</button>
                  <span class="text-muted-foreground text-xs">[{g.sid}]? · added {ago(g.at)}{g.source ? ` · from ${g.source}` : ''}</span>
                  {#if gt}<Badge variant={BADGE_VARIANT[gt]}>{tagLabel(gt)}</Badge>{:else}<span class="text-muted-foreground text-xs">org not tagged: no flag</span>{/if}
                  <Button size="xs" variant="ghost" onclick={() => dropGuess(c.handle, g.sid)}>Remove</Button>
                </li>
              {/each}
            </ul>
          {/if}
          <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), addGuess(c.handle, guessSid))}>
            <Input class="h-7 w-40 text-xs" placeholder="Org SID, e.g. BLKSYN" bind:value={guessSid} aria-label={`Org SID you suspect @${c.handle} is in`} />
            <Button type="submit" size="xs" variant="outline" disabled={!guessSid.trim()}>Add suspected org</Button>
            {#if guessMsg}<span class="text-destructive text-xs" role="status">{guessMsg}</span>{/if}
          </form>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if org?.org}
    {@const o = org.org}
    {@const t = tagOf('org', o.sid)}
    <Card.Root>
      <Card.Header>
        <div class="flex flex-wrap items-start gap-4">
          {#if o.logo}<img src={o.logo} alt="" class="size-16 rounded-md object-cover" />{/if}
          <div class="grid min-w-0 flex-1 gap-1">
            <Card.Title class="flex flex-wrap items-center gap-2">
              <a class={LINK_QUIET} href={`${RSI}/orgs/${o.sid}`} target="_blank" rel="noopener">{o.name}</a>
              <span class="text-muted-foreground text-sm font-normal">[{o.sid}]</span>
              {#if t}<Badge variant={BADGE_VARIANT[t]}>{tagLabel(t)}</Badge>{/if}
            </Card.Title>
            <Card.Description>
              {[o.members != null ? `${fmtNum(o.members)} members` : '', o.model, o.commitment, ...o.tags, o.focus.primary ? `Focus: ${[o.focus.primary, o.focus.secondary].filter(Boolean).join(' / ')}` : ''].filter(Boolean).join(' · ')}
            </Card.Description>
            {#if Array.isArray(o.discord) && o.discord.length}
              <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span class="text-muted-foreground">Discord (from the org's page):</span>
                {#each o.discord as d (d)}
                  <a class={LINK_QUIET} href={d} target="_blank" rel="noopener noreferrer">{d.replace('https://', '')}</a>
                {/each}
              </p>
            {/if}
          </div>
          <div class="text-muted-foreground flex items-center gap-2 text-xs">
            Cached {ago(org.at)}
            <Button size="xs" variant="outline" disabled={busy} onclick={() => lookOrg(o.sid, true)}>Refresh</Button>
          </div>
        </div>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <div class="grid gap-1.5">
          <span class="text-sm font-medium">Your tag on [{o.sid}]</span>
          <IntelTagEditor kind="org" id={o.sid} name={o.name} />
        </div>
        <div class="grid gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">Members</span>
            {#if members}<span class="text-muted-foreground text-xs">{members.list.length} of {fmtNum(members.total)} read · {members.list.filter((m) => m.visibility !== 'V').length} hidden / redacted</span>{/if}
            <Input class="ml-auto h-7 w-56 text-xs" placeholder="Filter loaded members" bind:value={memberQ} aria-label="Filter members" />
          </div>
          {#if members?.list.length}
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Member</Table.Head>
                  <Table.Head>Rank</Table.Head>
                  <Table.Head>Your tag</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each shownMembers as m, n (m.handle || `h-${n}`)}
                  {@const mt = m.handle ? tagOf('player', m.handle) : null}
                  <Table.Row>
                    <Table.Cell>
                      {#if m.handle}
                        <button class={cn(LINK_QUIET, 'text-left')} onclick={() => lookPlayer(m.handle)}>{m.name}</button>
                        <span class="text-muted-foreground text-xs">@{m.handle}{m.main ? '' : ' · affiliate'}</span>
                      {:else}
                        <span class="text-muted-foreground">Hidden member</span>
                      {/if}
                    </Table.Cell>
                    <Table.Cell>{m.rank ?? '—'}{m.stars ? ` · ${'★'.repeat(m.stars)}` : ''}</Table.Cell>
                    <Table.Cell>{#if mt}<Badge variant={BADGE_VARIANT[mt]}>{tagLabel(mt)}</Badge>{/if}</Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {:else if !loadingMembers}
            <Empty class="py-2 text-left">No members listed.</Empty>
          {/if}
          {#if members && members.list.length < members.total}
            <div>
              <Button size="sm" variant="outline" disabled={loadingMembers} onclick={() => loadMembers((members?.pages ?? 0) + 1)}>{loadingMembers ? 'Reading…' : `Load ${MEMBERS_PAGE} more`}</Button>
              <Button size="sm" variant="ghost" disabled={loadingMembers} onclick={() => loadMembers((members?.pages ?? 0) + 10)}>Load 10 pages</Button>
            </div>
          {/if}
        </div>
        <div class="grid gap-1.5">
          <span class="text-sm font-medium">Suspected members <span class="text-muted-foreground font-normal">(your guess)</span></span>
          <p class="text-muted-foreground text-xs">Players you think are in [{o.sid}] though RSI doesn't list them here (hidden or redacted). Your guess only; they get this org's tag with a ? on Spectrum and in Friends.</p>
          {#if Array.isArray(orgGuesses) && orgGuesses.length}
            <ul class="grid gap-1 text-sm">
              {#each orgGuesses as g (g.handle)}
                {@const gt = tagOf('player', g.handle)}
                <li class="flex flex-wrap items-center gap-2">
                  <button class={cn(LINK_QUIET, 'text-left')} onclick={() => lookPlayer(g.handle)}>@{g.handle}</button>
                  <span class="text-muted-foreground text-xs">added {ago(g.at)}{g.source ? ` · from ${g.source}` : ''}</span>
                  {#if gt}<Badge variant={BADGE_VARIANT[gt]}>{tagLabel(gt)}</Badge>{/if}
                  <Button size="xs" variant="ghost" onclick={() => dropGuess(g.handle, o.sid)}>Remove</Button>
                </li>
              {/each}
            </ul>
          {/if}
          <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), addGuess(guessHandle, o.sid))}>
            <Input class="h-7 w-48 text-xs" placeholder="Handle" bind:value={guessHandle} aria-label={`Handle you suspect is in ${o.sid}`} />
            <Button type="submit" size="xs" variant="outline" disabled={!guessHandle.trim()}>Add suspected member</Button>
            {#if guessMsg}<span class="text-destructive text-xs" role="status">{guessMsg}</span>{/if}
          </form>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>Your tags</Card.Title>
      <Card.Description>Players and orgs you tagged. Export to share with your org; import their file to merge it (yours are kept unless you tick Overwrite).</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <Input class="w-64" placeholder="Search handle, SID, note, label" bind:value={fQ} aria-label="Search tags" />
        {#each [['', 'All'], ['player', 'Players'], ['org', 'Orgs']] as [k, l]}
          <Button size="xs" variant={fKind === k ? 'secondary' : 'outline'} aria-pressed={fKind === k} onclick={() => (fKind = k as typeof fKind)}>{l}</Button>
        {/each}
        <span class="bg-border mx-1 h-4 w-px"></span>
        {#each INTEL_TAGS as tg (tg.id)}
          <Button size="xs" variant="outline" class={cn(fTags.includes(tg.id) && TAG_TONE[tg.id])} aria-pressed={fTags.includes(tg.id)} onclick={() => (fTags = fTags.includes(tg.id) ? fTags.filter((x) => x !== tg.id) : [...fTags, tg.id])}>{tg.label}</Button>
        {/each}
      </div>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Who</Table.Head>
            <Table.Head>Tag</Table.Head>
            <Table.Head>Note · labels</Table.Head>
            <Table.Head><span class="sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each list as e (intelKey(e.kind, e.id))}
            <Table.Row>
              <Table.Cell class="whitespace-normal">
                <button class={cn(LINK_QUIET, 'text-left')} onclick={() => (e.kind === 'org' ? lookOrg(e.id) : lookPlayer(e.id))}>{e.kind === 'org' ? `[${e.id}]` : `@${e.id}`}</button>
                {#if e.name && e.name !== e.id}<span class="text-muted-foreground block text-xs">{e.name}</span>{/if}
              </Table.Cell>
              <Table.Cell>
                <select class="bg-background rounded border px-1 py-0.5 text-xs" value={e.tag} onchange={(x) => retag(e, (x.currentTarget as HTMLSelectElement).value as IntelTag)} aria-label={`Tag for ${e.id}`}>
                  {#each INTEL_TAGS as tg (tg.id)}<option value={tg.id}>{tg.label}</option>{/each}
                </select>
              </Table.Cell>
              <Table.Cell class="max-w-[28rem] text-xs whitespace-normal">
                {e.note ?? ''}
                {#if e.labels?.length}<span class="mt-0.5 flex flex-wrap gap-1">{#each e.labels as l}<Badge variant="muted">{l}</Badge>{/each}</span>{/if}
                <span class="text-muted-foreground block">{ago(e.updatedAt)}{e.source ? ` · from ${e.source}` : ''}</span>
              </Table.Cell>
              <Table.Cell class="text-right"><Button size="xs" variant="ghost" onclick={() => untag(e)}>Remove</Button></Table.Cell>
            </Table.Row>
          {:else}
            <Empty colspan={4}>{Object.keys(intel).length ? 'Nothing matches.' : 'No tags yet: look someone up and tag them.'}</Empty>
          {/each}
        </Table.Body>
      </Table.Root>
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!Object.keys(intel).length && !Object.keys(suspects).length} onclick={() => doExport(true)}>Export all</Button>
        <Button size="sm" variant="outline" disabled={!list.length || list.length === Object.keys(intel).length} onclick={() => doExport(false)}>Export shown ({list.length})</Button>
        <label class="border-input hover:bg-accent inline-flex h-7 cursor-pointer items-center rounded-md border px-2.5 text-[0.8rem]">
          Import…
          <input type="file" accept="application/json,.json" class="sr-only" onchange={doImport} />
        </label>
        <label class="flex items-center gap-1 text-xs"><input type="checkbox" bind:checked={overwrite} /> Overwrite mine</label>
        {#if importMsg}<span class="text-muted-foreground text-xs" role="status">{importMsg}</span>{/if}
      </div>
    </Card.Content>
  </Card.Root>
</div>
