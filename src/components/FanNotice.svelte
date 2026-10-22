<script lang="ts">
  /**
   * Star Citizen Fankit requirements (08_Fankit_Guidelines.pdf, 2025-11-19): the *Made By The Community* logo
   * (unaltered: no recolour, flip, distortion, outline or shadow; ≥ 50 % opacity; legible size) together with the
   * trademark notice, in a legible font no smaller than 10 pt, in an always-visible navigation area and/or the home
   * page. Plus our own "not affiliated" line. White badge on dark themes, black badge on light themes (both are the
   * kit's own files, only resized — public/fankit/).
   * - `popup`: bottom of the toolbar popup. (The hub's always-visible notice is its sticky footer, entrypoints/hub/HubFooter.svelte.)
   * - `store`: top of the Store pages (Ship catalog, Browse): prices are read from the RSI store, RSI+ sells nothing,
   *   plus the "not affiliated" line — next to the prices, not only in the footer.
   */
    import { cn } from '@/lib/utils';

  let { variant = 'popup', class: klass = '' }: { variant?: 'popup' | 'store'; class?: string } = $props();

  const TRADEMARK = 'Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC.';
  const UNOFFICIAL = 'RSI+ is an unofficial Star Citizen fan tool, not affiliated with or endorsed by the Cloud Imperium group of companies.';
  const STORE =
    'Prices, availability and listings are read from the official RSI pledge store and can lag behind it or differ. RSI+ is not a store: it sells nothing and takes no payment — every purchase happens on robertsspaceindustries.com under RSI\'s own terms.';
  const size = 44;
</script>

{#snippet badge(px: number)}
  <span class="inline-flex shrink-0" style:width={`${px}px`} style:height={`${px}px`}>
    <img src="/fankit/made-by-the-community-white.png" alt="Made By The Community" width={px} height={px} class="block [[data-theme=light]_&]:hidden" />
    <img src="/fankit/made-by-the-community-black.png" alt="Made By The Community" width={px} height={px} class="hidden [[data-theme=light]_&]:block" />
  </span>
{/snippet}

{#if variant === 'store'}
  <aside class={cn('text-muted-foreground text-[13.5px] leading-snug', klass)} aria-label="Store notice">
    <p class="m-0">{STORE} {UNOFFICIAL}</p>
  </aside>
{:else}
  <!-- 13.5px ≈ 10pt: the guidelines' minimum for the notice. -->
  <aside class={cn('text-muted-foreground flex items-start gap-2.5 text-[13.5px] leading-snug', klass)} aria-label="Fan project notice">
    {@render badge(size)}
    <p class="m-0 grid gap-1">
      <span>{UNOFFICIAL}</span>
      <span>{TRADEMARK}</span>
    </p>
  </aside>
{/if}
