<script module lang="ts">
  /** One guided step. `done` is judged from live data by the panel; the wizard only trusts it once every earlier step is done. */
  export interface WizardStep {
    id: string;
    title: string;
    /** What to do / what the data says, shown on the current step. */
    hint?: string;
    done: boolean;
    /** Something is off but you can still act (missing lines, unverified prices). */
    warn?: string;
    /** Why the step's action is withheld (melting before the cart is confirmed). */
    blocked?: string;
    action?: WizardAction;
    /** A second button next to the first (open the cart + reload the hangar). */
    extra?: WizardAction;
  }
  export interface WizardAction {
    label: string;
    onclick?: () => void;
    href?: string;
    disabled?: boolean;
    busy?: boolean;
  }
</script>

<script lang="ts">
  /**
   * Guided flow: a vertical stepper whose steps are derived from the panel's own state (nothing is re-implemented here).
   * The current step is the first not-done one; later steps never count as done early (owning the target ship before the
   * CCU chain is applied). "Guide" can be switched off per flow (`localStorage` `rsiplus:wizard:<key>`).
   */
  import * as Card from '@/components/ui/card';
  import { Button } from '@/components/ui/button';
  import { Progress } from '@/components/ui/progress';
  import { Switch } from '@/components/ui/switch';
  import { Label } from '@/components/ui/label';
  import { cn } from '@/lib/utils';
  import Check from '@lucide/svelte/icons/check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Lock from '@lucide/svelte/icons/lock';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import PartyPopper from '@lucide/svelte/icons/party-popper';

  let {
    title,
    steps,
    storageKey,
    doneText = 'All done.',
    onReset,
    resetLabel = 'Start over',
  }: { title: string; steps: WizardStep[]; storageKey: string; doneText?: string; onReset?: () => void; resetLabel?: string } = $props();

  const KEY = $derived(`rsiplus:wizard:${storageKey}`);
  // svelte-ignore state_referenced_locally -- the key is fixed per flow; read once for the initial value
  let on = $state(
    (() => {
      try {
        return localStorage.getItem(`rsiplus:wizard:${storageKey}`) !== 'off';
      } catch {
        return true;
      }
    })(),
  );
  $effect(() => {
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* fine */
    }
  });

  /** done[i] = the step says so and every earlier one is done. */
  const done = $derived(steps.reduce<boolean[]>((acc, s, i) => [...acc, s.done && (i === 0 || acc[i - 1]!)], []));
  const current = $derived(done.indexOf(false));
  const finished = $derived(steps.length > 0 && current === -1);
  const n = $derived(done.filter(Boolean).length);
</script>

{#snippet act(a: WizardAction, variant: 'default' | 'outline')}
  {#if a.href}
    <Button size="sm" {variant} href={a.href} target={a.href.startsWith('#') ? undefined : '_blank'} rel={a.href.startsWith('#') ? undefined : 'noopener'} disabled={a.disabled}>
      {a.label}{#if !a.href.startsWith('#')}<ExternalLink />{/if}
    </Button>
  {:else}
    <Button size="sm" {variant} onclick={a.onclick} disabled={a.disabled || a.busy}>{a.label}</Button>
  {/if}
{/snippet}

<Card.Root size="sm" class={cn('shadow-none', on ? 'ring-primary/30' : 'bg-transparent')}>
  <Card.Header class="flex flex-wrap items-center gap-2">
    <Card.Title class="flex items-center gap-2 text-sm font-semibold">
      {title}
      {#if on && !finished}<span class="text-muted-foreground font-normal">step {current + 1} of {steps.length}</span>{/if}
    </Card.Title>
    <span class="flex-1"></span>
    <div class="flex items-center gap-2">
      <Switch id={`wizard-guide-${storageKey}`} bind:checked={on} />
      <Label for={`wizard-guide-${storageKey}`} class="text-muted-foreground cursor-pointer text-xs font-normal">Guide me</Label>
    </div>
  </Card.Header>
  {#if on}
    <Card.Content class="grid gap-3">
      <Progress value={n} max={steps.length || 1} class="h-1 *:data-[slot=progress-indicator]:bg-primary" aria-hidden="true" />
      {#if finished}
        <div class="text-success flex items-center gap-2 text-sm"><PartyPopper class="size-4" /> {doneText}</div>
        {#if onReset}<div><Button variant="outline" size="sm" onclick={onReset}>{resetLabel}</Button></div>{/if}
      {:else}
        <ol class="m-0 grid list-none gap-1 p-0">
          {#each steps as s, i (s.id)}
            {@const isDone = done[i]}
            {@const isNow = i === current}
            <li class={cn('grid grid-cols-[22px_1fr] gap-x-2.5', isNow ? 'py-1' : 'py-0.5', !isNow && !isDone && 'text-muted-foreground')}>
              <span
                class={cn(
                  'mt-0.5 flex size-[22px] items-center justify-center rounded-full border text-[11px] font-semibold',
                  isDone ? 'border-success/50 bg-success/15 text-success' : isNow ? (s.blocked ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-primary bg-primary/15 text-primary') : 'border-border',
                )}
                aria-hidden="true"
              >
                {#if isDone}<Check class="size-3" />{:else if isNow && s.blocked}<Lock class="size-3" />{:else}{i + 1}{/if}
              </span>
              <div class="min-w-0">
                <div class={cn('text-sm', isNow && 'font-semibold', isDone && 'text-muted-foreground line-through decoration-success/40')}>{s.title}</div>
                {#if isNow}
                  {#if s.hint}<p class="text-muted-foreground m-0 mt-0.5 text-xs">{s.hint}</p>{/if}
                  {#if s.blocked}
                    <p class="text-destructive m-0 mt-1 flex items-start gap-1.5 text-xs"><Lock class="mt-0.5 size-3 shrink-0" /> {s.blocked}</p>
                  {:else if s.warn}
                    <p class="text-warning m-0 mt-1 flex items-start gap-1.5 text-xs"><TriangleAlert class="mt-0.5 size-3 shrink-0" /> {s.warn}</p>
                  {/if}
                  {#if (s.action || s.extra) && !s.blocked}
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                      {#if s.action}{@render act(s.action, 'default')}{/if}
                      {#if s.extra}{@render act(s.extra, 'outline')}{/if}
                    </div>
                  {/if}
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </Card.Content>
  {/if}
</Card.Root>
