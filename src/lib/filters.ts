/** Mute rules: authors (nickname), subject keywords, channel labels. Pure — shared by the page hook and the UI. */
import type { Member, ThreadSummary } from './types';

export interface MuteRules {
  /** Lower-cased nicknames (handles), stable across display-name changes. */
  authors: string[];
  /** Case-insensitive substrings of thread subjects. A `/regex/` entry is a regex. */
  keywords: string[];
  /** Lower-cased label names (e.g. "concern"). */
  labels: string[];
  /** Also hide threads whose *latest reply* is by a muted author (bumps). */
  hideBumps: boolean;
}

export const NO_MUTES: MuteRules = { authors: [], keywords: [], labels: [], hideBumps: false };

export const norm = (s: string) => s.trim().toLowerCase().replace(/^@/, '');

export function keywordMatcher(keywords: string[]): (text: string) => string | null {
  const list = keywords.map((k) => k.trim()).filter(Boolean);
  const tests = list.map((k) => {
    const re = k.match(/^\/(.+)\/([a-z]*)$/);
    if (re) {
      try {
        // Always case-insensitive; never global (a /g regex keeps lastIndex between .test() calls).
        const r = new RegExp(re[1]!, `${re[2]!.replace(/[gi]/g, '')}i`);
        return (t: string) => r.test(t);
      } catch {
        return () => false; // invalid regex never matches
      }
    }
    const lower = k.toLowerCase();
    return (t: string) => t.toLowerCase().includes(lower);
  });
  return (text) => {
    for (let i = 0; i < tests.length; i++) if (tests[i]!(text)) return list[i]!;
    return null;
  };
}

export function isMutedMember(m: Pick<Member, 'nickname'> | null | undefined, rules: MuteRules): boolean {
  return !!m?.nickname && rules.authors.includes(norm(m.nickname));
}

/** Why a thread is muted, or null. */
export function muteReason(t: ThreadSummary, rules: MuteRules, match = keywordMatcher(rules.keywords)): string | null {
  if (isMutedMember(t.member, rules)) return `author @${t.member!.nickname}`;
  if (rules.hideBumps && isMutedMember(t.latest_activity?.member, rules)) return `bumped by @${t.latest_activity!.member!.nickname}`;
  if (t.label && rules.labels.includes(norm(t.label.name))) return `label ${t.label.name}`;
  const k = match(t.subject);
  if (k) return `keyword "${k}"`;
  return null;
}

/**
 * Rewrite a `/forum/channel/threads` payload: drop muted threads. Pinned threads are never dropped (they're
 * announcements). Returns null when nothing changed.
 */
export function filterThreads<T extends { data?: { threads?: ThreadSummary[] } }>(json: T, rules: MuteRules): T | null {
  const threads = json?.data?.threads;
  if (!Array.isArray(threads)) return null;
  const match = keywordMatcher(rules.keywords);
  const kept = threads.filter((t) => t.is_pinned || !muteReason(t, rules, match));
  if (kept.length === threads.length) return null;
  return { ...json, data: { ...json.data, threads: kept } };
}

