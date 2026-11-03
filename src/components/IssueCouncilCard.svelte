<script lang="ts">
  /** Watching → Issue Council: issues RSI+ tracks (watched with ☆, or on your My reports / My contributions / Followed issues). */
  import { getSettings, icIssuesItem, settingsItem } from '@/lib/settings';
  import { IC_ORIGIN, IC_RELATIONS, issueUrl, readState, statusLabel, tracked, type IcIssue, type IcIssues } from '@/lib/issue-council';
  import Empty from './Empty.svelte';
  import { LINK_QUIET } from '@/lib/ui';
  import { fmtDate } from '@/lib/dates';
  import * as Card from '@/components/ui/card';
  import * as Table from '@/components/ui/table';
  import { Button } from '@/components/ui/button';

  let issues = $state<IcIssues>({});
  let on = $state(false);
  $effect(() => {
    icIssuesItem.getValue().then((v) => (issues = v));
    getSettings().then((s) => (on = s.issueCouncil));
    const offs = [icIssuesItem.watch((v) => (issues = v ?? {})), settingsItem.watch(async () => (on = (await getSettings()).issueCouncil))];
    return () => offs.forEach((o) => o());
  });
  const rows = $derived(tracked(issues));
  const relLabel = (i: IcIssue) => IC_RELATIONS.filter((r) => i.rel.includes(r.id)).map((r) => r.label).join(', ');
  async function unwatch(code: string) {
    const cur = await icIssuesItem.getValue();
    const i = cur[code];
    if (!i) return;
    cur[code] = { ...i, rel: i.rel.filter((r) => r !== 'watched') };
    await icIssuesItem.setValue(cur);
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Issue Council</Card.Title>
    <Card.Description>
      Issues you watch with ☆ on the Issue Council, report, contribute to or follow there. A status change or new contributions go to the Feed when an Issue Council page shows them; RSI+ doesn't check in the background.
    </Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-3">
    {#if !on}
      <Empty class="py-2 text-left">Off. Turn it on in Settings → Integrations → Issue Council.</Empty>
    {:else if !rows.length}
      <Empty class="py-2 text-left">Nothing tracked yet. Open your <a class={LINK_QUIET} href={`${IC_ORIGIN}/projects/STAR-CITIZEN/my-reports`} target="_blank" rel="noopener">reports</a> on the Issue Council, or ☆ an issue there.</Empty>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Issue</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Contributions</Table.Head>
            <Table.Head>Why</Table.Head>
            <Table.Head><span class="sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each rows as i (i.code)}
            {@const rs = readState(i, i)}
            <Table.Row>
              <Table.Cell class="whitespace-normal">
                <a class={LINK_QUIET} href={issueUrl(i.code)} target="_blank" rel="noopener">{i.title || i.code}</a>
                <span class="text-muted-foreground block text-xs">{i.code}{i.category ? ` · ${i.category}` : ''} · seen {fmtDate(i.updatedAt)}</span>
              </Table.Cell>
              <Table.Cell class="capitalize">
                {statusLabel(i.status) || '—'}
                {#if rs.statusFrom}<span class="text-warning block text-xs normal-case">was {statusLabel(rs.statusFrom)}</span>{/if}
              </Table.Cell>
              <Table.Cell>
                {i.contributions ?? '—'}
                {#if rs.newContrib}<span class="text-primary text-xs font-semibold"> +{rs.newContrib} new</span>{/if}
              </Table.Cell>
              <Table.Cell class="text-muted-foreground text-xs whitespace-normal">{relLabel(i)}</Table.Cell>
              <Table.Cell class="text-right">
                {#if i.rel.includes('watched')}<Button variant="outline" size="xs" onclick={() => unwatch(i.code)}>Unwatch</Button>{/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  </Card.Content>
</Card.Root>
