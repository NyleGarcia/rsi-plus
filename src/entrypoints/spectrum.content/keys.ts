/**
 * Keyboard shortcuts (setting `keyboard`):
 *   j / k   next / previous thread row or reply      o / Enter  open focused row
 *   w       watch / unwatch thread                    m / u      mark read / unread
 *   n       jump to first new reply                    ?          help
 */
import { ui } from '@/lib/state.svelte';
import { parsePath } from '@/lib/types';
import type { Actions } from './index';

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('[contenteditable="true"]'));

function targets(): HTMLElement[] {
  const sel = parsePath(location.pathname).slug ? '.forum-thread-item' : '.sp-row';
  return [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.offsetParent !== null);
}

let focusEl: HTMLElement | null = null;

function move(dir: 1 | -1) {
  const list = targets();
  if (!list.length) return;
  let i = focusEl ? list.indexOf(focusEl) : -1;
  if (i === -1) {
    // Start from the first element in view.
    i = list.findIndex((e) => e.getBoundingClientRect().bottom > 80);
    if (dir === -1) i = Math.max(0, i - 1);
  } else i = Math.min(list.length - 1, Math.max(0, i + dir));
  focusEl?.classList.remove('sp-focus');
  focusEl = list[i] ?? null;
  focusEl?.classList.add('sp-focus');
  focusEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function focusedThread(actions: Actions) {
  const slug = focusEl?.dataset.spSlug ?? parsePath(location.pathname).slug;
  return slug ? (actions.thread(slug) ?? ui.view?.thread ?? null) : null;
}

export function startKeys(ctx: { onInvalidated(cb: () => void): void }, actions: Actions) {
  const onKey = (e: KeyboardEvent) => {
    if (!ui.settings.keyboard || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    const t = focusedThread(actions);
    switch (e.key) {
      case 'j':
        move(1);
        break;
      case 'k':
        move(-1);
        break;
      case 'o':
      case 'Enter': {
        if (!focusEl?.classList.contains('sp-row')) return;
        focusEl.querySelector<HTMLAnchorElement>('a[href*="/thread/"]')?.click();
        break;
      }
      case 'w':
        if (!t) return;
        actions.toggleWatch(t);
        break;
      case 'm':
        if (!t) return;
        actions.markRead(t);
        break;
      case 'u':
        if (!t) return;
        actions.markUnread(t);
        break;
      case 'n':
        if (!ui.view?.firstNewUrl) return;
        location.href = ui.view.firstNewUrl;
        break;
      case '?':
        ui.help = !ui.help;
        break;
      case 'Escape':
        if (!ui.help) return;
        ui.help = false;
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey, true);
  ctx.onInvalidated(() => window.removeEventListener('keydown', onKey, true));
  // Route change: the focused element is gone.
  window.addEventListener('wxt:locationchange', () => {
    focusEl?.classList.remove('sp-focus');
    focusEl = null;
  });
}
