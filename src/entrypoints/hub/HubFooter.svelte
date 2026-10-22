<script lang="ts">
  /**
   * The hub's footer, on every page (after SC-ORG-BOT's): one slim row — Fankit badge + the "unofficial" line, version,
   * and a *More* toggle that unfolds the full trademark notice, links (source, changelog, privacy, report a bug),
   * Buy me a coffee and the RSI referral code. The sidebar keeps only the short Fankit line (always visible).
   */
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import * as Collapsible from '@/components/ui/collapsible';
  import { Button } from '@/components/ui/button';
  import TipButton from '@/components/TipButton.svelte';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Coffee from '@lucide/svelte/icons/coffee';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Bug from '@lucide/svelte/icons/bug';
  import Code from '@lucide/svelte/icons/code';
  import FileText from '@lucide/svelte/icons/file-text';
  import Shield from '@lucide/svelte/icons/shield';
  import { BUYMEACOFFEE_URL, enlistUrl, REFERRAL_LEADS, REFERRAL_ROTATE_MS } from '@/lib/support';

  const REPO = 'https://github.com/NyleGarcia/rsi-plus';
  const TRADEMARK = 'Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC.';
  const UNOFFICIAL = 'RSI+ is an unofficial Star Citizen fan tool, not affiliated with or endorsed by the Cloud Imperium group of companies.';
  const SHORT = 'Unofficial fan tool · not affiliated with Cloud Imperium';
  const manifest = browser.runtime.getManifest();
  const version = manifest.version_name ?? manifest.version;

  let open = $state(false);
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
  const LINKS = [
    { label: 'Source', href: REPO, icon: Code },
    { label: 'Changelog', href: `${REPO}/blob/main/docs/changelog.md`, icon: FileText },
    { label: 'Privacy', href: `${REPO}/blob/main/PRIVACY.md`, icon: Shield },
    { label: 'Report a bug', href: `${REPO}/issues/new`, icon: Bug },
  ];
</script>

<footer class="bg-background/95 text-muted-foreground mt-auto border-t text-xs backdrop-blur" aria-label="About RSI+">
  <Collapsible.Root bind:open class="mx-auto w-full max-w-[1800px] px-6 max-sm:px-3">
    <div class="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
      <span class="inline-flex shrink-0 items-center gap-2">
        <img src="/fankit/made-by-the-community-white.png" alt="Made By The Community" width="28" height="28" class="block [[data-theme=light]_&]:hidden" />
        <img src="/fankit/made-by-the-community-black.png" alt="Made By The Community" width="28" height="28" class="hidden [[data-theme=light]_&]:block" />
        <span>{SHORT}</span>
      </span>
      <span class="tabular-nums">RSI+ {version}</span>
      <span class="ml-auto inline-flex items-center gap-1">
        <Button variant="ghost" size="xs" href={BUYMEACOFFEE_URL} target="_blank" rel="noopener" class="hover:text-warning"><Coffee class="text-warning" /> Coffee</Button>
        <Button variant="ghost" size="xs" href={`${REPO}/issues/new`} target="_blank" rel="noopener"><Bug /> Bug</Button>
        <Collapsible.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="xs" aria-label={open ? 'Less about RSI+' : 'More about RSI+'}>{#if open}<ChevronDown />{:else}<ChevronUp />{/if} {open ? 'Less' : 'More'}</Button>
          {/snippet}
        </Collapsible.Trigger>
      </span>
    </div>
    <Collapsible.Content class="grid gap-4 border-t py-4 sm:grid-cols-[1fr_auto_auto]">
      <p class="m-0 grid max-w-prose gap-1 text-[13.5px] leading-snug">
        <span>{UNOFFICIAL}</span>
        <span>{TRADEMARK}</span>
        <span>Prices and listings are read from the official RSI pledge store; RSI+ sells nothing — purchases happen on robertsspaceindustries.com.</span>
      </p>
      <nav class="grid content-start gap-1" aria-label="RSI+ links">
        {#each LINKS as l (l.href)}
          {@const Icon = l.icon}
          <a href={l.href} target="_blank" rel="noopener" class="hover:text-foreground inline-flex items-center gap-1.5 no-underline transition-colors"><Icon class="size-3.5" aria-hidden="true" /> {l.label} <ExternalLink class="size-3 opacity-60" aria-hidden="true" /></a>
        {/each}
      </nav>
      <div class="grid content-start gap-1">
        <span class="text-[10px] font-bold tracking-widest uppercase">Referral code</span>
        <div class="flex items-center gap-1">
          <code class="text-primary rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[11px] font-bold">{lead.id}</code>
          <TipButton variant="ghost" size="icon-xs" onclick={copy} tip={copied ? 'Copied' : 'Copy the code'} aria-label={copied ? 'Referral code copied' : 'Copy referral code'}>{#if copied}<Check class="text-success" />{:else}<Copy />{/if}</TipButton>
          <Button variant="outline" size="xs" href={enlistUrl(lead.id)} target="_blank" rel="noopener">Enlist <ExternalLink /></Button>
        </div>
        <span class="max-w-72 text-[10px] leading-snug">Use a referral code to earn 50,000 UEC in-game after buying a game package, and support your friend or favourite content creator. Courtesy of {lead.name}.</span>
      </div>
    </Collapsible.Content>
  </Collapsible.Root>
</footer>
