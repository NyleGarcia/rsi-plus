<script lang="ts">
  /** My CCUs: every upgrade you hold (hangar + buyback) with facets — built out in docs/plans/specs/filters-and-labels.md. */
  import * as Card from '@/components/ui/card';
  import Empty from './Empty.svelte';
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>CCUs</Card.Title>
    <Card.Description>Upgrades you hold, in the hangar and in buyback.</Card.Description>
  </Card.Header>
  <Card.Content>
    <Empty>Coming up.</Empty>
  </Card.Content>
</Card.Root>
