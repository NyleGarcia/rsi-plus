<script lang="ts">
  /**
   * Store / hangar tags with one wording and one tone each: Warbond, Standard, LTI / n-month insurance, owned ×n,
   * Concierge, Subscribers, out of stock, ship. `xs` is the tile-sized variant (Notifications, pack contents).
   */
  import HintBadge from './HintBadge.svelte';
  import type { BadgeVariant } from '@/components/ui/badge';
  import { cn } from '@/lib/utils';

  export type TagKind = 'warbond' | 'standard' | 'insurance' | 'owned' | 'concierge' | 'subscribers' | 'oos' | 'ship' | 'sale';

  let {
    kind,
    value = null,
    count = null,
    label = null,
    hint = null,
    size = 'default',
    class: className = '',
  }: {
    kind: TagKind;
    /** insurance: `LTI` / `6 mo`; sale: the price text. */
    value?: string | null;
    /** owned: how many. */
    count?: number | null;
    label?: string | null;
    hint?: string | null;
    size?: 'default' | 'xs';
    class?: string;
  } = $props();

  const spec = $derived.by((): { label: string; hint: string | null; variant: BadgeVariant } => {
    switch (kind) {
      case 'warbond':
        return { label: 'Warbond', hint: 'Warbond: new money only, no store credit', variant: 'warning' };
      case 'standard':
        return { label: 'Standard', hint: 'Standard: store credit welcome', variant: 'muted' };
      case 'insurance': {
        const lti = value === 'LTI';
        return lti
          ? { label: 'LTI', hint: 'Lifetime insurance on the hull(s)', variant: 'warning' }
          : { label: `${value ?? ''} insurance`, hint: `${(value ?? '').replace(' mo', ' months')} of insurance on the hull(s)`, variant: 'muted' };
      }
      case 'owned':
        return { label: count && count > 1 ? `owned ×${count}` : 'owned', hint: 'Already in your hangar', variant: 'success' };
      case 'concierge':
        return { label: 'Concierge', hint: 'The store lists this for Concierge members only', variant: 'warning' };
      case 'subscribers':
        return { label: 'Subscribers', hint: 'Subscribers Store — listed only to sessions with the subscriber badge', variant: 'info' };
      case 'oos':
        return { label: 'out of stock', hint: null, variant: 'muted' };
      case 'ship':
        return { label: 'ship', hint: 'A hull — ships come with their own hangar entry', variant: 'outline' };
      case 'sale':
        return { label: value ?? 'on sale', hint: null, variant: 'success' };
    }
  });
</script>

<HintBadge variant={spec.variant} hint={hint ?? spec.hint} class={cn(size === 'xs' && 'h-4 px-1 text-[10px]', className)}>{label ?? spec.label}</HintBadge>
