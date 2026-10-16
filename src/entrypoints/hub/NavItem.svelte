<script lang="ts">
  /**
   * One hub sidebar entry: icon + title, one line each (16 pages must fit an 800px-tall window without scrolling); the
   * subtitle is the hover title here and the header's second line once the page is open. Lives inside Sidebar.Provider
   * so a pick can close the mobile sheet.
   */
  import type { Component } from 'svelte';
  import * as Sidebar from '@/components/ui/sidebar';

  let {
    id,
    label,
    sub,
    icon: Icon,
    active,
    onselect,
  }: { id: string; label: string; sub: string; icon: Component; active: boolean; onselect: () => void } = $props();

  const sidebar = Sidebar.useSidebar();
</script>

<Sidebar.MenuItem>
  <Sidebar.MenuButton
    {id}
    isActive={active}
    title={sub}
    aria-current={active ? 'page' : undefined}
    aria-controls="panel"
    tabindex={active ? 0 : -1}
    tooltipContent={label}
    class="group-data-[collapsible=icon]:p-2! data-active:[&_svg]:text-primary"
    onclick={() => {
      onselect();
      if (sidebar.isMobile) sidebar.setOpenMobile(false);
    }}
  >
    <Icon aria-hidden="true" />
    <span class="truncate font-medium">{label}</span>
  </Sidebar.MenuButton>
</Sidebar.MenuItem>
