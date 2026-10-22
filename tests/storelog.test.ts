import { describe, expect, it } from 'vitest';
import { catalogEntries, cleanLog, dismiss, listingEntries, mergeChanges, recordStore, skuName, tally, type StoreEntry } from '@/lib/storelog';
import type { Catalog, CatalogShip, StoreListing } from '@/lib/store';

const e = (id: number, kind: StoreEntry['kind'] = 'paints', name = `Item ${id}`): StoreEntry => ({ key: `item:${id}`, name, price: 1000, kind });
const ids = (list: StoreEntry[]) => list.map((x) => x.key);

describe('recordStore', () => {
  it('the first copy only sets the baseline', () => {
    const r = recordStore({}, [], 'listing', [e(1), e(2)], 1);
    expect(r.logged).toEqual([]);
    expect(r.snap.listing?.entries).toHaveLength(2);
  });

  it('logs one add and one remove group per check, sorted by name', () => {
    const base = recordStore({}, [], 'listing', [e(1, 'packs', 'Citizen Starter Pack'), e(2), e(3)], 1).snap;
    const r = recordStore(base, [], 'listing', [e(2), e(3), e(5, 'packages', 'Star Citizen First Flight Pack'), e(4, 'packs', 'Aurora Pack')], 2);
    expect(r.logged.map((c) => [c.action, c.entries.map((x) => x.name)])).toEqual([
      ['add', ['Aurora Pack', 'Star Citizen First Flight Pack']],
      ['remove', ['Citizen Starter Pack']],
    ]);
    expect(r.log).toEqual(r.logged);
    // Nothing changed → nothing logged, log kept.
    const again = recordStore(r.snap, r.log, 'listing', [e(2), e(3), e(5, 'packages'), e(4, 'packs')], 3);
    expect(again.logged).toEqual([]);
    expect(again.log).toHaveLength(2);
  });

  it('a group that collapses (bad fetch) logs no removals and keeps its old entries', () => {
    const paints = Array.from({ length: 10 }, (_, i) => e(i));
    const base = recordStore({}, [], 'listing', [...paints, e(100, 'gear')], 1).snap;
    // Paints came back with 1 of 10; gear really changed.
    const r = recordStore(base, [], 'listing', [paints[0]!, e(101, 'gear')], 2);
    expect(r.logged.map((c) => [c.action, ids(c.entries)])).toEqual([
      ['add', ['item:101']],
      ['remove', ['item:100']],
    ]);
    expect(ids(r.snap.listing!.entries).sort()).toEqual([...ids(paints), 'item:101'].sort());
    // Paints back to normal next time: no "added" flood.
    expect(recordStore(r.snap, r.log, 'listing', [...paints, e(101, 'gear')], 3).logged).toEqual([]);
  });

  it('an empty copy is ignored', () => {
    const base = recordStore({}, [], 'catalog', [e(1, 'ccu')], 1).snap;
    expect(recordStore(base, [], 'catalog', [], 2)).toMatchObject({ snap: base, logged: [] });
  });
});

describe('entries', () => {
  const sku = (id: number, title: string, available = true) => ({ id, title, price: 5000, available, stock: null });
  it('catalog: available CCU targets ("… CCU") and standalones; wiki-only hulls skipped', () => {
    const ship = (o: Partial<CatalogShip>): CatalogShip => ({ id: 1, name: 'Sabre Raven EX', manufacturer: '', focus: '', msrp: 0, flyable: '', link: '', thumb: null, standalone: [], ccu: [], ...o });
    const c: Catalog = {
      at: 0,
      ships: [
        ship({ link: 'https://robertsspaceindustries.com/pledge/ships/sabre/Sabre-Raven-EX', ccu: [sku(10, 'Sabre Raven EX - Warbond Edition'), sku(11, 'gone', false)], standalone: [sku(12, 'Standard Edition')] }),
        ship({ id: 2, name: 'Kraken', msrpSource: 'wiki', standalone: [sku(13, 'Kraken')] }),
      ],
    };
    expect(catalogEntries(c).map((x) => [x.key, x.name, x.link, x.ship])).toEqual([
      ['ccu:10', 'Sabre Raven EX - Warbond Edition CCU', 'https://robertsspaceindustries.com/pledge/ships/sabre/Sabre-Raven-EX', 1],
      ['ship:12', 'Sabre Raven EX - Standard Edition', 'https://robertsspaceindustries.com/pledge/ships/sabre/Sabre-Raven-EX', 1],
    ]);
  });
  it('skuName: the hull is prefixed unless the title already names it', () => {
    expect(skuName('Polaris', 'Standard Edition')).toBe('Polaris - Standard Edition');
    expect(skuName('Polaris', 'Polaris - Warbond Edition')).toBe('Polaris - Warbond Edition');
    expect(skuName('Polaris', '')).toBe('Polaris');
  });
  it('listing: no ships (catalog has them), no Concierge / Subscribers rows', () => {
    const it = (id: number, category: string, vip = false) => ({ id, name: `L${id}`, url: `https://robertsspaceindustries.com/pledge/${id}`, price: 900, discounted: 700, available: true, thumb: null, category, subtitle: '', vip, warbond: false });
    const l = { at: 0, items: [it(1, 'ships'), it(2, 'packs'), it(3, 'subscribers'), it(4, 'gear', true)] } as StoreListing;
    expect(listingEntries(l)).toEqual([{ key: 'item:2', name: 'L2', price: 700, kind: 'packs', link: 'https://robertsspaceindustries.com/pledge/2', thumb: null }]);
  });
  it('mergeChanges joins same-action groups logged within the window, keeping the parts', () => {
    const log = [
      { at: 10_000, action: 'add' as const, entries: [e(1)] },
      { at: 9_000, action: 'add' as const, entries: [e(2), e(3)] },
      { at: 9_000, action: 'remove' as const, entries: [e(4)] },
      { at: 1_000, action: 'add' as const, entries: [e(5)] },
    ];
    const m = mergeChanges(log, 5_000);
    expect(m.map((x) => [x.action, ids(x.entries), x.parts.length])).toEqual([
      ['add', ['item:1', 'item:2', 'item:3'], 2],
      ['remove', ['item:4'], 1],
      ['add', ['item:5'], 1],
    ]);
  });
  it('cleanLog drops malformed groups; tally counts entries per action', () => {
    const log = [{ at: 1, action: 'add' as const, entries: [e(1), e(2)] }, {} as never, null as never, { at: 2, action: 'remove' as const, entries: [e(3)] }];
    expect(cleanLog(log).length).toBe(2);
    expect(cleanLog('nope')).toEqual([]);
    expect(tally(cleanLog(log))).toEqual({ add: 2, remove: 1 });
    expect(mergeChanges(log).length).toBe(2);
  });
  it('dismiss drops one entry of a group, or the group; an emptied group goes too', () => {
    const log = [
      { at: 5, action: 'add' as const, entries: [e(1), e(2)] },
      { at: 5, action: 'remove' as const, entries: [e(3)] },
      { at: 4, action: 'add' as const, entries: [e(4)] },
    ];
    expect(dismiss(log, 5, 'add', 'item:1', 'item:2').map((c) => ids(c.entries))).toEqual([['item:1'], ['item:3'], ['item:4']]);
    expect(dismiss(log, 5, 'add', 'item:1', 'item:1').length).toBe(3);
    expect(dismiss(dismiss(log, 5, 'add', 'item:1', 'item:1'), 5, 'add', 'item:2', 'item:2').length).toBe(2);
    expect(dismiss(log, 5, 'remove', 'item:3').map((c) => c.at)).toEqual([5, 4]);
    expect(dismiss(log, 5, 'add', 'item:1', ['item:1', 'item:2']).length).toBe(2);
    expect(dismiss([{ at: 5, action: 'add', entries: [e(1), e(2), e(3)] }], 5, 'add', 'item:1', ['item:1', 'item:2']).map((c) => ids(c.entries))).toEqual([['item:3']]);
    expect(dismiss(log, 9, 'add', 'item:1')).toEqual(log);
  });
});
