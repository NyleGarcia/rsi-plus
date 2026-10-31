import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/manifest-check.mjs', import.meta.url));
// The extension audit (scripts/manifest-check.mjs, docs/ci.md) run as CI runs it, on hand-made manifests.
const dir = mkdtempSync(join(tmpdir(), 'manifest-check-'));
let n = 0;
function check(manifest: Record<string, unknown>, ...flags: string[]) {
  const file = join(dir, `m${n++}.json`);
  writeFileSync(file, JSON.stringify(manifest));
  const r = spawnSync(process.execPath, [SCRIPT, ...flags, file], { encoding: 'utf8' });
  return { ok: r.status === 0, err: r.stderr };
}

const RSI = 'https://robertsspaceindustries.com/*';
const STARORG = 'https://starorg.tools/*';
const DEV = 'https://dev.starorg.tools/*';
const mv3 = (extra: Record<string, unknown> = {}) => ({ manifest_version: 3, permissions: ['storage', 'alarms', 'cookies', 'identity', 'offscreen'], host_permissions: [RSI], ...extra });
const mv2 = (extra: Record<string, unknown> = {}) => ({ manifest_version: 2, permissions: ['storage', 'alarms', 'cookies', 'identity', RSI], ...extra });

describe('manifest audit', () => {
  it('accepts identity and the StarOrg optional host (MV3 optional_host_permissions, MV2 optional_permissions)', () => {
    expect(check(mv3({ optional_host_permissions: [STARORG] }))).toMatchObject({ ok: true });
    expect(check(mv2({ optional_permissions: [STARORG] }))).toMatchObject({ ok: true });
  });
  it('accepts the dev StarOrg host too (the Site dropdown can pick it)', () => {
    expect(check(mv3({ optional_host_permissions: [STARORG, DEV] }))).toMatchObject({ ok: true });
    expect(check(mv2({ optional_permissions: [STARORG, DEV] }))).toMatchObject({ ok: true });
  });
  it('rejects any other optional host, and an optional API permission', () => {
    const other = check(mv3({ optional_host_permissions: ['https://evil.example/*'] }));
    expect(other.ok).toBe(false);
    expect(other.err).toContain('optional host outside StarOrg Tools');
    expect(check(mv2({ optional_permissions: ['https://*.starorg.tools/*'] })).ok).toBe(false);
    expect(check(mv3({ optional_permissions: ['tabs'] })).err).toContain('optional permission set: tabs');
    expect(check(mv2({ optional_permissions: ['history'] })).err).toContain('optional permission set: history');
  });
  it('still fails StarOrg as a required host', () => {
    expect(check(mv3({ host_permissions: [RSI, STARORG] })).err).toContain('host permission outside RSI');
    expect(check(mv2({ permissions: ['storage', RSI, STARORG] })).err).toContain('host permission outside RSI');
  });
  it('still fails a permission off the allowlist and other third-party URLs', () => {
    expect(check(mv3({ permissions: ['storage', 'tabs'] })).err).toContain('permission not on the allowlist: tabs');
    expect(check(mv3({ optional_host_permissions: [STARORG], homepage_url: 'https://starorg.tools/fleet' })).err).toContain('third-party URL in manifest');
  });
  it('allows the StarOrg host only under the optional-permission keys', () => {
    const war = check(mv3({ optional_host_permissions: [STARORG], web_accessible_resources: [{ resources: ['x.png'], matches: [STARORG] }] }));
    expect(war.ok).toBe(false);
    expect(war.err).toContain(`third-party URL in manifest: ${STARORG}`);
    expect(check(mv2({ optional_permissions: [STARORG], web_accessible_resources: [STARORG] })).ok).toBe(false);
  });
});
