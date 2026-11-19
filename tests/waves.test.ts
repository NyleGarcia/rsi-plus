import { describe, expect, it } from 'vitest';
import { activeWaveEvent, wavesShown, countdown, currentWave, IAE_2956, matchListings, stopAfterLook, watchEveryMs, WAVE_OPEN_MS, waveTimes } from '@/lib/waves';

describe('limited waves', () => {
  it('six waves, four hours apart, from 16:00 UTC on the sale date', () => {
    const t = waveTimes('2026-11-14');
    expect(t.map((x) => new Date(x).toISOString().slice(0, 16))).toEqual(['2026-11-14T16:00', '2026-11-14T20:00', '2026-11-15T00:00', '2026-11-15T04:00', '2026-11-15T08:00', '2026-11-15T12:00']);
    expect(IAE_2956.map((s) => [s.ship, s.date])).toContainEqual(['Javelin', '2026-11-20']);
  });
  it('the page only exists around an event with waves, and only while turned on', () => {
    const first = waveTimes('2026-11-14')[0]!;
    const last = waveTimes('2026-11-20').at(-1)!;
    expect(activeWaveEvent(first - 6 * 86_400_000)?.name).toBe('IAE 2956');
    expect(activeWaveEvent(first - 8 * 86_400_000)).toBeNull();
    expect(activeWaveEvent(last + 2 * 86_400_000)).toBeNull();
    expect(wavesShown({ on: false }, first)).toBe(false);
    expect(wavesShown({}, first)).toBe(true);
    expect(wavesShown({}, last + 2 * 86_400_000)).toBe(false);
  });
  it('the wave to care about: the open one, else the next, null when over', () => {
    const t = waveTimes('2026-11-14');
    expect(currentWave(t, t[0]! - 1)).toEqual({ i: 0, at: t[0], open: false });
    expect(currentWave(t, t[1]! + 5_000)).toEqual({ i: 1, at: t[1], open: true });
    expect(currentWave(t, t[1]! + WAVE_OPEN_MS)).toEqual({ i: 2, at: t[2], open: false });
    expect(currentWave(t, t[5]! + WAVE_OPEN_MS)).toBeNull();
  });
  it('countdown text and how often the listing is looked at', () => {
    expect(countdown(0)).toBe('now');
    expect(countdown(249_000)).toBe('4 min 09 s');
    expect(countdown(2 * 3_600_000 + 5 * 60_000)).toBe('2 h 05 min');
    expect(watchEveryMs(10 * 60_000)).toBeNull(); // far out: no requests
    expect(watchEveryMs(2 * 60_000)).toBe(20_000);
    expect(watchEveryMs(10_000)).toBe(4_000);
    expect(watchEveryMs(-60_000)).toBe(4_000);
    expect(watchEveryMs(-5 * 60_000)).toBe(15_000);
    expect(watchEveryMs(-WAVE_OPEN_MS)).toBeNull();
  });
  it('matches the listing by name: sellable first, and Kraken does not take the Privateer', () => {
    const items = [
      { name: 'Kraken Privateer - 10 Year', available: true },
      { name: 'Kraken - 10 Year', available: false },
      { name: '890 Jump - 10 Year', available: false },
      { name: '890 Jump - Best In Show Edition 2955', available: true },
    ];
    const sale = (id: string) => IAE_2956.find((s) => s.id === id)!;
    expect(matchListings(items, sale('kraken')).map((i) => i.name)).toEqual(['Kraken - 10 Year']);
    expect(matchListings(items, sale('privateer')).map((i) => i.name)).toEqual(['Kraken Privateer - 10 Year']);
    expect(matchListings(items, sale('890')).map((i) => i.name)).toEqual(['890 Jump - Best In Show Edition 2955', '890 Jump - 10 Year']);
  });
  it('stopAfterLook: a watched listing in stock, or open wave seen in stock then gone, ends the watch for that wave', () => {
    const o = { open: true, watchedInStock: false, anyInStock: false, sawStock: false };
    expect(stopAfterLook({ ...o, watchedInStock: true, anyInStock: true, sawStock: true })).toBe('stock');
    expect(stopAfterLook({ ...o, open: false, watchedInStock: true, anyInStock: true, sawStock: true })).toBe('stock'); // listed a bit early
    expect(stopAfterLook({ ...o, sawStock: true })).toBe('soldout');
    expect(stopAfterLook({ ...o, open: false, sawStock: true })).toBeNull(); // between waves: nothing to sell out
    expect(stopAfterLook(o)).toBeNull(); // open, never seen in stock: keep looking
    expect(stopAfterLook({ ...o, anyInStock: true, sawStock: true })).toBeNull(); // only an unwatched edition sellable
  });
});
