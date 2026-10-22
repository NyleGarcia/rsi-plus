import { describe, expect, it } from 'vitest';
import { applyFacets, facetCounts, toggleFacet, insuranceBucket, stageOf, INSURANCE_OPTIONS, type Facet, type RangeFacet } from '../src/lib/facets';

type Row = { ins: string; lti: boolean; wb: boolean; price: number | null };
const rows: Row[] = [
  { ins: 'LTI', lti: true, wb: true, price: 100 },
  { ins: '120 mo', lti: false, wb: false, price: 50 },
  { ins: '6 mo', lti: false, wb: true, price: null },
  { ins: '', lti: false, wb: false, price: 10 },
];
const facets: Facet<Row>[] = [
  { id: 'ins', label: 'Insurance', options: INSURANCE_OPTIONS((r) => r.ins, (r) => r.lti) },
  { id: 'wb', label: 'Warbond', multiple: true, options: [{ id: 'yes', label: 'Warbond', test: (r) => r.wb }, { id: 'no', label: 'Standard', test: (r) => !r.wb }] },
];
const ranges: RangeFacet<Row>[] = [{ id: 'price', label: 'Price', get: (r) => r.price }];

describe('facets', () => {
  it('buckets insurance and stage', () => {
    expect(insuranceBucket('LTI')).toBe('lti');
    expect(insuranceBucket('', true)).toBe('lti');
    expect(insuranceBucket('120 mo')).toBe('120');
    expect(insuranceBucket('6 mo')).toBe('short');
    expect(insuranceBucket('')).toBe('none');
    expect(stageOf('Flyable')).toBe('ready');
    expect(stageOf('In Concept')).toBe('concept');
    expect(stageOf('In Production')).toBe('other');
  });
  it('applies single, multiple and range facets', () => {
    expect(applyFacets(rows, facets, { ins: 'lti' })).toHaveLength(1);
    expect(applyFacets(rows, facets, { wb: ['yes', 'no'] })).toHaveLength(4);
    expect(applyFacets(rows, facets, { wb: ['yes'] })).toHaveLength(2);
    expect(applyFacets(rows, facets, { price: { min: 20, max: null } }, ranges)).toHaveLength(2); // null price drops out once bounded
    expect(applyFacets(rows, facets, { price: { min: null, max: null } }, ranges)).toHaveLength(4);
    expect(applyFacets(rows, facets, {})).toHaveLength(4);
  });
  it('counts each option with the other facets applied', () => {
    const c = facetCounts(rows, facets, { wb: ['yes'] });
    expect(c.ins).toEqual({ lti: 1, '120': 0, short: 1, none: 0 });
    expect(c.wb).toEqual({ yes: 2, no: 2 }); // its own choice is ignored for its own counts
  });
  it('toggles', () => {
    let v = toggleFacet({}, facets[0]!, 'lti');
    expect(v.ins).toBe('lti');
    v = toggleFacet(v, facets[0]!, 'lti');
    expect(v.ins).toBeNull();
    v = toggleFacet(v, facets[1]!, 'yes');
    v = toggleFacet(v, facets[1]!, 'no');
    expect(v.wb).toEqual(['yes', 'no']);
    v = toggleFacet(v, facets[1]!, 'yes');
    expect(v.wb).toEqual(['no']);
  });
});
