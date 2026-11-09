import { DEFAULTS, type Settings } from './settings';
import type { ThreadSummary } from './types';

export interface ThreadView {
  thread: ThreadSummary;
  /** New replies since your previous visit (0 on first visit). */
  newCount: number;
  firstVisit: boolean;
  /** Link to the first reply posted after your previous visit (if it was in the loaded page). */
  firstNewUrl: string | null;
}

/** Shared reactive state for the in-page Svelte UI (thread bar, toasts, help). */
export const ui = $state({
  settings: DEFAULTS as Settings,
  view: null as ThreadView | null,
  watched: false,
  /** Issue Council codes you linked to the open thread. */
  linked: [] as string[],
  help: false,
  /** Px the floating bar sits above the viewport bottom to clear Spectrum's own pinned footer (reply pager). */
  barLift: 0,
  toast: null as { text: string; undo?: () => void; id: number } | null,
});

let toastSeq = 0;
export function toast(text: string, undo?: () => void, ms = 6000) {
  const id = ++toastSeq;
  ui.toast = { text, undo, id };
  setTimeout(() => {
    if (ui.toast?.id === id) ui.toast = null;
  }, ms);
}
