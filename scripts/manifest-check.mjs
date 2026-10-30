// Guards the built manifests against permission creep and remote code — run after `wxt build` (-b firefox too):
//   node scripts/manifest-check.mjs .output/chrome-mv3/manifest.json .output/firefox-mv2/manifest.json
// Every permission must be on the allowlist, required hosts must stay on RSI, the only optional host is StarOrg Tools
// (asked for when the user presses Connect), no CSP loosening (unsafe-eval / remote script sources), no http:// or
// third-party URLs anywhere. Adding a permission is a deliberate change: extend the allowlist here in the same commit
// (and say why in wxt.config.ts). docs/ci.md.
//   --dev   also accept the dev StarOrg host, which only a development-mode build declares (never a store zip).
import { readFileSync } from 'node:fs';

const PERMISSIONS = new Set(['storage', 'unlimitedStorage', 'alarms', 'notifications', 'cookies', 'offscreen', 'identity']);
const HOSTS = new Set(['https://robertsspaceindustries.com/*']);
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const files = args.filter((a) => a !== '--dev');
/** Optional hosts: requested at runtime by Settings → Integrations → StarOrg Tools → Connect, dropped on Disconnect. */
const OPTIONAL_HOSTS = new Set(['https://starorg.tools/*', ...(dev ? ['https://dev.starorg.tools/*'] : [])]);
const BAD_CSP = /unsafe-eval|wasm-unsafe-eval|http:|https:\/\/(?!robertsspaceindustries\.com)/;
const isHost = (p) => p.includes('/') || p === '<all_urls>';

if (!files.length) {
  console.error('usage: node scripts/manifest-check.mjs [--dev] <manifest.json>...');
  process.exit(2);
}

let failed = false;
const fail = (file, msg) => {
  failed = true;
  console.error(`✖ ${file}: ${msg}`);
};

for (const file of files) {
  const m = JSON.parse(readFileSync(file, 'utf8'));
  const mv2 = m.manifest_version === 2;
  const perms = m.permissions ?? [];
  const hosts = mv2 ? perms.filter(isHost) : (m.host_permissions ?? []);
  for (const p of perms.filter((p) => !isHost(p))) if (!PERMISSIONS.has(p)) fail(file, `permission not on the allowlist: ${p}`);
  for (const h of hosts) if (!HOSTS.has(h)) fail(file, `host permission outside RSI: ${h}`);
  // Optional: hosts only, and only the StarOrg Tools host — MV3 `optional_host_permissions`, MV2 host-shaped
  // `optional_permissions` (MV2 has no separate key). An optional API permission still fails.
  const optional = m.optional_permissions ?? [];
  const optionalHosts = [...(mv2 ? optional.filter(isHost) : []), ...(m.optional_host_permissions ?? [])];
  for (const p of mv2 ? optional.filter((p) => !isHost(p)) : optional) fail(file, `optional permission set: ${p}`);
  for (const h of optionalHosts) if (!OPTIONAL_HOSTS.has(h)) fail(file, `optional host outside StarOrg Tools: ${h}`);
  for (const cs of m.content_scripts ?? [])
    for (const pat of [...(cs.matches ?? []), ...(cs.exclude_matches ?? [])])
      if (!pat.startsWith('https://robertsspaceindustries.com/')) fail(file, `content script match outside RSI: ${pat}`);
  const csp = m.content_security_policy;
  const csps = typeof csp === 'string' ? [csp] : Object.values(csp ?? {});
  for (const c of csps) if (BAD_CSP.test(c)) fail(file, `content_security_policy loosened: ${c}`);
  if (m.externally_connectable) fail(file, 'externally_connectable set');
  if (/http:\/\//.test(JSON.stringify(m))) fail(file, 'plain http:// URL in manifest');
  // The optional-host keys were checked above; scan everything else with them removed, so the StarOrg host is allowed
  // there and only there (a web_accessible_resources match or a homepage on starorg.tools still fails).
  const { optional_host_permissions: _ohp, optional_permissions: _op, ...rest } = m;
  for (const url of JSON.stringify(rest).match(/https:\/\/[^"\s]+/g) ?? [])
    if (!url.startsWith('https://robertsspaceindustries.com/')) fail(file, `third-party URL in manifest: ${url}`);
  if (!failed) console.log(`✔ ${file}: ${perms.length} permissions, hosts ${hosts.join(', ')}${optionalHosts.length ? `; optional ${optionalHosts.join(', ')}` : ''}`);
}

process.exit(failed ? 1 : 0);
