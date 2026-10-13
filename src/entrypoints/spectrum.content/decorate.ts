/**
 * DOM decoration. Spectrum's markup is React with unhashed classes (`.forum-thread-item`, `.member-name`,
 * `.nickname-separator` — from the 2026-10 bundle). Thread *list* rows have no stable class, so a row is found
 * from its thread link: the ancestor that sits next to sibling rows linking to *other* threads.
 * Only rows whose slug came from a captured list payload are painted (sidebar bookmarks etc. are left alone).
 */
import { isMutedMember, keywordMatcher, muteReason } from '@/lib/filters';
import { status, type ReadState } from '@/lib/read';
import type { Settings } from '@/lib/settings';
import { parsePath, type ThreadSummary } from '@/lib/types';
import { isDev, type Watches } from '@/lib/watch';
import type { Actions } from './index';

interface DecorState {
  settings: Settings;
  read: ReadState;
  watches: Watches;
  threads: Map<string, ThreadSummary>;
  listed: Set<string>;
}
let st: DecorState | null = null;
export function setDecorState(s: DecorState) {
  st = s;
}

const THREAD_LINK = 'a[href*="/thread/"]';

export function slugOf(a: HTMLAnchorElement): { slug: string | null; replyId: string | null } {
  try {
    const p = parsePath(new URL(a.href, location.href).pathname);
    return { slug: p.slug, replyId: p.replyId };
  } catch {
    return { slug: null, replyId: null };
  }
}

/** The list row containing `a`: climb until the element has a sibling that links to a different thread. */
export function rowFor(a: HTMLAnchorElement, slug: string, maxDepth = 8): HTMLElement | null {
  let el: HTMLElement = a;
  for (let i = 0; i < maxDepth && el.parentElement && el.parentElement !== document.body; i++) {
    const p = el.parentElement;
    for (const sib of p.children) {
      if (sib === el) continue;
      for (const other of sib.querySelectorAll<HTMLAnchorElement>(THREAD_LINK)) {
        const s = slugOf(other).slug;
        if (s && s !== slug) return el;
      }
    }
    el = p;
  }
  return null;
}

export function decorate(actions: Actions) {
  if (!st) return;
  paintRows(actions);
  paintReplies(actions);
}

function paintRows(actions: Actions) {
  const s = st!;
  const match = keywordMatcher(s.settings.mutes.keywords);
  const done = new Set<HTMLElement>();
  for (const a of document.querySelectorAll<HTMLAnchorElement>(THREAD_LINK)) {
    if (a.closest('.forum-thread-item, .sp-ui, [class*="sidebar"], [class*="Sidebar"]')) continue;
    const { slug, replyId } = slugOf(a);
    if (!slug || replyId || !s.listed.has(slug)) continue;
    const t = s.threads.get(slug);
    const row = t && rowFor(a, slug);
    if (!t || !row || done.has(row)) continue;
    done.add(row);

    const rs = s.settings.readTracking ? status(t, s.read) : null;
    const reason = muteReason(t, s.settings.mutes, match);
    const watched = s.watches.threads.some((w) => w.id === t.id);
    const dev = s.settings.devHighlight && isDev(t);
    const key = [rs?.kind, rs?.kind === 'new' ? rs.count : '', reason, watched, dev, t.is_pinned].join('|');
    if (row.dataset.sp === key && row.querySelector('.sp-badges')) continue;
    row.dataset.sp = key;

    row.classList.add('sp-row');
    row.classList.toggle('sp-read', rs?.kind === 'read');
    row.classList.toggle('sp-new', rs?.kind === 'new');
    row.classList.toggle('sp-unseen', rs?.kind === 'unseen');
    row.classList.toggle('sp-pinned', t.is_pinned);
    row.classList.toggle('sp-muted', !!reason && !t.is_pinned);
    row.classList.toggle('sp-dev-row', dev);
    row.classList.toggle('sp-watched', watched);
    row.dataset.spSlug = slug;
    if (reason) row.title = `RSI+: muted (${reason})`;
    else if (row.title.startsWith('RSI+')) row.removeAttribute('title');

    row.querySelector(':scope .sp-badges')?.remove();
    const badges = el('span', 'sp-ui sp-badges');
    if (rs?.kind === 'new') badges.append(el('span', 'sp-pill sp-pill-new', `+${rs.count} new`));
    if (dev) badges.append(el('span', 'sp-pill sp-pill-dev', 'DEV'));
    const star = el('button', `sp-star${watched ? ' on' : ''}`, watched ? '★' : '☆');
    star.title = watched ? 'Stop watching (w)' : 'Watch thread — notify on new replies (w)';
    star.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      actions.toggleWatch(t);
    });
    badges.append(star);
    a.after(badges);
  }
}

function ownChild<T extends HTMLElement>(item: HTMLElement, sel: string): T | null {
  for (const n of item.querySelectorAll<T>(sel)) if (n.closest('.forum-thread-item') === item) return n;
  return null;
}

export function nicknameOf(item: HTMLElement): { nickname: string; displayname: string } | null {
  const info = ownChild(item, '.forum-thread-member-info');
  const sep = info?.querySelector('.nickname-separator');
  const nickname = sep?.parentElement?.textContent?.replace(/^@/, '').trim();
  if (!nickname) return null;
  const displayname = info?.querySelector('.displayname')?.textContent?.trim() || nickname;
  return { nickname, displayname };
}

function paintReplies(actions: Actions) {
  const s = st!;
  if (!parsePath(location.pathname).slug) return;
  for (const item of document.querySelectorAll<HTMLElement>('.forum-thread-item')) {
    const who = nicknameOf(item);
    if (!who) continue;
    const muted = s.settings.muteReplies && isMutedMember(who, s.settings.mutes);
    const key = `${who.nickname}|${muted}`;
    if (item.dataset.sp === key) continue;
    item.dataset.sp = key;

    const body = ownChild(item, '.body-content-blocks') ?? ownChild(item, '.content-blocks');
    ownChild(item, '.sp-muted-note')?.remove();
    body?.classList.toggle('sp-muted-body', muted);
    if (muted && body) {
      const note = el('button', 'sp-ui sp-muted-note', `Muted @${who.nickname} — show`);
      note.addEventListener('click', () => {
        body.classList.toggle('sp-muted-body');
        note.textContent = body.classList.contains('sp-muted-body') ? `Muted @${who.nickname} — show` : `Muted @${who.nickname} — hide`;
      });
      body.before(note);
    }

    const info = ownChild(item, '.forum-thread-member-info');
    if (info && !info.querySelector(':scope > .sp-reply-actions')) {
      const box = el('span', 'sp-ui sp-reply-actions');
      const mute = el('button', 'sp-mini', 'Mute');
      mute.title = `Hide threads and replies by @${who.nickname}`;
      mute.addEventListener('click', (e) => {
        e.stopPropagation();
        actions.mute(who.nickname);
      });
      const watch = el('button', 'sp-mini', 'Watch author');
      watch.title = `Notify when @${who.nickname} posts in your watched channels`;
      watch.addEventListener('click', (e) => {
        e.stopPropagation();
        actions.watchAuthor(who.nickname, who.displayname);
      });
      box.append(mute, watch);
      info.append(box);
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  if (n instanceof HTMLButtonElement) n.type = 'button';
  return n;
}
