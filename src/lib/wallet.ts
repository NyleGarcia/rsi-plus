/**
 * Wallet tab data: your own pledge spend (from the saved hangar) and Star Citizen's public funding numbers.
 *
 * Funding comes from RSI's crowdfund stats endpoint (the one behind the old /funding-goals page). It's public, no
 * login: `POST /api/stats/getCrowdfundStats {chart: 'day'|'week'|'month', funds: true, fans: true}` →
 * `data.funds` (lifetime, cents), `data.fans` (citizens), `data.chart[key] = {gross (cents), axis}` for the last 7
 * periods. Keys are `YYYY-MM-DD`, `YYYY-WW` or `YYYY-MM`.
 */
import type { OwnedCcu } from './ccu';
import type { Pledge, PledgeType } from './hangar';
import { matchShip, type CatalogShip } from './store';
import { SPECTRUM_ORIGIN } from './types';

export type FundingRange = 'day' | 'week' | 'month';

export interface FundingPoint {
  /** API key (`2026-10-03`, `2026-40`, `2026-09`). */
  key: string;
  /** Short axis label (`03`, `W40`, `Sep`). */
  label: string;
  usd: number;
}

export interface Funding {
  at: number;
  range: FundingRange;
  /** Lifetime funds, USD. */
  funds: number;
  /** Registered citizens (0 when the API omits it). */
  fans: number;
  points: FundingPoint[];
}

interface Raw {
  success?: number;
  msg?: string;
  data?: { funds?: number | string; fans?: number | string; chart?: Record<string, { gross: string | number; axis?: string }> };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function pointLabel(key: string, range: FundingRange): string {
  const parts = key.split('-');
  if (range === 'month') return MONTHS[Number(parts[1]) - 1] ?? key;
  if (range === 'week') return `W${parts[1] ?? key}`;
  return parts[2] ?? key;
}

/** Turns the API body into USD numbers; throws on an API-level failure (`success: 0`). */
export function parseFunding(raw: Raw, range: FundingRange, at = Date.now()): Funding {
  if (!raw.success || !raw.data) throw new Error(`RSI stats: ${raw.msg ?? 'bad response'}`);
  const d = raw.data;
  const cents = (v: string | number | undefined) => Math.round(Number(v ?? 0)) / 100;
  const points = Object.entries(d.chart ?? {})
    .map(([key, v]) => ({ key, label: pointLabel(key, range), usd: cents(v.gross) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { at, range, funds: cents(d.funds), fans: Number(d.fans ?? 0), points };
}

export async function fetchFunding(range: FundingRange, signal?: AbortSignal): Promise<Funding> {
  const res = await fetch(`${SPECTRUM_ORIGIN}/api/stats/getCrowdfundStats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart: range, funds: true, fans: true }),
    signal,
  });
  if (!res.ok) throw new Error(`RSI stats: HTTP ${res.status}`);
  return parseFunding((await res.json()) as Raw, range);
}

// ---- personal spend (hangar) ----

export interface Bucket {
  key: string;
  label: string;
  value: number;
  count: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Melt value per year of the pledge's "Created" date; unparseable dates land in "?". Oldest first. */
export function spendByYear(pledges: Pledge[]): Bucket[] {
  const years = bucket(pledges, (p) => {
    const t = Date.parse(p.date);
    return Number.isNaN(t) ? '?' : String(new Date(t).getFullYear());
  });
  return [...years.filter((b) => b.key !== '?'), ...years.filter((b) => b.key === '?')];
}

/** Melt value per calendar month (`YYYY-MM`) over the last `months` months, every month present (zeros kept). */
export function spendByMonth(pledges: Pledge[], months = 24, now = new Date()): Bucket[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const m = new Map(keys.map((k) => [k, { key: k, label: MONTHS[Number(k.slice(5)) - 1] ?? k, value: 0, count: 0 }]));
  for (const p of pledges) {
    const t = Date.parse(p.date);
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    const b = m.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    if (!b) continue;
    b.value = r2(b.value + p.value);
    b.count++;
  }
  return [...m.values()];
}

/** Melt value per pledge type, largest first. */
export function spendByType(pledges: Pledge[]): Bucket[] {
  return bucket(pledges, (p) => p.type).sort((a, b) => b.value - a.value);
}

/** Warbond (new money) vs store-credit pledges. */
export function spendByFunding(pledges: Pledge[]): Bucket[] {
  return bucket(pledges, (p) => (p.warbond ? 'warbond' : 'credit'), { warbond: 'Warbond (cash)', credit: 'Store credit / regular' });
}

function bucket(pledges: Pledge[], keyOf: (p: Pledge) => string | PledgeType, labels: Record<string, string> = {}): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const p of pledges) {
    const key = keyOf(p);
    const b = m.get(key) ?? { key, label: labels[key] ?? key, value: 0, count: 0 };
    b.value = r2(b.value + p.value);
    b.count++;
    m.set(key, b);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface SpendSummary {
  value: number;
  pledges: number;
  warbond: number;
  /** Oldest "Created" date (ms) or null. */
  since: number | null;
  /** Years since the first pledge, one decimal. */
  years: number;
  /** Average melt value per year backed (0 when unknown). */
  perYear: number;
  /** Melt value of pledges RSI says were paid with cash / with store credit; `payKnown` = pledges carrying that field (0 on old saves). */
  cash: number;
  credit: number;
  payKnown: number;
}

export function spendSummary(pledges: Pledge[], now = Date.now()): SpendSummary {
  const dates = pledges.map((p) => Date.parse(p.date)).filter((t) => !Number.isNaN(t));
  const since = dates.length ? Math.min(...dates) : null;
  const value = r2(pledges.reduce((s, p) => s + p.value, 0));
  const years = since ? Math.max(0.1, Math.round(((now - since) / 31557600000) * 10) / 10) : 0;
  return {
    value,
    pledges: pledges.length,
    warbond: r2(pledges.filter((p) => p.warbond).reduce((s, p) => s + p.value, 0)),
    since,
    years,
    perYear: years ? r2(value / years) : 0,
    cash: r2(pledges.filter((p) => p.paidWith === 'cash').reduce((s, p) => s + p.value, 0)),
    credit: r2(pledges.filter((p) => p.paidWith === 'credit').reduce((s, p) => s + p.value, 0)),
    payKnown: pledges.filter((p) => p.paidWith).length,
  };
}

/** Your hangar's melt value as a percentage of lifetime funding (unrounded — tiny; format with `toPrecision`). */
export const shareOfFunding = (value: number, funds: number): number => (funds > 0 ? (value / funds) * 100 : 0);

// ---- fleet value: what you paid vs today's store price (CCU Game "Personal Statistics") ----

export interface FleetRow {
  pledgeId: number;
  pledge: string;
  ship: string;
  shipId: number;
  /** Melt value (USD) — what the pledge is worth to RSI today, our proxy for "paid". */
  paid: number;
  /** Current MSRP (USD). */
  msrp: number;
}

export interface FleetValue {
  rows: FleetRow[];
  paid: number;
  msrp: number;
  /** Pledges with several ships (packs) — not split, listed by count only. */
  packs: number;
}

/** One row per single-ship pledge matched to the catalog, biggest gain (msrp − paid) first. Packs are counted, not split. */
export function fleetValue(pledges: Pledge[], ships: CatalogShip[]): FleetValue {
  const rows: FleetRow[] = [];
  let packs = 0;
  for (const p of pledges) {
    if (p.ships.length > 1) {
      packs++;
      continue;
    }
    const title = p.ships[0];
    if (!title) continue;
    const s = matchShip(title, ships);
    if (!s || !s.msrp) continue;
    rows.push({ pledgeId: p.id, pledge: p.name, ship: s.name, shipId: s.id, paid: p.value, msrp: s.msrp / 100 });
  }
  rows.sort((a, b) => b.msrp - b.paid - (a.msrp - a.paid));
  return { rows, paid: r2(rows.reduce((n, r) => n + r.paid, 0)), msrp: r2(rows.reduce((n, r) => n + r.msrp, 0)), packs };
}

// ---- CCU portfolio (CCU Game "CCU Overview") ----

export interface CcuRow {
  ref: number;
  source: 'hangar' | 'buyback';
  from: string;
  to: string;
  /** USD paid (melt value); 0 = gifted / unknown. */
  paid: number;
  /** msrp(to) − msrp(from) in USD: what the upgrade is worth at today's prices. */
  worth: number;
  /** worth − paid (only meaningful when paid > 0). */
  gain: number;
}

export interface CcuOverview {
  rows: CcuRow[];
  count: number;
  paid: number;
  worth: number;
  /** Sum of gains over CCUs with a known price. */
  gain: number;
  /** CCUs whose upgrade is worth more than you paid (bought on a discount / before a price rise). */
  winners: number;
  gifted: number;
}

export function ccuOverview(owned: OwnedCcu[], ships: CatalogShip[]): CcuOverview {
  const byId = new Map(ships.map((s) => [s.id, s]));
  const rows: CcuRow[] = owned
    .filter((o) => o.source === 'hangar')
    .map((o) => {
      const from = byId.get(o.fromId);
      const to = byId.get(o.toId);
      const paid = o.value / 100;
      const worth = ((to?.msrp ?? 0) - (from?.msrp ?? 0)) / 100;
      return { ref: o.ref, source: o.source, from: from?.name ?? `#${o.fromId}`, to: to?.name ?? `#${o.toId}`, paid, worth, gain: paid ? r2(worth - paid) : 0 };
    })
    .sort((a, b) => b.gain - a.gain);
  const priced = rows.filter((r) => r.paid > 0);
  return {
    rows,
    count: rows.length,
    paid: r2(rows.reduce((n, r) => n + r.paid, 0)),
    worth: r2(rows.reduce((n, r) => n + r.worth, 0)),
    gain: r2(priced.reduce((n, r) => n + r.gain, 0)),
    winners: priced.filter((r) => r.gain > 0).length,
    gifted: rows.filter((r) => !r.paid).length,
  };
}

// ---- funding dashboard extras ----

/** Fraction of the current period that has elapsed (0–1), for projecting the running day / week / month. */
export function periodElapsed(range: FundingRange, now = new Date()): number {
  if (range === 'day') return Math.max(0.01, (now.getHours() * 60 + now.getMinutes()) / 1440);
  if (range === 'week') {
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    return Math.max(0.01, (dow + (now.getHours() * 60 + now.getMinutes()) / 1440) / 7);
  }
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(0.01, (now.getDate() - 1 + (now.getHours() * 60 + now.getMinutes()) / 1440) / days);
}

export interface FundingStats {
  /** Mean of the completed periods shown (the running one excluded). */
  average: number;
  best: FundingPoint | null;
  /** Running period scaled to its full length. */
  projected: number;
}

export function fundingStats(f: Funding, now = new Date()): FundingStats {
  const done = f.points.slice(0, -1);
  const current = f.points.at(-1);
  const average = done.length ? r2(done.reduce((n, p) => n + p.usd, 0) / done.length) : 0;
  const best = done.reduce<FundingPoint | null>((b, p) => (!b || p.usd > b.usd ? p : b), null);
  return { average, best, projected: current ? r2(current.usd / periodElapsed(f.range, now)) : 0 };
}
