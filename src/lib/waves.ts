/**
 * Stock-limited hull waves: RSI sells a limited hull in waves at
 * announced times and each wave sells out in seconds. This is the schedule, the countdown maths and the listing match;
 * the page (`WavesPanel`) counts down, checks you are ready and watches the listing so you can add it to your cart the
 * moment it is sellable. You add and you check out: nothing here submits an order.
 *
 * IAE 2956: every limited hull goes up six times, four hours apart, from 16:00 UTC on its sale date.
 */
import type { StorePaint } from './store';

export interface WaveSale {
  id: string;
  ship: string;
  /** Text the store listing's name contains ("890 Jump - 10 Year"). */
  listing: string;
  /** Sale date, UTC (`YYYY-MM-DD`): wave 1 is 16:00 UTC that day. */
  date: string;
  /** Who can buy / what it costs, as announced. */
  note: string;
  concierge?: boolean;
  invite?: boolean;
}

export const WAVE_COUNT = 6;
export const WAVE_EVERY_H = 4;
export const WAVE_FIRST_UTC_H = 16;

export const IAE_2956: WaveSale[] = [
  { id: '890', ship: '890 Jump', listing: '890 Jump', date: '2026-11-14', note: 'Concierge only. Listed as "890 Jump - 10 Year".', concierge: true },
  { id: 'odin', ship: 'Odin', listing: 'Odin', date: '2026-11-15', note: 'Only for backers selected in the Odin Founders Club release. $5,000 warbond / $5,900 store credit.', invite: true },
  { id: 'kraken', ship: 'Kraken', listing: 'Kraken', date: '2026-11-17', note: 'Kraken and Kraken Privateer.', concierge: true },
  { id: 'privateer', ship: 'Kraken Privateer', listing: 'Kraken Privateer', date: '2026-11-17', note: 'Same waves as the Kraken.', concierge: true },
  { id: 'pioneer', ship: 'Pioneer', listing: 'Pioneer', date: '2026-11-18', note: '', concierge: true },
  { id: 'idris', ship: 'Idris-P', listing: 'Idris', date: '2026-11-20', note: 'Idris-P.', concierge: true },
  { id: 'javelin', ship: 'Javelin', listing: 'Javelin', date: '2026-11-20', note: '', concierge: true },
];

/** A sale event with stock-limited waves (IAE, Invictus / DefenseCon …): one entry per event once RSI posts its schedule. */
export interface WaveEvent {
  id: string;
  name: string;
  sales: WaveSale[];
}
export const WAVE_EVENTS: WaveEvent[] = [{ id: 'iae-2956', name: 'IAE 2956', sales: IAE_2956 }];
/** The page shows up this long before an event's first wave and stays this long after its last. */
export const EVENT_LEAD_MS = 7 * 86_400_000;
export const EVENT_TAIL_MS = 86_400_000;
/** The event with waves going on (or about to start) now; null between events. */
export function activeWaveEvent(now: number, events: readonly WaveEvent[] = WAVE_EVENTS): WaveEvent | null {
  for (const e of events) {
    const times = e.sales.flatMap((s) => waveTimes(s.date));
    if (times.length && now >= Math.min(...times) - EVENT_LEAD_MS && now < Math.max(...times) + EVENT_TAIL_MS) return e;
  }
  return null;
}
/** Settings → Limited waves (default on): the page and its reminders exist only while this is on and an event runs. */
export const wavesShown = (v: { on?: boolean } | null | undefined, now: number) => v?.on !== false && !!activeWaveEvent(now);

/** The wave times of a sale (ms), in order. */
export function waveTimes(date: string, count = WAVE_COUNT, everyH = WAVE_EVERY_H, firstUtcH = WAVE_FIRST_UTC_H): number[] {
  const start = Date.parse(`${date}T${String(firstUtcH).padStart(2, '0')}:00:00Z`);
  return Array.from({ length: count }, (_, i) => start + i * everyH * 3_600_000);
}

/** How long after a wave opens it still counts as "on" (stock may last minutes on the late waves). */
export const WAVE_OPEN_MS = 15 * 60_000;

/** The wave to care about now: one that is open, else the next one; null when the sale is over. `i` is 0-based. */
export function currentWave(times: readonly number[], now: number): { i: number; at: number; open: boolean } | null {
  for (let i = 0; i < times.length; i++) {
    const at = times[i]!;
    if (now < at) return { i, at, open: false };
    if (now - at < WAVE_OPEN_MS) return { i, at, open: true };
  }
  return null;
}

/** "2 h 05 min", "4 min 09 s", "now". */
export function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${pad(m)} min`;
  return `${m} min ${pad(s % 60)} s`;
}

/** How often to look at the listing: every few seconds around the wave, slower before and after, not at all far out. */
export function watchEveryMs(msToWave: number): number | null {
  if (msToWave > 5 * 60_000) return null; // more than 5 min out: nothing to watch
  if (msToWave > 45_000) return 20_000;
  if (msToWave > -3 * 60_000) return 4_000; // T−45 s … T+3 min
  if (msToWave > -WAVE_OPEN_MS) return 15_000;
  return null;
}

/**
 * After a look during a wave: stop watching that wave? `stock` = a listing you watch is sellable (you have been told;
 * the cart button has what it needs); `soldout` = the wave is open, some listing was sellable earlier in it, and none
 * is now. Either way the watch rests until the next wave opens its own window (`currentWave` moves on).
 */
export type WaveStop = 'stock' | 'soldout';
export function stopAfterLook(o: { open: boolean; watchedInStock: boolean; anyInStock: boolean; sawStock: boolean }): WaveStop | null {
  if (o.watchedInStock) return 'stock';
  if (o.open && o.sawStock && !o.anyInStock) return 'soldout';
  return null;
}

/** Store listings whose name carries the sale's text, sellable ones first, then by name length (the plain hull before packs). */
export function matchListings<T extends Pick<StorePaint, 'name' | 'available'>>(items: readonly T[], sale: Pick<WaveSale, 'listing' | 'ship'>): T[] {
  const want = sale.listing.toLowerCase();
  const other = IAE_2956.filter((s) => s.listing.toLowerCase() !== want && s.listing.toLowerCase().includes(want)).map((s) => s.listing.toLowerCase());
  return items
    .filter((i) => {
      const n = i.name.toLowerCase();
      return n.includes(want) && !other.some((o) => n.includes(o)); // "Kraken" must not take "Kraken Privateer"
    })
    .sort((a, b) => Number(b.available) - Number(a.available) || a.name.length - b.name.length);
}

/** Lead times (ms before a wave) at which to notify. */
export const WAVE_LEADS = [30 * 60_000, 5 * 60_000, 60_000];
