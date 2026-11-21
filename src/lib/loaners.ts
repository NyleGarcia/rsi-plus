/**
 * RSI's Loaner Ship Matrix (support article 360003093114): the ships you get to fly while one you pledged for is not
 * flight ready. Read from the help center's public JSON API (`Access-Control-Allow-Origin: *`, so the hub fetches it with
 * no host permission), parsed out of the article's table, cached a day in `loanersItem`.
 */
import type { CatalogShip } from './store';

export const LOANER_ARTICLE = 'https://support.robertsspaceindustries.com/hc/en-us/articles/360003093114-Loaner-Ship-Matrix';
const API = 'https://support.robertsspaceindustries.com/api/v2/help_center/en-us/articles/360003093114.json';
/** Refetched when the cache is older than this. */
export const LOANER_MAX_AGE = 24 * 3_600_000;

export interface LoanerRow {
  /** "YOUR SHIP" as RSI wrote it ("600i Explorer and Executive", "Fury Variants"). */
  ship: string;
  /** "OUR LOANER(S)", one name each ("Mole", "Arrow"). */
  loaners: string[];
}
export interface LoanerMatrix {
  /** When RSI last edited the article (ISO). */
  updated: string;
  /** When RSI+ fetched it (ms). */
  at: number;
  rows: LoanerRow[];
}

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&#39;': "'", '&#039;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };
const text = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:nbsp|#0?39|quot|lt|gt);/g, (e) => ENTITIES[e] ?? e)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    // `&amp;` last: unescaping it first would decode `&amp;lt;` twice
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The matrix rows out of the article body: the first table, two cells per row, header row skipped. */
export function parseLoanerHtml(body: string): LoanerRow[] {
  const table = body.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? '';
  const rows: LoanerRow[] = [];
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    if (/<th\b/i.test(tr)) continue;
    const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => text(m[1]!));
    if (cells.length < 2 || !cells[0] || !cells[1]) continue;
    rows.push({ ship: cells[0], loaners: cells[1].split(',').map((s) => s.trim()).filter(Boolean) });
  }
  return rows;
}

/** Fetch + parse. Throws when the article no longer has the table (RSI moved or reshaped it). */
export async function fetchLoaners(signal?: AbortSignal): Promise<LoanerMatrix> {
  const res = await fetch(API, { signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`RSI support answered ${res.status}`);
  const { article } = (await res.json()) as { article?: { body?: string; updated_at?: string } };
  const rows = parseLoanerHtml(article?.body ?? '');
  if (rows.length < 5) throw new Error('the Loaner Ship Matrix table was not found in the article');
  return { updated: article?.updated_at ?? '', at: Date.now(), rows };
}

/** Lowercase, hyphens as spaces ("Idris-P" = "Idris P"), "w/ C8X" = "w/C8X", single spaces. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[-–]/g, ' ')
    .replace(/w\/\s+/g, 'w/')
    .replace(/\s+/g, ' ')
    .trim();

interface Alts {
  names: string[];
  /** "Fury Variants": every ship whose name starts with the name. */
  variants: boolean;
}
/**
 * The ship names one "YOUR SHIP" cell stands for: "600i Explorer and Executive" → 600i Explorer, 600i Executive;
 * "Idris-M & P" → Idris M, Idris P; "Hull D, E"; "Pulse (+ LX)" → Pulse, Pulse LX; "Carrack / Carrack Expedition".
 */
export function expandShip(cell: string): Alts {
  let s = norm(cell);
  const variants = / variants$/.test(s);
  if (variants) s = s.replace(/ variants$/, '');
  const names: string[] = [];
  const plus = s.match(/^(.*?)\s*\(\+\s*(.*?)\)\s*$/);
  if (plus) {
    names.push(plus[1]!, ...plus[2]!.split(/\s*,\s*|\s+(?:and|&)\s+/).filter(Boolean).map((x) => `${plus[1]} ${x}`));
    return { names, variants };
  }
  for (const part of s.split(/\s+\/\s+/)) {
    const [first, ...rest] = part.split(/\s*,\s*|\s+(?:and|&)\s+/).filter(Boolean);
    if (!first) continue;
    names.push(first);
    // The later names are the last word swapped: "600i explorer and executive", "hull d, e", "idris m & p".
    const stem = first.includes(' ') ? first.slice(0, first.lastIndexOf(' ') + 1) : '';
    for (const r of rest) names.push(!r.includes(' ') && stem ? stem + r : r);
  }
  return { names, variants };
}

/**
 * Store ship → its matrix row. Each ship takes the row whose name fits it best: the exact name, then a "Variants"
 * prefix, then a longer store name ("Nox" → Nox Kue), then a shorter one ("Genesis Starliner" → Genesis).
 */
export function matchLoaners(rows: LoanerRow[], ships: Pick<CatalogShip, 'id' | 'name'>[]): Map<number, LoanerRow> {
  const alts = rows.map((r) => ({ row: r, ...expandShip(r.ship) }));
  const out = new Map<number, LoanerRow>();
  for (const ship of ships) {
    const n = norm(ship.name);
    let best: LoanerRow | null = null;
    let bestScore = 0;
    for (const a of alts)
      for (const name of a.names) {
        const score = n === name ? 4 : a.variants && n.startsWith(name) ? 3 : n.startsWith(`${name} `) ? 2 : name.startsWith(`${n} `) ? 1 : 0;
        if (score > bestScore) [best, bestScore] = [a.row, score];
      }
    if (best) out.set(ship.id, best);
  }
  return out;
}

export interface MyLoaner {
  name: string;
  /** Your ships that grant it (one loaner covers them all: loaners don't stack). */
  from: string[];
}
/** The loaners your ships get, one per name, with the ships that grant each. */
export function myLoaners(owned: Pick<CatalogShip, 'id' | 'name'>[], byShip: Map<number, LoanerRow>): MyLoaner[] {
  const by = new Map<string, MyLoaner>();
  for (const s of owned) {
    for (const l of byShip.get(s.id)?.loaners ?? []) {
      const k = norm(l);
      const m = by.get(k) ?? { name: l, from: [] };
      if (!m.from.includes(s.name)) m.from.push(s.name);
      by.set(k, m);
    }
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}
