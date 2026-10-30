import { describe, expect, it } from 'vitest';
import { buybackGroups, buybackLines } from '@/lib/buyback-groups';
import type { BuybackItem } from '@/lib/hangar';
import type { CatalogShip } from '@/lib/store';

const ship = (id: number, name: string): CatalogShip => ({ id, name, manufacturer: '', focus: '', msrp: 0, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });
const ships = [ship(1, 'Cutlass Black'), ship(2, 'Cutlass Red'), ship(3, 'Constellation Andromeda'), ship(4, 'Carrack'), ship(5, 'Perseus'), ship(6, 'Avenger Titan')];
let n = 0;
const bb = (over: Partial<BuybackItem>): BuybackItem => ({ id: ++n, name: 'x', date: 'Oct 01, 2026', contained: '', type: 'other', upgrade: null, url: null, ...over });

const cutlass = bb({ name: 'Cutlass Black', type: 'ship', contained: 'Cutlass Black' });
const ccu = bb({ name: 'Upgrade - Cutlass Black to Carrack', type: 'upgrade', upgrade: { fromId: 1, fromName: 'Cutlass Black', toId: 4, toName: 'Carrack' } });
const paint = bb({ name: 'Constellation - Sunburst Paint', type: 'paint', items: [{ title: 'Constellation - Sunburst Paint', kind: 'Skin' }] });
const pack = bb({ name: 'Perseus - 5 Paint Pack', type: 'paint', contained: '5 items' });
const combo = bb({ name: 'Starter Duo', type: 'combo', items: [{ title: 'Avenger Titan', kind: 'Ship' }, { title: 'Cutlass Red', kind: 'Ship' }, { title: 'Star Citizen Digital Download', kind: 'Game' }] });
const poster = bb({ name: 'Hangar Poster', type: 'hangar', contained: 'Hangar Poster' });

describe('buyback hull lines', () => {
  it('a CCU goes under its target ship', () => expect(buybackLines(ccu, ships)).toEqual(['carrack']));
  it('a ship under itself, a paint under the hull it names', () => {
    expect(buybackLines(cutlass, ships)).toEqual(['cutlass']);
    expect(buybackLines(paint, ships)).toEqual(['constellation']);
  });
  it('a count-only pack under the hull in its name', () => expect(buybackLines(pack, ships)).toEqual(['perseus']));
  it('a combo under every ship it holds', () => expect(buybackLines(combo, ships).sort()).toEqual(['avenger', 'cutlass']));
  it('nothing for an entry naming no hull', () => expect(buybackLines(poster, ships)).toEqual([]));
});

describe('buyback groups', () => {
  const list = [cutlass, ccu, paint, pack, combo, poster];
  it('none: one headerless group in the given order', () => {
    expect(buybackGroups(list, 'none', ships)).toEqual([{ key: 'b|all', label: '', items: list }]);
  });
  it('type: fixed type order, each group keeps the list order', () => {
    const g = buybackGroups(list, 'type', ships);
    expect(g.map((x) => x.label)).toEqual(['Ships', 'Combos', 'Upgrades (CCUs)', 'Paints', 'Hangar decorations']);
    expect(g.find((x) => x.label === 'Paints')!.items).toEqual([paint, pack]);
  });
  it('ship: by hull line A–Z, a multi-ship entry in each, unknown last', () => {
    const g = buybackGroups(list, 'ship', ships);
    expect(g.map((x) => x.label)).toEqual(['Avenger', 'Carrack', 'Constellation', 'Cutlass', 'Perseus', 'No ship / unknown ship']);
    expect(g.find((x) => x.label === 'Cutlass')!.items).toEqual([cutlass, combo]);
    expect(g.at(-1)!.items).toEqual([poster]);
  });
});
