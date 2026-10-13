import { describe, expect, it } from 'vitest';
import { compare, dateValue, nextSort, sortBy } from '@/lib/sort';

describe('column sort', () => {
  const rows = [
    { n: 'Mk 10', v: 5, d: 'October 01, 2026' },
    { n: 'mk 2', v: null, d: 'January 5, 2025' },
    { n: 'Alpha', v: 20, d: '' },
    { n: 'Beta', v: 5, d: 'March 3, 2026' },
  ];
  const acc = { n: (r: (typeof rows)[0]) => r.n, v: (r: (typeof rows)[0]) => r.v, d: (r: (typeof rows)[0]) => dateValue(r.d) };

  it('natural, case-insensitive strings', () => {
    expect(sortBy(rows, { key: 'n', dir: 'asc' }, acc).map((r) => r.n)).toEqual(['Alpha', 'Beta', 'mk 2', 'Mk 10']);
  });

  it('numbers; empties last in both directions; stable ties', () => {
    expect(sortBy(rows, { key: 'v', dir: 'asc' }, acc).map((r) => r.n)).toEqual(['Mk 10', 'Beta', 'Alpha', 'mk 2']);
    expect(sortBy(rows, { key: 'v', dir: 'desc' }, acc).map((r) => r.n)).toEqual(['Alpha', 'Mk 10', 'Beta', 'mk 2']);
  });

  it('RSI dates', () => {
    expect(sortBy(rows, { key: 'd', dir: 'desc' }, acc).map((r) => r.n)).toEqual(['Mk 10', 'Beta', 'mk 2', 'Alpha']);
  });

  it('header clicks', () => {
    expect(nextSort({ key: 'a', dir: 'asc' }, 'a')).toEqual({ key: 'a', dir: 'desc' });
    expect(nextSort({ key: 'a', dir: 'desc' }, 'b', 'desc')).toEqual({ key: 'b', dir: 'desc' });
    expect(compare(true, false, 'desc')).toBeLessThan(0);
  });
});
