<script lang="ts">
  /**
   * One hub sidebar entry: icon + title, one line each (16 pages must fit an 800px-tall window without scrolling); the
   * subtitle is in the tooltip when the sidebar is collapsed to icons and the header's second line once the page is
   * open. Lives inside Sidebar.Provider so a pick can close the mobile sheet.
   */
  import type { Component } from 'svelte';
  import * as Sidebar from '@/components/ui/sidebar';
  import { Badge } from '@/components/ui/badge';

  let {
    id,
    label,
    sub,
    icon: Icon,
    active,
    count = 0,
    badge = [],
    children = [],
    onselect,
  }: {
    id: string;
    label: string;
    sub: string;
    icon: Component;
    active: boolean;
    /** Pending items (the badge shows when above zero). */
    count?: number;
    /** What the badge says, as colored chips ("+32" green, "−5" red); the plain count when empty. */
    badge?: { text: string; tone: 'success' | 'destructive' | 'info' }[];
    /** Views of the page, listed under it (hidden when the sidebar is collapsed to icons). */
    children?: { id: string; label: string; sub: string; href: string; active: boolean; count?: string }[];
    onselect: () => void;
  } = $props();

  const sidebar = Sidebar.useSidebar();
</script>

{#snippet tooltipContent()}
  <span class="grid gap-0.5"><span class="font-semibold">{label}</span><span class="opacity-80">{sub}</span></span>
{/snippet}

<Sidebar.MenuItem>
  <Sidebar.MenuButton
    {id}
    isActive={active}
    aria-current={active ? 'page' : undefined}
    aria-controls="panel"
    tabindex={active ? 0 : -1}
    {tooltipContent}
    class="group-data-[collapsible=icon]:p-2! data-active:[&_svg]:text-primary"
    onclick={() => {
      onselect();
      if (sidebar.isMobile) sidebar.setOpenMobile(false);
    }}
  >
    <Icon aria-hidden="true" />
    <span class="truncate font-medium">{label}</span>
  </Sidebar.MenuButton>
  {#if count > 0}
    <Sidebar.MenuBadge class="flex gap-1 px-0">
      {#each badge as b (b.text)}
        <Badge variant={b.tone === 'success' ? 'success-soft' : b.tone === 'info' ? 'info' : 'destructive'} class="h-4 rounded-md px-1.5 text-[11px] font-semibold tabular-nums">{b.text}</Badge>
      {:else}
        <Badge variant="info" class="h-4 rounded-md px-1.5 text-[11px] font-semibold tabular-nums">{count > 99 ? '99+' : count}</Badge>
      {/each}
    </Sidebar.MenuBadge>
  {/if}
  {#if children.length}
    <Sidebar.MenuSub class="mr-0 pr-1">
      {#each children as c (c.id)}
        <Sidebar.MenuSubItem>
          <Sidebar.MenuSubButton href={c.href} isActive={c.active} aria-current={c.active ? 'page' : undefined} title={c.sub} class="justify-between" onclick={() => sidebar.isMobile && sidebar.setOpenMobile(false)}>
            <span class="truncate">{c.label}</span>
            {#if c.count}<span class="text-muted-foreground text-[11px] tabular-nums">{c.count}</span>{/if}
          </Sidebar.MenuSubButton>
        </Sidebar.MenuSubItem>
      {/each}
    </Sidebar.MenuSub>
  {/if}
</Sidebar.MenuItem>
