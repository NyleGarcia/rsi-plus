import { describe, expect, it } from 'vitest';
import { categorize, type Category } from '@/lib/items';
import type { CatalogShip } from '@/lib/store';
import { itemWikiUrl, storeWikiUrl, wikiSearchUrl, wikiUrl } from '@/lib/wiki';

const ship = (name: string): CatalogShip => ({ id: 1, name, manufacturer: '', focus: '', msrp: 0, flyable: '', link: '', thumb: null, standalone: [], ccu: [] });

describe('wiki', () => {
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

  it('wikiSearchUrl: query-encoded, jumps with go=Go', () => {
    expect(wikiSearchUrl('Arrowhead Sniper Rifle')).toBe('https://starcitizen.tools/index.php?search=Arrowhead%20Sniper%20Rifle&go=Go');
    expect(wikiSearchUrl("Xi'an  (Paint) & more")).toBe("https://starcitizen.tools/index.php?search=Xi'an%20(Paint)%20%26%20more&go=Go");
  });

  it('itemWikiUrl: ships use the catalog name; covered kinds search; the rest get no link', () => {
    expect(itemWikiUrl('ship', 'Odin - LTI', ship('Odin'))).toBe('https://starcitizen.tools/Odin');
    expect(itemWikiUrl('ship', 'Unknown Hull', null)).toBe(wikiSearchUrl('Unknown Hull'));
    for (const c of ['paint', 'armor', 'weapon', 'fps', 'component'] as Category[]) expect(itemWikiUrl(c, 'Thing', null)).toBe(wikiSearchUrl('Thing'));
    for (const c of ['decoration', 'hangar', 'game', 'insurance', 'credits', 'other'] as Category[]) expect(itemWikiUrl(c, 'Thing', null)).toBeNull();
    expect(itemWikiUrl('paint', '  ', null)).toBeNull();
    expect(itemWikiUrl(categorize('Odin', 'Ship'), 'Odin', ship('Odin'))).toBe('https://starcitizen.tools/Odin');
    expect(itemWikiUrl(categorize('Lifetime Insurance', 'Insurance'), 'Lifetime Insurance', null)).toBeNull();
  });

  it('storeWikiUrl: ships / paints / gear link; packs, packages and subscribers do not; add-ons by title', () => {
    expect(storeWikiUrl('ships', 'Carrack Expedition', ship('Carrack Expedition'))).toBe('https://starcitizen.tools/Carrack_Expedition');
    expect(storeWikiUrl('paints', 'Cutlass Red Paint')).toBe(wikiSearchUrl('Cutlass Red Paint'));
    expect(storeWikiUrl('gear', 'Pembroke Armor')).toBe(wikiSearchUrl('Pembroke Armor'));
    expect(storeWikiUrl('gear', 'Arrowhead Sniper Rifle')).toBe(wikiSearchUrl('Arrowhead Sniper Rifle'));
    // Concierge specials land in `gear`: flair, credits and other one-offs have no wiki page.
    expect(storeWikiUrl('gear', "Chairman's Club Plaque")).toBeNull();
    expect(storeWikiUrl('gear', '50,000 UEC')).toBeNull();
    expect(storeWikiUrl('packs', 'Squadron Pack')).toBeNull();
    expect(storeWikiUrl('packages', 'Starter Package')).toBeNull();
    expect(storeWikiUrl('subscribers', 'Coin')).toBeNull();
    expect(storeWikiUrl('addons', 'Hangar Flair Poster')).toBeNull();
    expect(storeWikiUrl('addons', 'Aurora Paint')).toBe(wikiSearchUrl('Aurora Paint'));
  });
});
