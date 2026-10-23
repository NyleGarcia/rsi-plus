<script lang="ts">
  /**
   * Store / hangar tags with one wording and one tone each: Warbond, Standard, LTI / n-month insurance, owned ×n,
   * Concierge, Subscribers, out of stock, ship. `xs` is the tile-sized variant (Notifications, pack contents).
   */
  import HintBadge from './HintBadge.svelte';
  import type { BadgeVariant } from '@/components/ui/badge';
  import { cn } from '@/lib/utils';

  export type TagKind = 'warbond' | 'standard' | 'insurance' | 'owned' | 'concierge' | 'subscribers' | 'oos' | 'ship' | 'sale' | 'limited' | 'new' | 'bestvalue' | 'bonus' | 'fits' | 'lowstock' | 'stage' | 'size' | 'discount' | 'gifted' | 'giftable' | 'meltable' | 'upgraded' | 'game';

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
      case 'limited':
        return { label: 'Limited time', hint: 'RSI marks this listing time-limited — it leaves the store when the window closes', variant: 'destructive' };
      case 'new':
        return { label: 'New', hint: 'RSI marks this as new in the store', variant: 'info' };
      case 'bestvalue':
        return { label: 'Best value', hint: 'RSI marks this the best value of its kind', variant: 'success' };
      case 'bonus':
        return { label: value ?? 'Bonus', hint: 'Comes with extras RSI calls out on the listing', variant: 'success' };
      case 'fits':
        return { label: `Fits ${value ?? ''}`, hint: 'RSI says which hull this fits', variant: 'muted' };
      case 'lowstock':
        return { label: 'Low stock', hint: 'RSI reports the stock running low', variant: 'warning' };
      case 'stage':
        return value && /concept/i.test(value)
          ? { label: 'Concept', hint: 'Not flyable yet — RSI lists it as in concept', variant: 'muted' }
          : /flyable|ready/i.test(value ?? '')
            ? { label: 'Flight ready', hint: 'Flyable in the game today', variant: 'success' }
            : { label: value || 'In production', hint: "RSI's production status", variant: 'muted' };
      case 'size':
        return { label: value ?? '', hint: "RSI's ship size class", variant: 'outline' };
      case 'discount':
        return { label: value ?? 'on sale', hint: 'Below MSRP right now', variant: 'success' };
      case 'gifted':
        return { label: 'Gifted', hint: 'No melt value — received as a gift (or a free item)', variant: 'muted' };
      case 'giftable':
        return { label: 'Giftable', hint: 'RSI lets you gift this pledge', variant: 'info' };
      case 'meltable':
        return { label: 'Meltable', hint: 'Can be melted for store credit', variant: 'muted' };
      case 'upgraded':
        return { label: 'Upgraded', hint: 'A CCU was applied to this pledge', variant: 'info' };
      case 'game':
        return { label: 'Game package', hint: 'Includes a Star Citizen / Squadron 42 game package', variant: 'info' };
    }
  });
</script>

<HintBadge variant={spec.variant} hint={hint ?? spec.hint} {size} class={className}>{label ?? spec.label}</HintBadge>
