<script lang="ts">
  /** Org lookup flag for a player (Friends rows, requests): your tag on them or an org they're in; links to the lookup. */
  import { tagLabel, type Threat } from '@/lib/intel';
  import { Badge } from '@/components/ui/badge';
  import { BADGE_VARIANT } from './intel-tone';

  let { threat, nickname }: { threat: Threat | null; nickname: string } = $props();
</script>

{#if threat?.tag}
  <a href={`#intel?player=${encodeURIComponent(nickname)}`} title={`Org lookup:\n${threat.reasons.map((r) => r.text).join('\n')}`} class="no-underline">
    <Badge variant={BADGE_VARIANT[threat.tag]}>{threat.tag === 'hostile' || threat.tag === 'caution' ? '⚠ ' : ''}{tagLabel(threat.tag)}{threat.reasons[0]?.sid ? ` · ${threat.reasons[0].sid}` : ''}</Badge>
  </a>
{/if}
