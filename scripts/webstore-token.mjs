#!/usr/bin/env node
/**
 * Get a Chrome Web Store refresh token for CI and store it — with the client id / secret and the extension id — as
 * GitHub Actions secrets, without the values ever being printed (docs/release.md). The refresh token is also put on the
 * clipboard so it can be added to the 1Password Environment `rsi-plus` (mounted at .env.submit) for local use.
 *
 *   node scripts/webstore-token.mjs --extension-id <id> --publisher-id <id> [--repo owner/name] [--env chrome-web-store]
 *
 * The publisher id (Web Store developer dashboard → Account → Publisher ID) is what API v2 addresses items by; v1.1
 * was switched off on 2026-10-15.
 *
 * Takes the OAuth client id and secret (Desktop app, from scripts/webstore-setup.sh) from `.env.submit`, the environment
 * or a prompt, opens Google's consent page
 * for the account that owns the listing, catches the code on a loopback port, exchanges it, checks the token against
 * the Web Store API, then `gh secret set` ×4. Needs Node 22 (fetch) and a logged-in `gh`.
 */
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFile } from 'node:fs/promises';

const arg = (name, def = '') => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
};
const extensionId = arg('extension-id');
const publisherIdArg = arg('publisher-id');
const repo = arg('repo');
const envName = arg('env', 'chrome-web-store');
if (!/^[a-p]{32}$/.test(extensionId)) {
  console.error('usage: node scripts/webstore-token.mjs --extension-id <32-letter Web Store item id>');
  process.exit(1);
}
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

// Client id / secret: from the environment, else `.env.submit` — the 1Password Environment `rsi-plus` mounted there (a
// live FIFO fed by 1Password, nothing on disk; the file `wxt submit` reads too), else asked for.
const dotenv = Object.fromEntries(
  (await readFile('.env.submit', 'utf8').catch(() => ''))
    .split('\n')
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const rl = createInterface({ input: stdin, output: stdout });
const ask = async (q) => (await rl.question(q)).trim();
const clientId = process.env.CHROME_CLIENT_ID || dotenv.CHROME_CLIENT_ID || (await ask('OAuth client ID: '));
const clientSecret = process.env.CHROME_CLIENT_SECRET || dotenv.CHROME_CLIENT_SECRET || (await ask('OAuth client secret: '));
const publisherId = publisherIdArg || process.env.CHROME_PUBLISHER_ID || dotenv.CHROME_PUBLISHER_ID || (await ask('Publisher ID (dashboard → Account): '));
rl.close();
if (!publisherId) {
  console.error('publisher id is required (API v2)');
  process.exit(1);
}
if (!clientId || !clientSecret) {
  console.error('client id and secret are required');
  process.exit(1);
}

// Loopback: Google accepts http://127.0.0.1:<any port> for Desktop-app clients.
let redirectUri = '';
const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const c = url.searchParams.get('code');
    const err = url.searchParams.get('error');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<p style="font:16px system-ui">${c ? 'RSI+: token received — you can close this tab.' : `RSI+: ${err ?? 'no code'}`}</p>`);
    server.close();
    c ? resolve(c) : reject(new Error(err ?? 'no code in redirect'));
  });
  server.listen(0, '127.0.0.1', () => {
    redirectUri = `http://127.0.0.1:${server.address().port}`;
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent' }).toString();
    console.log('\nSign in as the Google account that owns the Web Store listing. Opening:\n' + auth.href + '\n');
    spawn('xdg-open', [auth.href], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  });
});

const token = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
}).then((r) => r.json());
if (!token.refresh_token) {
  console.error("No refresh token in Google's answer:", token.error_description ?? token.error ?? JSON.stringify(Object.keys(token)));
  process.exit(1);
}

// Prove the token works against the item (API v2) before storing anything.
const check = await fetch(`https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}:fetchStatus`, {
  headers: { authorization: `Bearer ${token.access_token}` },
});
const item = await check.json().catch(() => ({}));
if (!check.ok) {
  console.error(`Web Store API v2 refused (${check.status}): ${item.error?.message ?? 'is the API enabled on the project, is the publisher id right, and is this the account that owns the item?'}`);
  process.exit(1);
}
console.log(`Web Store item ${extensionId}: ${JSON.stringify(item).slice(0, 300)}`);

const setSecret = (name, value) =>
  execFileSync('gh', ['secret', 'set', name, '--env', envName, ...(repo ? ['--repo', repo] : [])], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
setSecret('CHROME_EXTENSION_ID', extensionId);
setSecret('CHROME_PUBLISHER_ID', publisherId);
setSecret('CHROME_CLIENT_ID', clientId);
setSecret('CHROME_CLIENT_SECRET', clientSecret);
setSecret('CHROME_REFRESH_TOKEN', token.refresh_token);
console.log(`\nStored CHROME_EXTENSION_ID, CHROME_PUBLISHER_ID, CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN in the "${envName}" GitHub environment. The next release will submit itself.`);

// For local `wxt submit --dry-run`: hand the token to the clipboard for the 1Password Environment, never to the terminal.
const copied = ['wl-copy', 'xclip -selection clipboard', 'pbcopy'].some((cmd) => {
  try {
    execFileSync(cmd.split(' ')[0], cmd.split(' ').slice(1), { input: token.refresh_token, stdio: ['pipe', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
});
console.log(copied ? 'Refresh token copied to the clipboard: add it to the 1Password Environment "rsi-plus" as CHROME_REFRESH_TOKEN (concealed).' : 'No clipboard tool found (wl-copy / xclip / pbcopy): rerun this script later if you want the token in 1Password too.');
