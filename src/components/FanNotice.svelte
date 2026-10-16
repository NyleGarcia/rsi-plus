<script lang="ts">
  /**
   * Star Citizen Fankit requirements (08_Fankit_Guidelines.pdf, 2025-11-19): the *Made By The Community* logo
   * (unaltered: no recolour, flip, distortion, outline or shadow; ≥ 50 % opacity; legible size) together with the
   * trademark notice, in a legible font no smaller than 10 pt, in an always-visible navigation area and/or the home
   * page. Plus our own "not affiliated" line. White badge on dark themes, black badge on light themes (both are the
   * kit's own files, only resized — public/fankit/).
   * - `sidebar`: hub sidebar footer, always visible: badge + one short "unofficial" line (full notice as tooltip);
   *   collapsed to icons, just the badge. Kept short so the nav above isn't pushed off-screen.
   * - `footer`: under every hub page, the full notice (the Feed home page included; covers the mobile sheet).
   * - `popup`: bottom of the toolbar popup.
   */
  import * as Tooltip from '@/components/ui/tooltip';
  import { cn } from '@/lib/utils';

  let { variant = 'footer', collapsed = false, class: klass = '' }: { variant?: 'sidebar' | 'footer' | 'popup'; collapsed?: boolean; class?: string } = $props();

  const TRADEMARK = 'Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC.';
  const UNOFFICIAL = 'RSI+ is an unofficial Star Citizen fan tool, not affiliated with or endorsed by the Cloud Imperium group of companies.';
  const SHORT = 'Unofficial fan tool. Not affiliated with Cloud Imperium.';
  const size = 44;
</script>

{#snippet badge(px: number)}
  <span class="inline-flex shrink-0" style:width={`${px}px`} style:height={`${px}px`}>
    <img src="/fankit/made-by-the-community-white.png" alt="Made By The Community" width={px} height={px} class="block [[data-theme=light]_&]:hidden" />
    <img src="/fankit/made-by-the-community-black.png" alt="Made By The Community" width={px} height={px} class="hidden [[data-theme=light]_&]:block" />
  </span>
{/snippet}

{#if variant === 'sidebar'}
  <Tooltip.Root>
    <Tooltip.Trigger class={cn('text-muted-foreground flex cursor-default items-center gap-2.5 text-left text-[13.5px] leading-snug', collapsed && 'mx-auto', klass)} aria-label="Made By The Community, unofficial fan tool">
      {@render badge(collapsed ? 32 : 36)}
      {#if !collapsed}<span>{SHORT}</span>{/if}
    </Tooltip.Trigger>
    <Tooltip.Content side="right" class="max-w-72 text-[13.5px] leading-snug">{UNOFFICIAL} {TRADEMARK}</Tooltip.Content>
  </Tooltip.Root>
{:else}
  <!-- 13.5px ≈ 10pt: the guidelines' minimum for the notice. -->
  <aside class={cn('text-muted-foreground flex items-start gap-2.5 text-[13.5px] leading-snug', variant === 'footer' && 'border-t pt-4', klass)} aria-label="Fan project notice">
    {@render badge(size)}
    <p class="m-0 grid gap-1">
      <span>{UNOFFICIAL}</span>
      <span>{TRADEMARK}</span>
    </p>
  </aside>
{/if}
