/**
 * Issue Council pages (opt-in: Settings → Issue Council). Registered at runtime by the background only while the
 * setting is on and the optional host is granted (`registration: 'runtime'` keeps it out of the manifest, so a store
 * install asks for nothing new). Reads Issue Council's own markup (lib/issue-council.ts) — never its API or login.
 *
 * - Issue cards (dashboard, lists, my reports …): "+N new" contributions and "was <status>" since your last visit to
 *   the issue, and an RSI+ Watch star.
 * - An issue page: marks it read, highlights Activity Feed entries added since your last visit, an RSI+ panel with
 *   Watch, what changed, and the Spectrum threads RSI+ saw mention the code.
 * - Tracked issues (watched, or on My reports / My contributions / Followed issues) that changed since RSI+ last saw
 *   them → Feed + desktop notification, through the background.
 * - Report new issue: autosaves the form, offers the draft back, inserts your template.
 */
import { getSettings, icDraftItem, icIssuesItem, icMentionsItem, settingsItem, type Settings } from '@/lib/settings';
import {
  issueEvents,
  markSeen,
  newActivity,
  pageOf,
  pageRelation,
  parseCards,
  parseIssuePage,
  prune,
  readState,
  statusLabel,
  toggleWatch,
  upsert,
  type IcIssue,
  type IcIssues,
  type IcMentions,
  type IcSnapshot,
} from '@/lib/issue-council';
import { threadUrl } from '@/lib/types';
import type { FeedEvent } from '@/lib/watch';
import css from './style.css?inline';

let settings: Settings;
let issues: IcIssues = {};
let mentions: IcMentions = {};
let path = location.pathname;
/** Issue pages marked read in this page view (a re-render must not count the visit twice). */
const visited = new Set<string>();
/** Activity Feed entries new at this visit, per issue: highlighted until you leave the page. */
const fresh = new Map<string, Set<string>>();
/** What the last visit showed, per issue, for the panel's "since your visit" line (kept for this page view). */
const before = new Map<string, IcIssue | undefined>();

export default defineContentScript({
  matches: ['https://issue-council.robertsspaceindustries.com/*'],
  registration: 'runtime',
  runAt: 'document_idle',
  async main(ctx) {
    settings = await getSettings();
    if (!settings.issueCouncil) return;
    settingsItem.watch(async () => (settings = await getSettings()));
    const style = document.createElement('style');
    style.id = 'rsiplus-ic-style';
    style.textContent = css;
    (document.head ?? document.documentElement).append(style);

    issues = await icIssuesItem.getValue();
    mentions = await icMentionsItem.getValue();
    icIssuesItem.watch((v) => {
      issues = v ?? {};
      schedule();
    });
    icMentionsItem.watch((v) => (mentions = v ?? {}));

    let timer = 0;
    const schedule = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        scan().catch((e) => console.warn('[RSI+] issue council', e));
      }, 250);
    };
    ctx.addEventListener(window, 'wxt:locationchange', (e) => {
      const from = pageOf(path);
      path = e.newUrl.pathname;
      // Submitted: the form leaves for the new issue's page — the draft is done.
      if (from === 'create' && pageOf(path) === 'issue') icDraftItem.setValue(null).catch(() => {});
      visited.clear();
      fresh.clear();
      before.clear();
      schedule();
    });
    const mo = new MutationObserver((muts) => {
      if (muts.every((m) => [...m.addedNodes, ...m.removedNodes].every((n) => n instanceof HTMLElement && (n.classList.contains('rp-ic') || !!n.closest('.rp-ic'))))) return;
      schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => mo.disconnect());
    startReportHelper(ctx);
    schedule();
  },
});

/** Same issue facts as stored (title, status, count, category, relations): no write needed. */
const sig = (i: IcIssue | undefined) => (i ? [i.title, i.status, i.contributions, i.category, i.rel.join(',')].join('|') : '');

async function scan() {
  const page = pageOf(path);
  const now = Date.now();
  const next: IcIssues = { ...issues };
  const events: FeedEvent[] = [];
  let dirty = false;
  const touch = (snap: IcSnapshot, rel: IcIssue['rel'][number] | null) => {
    const prev = next[snap.code];
    events.push(...issueEvents(prev, snap, now));
    const up = upsert(next, snap, rel, now);
    // Unchanged and seen in the last 10 minutes: keep the stored record (no write on every DOM change).
    if (prev && sig(prev) === sig(up) && now - prev.updatedAt < 600_000) next[snap.code] = prev;
    else dirty = true;
  };

  const cards = parseCards(document);
  for (const c of cards) touch(c, c.rel ?? pageRelation(page));

  const issuePage = page === 'issue' ? parseIssuePage(document) : null;
  if (issuePage) {
    touch(issuePage, null);
    const code = issuePage.code;
    // Mark read once the Activity Feed is on the page (it renders after the header).
    if (!visited.has(code) && document.querySelector('.c-activity-feed')) {
      visited.add(code);
      before.set(code, issues[code]);
      fresh.set(code, new Set(newActivity(issues[code], issuePage)));
      next[code] = markSeen(next[code]!, issuePage, now);
      dirty = true;
    } else if (visited.has(code)) {
      // Entries that render later in this visit (load more) are read too.
      const seen = new Set(next[code]?.seen?.activity ?? []);
      if (issuePage.activity.some((id) => !seen.has(id))) {
        next[code] = markSeen(next[code]!, issuePage, next[code]!.seen?.at ?? now);
        dirty = true;
      }
    }
  }

  if (dirty) {
    issues = prune(next);
    await icIssuesItem.setValue(issues);
  }
  if (events.length) browser.runtime.sendMessage({ type: 'ic:events', events }).catch(() => {});

  for (const c of cards) paintCard(c.el, c);
  if (issuePage) paintIssuePage(issuePage);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  if (n instanceof HTMLButtonElement) n.type = 'button';
  return n;
}

function watchButton(snap: IcSnapshot, watched: boolean, big = false): HTMLButtonElement {
  const b = el('button', `rp-ic-watch${watched ? ' on' : ''}${big ? ' big' : ''}`, watched ? (big ? '★ Watching in RSI+' : '★') : big ? '☆ Watch in RSI+' : '☆');
  b.title = watched ? 'Stop watching in RSI+' : 'Watch in RSI+: a status change or new contributions go to the RSI+ Feed (seen when you open the Issue Council)';
  b.setAttribute('aria-pressed', String(watched));
  b.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = await icIssuesItem.getValue();
    toggleWatch(cur, snap, Date.now());
    await icIssuesItem.setValue(cur);
  });
  return b;
}

/** Card: "+N new" / "was open" since your last visit, watch star. Repainted only when its state changes. */
function paintCard(card: HTMLElement, snap: IcSnapshot) {
  const issue = issues[snap.code];
  const rs = readState(issue, snap);
  const watched = !!issue?.rel.includes('watched');
  const key = [rs.newContrib, rs.statusFrom, watched, issue?.rel.join(',')].join('|');
  const host = card.querySelector('.c-issue-card-content');
  if (!host) return;
  let box = host.querySelector<HTMLElement>(':scope > .rp-ic-card');
  if (box?.dataset.key === key) return;
  box?.remove();
  box = el('div', 'rp-ic rp-ic-card');
  box.dataset.key = key;
  if (rs.newContrib) box.append(el('span', 'rp-ic-pill new', `+${rs.newContrib} new`));
  if (rs.statusFrom) box.append(el('span', 'rp-ic-pill status', `was ${statusLabel(rs.statusFrom)}`));
  if (issue?.seen && !rs.newContrib && !rs.statusFrom) box.append(el('span', 'rp-ic-pill read', 'read'));
  box.append(watchButton(snap, watched));
  host.prepend(box);
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Issue page: RSI+ panel under the header, new Activity Feed entries highlighted. */
function paintIssuePage(p: ReturnType<typeof parseIssuePage> & {}) {
  for (const id of fresh.get(p.code) ?? []) document.getElementById(id)?.classList.add('rp-ic-new');
  const header = document.querySelector('.c-issue-report-header');
  if (!header) return;
  const issue = issues[p.code];
  const prev = before.get(p.code);
  const rs = readState(prev, p);
  const nNew = fresh.get(p.code)?.size ?? 0;
  const ment = mentions[p.code] ?? [];
  const watched = !!issue?.rel.includes('watched');
  const key = [watched, issue?.rel.join(','), rs.newContrib, rs.statusFrom, nNew, prev?.seen?.at, ment.map((m) => m.slug).join(',')].join('|');
  let box = header.parentElement?.querySelector<HTMLElement>(':scope > .rp-ic-panel');
  if (box?.dataset.key === key) return;
  box?.remove();
  box = el('div', 'rp-ic rp-ic-panel');
  box.dataset.key = key;
  const row = el('div', 'rp-ic-row');
  row.append(el('span', 'rp-ic-logo', 'RSI+'), watchButton(p, watched, true));
  const rel = issue?.rel.filter((r) => r !== 'watched') ?? [];
  if (rel.length) row.append(el('span', 'rp-ic-muted', `tracked: ${rel.map((r) => ({ reported: 'you reported it', contributed: 'you contributed', followed: 'you follow it' })[r as 'reported']).join(', ')}`));
  box.append(row);

  const since = el('div', 'rp-ic-row');
  if (!prev?.seen) since.append(el('span', 'rp-ic-muted', 'First visit: from now on RSI+ marks what is new here.'));
  else {
    const bits: string[] = [];
    if (rs.statusFrom) bits.push(`status ${statusLabel(rs.statusFrom)} → ${statusLabel(p.status)}`);
    if (rs.newContrib) bits.push(`+${rs.newContrib} contribution${rs.newContrib === 1 ? '' : 's'}`);
    if (nNew) bits.push(`${nNew} new in the Activity Feed`);
    since.append(el('span', bits.length ? 'rp-ic-new-text' : 'rp-ic-muted', bits.length ? `Since your visit ${when(prev.seen.at)}: ${bits.join(' · ')}` : `Nothing new since your visit ${when(prev.seen.at)}`));
    if (nNew) {
      const jump = el('button', 'rp-ic-btn', 'Jump to first new');
      jump.addEventListener('click', () => {
        const first = [...(fresh.get(p.code) ?? [])].map((id) => document.getElementById(id)).find((n) => !!n);
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      since.append(jump);
    }
  }
  box.append(since);

  if (ment.length) {
    const m = el('div', 'rp-ic-row');
    m.append(el('span', 'rp-ic-muted', 'On Spectrum:'));
    for (const t of ment) {
      const a = el('a', 'rp-ic-link', t.subject || t.slug);
      a.href = threadUrl(t.channelId, t.slug);
      a.target = '_blank';
      a.rel = 'noopener';
      m.append(a);
    }
    box.append(m);
  }
  header.after(box);
}

/* ---------------------------------------------------------------- report new issue ---------------------------------------------------------------- */

type Field = HTMLInputElement | HTMLTextAreaElement;
const FORM = 'form.c-form-with-steps, form.c-form';
const fieldsOf = (form: Element) => [...form.querySelectorAll<Field>('input[name]:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea[name]')];

/** Set a React-controlled field: the native setter, then the events React listens for. */
function setValue(f: Field, v: string) {
  const proto = f instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(f, v);
  f.dispatchEvent(new Event('input', { bubbles: true }));
  f.dispatchEvent(new Event('change', { bubbles: true }));
}

function startReportHelper(ctx: { onInvalidated(cb: () => void): void }) {
  let saveTimer = 0;
  /** Restore requested: fields of later steps get filled as they render. */
  let restoring: Record<string, string> | null = null;
  /** The text box last clicked: the template goes there (multi-line fields only — the title holds 60 characters). */
  let lastField: HTMLTextAreaElement | null = null;

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      const form = document.querySelector(FORM);
      if (!form || pageOf(path) !== 'create') return;
      const cur = (await icDraftItem.getValue())?.fields ?? {};
      const fields = { ...cur };
      for (const f of fieldsOf(form)) {
        if (f.value.trim()) fields[f.name] = f.value;
        else delete fields[f.name];
      }
      await icDraftItem.setValue(Object.keys(fields).length ? { at: Date.now(), fields } : null);
    }, 600);
  };
  const onInput = (e: Event) => {
    const t = e.target as Element | null;
    if (pageOf(path) !== 'create' || !t?.closest?.(FORM) || !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
    save(); // merges into the stored draft, so restored fields of steps not on screen stay
  };
  const onFocus = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLTextAreaElement && t.closest(FORM)) lastField = t;
  };
  document.addEventListener('input', onInput, true);
  document.addEventListener('focusin', onFocus, true);
  ctx.onInvalidated(() => (document.removeEventListener('input', onInput, true), document.removeEventListener('focusin', onFocus, true)));

  const fill = () => {
    const form = document.querySelector(FORM);
    if (!form || !restoring) return;
    for (const f of fieldsOf(form)) if (restoring[f.name] != null && !f.value) setValue(f, restoring[f.name]!);
  };

  let painting = false;
  const paint = async () => {
    if (painting) return;
    painting = true;
    try {
      const form = document.querySelector(FORM);
      const bar = document.querySelector<HTMLElement>('.rp-ic-report');
      if (pageOf(path) !== 'create' || !form) return void bar?.remove();
      fill();
      const draft = await icDraftItem.getValue();
      const empty = fieldsOf(form).every((f) => !f.value.trim());
      const key = [draft?.at, empty, !!restoring].join('|');
      if (bar?.dataset.key === key) return;
      bar?.remove();
      const box = el('div', 'rp-ic rp-ic-report');
      box.dataset.key = key;
      box.append(el('span', 'rp-ic-logo', 'RSI+'));
      if (draft && empty && !restoring) {
        const n = Object.keys(draft.fields).length;
        const restore = el('button', 'rp-ic-btn primary', `Restore draft (${n} field${n === 1 ? '' : 's'}, ${when(draft.at)})`);
        restore.addEventListener('click', () => {
          restoring = { ...draft.fields };
          fill();
          paint();
        });
        const drop = el('button', 'rp-ic-btn', 'Discard');
        drop.addEventListener('click', () => icDraftItem.setValue(null).then(paint));
        box.append(restore, drop);
      } else box.append(el('span', 'rp-ic-muted', draft ? `Draft saved ${when(draft.at)}` : 'Your answers are saved as you type'));
      const tpl = el('button', 'rp-ic-btn', 'Insert template');
      tpl.title = 'Put your template (Settings → Integrations → Issue Council) into the text box you last clicked';
      const hint = el('span', 'rp-ic-muted');
      tpl.addEventListener('click', () => {
        const target = lastField?.isConnected ? lastField : (form.querySelector<HTMLTextAreaElement>('textarea[name]') ?? null);
        if (!target) return void (hint.textContent = 'No text box on this step: it goes into a description field (after Next).');
        hint.textContent = '';
        const t = settings.icTemplate || '';
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        setValue(target, target.value.slice(0, start) + t + target.value.slice(end));
        target.focus();
      });
      box.append(tpl, hint);
      form.before(box);
    } finally {
      painting = false;
    }
  };
  let raf = 0;
  const soon = () => void (raf ||= requestAnimationFrame(() => ((raf = 0), paint())));
  icDraftItem.watch(soon);
  const mo = new MutationObserver(soon);
  mo.observe(document.body, { childList: true, subtree: true });
  ctx.onInvalidated(() => mo.disconnect());
  paint();
}
