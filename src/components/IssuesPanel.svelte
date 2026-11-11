<script lang="ts">
  /**
   * Hub → Issue Council: every issue RSI+ tracks (watched, reported, contributed, followed) — or every one it has seen —
   * with filters, your private notes, the contribution trend and CSV / JSON export. Local data only (lib/issue-council.ts).
   */
  import { icIssuesItem, icLinksItem, icMentionsItem } from '@/lib/settings';
  import {
    IC_ORIGIN,
    IC_RELATIONS,
    NO_IC_FILTER,
    facetCounts,
    filterIssues,
    issueUrl,
    issuesCsv,
    readState,
    removeLink,
    setNote,
    threadsFor,
    statusLabel,
    toggleWatch,
    type IcFilter,
    type IcIssue,
    type IcIssues,
    type IcLinks,
    type IcMentions,
    type IcRelation,
  } from '@/lib/issue-council';
  import { threadUrl } from '@/lib/types';
  import { dateStamp, downloadFile } from '@/lib/download';
  import { fmtDate, fmtDateTime } from '@/lib/dates';
  import { LINK_QUIET } from '@/lib/ui';
  import Empty from './Empty.svelte';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import { Button } from '@/components/ui/button';
  import { Badge } from '@/components/ui/badge';
  import { Input } from '@/components/ui/input';
  import { Textarea } from '@/components/ui/textarea';
  import { Switch } from '@/components/ui/switch';
  import { Label } from '@/components/ui/label';

  let issues = $state<IcIssues>({});
  let mentions = $state<IcMentions>({});
  let links = $state<IcLinks>({});
  $effect(() => {
    icIssuesItem.getValue().then((v) => (issues = v));
    icMentionsItem.getValue().then((v) => (mentions = v));
    icLinksItem.getValue().then((v) => (links = v));
    const offs = [icIssuesItem.watch((v) => (issues = v ?? {})), icMentionsItem.watch((v) => (mentions = v ?? {})), icLinksItem.watch((v) => (links = v ?? {}))];
    return () => offs.forEach((o) => o());
  });

  let f = $state<IcFilter>({ ...NO_IC_FILTER });
  /** Facets count the scope (tracked / all) before the other filters, so a chip never hides itself. */
  const scope = $derived(filterIssues(issues, { ...NO_IC_FILTER, all: f.all }));
  const rows = $derived(filterIssues(issues, f));
  const statuses = $derived(facetCounts(scope, (i) => i.status));
  const categories = $derived(facetCounts(scope, (i) => i.category));
  const relCounts = $derived(Object.fromEntries(IC_RELATIONS.map((r) => [r.id, scope.filter((i) => i.rel.includes(r.id)).length])));
  const filtered = $derived(f.status.length + f.rel.length + f.category.length > 0 || !!f.q.trim());

  const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  let editing = $state<string | null>(null);
  let draft = $state('');
  async function saveNote(code: string) {
    const cur = await icIssuesItem.getValue();
    if (setNote(cur, code, draft)) await icIssuesItem.setValue(cur);
    editing = null;
  }
  async function unlink(code: string, slug: string) {
    await icLinksItem.setValue(removeLink(await icLinksItem.getValue(), code, slug));
  }
  async function watch(i: IcIssue) {
    const cur = await icIssuesItem.getValue();
    toggleWatch(cur, i, Date.now());
    await icIssuesItem.setValue(cur);
  }
  async function markRead(i: IcIssue) {
    const cur = await icIssuesItem.getValue();
    const c = cur[i.code];
    if (!c) return;
    cur[i.code] = { ...c, seen: { at: Date.now(), status: c.status, contributions: c.contributions, activity: c.seen?.activity ?? [] } };
    await icIssuesItem.setValue(cur);
  }
  const exportCsv = () => downloadFile(`rsi-plus-issue-council-${dateStamp()}.csv`, issuesCsv(rows));
  const exportJson = () => downloadFile(`rsi-plus-issue-council-${dateStamp()}.json`, JSON.stringify(rows.map(({ seen: _s, ...i }) => ({ ...i, url: issueUrl(i.code) })), null, 2), 'application/json');

  /** Sparkline points for the contribution history (needs 2+ counted points). */
  function spark(i: IcIssue, w = 96, h = 24): { d: string; dots: { x: number; y: number; status: string }[] } | null {
    const pts = (i.history ?? []).filter((p) => p.contributions != null);
    if (pts.length < 2) return null;
    const t0 = pts[0]!.at;
    const t1 = pts.at(-1)!.at;
    const vs = pts.map((p) => p.contributions!);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const x = (at: number) => (t1 === t0 ? w : ((at - t0) / (t1 - t0)) * (w - 4) + 2);
    const y = (v: number) => (hi === lo ? h / 2 : h - 2 - ((v - lo) / (hi - lo)) * (h - 4));
    const d = pts.map((p, n) => `${n ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.contributions!).toFixed(1)}`).join(' ');
    const hist = i.history ?? [];
    const dots = hist
      .filter((p, n) => n > 0 && p.status !== hist[n - 1]!.status && p.contributions != null)
      .map((p) => ({ x: x(p.at), y: y(p.contributions!), status: p.status }));
    return { d, dots };
  }
  const relLabel = (r: IcRelation) => IC_RELATIONS.find((x) => x.id === r)?.label ?? r;
</script>

<div class="grid gap-4">
  <Card.Root>
    <Card.Header>
      <Card.Title>Issue Council</Card.Title>
      <Card.Description>
        Issues you watch with ☆, report, contribute to or follow on the Issue Council, from the pages you open there. RSI+ doesn't check in the background, so counts are as of the last time an Issue Council page showed them. Notes stay in this browser.
      </Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <Input class="w-72" placeholder="Search code, title or note" bind:value={f.q} aria-label="Search issues" />
        <div class="flex items-center gap-2">
          <Switch id="ic-all" checked={f.all} onCheckedChange={(v) => (f.all = v)} />
          <Label for="ic-all">Show all seen ({Object.keys(issues).length})</Label>
        </div>
        <div class="ml-auto flex gap-2">
          {#if filtered}<Button variant="ghost" size="sm" onclick={() => (f = { ...NO_IC_FILTER, all: f.all })}>Clear filters</Button>{/if}
          <Button variant="outline" size="sm" disabled={!rows.length} onclick={exportCsv}>CSV</Button>
          <Button variant="outline" size="sm" disabled={!rows.length} onclick={exportJson}>JSON</Button>
        </div>
      </div>
      <div class="grid gap-2 text-xs">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-muted-foreground w-16">Why</span>
          {#each IC_RELATIONS as r (r.id)}
            <Button size="xs" variant={f.rel.includes(r.id) ? 'secondary' : 'outline'} aria-pressed={f.rel.includes(r.id)} onclick={() => (f.rel = flip(f.rel, r.id))}>{r.label} · {relCounts[r.id]}</Button>
          {/each}
        </div>
        {#if statuses.length}
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-muted-foreground w-16">Status</span>
            {#each statuses as [s, n] (s)}
              <Button size="xs" class="capitalize" variant={f.status.includes(s) ? 'secondary' : 'outline'} aria-pressed={f.status.includes(s)} onclick={() => (f.status = flip(f.status, s))}>{statusLabel(s)} · {n}</Button>
            {/each}
          </div>
        {/if}
        {#if categories.length}
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-muted-foreground w-16">Category</span>
            {#each categories as [c, n] (c)}
              <Button size="xs" variant={f.category.includes(c) ? 'secondary' : 'outline'} aria-pressed={f.category.includes(c)} onclick={() => (f.category = flip(f.category, c))}>{c} · {n}</Button>
            {/each}
          </div>
        {/if}
      </div>

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Issue</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Contributions</Table.Head>
            <Table.Head>Trend</Table.Head>
            <Table.Head>Why</Table.Head>
            <Table.Head><span class="sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each rows as i (i.code)}
            {@const rs = readState(i, i)}
            {@const sp = spark(i)}
            {@const ment = threadsFor(i.code, mentions, links)}
            <Table.Row>
              <Table.Cell class="max-w-[28rem] whitespace-normal align-top">
                <a class={LINK_QUIET} href={issueUrl(i.code)} target="_blank" rel="noopener">{i.title || i.code}</a>
                <span class="text-muted-foreground block text-xs">{i.code}{i.category ? ` · ${i.category}` : ''} · seen {fmtDate(i.updatedAt)}</span>
                {#if ment.length}
                  <span class="text-muted-foreground block text-xs">
                    Spectrum:
                    {#each ment as m, n (m.slug)}{n ? ', ' : ' '}<a class={LINK_QUIET} href={threadUrl(m.channelId, m.slug)} target="_blank" rel="noopener">{m.linked ? '🔗 ' : ''}{m.subject || m.slug}</a>{#if m.linked}<button class="text-muted-foreground hover:text-foreground ml-0.5" title="Unlink this thread" aria-label={`Unlink ${m.subject || m.slug}`} onclick={() => unlink(i.code, m.slug)}>×</button>{/if}{/each}
                  </span>
                {/if}
                {#if editing === i.code}
                  <form class="mt-2 grid gap-2" onsubmit={(e) => (e.preventDefault(), saveNote(i.code))}>
                    <Textarea rows={3} class="text-xs" bind:value={draft} placeholder="Private note (stays in this browser)" aria-label={`Note on ${i.code}`} />
                    <div class="flex gap-2">
                      <Button type="submit" size="xs">Save</Button>
                      <Button type="button" size="xs" variant="ghost" onclick={() => (editing = null)}>Cancel</Button>
                    </div>
                  </form>
                {:else if i.note}
                  <button class="text-warning mt-1 block text-left text-xs whitespace-pre-wrap" title="Edit note" onclick={() => ((editing = i.code), (draft = i.note ?? ''))}>✎ {i.note}</button>
                {/if}
              </Table.Cell>
              <Table.Cell class="align-top capitalize">
                {statusLabel(i.status) || '—'}
                {#if rs.statusFrom}<span class="text-warning block text-xs normal-case">was {statusLabel(rs.statusFrom)}</span>{/if}
              </Table.Cell>
              <Table.Cell class="align-top tabular-nums">
                {i.contributions ?? '—'}
                {#if rs.newContrib}<span class="text-primary text-xs font-semibold"> +{rs.newContrib} new</span>{/if}
              </Table.Cell>
              <Table.Cell class="align-top">
                {#if sp}
                  {@const h = i.history ?? []}
                  <svg width="96" height="24" viewBox="0 0 96 24" class="text-primary overflow-visible" role="img" aria-label={`Contributions ${h.find((p) => p.contributions != null)?.contributions} → ${h.at(-1)?.contributions} since ${fmtDate(h[0]!.at)}`}>
                    <title>{h.map((p) => `${fmtDateTime(p.at)}: ${p.contributions ?? '?'} (${statusLabel(p.status)})`).join('\n')}</title>
                    <path d={sp.d} fill="none" stroke="currentColor" stroke-width="1.5" />
                    {#each sp.dots as d}<circle cx={d.x} cy={d.y} r="2.5" class="fill-warning" />{/each}
                  </svg>
                {:else}
                  <span class="text-muted-foreground text-xs">{i.rel.length ? 'after the next change' : '—'}</span>
                {/if}
              </Table.Cell>
              <Table.Cell class="align-top">
                <div class="flex flex-wrap gap-1">
                  {#each i.rel as r (r)}<Badge variant={r === 'watched' ? 'warning' : 'muted'}>{relLabel(r)}</Badge>{/each}
                </div>
              </Table.Cell>
              <Table.Cell class="text-right align-top">
                <div class="flex justify-end gap-1">
                  <Button variant="ghost" size="xs" onclick={() => ((editing = i.code), (draft = i.note ?? ''))}>{i.note ? 'Edit note' : 'Note'}</Button>
                  {#if rs.newContrib || rs.statusFrom}<Button variant="ghost" size="xs" onclick={() => markRead(i)}>Mark read</Button>{/if}
                  <Button variant="outline" size="xs" onclick={() => watch(i)}>{i.rel.includes('watched') ? 'Unwatch' : '☆ Watch'}</Button>
                </div>
              </Table.Cell>
            </Table.Row>
          {:else}
            <Empty colspan={6}>
              {#if filtered}
                Nothing matches these filters.
              {:else if f.all}
                RSI+ hasn't seen any issues yet. Open the <a class={LINK_QUIET} href={`${IC_ORIGIN}/projects/STAR-CITIZEN`} target="_blank" rel="noopener">Issue Council</a>.
              {:else}
                Nothing tracked yet. Open your <a class={LINK_QUIET} href={`${IC_ORIGIN}/projects/STAR-CITIZEN/my-reports`} target="_blank" rel="noopener">reports</a> on the Issue Council, or ☆ an issue there.
              {/if}
            </Empty>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>
</div>
