import { beforeEach, describe, expect, it, vi } from 'vitest';
import titles from '@/lib/data/wiki-titles.json';
import { categorize, type Category } from '@/lib/items';
import type { CatalogShip } from '@/lib/store';
import { itemWikiUrl, storeWikiUrl, wikiPageUrl, wikiUrl } from '@/lib/wiki';
import { setWikiTitles, wikiTitle } from '@/lib/wiki-pages.svelte';

const ship = (name: string): CatalogShip => ({ id: 1, name, manufacturer: '', focus: '', msrp: 0, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });

// Pages the wiki has (articles and redirects), as `scripts/wiki-titles.mjs` writes them.
const PAGES = ['Odin', 'Carrack Expedition', 'Avenger Titan', 'Aurora MR', 'Arrowhead Sniper Rifle', 'Pembroke Armor', 'Thing', 'Cutlass Red Paint', 'Aurora Paint'];

describe('wiki', () => {
  beforeEach(() => setWikiTitles(PAGES));

  it('wikiUrl: spaces → underscores, readable punctuation kept, first letter as given', () => {
    expect(wikiUrl('Odin')).toBe('https://starcitizen.tools/Odin');
    expect(wikiUrl('F7C Hornet Mk II')).toBe('https://starcitizen.tools/F7C_Hornet_Mk_II');
    expect(wikiUrl("  Khartu-al  (Xi'an  Scout) ")).toBe("https://starcitizen.tools/Khartu-al_(Xi'an_Scout)");
    expect(wikiUrl('100i')).toBe('https://starcitizen.tools/100i');
    expect(wikiUrl('Ares Star Fighter Ion')).toBe('https://starcitizen.tools/Ares_Star_Fighter_Ion');
  });

  it('wikiUrl: encodes unsafe characters per segment, keeps : , and /', () => {
    expect(wikiUrl('C8R Pisces Rescue: Nurse')).toBe('https://starcitizen.tools/C8R_Pisces_Rescue:_Nurse');
    expect(wikiUrl('A & B, C/D?')).toBe('https://starcitizen.tools/A_%26_B,_C/D%3F');
    expect(wikiUrl('A#B 50%')).toBe('https://starcitizen.tools/A%23B_50%25');
    expect(wikiUrl('Größe')).toBe('https://starcitizen.tools/Gr%C3%B6%C3%9Fe');
  });

  it('wikiPageUrl: only names the wiki has a page for, by its own title; case and spacing ignored', () => {
    expect(wikiPageUrl('Odin')).toBe('https://starcitizen.tools/Odin');
    expect(wikiPageUrl('  arrowhead  sniper RIFLE ')).toBe('https://starcitizen.tools/Arrowhead_Sniper_Rifle');
    expect(wikiPageUrl('Aurora MR')).toBe('https://starcitizen.tools/Aurora_MR'); // a redirect: the wiki forwards it
    expect(wikiPageUrl('Whitecap Paint')).toBeNull();
    expect(wikiPageUrl('   ')).toBeNull();
  });

  it('no link before the title list has loaded; the first lookup loads it', async () => {
    vi.resetModules();
    const fresh = await import('@/lib/wiki-pages.svelte');
    expect(fresh.wikiTitle('Odin')).toBeNull();
    await fresh.loadWikiTitles();
    expect(fresh.wikiTitle('Odin')).toBe('Odin');
  });

  it('the bundled list holds ships, vehicles and gear the panels link', () => {
    setWikiTitles(titles);
    for (const n of ['Odin', 'Avenger Titan', 'Carrack Expedition', 'Arrowhead Sniper Rifle', 'Pembroke Armor', 'Ursa Rover', 'Origin 300i']) expect(wikiTitle(n), n).not.toBeNull();
    expect(wikiTitle('Lifetime Insurance')).toBeNull();
  });

  it('itemWikiUrl: ships use the catalog name, then the title; covered kinds by title; the rest get no link', () => {
    expect(itemWikiUrl('ship', 'Odin - LTI', ship('Odin'))).toBe('https://starcitizen.tools/Odin');
    expect(itemWikiUrl('ship', 'Avenger Titan', ship('Avenger Titan Renegade'))).toBe('https://starcitizen.tools/Avenger_Titan');
    expect(itemWikiUrl('ship', 'Unknown Hull', null)).toBeNull();
    expect(itemWikiUrl('ship', 'Unknown Hull', ship('Unknown Hull'))).toBeNull();
    for (const c of ['paint', 'armor', 'weapon', 'fps', 'component'] as Category[]) {
      expect(itemWikiUrl(c, 'Thing', null)).toBe('https://starcitizen.tools/Thing');
      expect(itemWikiUrl(c, 'No Such Thing', null)).toBeNull();
    }
    for (const c of ['decoration', 'hangar', 'game', 'insurance', 'credits', 'other'] as Category[]) expect(itemWikiUrl(c, 'Thing', null)).toBeNull();
    expect(itemWikiUrl('paint', '  ', null)).toBeNull();
    expect(itemWikiUrl(categorize('Odin', 'Ship'), 'Odin', ship('Odin'))).toBe('https://starcitizen.tools/Odin');
    expect(itemWikiUrl(categorize('Lifetime Insurance', 'Insurance'), 'Lifetime Insurance', null)).toBeNull();
  });

  it('storeWikiUrl: ships / paints / gear link; packs, packages and subscribers do not; add-ons by title', () => {
    expect(storeWikiUrl('ships', 'Carrack Expedition', ship('Carrack Expedition'))).toBe('https://starcitizen.tools/Carrack_Expedition');
    expect(storeWikiUrl('ships', 'Hull Z', ship('Hull Z'))).toBeNull();
    expect(storeWikiUrl('paints', 'Cutlass Red Paint')).toBe('https://starcitizen.tools/Cutlass_Red_Paint');
    expect(storeWikiUrl('paints', 'Cutlass Blue Paint')).toBeNull();
    expect(storeWikiUrl('gear', 'Pembroke Armor')).toBe('https://starcitizen.tools/Pembroke_Armor');
    expect(storeWikiUrl('gear', 'Arrowhead Sniper Rifle')).toBe('https://starcitizen.tools/Arrowhead_Sniper_Rifle');
    // Concierge specials land in `gear`: flair, credits and other one-offs have no wiki page.
    expect(storeWikiUrl('gear', "Chairman's Club Plaque")).toBeNull();
    expect(storeWikiUrl('gear', '50,000 UEC')).toBeNull();
    expect(storeWikiUrl('packs', 'Squadron Pack')).toBeNull();
    expect(storeWikiUrl('packages', 'Starter Package')).toBeNull();
    expect(storeWikiUrl('subscribers', 'Coin')).toBeNull();
    expect(storeWikiUrl('addons', 'Hangar Flair Poster')).toBeNull();
    expect(storeWikiUrl('addons', 'Aurora Paint')).toBe('https://starcitizen.tools/Aurora_Paint');
  });
});
