<script lang="ts">
  /** Fankit logo + notices in the sidebar footer (needs the sidebar context to know when it is collapsed to icons). */
  import FanNotice from '@/components/FanNotice.svelte';
  import * as Sidebar from '@/components/ui/sidebar';

  const sidebar = Sidebar.useSidebar();
  const collapsed = $derived(sidebar.state === 'collapsed' && !sidebar.isMobile);
</script>

<FanNotice variant="sidebar" {collapsed} class="px-1" />
