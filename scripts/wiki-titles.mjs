// Dumps every page title in the Star Citizen Wiki's main namespace (articles and redirects, so RSI's spellings that
// the wiki redirects still match) to src/lib/data/wiki-titles.json. RSI+ shows a wiki link only for names on this
// list (`lib/wiki-pages.svelte.ts`), so it never links a page that doesn't exist, and makes no request to the wiki at
// run time. Re-run before a release to pick up new ships and items; titles only, sorted, so it diffs cleanly.
//   node scripts/wiki-titles.mjs [out.json]      (default: src/lib/data/wiki-titles.json, from any directory)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://starcitizen.tools/api.php';
const out = process.argv[2] ?? fileURLToPath(new URL('../src/lib/data/wiki-titles.json', import.meta.url));

const titles = [];
let from = {};
for (;;) {
  const q = new URLSearchParams({ action: 'query', list: 'allpages', apnamespace: '0', aplimit: 'max', format: 'json', formatversion: '2', ...from });
  const res = await fetch(`${API}?${q}`, { headers: { 'User-Agent': 'rsi-plus wiki-titles (github.com/NyleGarcia/rsi-plus)' } });
  if (!res.ok) throw new Error(`starcitizen.tools allpages: HTTP ${res.status}`);
  const body = await res.json();
  titles.push(...body.query.allpages.map((p) => p.title));
  if (!body.continue) break;
  from = { apcontinue: body.continue.apcontinue };
}
if (titles.length < 1000) throw new Error(`starcitizen.tools allpages: only ${titles.length} titles`);
titles.sort((a, b) => a.localeCompare(b, 'en'));
writeFileSync(out, '[\n' + titles.map((t) => JSON.stringify(t)).join(',\n') + '\n]\n');
console.log(`wrote ${titles.length} titles to ${out}`);
