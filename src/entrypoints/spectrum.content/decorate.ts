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
import { isDev, keywordsFor, type Watches } from '@/lib/watch';
import { IC_RELATIONS, findCodes, fixedEvent, issueUrl, notesMatches, notesSection, readState, statusLabel, threadsFor, tracked, type IcIssues, type IcLinks, type IcMentions, type NotesSection } from '@/lib/issue-council';
import { parseBuild } from '@/lib/sc-builds';
import { tagLabel, type Threat } from '@/lib/intel';
import { threadUrl } from '@/lib/types';
import type { Actions } from './index';

interface DecorState {
  settings: Settings;
  read: ReadState;
  watches: Watches;
  threads: Map<string, ThreadSummary>;
  listed: Set<string>;
  /** Issue Council issues RSI+ has seen (status / contributions for the STARC chips). */
  ic: IcIssues;
  /** Threads that mention / you linked to each code (the chip's hover card). */
  icMentions: IcMentions;
  icLinks: IcLinks;
  /** Your org-lookup tags that apply to a reply author (their own, or an org they're in); null when none. */
  intelOf: (nickname: string) => Threat | null;
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

/** Settings → Spectrum tools off: take back everything `decorate` added (badges, buttons, row classes, muted bodies). */
export function undecorate() {
  for (const n of document.querySelectorAll('.sp-ui')) n.remove();
  for (const n of document.querySelectorAll<HTMLElement>('[data-sp]')) {
    delete n.dataset.sp;
    delete n.dataset.spSlug;
    if (n.title.startsWith('RSI+')) n.removeAttribute('title');
    n.classList.remove('sp-row', 'sp-read', 'sp-new', 'sp-unseen', 'sp-pinned', 'sp-muted', 'sp-dev-row', 'sp-watched', 'sp-keyword');
  }
  for (const n of document.querySelectorAll('.sp-muted-body, .sp-focus, .sp-pn-line')) n.classList.remove('sp-muted-body', 'sp-focus', 'sp-pn-line', 'sp-pn-code');
  for (const n of document.querySelectorAll<HTMLElement>('[data-sp-pn]')) delete n.dataset.spPn;
  for (const n of document.querySelectorAll<HTMLElement>('[data-sp-intel]')) delete n.dataset.spIntel;
}

export function decorate(actions: Actions) {
  if (!st) return;
  paintRows(actions);
  paintReplies(actions);
}

function paintRows(actions: Actions) {
  const s = st!;
  const match = keywordMatcher(s.settings.mutes.keywords);
  /** Keyword watches per channel (every-channel ones included), built once per paint. */
  const kwFor = new Map<string, (text: string) => string | null>();
  const kwIn = (channelId: string) => {
    let m = kwFor.get(channelId);
    if (!m) kwFor.set(channelId, (m = keywordMatcher(keywordsFor(s.watches, channelId))));
    return m;
  };
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
    const kw = kwIn(t.channel_id)(t.subject);
    const key = [rs?.kind, rs?.kind === 'new' ? rs.count : '', reason, watched, dev, kw, t.is_pinned].join('|');
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
    row.classList.toggle('sp-keyword', !!kw);
    row.dataset.spSlug = slug;
    if (reason) row.title = `RSI+: muted (${reason})`;
    else if (kw) row.title = `RSI+: matches your keyword watch "${kw}"`;
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

/** Issue Council codes in the replies on screen, collected by the last paint (the content script records the mentions). */
export let pageCodes: string[] = [];

/**
 * Under a reply that mentions `STARC-123456`: a chip per code linking to the issue, with its status and contributions
 * when RSI+ has seen it on the Issue Council. Text nodes are left alone (React owns them); the chip row is a sibling.
 */
function paintCodes(item: HTMLElement, body: HTMLElement | null, ic: IcIssues, found: Set<string>, actions: Actions) {
  const codes = body ? findCodes(body.textContent ?? '') : [];
  for (const c of codes) found.add(c);
  const key = codes.map((c) => `${c}:${ic[c]?.status ?? ''}:${ic[c]?.contributions ?? ''}`).join(',');
  const old = ownChild<HTMLElement>(item, '.sp-starc');
  if ((old?.dataset.key ?? '') === key && (!!old || !codes.length)) return;
  old?.remove();
  if (!codes.length || !body) return;
  const row = el('div', 'sp-ui sp-starc');
  row.dataset.key = key;
  for (const code of codes) {
    const i = ic[code];
    const a = el('a', `sp-starc-chip${i?.status ? ` sp-starc-${i.status}` : ''}`);
    a.href = issueUrl(code);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = [code, i?.status && statusLabel(i.status), i?.contributions != null && `${i.contributions} contributions`].filter(Boolean).join(' · ') + ' ↗';
    a.dataset.code = code;
    a.setAttribute('aria-describedby', 'sp-starc-card');
    hoverCard(a, code, actions);
    row.append(a);
  }
  body.after(row);
}

/* ---- STARC chip hover card: what RSI+ knows about the issue, Watch, the threads it's in. Local data only. ---- */
let cardTimer = 0;
function hideCard() {
  clearTimeout(cardTimer);
  cardTimer = window.setTimeout(() => document.getElementById('sp-starc-card')?.remove(), 180);
}
function hoverCard(chip: HTMLElement, code: string, actions: Actions) {
  const show = () => {
    clearTimeout(cardTimer);
    showCard(chip, code, actions);
  };
  chip.addEventListener('mouseenter', show);
  chip.addEventListener('focus', show);
  chip.addEventListener('mouseleave', hideCard);
  chip.addEventListener('blur', hideCard);
  chip.addEventListener('keydown', (e) => e.key === 'Escape' && document.getElementById('sp-starc-card')?.remove());
}
function showCard(chip: HTMLElement, code: string, actions: Actions) {
  const s = st;
  if (!s) return;
  document.getElementById('sp-starc-card')?.remove();
  const i = s.ic[code];
  const card = el('div', 'sp-ui sp-starc-card');
  card.id = 'sp-starc-card';
  card.setAttribute('role', 'tooltip');
  card.addEventListener('mouseenter', () => clearTimeout(cardTimer));
  card.addEventListener('mouseleave', hideCard);
  const head = el('div', 'sp-starc-card-head');
  head.append(el('strong', '', code));
  if (i?.status) head.append(el('span', `sp-starc-card-status sp-starc-${i.status}`, statusLabel(i.status)));
  card.append(head);
  if (!i) card.append(el('p', 'sp-starc-card-muted', 'Not seen by RSI+ yet: open it on the Issue Council once to track its status.'));
  else {
    if (i.title) card.append(el('p', 'sp-starc-card-title', i.title));
    const rs = readState(i, i);
    const facts = [i.contributions != null ? `${i.contributions} contributions${rs.newContrib ? ` (+${rs.newContrib} since your visit)` : ''}` : '', i.category ?? '', rs.statusFrom ? `was ${statusLabel(rs.statusFrom)}` : ''].filter(Boolean);
    if (facts.length) card.append(el('p', 'sp-starc-card-muted', facts.join(' · ')));
    const rel = IC_RELATIONS.filter((r) => i.rel.includes(r.id)).map((r) => r.label);
    if (rel.length) card.append(el('p', 'sp-starc-card-rel', rel.join(' · ')));
    if (i.note) card.append(el('p', 'sp-starc-card-note', `Note: ${i.note.split('\n')[0]}`));
  }
  const { mentions, links } = actions.icThreads(code);
  const here = parsePath(location.pathname).slug;
  const others = threadsFor(code, { [code]: mentions }, { [code]: links }).filter((t) => t.slug !== here);
  if (others.length) {
    const list = el('div', 'sp-starc-card-threads');
    list.append(el('span', 'sp-starc-card-muted', 'Also on Spectrum:'));
    for (const t of others.slice(0, 4)) {
      const a = el('a', '', `${t.linked ? '🔗 ' : ''}${t.subject || t.slug}`);
      a.href = threadUrl(t.channelId, t.slug);
      list.append(a);
    }
    card.append(list);
  }
  const row = el('div', 'sp-starc-card-actions');
  const watched = !!i?.rel.includes('watched');
  const w = el('button', `sp-starc-card-btn${watched ? ' on' : ''}`, watched ? '★ Watching in RSI+' : '☆ Watch in RSI+');
  w.addEventListener('click', async (e) => {
    e.preventDefault();
    const on = await actions.toggleIcWatch(code);
    w.textContent = on ? '★ Watching in RSI+' : '☆ Watch in RSI+';
    w.classList.toggle('on', on);
  });
  const open = el('a', 'sp-starc-card-btn', 'Open ↗');
  open.href = issueUrl(code);
  open.target = '_blank';
  open.rel = 'noopener';
  row.append(w, open);
  card.append(row);
  document.body.append(card);
  const r = chip.getBoundingClientRect();
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const below = r.bottom + 6 + ch < window.innerHeight;
  card.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - cw - 8))}px`;
  card.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - ch - 6)}px`;
}

/* ---- patch notes: lines about issues you track (by code, or "maybe" by title words under Known Issues / Bug Fixes) ---- */
const notified = new Set<string>();
function paintPatchNotes() {
  const s = st!;
  const { slug } = parsePath(location.pathname);
  const t = slug ? s.threads.get(slug) : undefined;
  const build = t ? parseBuild(t.subject) : null;
  const first = document.querySelector<HTMLElement>('.forum-thread-item');
  const body = first ? (ownChild<HTMLElement>(first, '.body-content-blocks') ?? ownChild<HTMLElement>(first, '.content-blocks')) : null;
  if (!build || !body || !s.settings.issueCouncil) return void document.querySelector('.sp-pn-bar')?.remove();
  const mine = tracked(s.ic);
  const key = `${slug}|${mine.map((i) => i.code).join(',')}|${body.textContent?.length ?? 0}`;
  if (body.dataset.spPn === key) return;
  body.dataset.spPn = key;
  for (const n of body.querySelectorAll('.sp-pn-tag')) n.remove();
  for (const n of body.querySelectorAll('.sp-pn-line')) n.classList.remove('sp-pn-line', 'sp-pn-code');
  // Lines in order, each with the section the nearest heading above it started.
  const lines: { el: HTMLElement; text: string; section: NotesSection }[] = [];
  let section: NotesSection = 'other';
  for (const n of body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, p, li')) {
    if (n.querySelector('li, p')) continue; // containers: their lines come on their own
    const text = n.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!text) continue;
    const heading = /^H\d$/.test(n.tagName) || (n.tagName === 'P' && text.length < 60 && !!n.querySelector('strong, b') && n.querySelector('strong, b')!.textContent!.trim() === text);
    if (heading) {
      section = notesSection(text);
      continue;
    }
    lines.push({ el: n, text, section });
  }
  const found = notesMatches(lines, mine);
  const byCode = found.filter((f) => f.how === 'code').length;
  for (const f of found) {
    const line = lines[f.line]!.el;
    line.classList.add('sp-pn-line', ...(f.how === 'code' ? ['sp-pn-code'] : []));
    const i = s.ic[f.code];
    const tag = el('a', `sp-ui sp-pn-tag${f.how === 'maybe' ? ' maybe' : ''}`, f.how === 'code' ? `★ you track ${f.code}` : `${f.section === 'fixed' ? 'maybe fixed' : 'maybe'}: ${f.code} ↗`);
    tag.href = issueUrl(f.code);
    tag.target = '_blank';
    tag.rel = 'noopener';
    tag.title = i ? `${i.title}${i.status ? ` (${statusLabel(i.status)})` : ''}${f.how === 'maybe' ? '\nMatched by title words only: may be a different issue' : ''}` : f.code;
    line.append(tag);
    if (f.how === 'code' && f.section === 'fixed' && i && s.settings.icPatchNotify && !notified.has(`${f.code}|${build.version}`)) {
      notified.add(`${f.code}|${build.version}`);
      browser.runtime.sendMessage({ type: 'ic:events', events: [fixedEvent(i, { subject: t!.subject, url: location.href, version: `${build.version} ${build.env}` }, Date.now())] }).catch(() => {});
    }
  }
  let bar = document.querySelector<HTMLElement>('.sp-pn-bar');
  if (!found.length) return void bar?.remove();
  if (!bar) {
    bar = el('div', 'sp-ui sp-pn-bar');
    body.before(bar);
  }
  bar.replaceChildren(el('span', '', `RSI+ · ${new Set(found.map((f) => f.code)).size} tracked issue${found.length === 1 ? '' : 's'} in these notes (${byCode} by code, ${found.length - byCode} maybe)`));
  const jump = el('button', 'sp-pn-jump', 'Jump to first');
  jump.addEventListener('click', () => body.querySelector('.sp-pn-line')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  bar.append(jump);
}

function paintReplies(actions: Actions) {
  const s = st!;
  if (!parsePath(location.pathname).slug) return void (pageCodes = []);
  paintPatchNotes();
  const found = new Set<string>();
  for (const item of document.querySelectorAll<HTMLElement>('.forum-thread-item')) {
    paintCodes(item, ownChild<HTMLElement>(item, '.body-content-blocks') ?? ownChild<HTMLElement>(item, '.content-blocks'), s.ic, found, actions);
    const who = nicknameOf(item);
    if (!who) continue;
    paintIntel(item, who.nickname, actions);
    const muted = s.settings.muteReplies && isMutedMember(who, s.settings.mutes);
    const watched = s.watches.authors.some((a) => a.nickname.toLowerCase() === who.nickname.toLowerCase());
    const key = `${who.nickname}|${muted}|${watched}`;
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
    // A repainted item keeps its buttons (same author); only the Watch toggle's state changes.
    const old = info?.querySelector<HTMLButtonElement>(':scope > .sp-reply-actions > .sp-watch-author');
    if (old && old.dataset.nick === who.nickname) {
      setWatchLabel(old, who.nickname, watched);
      continue;
    }
    info?.querySelector(':scope > .sp-reply-actions')?.remove();
    if (info) {
      const box = el('span', 'sp-ui sp-reply-actions');
      const mute = el('button', 'sp-mini', 'Mute');
      mute.title = `Hide threads and replies by @${who.nickname}`;
      mute.addEventListener('click', (e) => {
        e.stopPropagation();
        actions.mute(who.nickname);
      });
      const watch = el('button', 'sp-mini sp-watch-author');
      watch.dataset.nick = who.nickname;
      setWatchLabel(watch, who.nickname, watched);
      watch.addEventListener('click', (e) => {
        e.stopPropagation();
        actions.toggleAuthor(who.nickname, who.displayname);
      });
      box.append(mute, watch);
      info.append(box);
    }
  }
  pageCodes = [...found];
}

/** Org lookup flag next to a reply author: your tag on them or on an org they're in. Click: look them up in the hub. */
function paintIntel(item: HTMLElement, nickname: string, actions: Actions) {
  const t = st!.intelOf(nickname);
  const info = ownChild(item, '.forum-thread-member-info');
  if (!info) return;
  const key = t?.tag ? `${t.tag}|${t.reasons.map((r) => r.text).join('|')}` : '';
  if ((info.dataset.spIntel ?? '') === key) return;
  info.dataset.spIntel = key;
  info.querySelector(':scope > .sp-intel')?.remove();
  if (!t?.tag) return;
  const why = t.reasons[0];
  const chip = el('button', `sp-ui sp-intel sp-intel-${t.tag}`, `${t.tag === 'hostile' || t.tag === 'caution' ? '⚠ ' : ''}${tagLabel(t.tag)}${why?.sid ? ` · ${why.sid}${why.guess ? '?' : ''}` : ''}`);
  chip.title = `RSI+ org lookup:\n${t.reasons.map((r) => r.text).join('\n')}${t.hidden ? `\n${t.hidden} hidden org membership${t.hidden === 1 ? '' : 's'}` : ''}\nClick to look up @${nickname}`;
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    actions.lookUp(nickname);
  });
  info.append(chip);
}

/** The reply's Watch author button is a toggle: label, pressed state and tooltip follow the watch list. */
function setWatchLabel(b: HTMLButtonElement, nickname: string, watched: boolean) {
  b.textContent = watched ? '★ Watching author' : 'Watch author';
  b.classList.toggle('sp-on', watched);
  b.setAttribute('aria-pressed', String(watched));
  b.title = watched ? `Stop watching @${nickname}` : `Notify when @${nickname} posts in your watched channels`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  if (n instanceof HTMLButtonElement) n.type = 'button';
  return n;
}
