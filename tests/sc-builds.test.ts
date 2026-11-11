import { describe, expect, it } from 'vitest';
import { buildLabel, compareBuilds, mergeBuilds, parseBuild } from '@/lib/sc-builds';

describe('parseBuild (real Patch Notes subjects, 2026-11)', () => {
  it.each([
    ['[All Waves] Star Citizen Alpha 4.10.3 PTU Patch Notes 13132336', { env: 'PTU', version: '4.10.3', build: 13132336 }],
    ['[Now Closed] Star Citizen Alpha 5.0 PTU 13119881 - Genesis, QDSM, Starchitect, Mission Boards', { env: 'PTU', version: '5.0', build: 13119881 }],
    ['Star Citizen Alpha 4.10.2 LIVE Release Notes', { env: 'LIVE', version: '4.10.2', build: null }],
    ['[Evocati NDA] Star Citizen Alpha 4.10.2 PTU Patch Notes 12702947', { env: 'PTU', version: '4.10.2', build: 12702947 }],
    ['[All Backer] Star Citizen Alpha 4.10.2 PTU RC2 Patch Notes 12878398', { env: 'PTU', version: '4.10.2', build: 12878398 }],
  ])('%s', (s, want) => expect(parseBuild(s)).toEqual(want));
  it.each(['Star Citizen Alpha 4.10.2 LIVE - Hotfix Central  (Updated 10.17.2026)', '[All Backer] TTK TTD Balance Test Tech-Preview #3', 'Ship blows up'])('ignores %s', (s) => expect(parseBuild(s)).toBeNull());
});

describe('builds', () => {
  it('orders versions, then build numbers', () => {
    expect(compareBuilds({ version: '4.10.3', build: 1 }, { version: '4.10.2', build: 9 })).toBe(1);
    expect(compareBuilds({ version: '5.0', build: 1 }, { version: '4.10.3', build: 9 })).toBe(1);
    expect(compareBuilds({ version: '4.10.3', build: 5 }, { version: '4.10.3', build: 9 })).toBe(-1);
  });
  it('keeps the newest per environment, same object when nothing is newer', () => {
    const t = (subject: string) => ({ subject, slug: subject, channel_id: '190048' });
    const b = mergeBuilds({}, [t('[Wave 1] Star Citizen Alpha 4.10.3 PTU Patch Notes 12999338'), t('[All Waves] Star Citizen Alpha 4.10.3 PTU Patch Notes 13132336'), t('Star Citizen Alpha 4.10.2 LIVE Release Notes')], 1);
    expect(b.PTU!.build).toBe(13132336);
    expect(buildLabel(b.LIVE!)).toBe('4.10.2 LIVE');
    expect(mergeBuilds(b, [t('[Wave 1] Star Citizen Alpha 4.10.3 PTU Patch Notes 12999338')], 2)).toBe(b);
  });
});
