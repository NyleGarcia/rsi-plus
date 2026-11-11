/**
 * Star Citizen game builds as Spectrum's patch-notes threads name them ("Star Citizen Alpha 4.3.2 PTU.10123456 Patch
 * Notes"). RSI+ reads the subjects of thread lists you open on Spectrum (no extra request) and keeps the newest per
 * environment, for the Issue Council report helper's `{build}`. Public data, shared across accounts.
 */
export const SC_ENVS = ['LIVE', 'PTU', 'EPTU', 'TECH-PREVIEW'] as const;
export type ScEnv = (typeof SC_ENVS)[number];

export interface ScBuild {
  env: ScEnv;
  /** "4.3.2" (a letter suffix kept: "3.24.2a"). */
  version: string;
  /** The build number after the environment ("PTU.10123456"), null when the subject has none. */
  build: number | null;
  subject: string;
  slug: string;
  channelId: string;
  /** When RSI+ saw it (ms). */
  at: number;
}
export type ScBuilds = Partial<Record<ScEnv, ScBuild>>;

/**
 * A patch / release notes subject → env, version, build; null for anything else. Real subjects (2026-11):
 * "[All Waves] Star Citizen Alpha 4.10.3 PTU Patch Notes 13132336", "Star Citizen Alpha 5.0 PTU 13119881 - Genesis, …",
 * "Star Citizen Alpha 4.10.2 LIVE Release Notes", "[Evocati NDA] Star Citizen Alpha 4.10.2 PTU Patch Notes 12702947"
 * (the environment is the word after the version; bracket tags are waves, not environments).
 */
export function parseBuild(subject: string): Omit<ScBuild, 'subject' | 'slug' | 'channelId' | 'at'> | null {
  const s = subject.replace(/^\s*\[[^\]]*\]\s*/, '');
  const m = /\bAlpha\s+(\d+\.\d+(?:\.\d+)?[a-z]?)\s+(LIVE|EPTU|PTU|Tech[- ]?Preview)\b/i.exec(s);
  if (!m) return null;
  const build = /\b(\d{6,})\b/.exec(s);
  // Notes only: "Hotfix Central" and the like name a version but aren't a build announcement.
  if (!/\b(patch|release)\s+notes\b/i.test(s) && !build) return null;
  const raw = m[2]!.toUpperCase().replace(/\s/g, '-');
  const env: ScEnv = raw.startsWith('TECH') ? 'TECH-PREVIEW' : (raw as ScEnv);
  return { env, version: m[1]!, build: build ? Number(build[1]) : null };
}

/** -1 / 0 / 1 by version (numeric parts, then letter), then build number. */
export function compareBuilds(a: Pick<ScBuild, 'version' | 'build'>, b: Pick<ScBuild, 'version' | 'build'>): number {
  const parts = (v: string) => {
    const m = /^([\d.]+)([a-z]?)$/.exec(v);
    return { n: (m?.[1] ?? v).split('.').map(Number), l: m?.[2] ?? '' };
  };
  const x = parts(a.version);
  const y = parts(b.version);
  for (let i = 0; i < Math.max(x.n.length, y.n.length); i++) {
    const d = (x.n[i] ?? 0) - (y.n[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.l !== y.l) return x.l < y.l ? -1 : 1;
  return Math.sign((a.build ?? 0) - (b.build ?? 0));
}

/** Newest build per environment after a thread list: unchanged object when nothing is newer (no write). */
export function mergeBuilds(cur: ScBuilds, threads: { subject: string; slug: string; channel_id: string }[], now: number): ScBuilds {
  let next = cur;
  for (const t of threads) {
    const p = parseBuild(t.subject);
    if (!p) continue;
    const have = next[p.env];
    if (have && compareBuilds(p, have) <= 0) continue;
    next = { ...next, [p.env]: { ...p, subject: t.subject, slug: t.slug, channelId: t.channel_id, at: now } };
  }
  return next;
}

/** "4.3.2 PTU.10123456" / "4.3.2 LIVE". */
export const buildLabel = (b: ScBuild) => `${b.version} ${b.env}${b.build ? `.${b.build}` : ''}`;
