<script lang="ts">
  /**
   * Bottom of the hub sidebar: Buy me a coffee + an RSI referral code (copy / Enlist; rotates when several leads are
   * listed), after SC-ORG-BOT's footer. Collapsed to icons, only the coffee cup and the referral star stay, with tooltips.
   */
  import { onMount } from 'svelte';
  import { Button } from '@/components/ui/button';
  import * as Sidebar from '@/components/ui/sidebar';
  import * as Tooltip from '@/components/ui/tooltip';
  import Coffee from '@lucide/svelte/icons/coffee';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Star from '@lucide/svelte/icons/star';
  import { BUYMEACOFFEE_URL, enlistUrl, REFERRAL_LEADS, REFERRAL_ROTATE_MS } from '@/lib/support';

  const sidebar = Sidebar.useSidebar();
  let i = $state(0);
  let copied = $state(false);
  const lead = $derived(REFERRAL_LEADS[i % REFERRAL_LEADS.length]!);
  onMount(() => {
    if (REFERRAL_LEADS.length < 2) return;
    const t = setInterval(() => ((i = (i + 1) % REFERRAL_LEADS.length), (copied = false)), REFERRAL_ROTATE_MS);
    return () => clearInterval(t);
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(lead.id);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      /* clipboard blocked — the code is still visible to select */
    }
  }
  const collapsed = $derived(sidebar.state === 'collapsed' && !sidebar.isMobile);
</script>

{#if collapsed}
  <div class="flex flex-col items-center gap-1">
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" size="icon-sm" href={BUYMEACOFFEE_URL} target="_blank" rel="noopener" aria-label="Buy me a coffee"><Coffee class="text-warning" /></Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">Buy me a coffee</Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" size="icon-sm" href={enlistUrl(lead.id)} target="_blank" rel="noopener" aria-label={`Enlist with referral code ${lead.id}`}><Star class="text-primary" /></Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">Referral {lead.id} · courtesy of {lead.name}</Tooltip.Content>
    </Tooltip.Root>
  </div>
{:else}
  <div class="grid gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-2.5 text-xs">
    <a href={BUYMEACOFFEE_URL} target="_blank" rel="noopener" class="text-muted-foreground hover:text-warning inline-flex items-center gap-1.5 font-medium no-underline transition-colors">
      <Coffee class="text-warning size-3.5" aria-hidden="true" /> Buy me a coffee
    </a>
    <div class="grid gap-1">
      <span class="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">Referral code</span>
      <div class="flex items-center gap-1">
        <code class="text-primary rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[11px] font-bold">{lead.id}</code>
        <Button variant="ghost" size="icon-xs" onclick={copy} aria-label={copied ? 'Referral code copied' : 'Copy referral code'}>
          {#if copied}<Check class="text-success" />{:else}<Copy />{/if}
        </Button>
        <Button variant="outline" size="xs" href={enlistUrl(lead.id)} target="_blank" rel="noopener">Enlist <ExternalLink /></Button>
      </div>
      <span class="text-muted-foreground text-[10px]">Courtesy of {lead.name}</span>
    </div>
  </div>
{/if}
