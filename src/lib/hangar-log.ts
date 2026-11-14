/**
 * RSI's Hangar log (the *Hangar log* button on /account/pledges): the history of your pledges — created, reclaimed,
 * gifted, and upgrades applied. `POST /api/account/pledgeLog { page }` → `{ success, data: { pagecount, rendered } }`
 * with `rendered` an HTML fragment of rows, newest first (seen in RSI's own account script, 2026-11). Read-only.
 *
 * A row reads, as text:
 *   `Nov 14 2026, 6:33 pm - Upgrade - Pulse to Meteor Warbond Edition #115341930 - Consumed by <handle> on pledge #103546693, value: $210.00 USD`
 *   `Nov 14 2026, 6:33 pm - Standalone Ships - Pulse plus Dominion Paint #103546693 - Upgrade applied: #115341930 Upgrade - Pulse to Meteor Warbond Edition, new value: $235.00 USD`
 * Applying a CCU writes both: the upgrade is *consumed* on a pledge, and that pledge has an upgrade *applied*. A CCU
 * that left the hangar without a *consumed* row was melted or gifted. The parser works on the text, not the markup.
 */
import { token } from './api';
import { SPECTRUM_ORIGIN } from './types';

export type LogKind = 'consumed' | 'applied' | 'created' | 'reclaimed' | 'gifted' | 'other';
export interface LogEntry {
  /** When, as RSI printed it (read as local time), ms. NaN when unreadable. */
  at: number;
  /** The pledge the row is about: its name and id. */
  name: string;
  id: number;
  kind: LogKind;
  /** `consumed`: the pledge the upgrade went onto. `applied`: this row's own pledge (= `id`). */
  pledgeId?: number;
  /** `applied`: the upgrade that was used up. `consumed`: this row's own id. */
  upgradeId?: number;
  /** USD cents: the upgrade's value (`consumed`), the pledge's new value (`applied`) or what it cost (`created`). */
  value?: number;
  /** `created`: the order it came from. */
  order?: string;
  /** What follows the id, as printed. */
  text: string;
}

const DATE = /[A-Z][a-z]{2} \d{1,2} \d{4}, \d{1,2}:\d{2} [ap]m/;
const ENTITIES: Record<string, string> = { '&amp;': '&', '&nbsp;': ' ', '&#36;': '$', '&#039;': "'", '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };
const toText = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
const cents = (s: string | undefined) => (s ? Math.round(Number(s.replace(/,/g, '')) * 100) : undefined);

/** The rows of a rendered log page, newest first as RSI lists them. Rows it cannot read are skipped. */
export function parseHangarLog(html: string): LogEntry[] {
  const text = toText(html);
  const starts = [...text.matchAll(new RegExp(DATE.source, 'g'))].map((m) => m.index!);
  const out: LogEntry[] = [];
  starts.forEach((from, i) => {
    const row = text.slice(from, starts[i + 1] ?? text.length).trim();
    const m = new RegExp(`^(${DATE.source}) - (.+?) #(\\d+) - (.*)$`).exec(row);
    if (!m) return;
    const rest = m[4]!.trim();
    const e: LogEntry = { at: Date.parse(m[1]!.replace(',', '')), name: m[2]!.trim(), id: Number(m[3]), kind: 'other', text: rest };
    const used = /^Consumed by .+? on pledge #(\d+)(?:, value: \$([\d,.]+))?/i.exec(rest);
    const applied = /^Upgrade applied: #(\d+)\b.*?(?:, new value: \$([\d,.]+))?(?: USD)?$/i.exec(rest);
    if (used) Object.assign(e, { kind: 'consumed', pledgeId: Number(used[1]), upgradeId: e.id, value: cents(used[2]) });
    else if (applied) Object.assign(e, { kind: 'applied', pledgeId: e.id, upgradeId: Number(applied[1]), value: cents(applied[2]) });
    else if (/^Created by /i.test(rest)) {
      const c = /order #(\w+)(?:, value: \$([\d,.]+))?/i.exec(rest);
      Object.assign(e, { kind: 'created', ...(c ? { order: c[1], value: cents(c[2]) } : {}) });
    } else if (/reclaim|melt/i.test(rest)) e.kind = 'reclaimed';
    else if (/gift/i.test(rest)) e.kind = 'gifted';
    out.push(e);
  });
  return out;
}

/** Upgrades that were applied (used up on a pledge), by upgrade id: where, when, and what the upgrade was worth. */
export function consumedUpgrades(log: readonly LogEntry[]): Map<number, { pledgeId: number; at: number; value: number }> {
  const m = new Map<number, { pledgeId: number; at: number; value: number }>();
  for (const e of log) if (e.kind === 'consumed' && e.pledgeId != null && !m.has(e.id)) m.set(e.id, { pledgeId: e.pledgeId, at: e.at, value: e.value ?? 0 });
  return m;
}

/**
 * The two hulls in an upgrade's name: "Upgrade - Galaxy to 600i Touring Warbond Edition" → ["Galaxy", "600i Touring"].
 * The edition words at the end are dropped; null when the name is not an upgrade's.
 */
export function upgradeHulls(name: string): [string, string] | null {
  const m = /^Upgrade - (.+?) to (.+)$/i.exec(name.trim());
  if (!m) return null;
  const to = m[2]!.replace(/\s+(?:(?:Standard|Warbond|BIS|Best in Show|Limited|IAE|ILW|Invictus)\s+)*(?:Edition|Upgrade)\s*$/i, '').trim();
  return [m[1]!.trim(), to || m[2]!.trim()];
}

/** One page of the log (1 = newest). */
export async function fetchHangarLogPage(page: number, signal?: AbortSignal): Promise<{ entries: LogEntry[]; pages: number }> {
  const res = await fetch(`${SPECTRUM_ORIGIN}/api/account/pledgeLog`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Rsi-Token': await token() },
    body: JSON.stringify({ page }),
    signal,
  });
  if (!res.ok) throw new Error(`RSI hangar log: HTTP ${res.status}`);
  const body = (await res.json()) as { success?: number | boolean; msg?: string; data?: { pagecount?: number; rendered?: string } };
  if (!body.success) throw new Error(`RSI hangar log: ${body.msg || 'refused — sign in to RSI'}`);
  return { entries: parseHangarLog(body.data?.rendered ?? ''), pages: Number(body.data?.pagecount ?? 1) || 1 };
}

/**
 * Read the log from the newest page until every id in `want` has a row (and at least `minPages` were read), the pages
 * run out or `maxPages` is reached (a short pause between pages). Returns what was read.
 */
export async function findInHangarLog(want: readonly number[], maxPages = 6, signal?: AbortSignal, minPages = 1): Promise<LogEntry[]> {
  const left = new Set(want);
  const all: LogEntry[] = [];
  for (let page = 1; page <= maxPages && (left.size || page <= minPages); page++) {
    const { entries, pages } = await fetchHangarLogPage(page, signal);
    all.push(...entries);
    for (const e of entries) left.delete(e.id);
    if (page >= pages || !entries.length) break;
    await new Promise((ok) => setTimeout(ok, 400));
  }
  return all;
}

// ---------------------------------------------------------------------------------------------------------------
// Which pledges RSI lets an upgrade go onto — what its *Apply upgrade* dialog lists.
// `POST /api/account/chooseUpgradeTarget { upgrade_id }` → `{ success, data: { rendered } }`, rows of radio buttons
// (value = pledge id) with the pledge's name in the label (RSI's account script, 2026-11). Read-only: applying is
// `applyUpgrade { upgrade_id, pledge_id, current_password }`, permanent, and RSI+ never calls it.

export interface UpgradeTarget {
  id: number;
  name: string;
}

/** RSI has no such upgrade any more: it was applied, melted or gifted since the hangar was read. */
export class UpgradeGoneError extends Error {
  constructor() {
    super('RSI no longer has this CCU');
  }
}

/** The pledges in a rendered target list. Reads the radio buttons; the name is the row's text. */
export function parseUpgradeTargets(html: string): UpgradeTarget[] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const out: UpgradeTarget[] = [];
  for (const radio of doc.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    const id = Number(radio.getAttribute('value'));
    if (!Number.isFinite(id) || id <= 0 || out.some((t) => t.id === id)) continue;
    const row = radio.closest('.row') ?? radio.parentElement;
    // RSI prints "Standalone Ships - Pulse plus Dominion Paint (#103546693)": the id is ours already
    const name = (row?.querySelector('label span')?.textContent ?? row?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\s*\(#\d+\)\s*$/, '')
      .trim();
    out.push({ id, name });
  }
  return out;
}

/** Ask RSI which pledges this upgrade (its pledge id) can be applied to right now. */
export async function upgradeTargets(upgradeId: number, signal?: AbortSignal): Promise<UpgradeTarget[]> {
  const res = await fetch(`${SPECTRUM_ORIGIN}/api/account/chooseUpgradeTarget`, {
    method: 'POST',
    credentials: 'include',
    // As RSI's own page sends it (checked against its request, 2026-11): the id as a string, and the XHR marker.
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Rsi-Token': await token() },
    body: JSON.stringify({ upgrade_id: String(upgradeId) }),
    signal,
  });
  if (!res.ok) throw new Error(`RSI upgrade targets: HTTP ${res.status}`);
  const body = (await res.json()) as { success?: number | boolean; code?: string; msg?: string; data?: { rendered?: string } | string };
  // `ErrInvalidObject`: RSI has no such upgrade any more — applied, melted or gifted since the hangar was read.
  if (!body.success && body.code === 'ErrInvalidObject') throw new UpgradeGoneError();
  if (!body.success) throw new Error(`RSI upgrade targets: ${body.msg || 'refused — sign in to RSI'}`);
  return parseUpgradeTargets(typeof body.data === 'object' ? (body.data?.rendered ?? '') : '');
}
