// Dumps RSI's public pledge-store upgrade catalog to tests/fixtures/catalog.json for the catalog-drift test in
// tests/export.test.ts. Same request as `fetchCatalog()` in src/lib/store.ts (`initShipUpgrade` on the upgrade
// GraphQL), sent with no session: the ship list is public. Writes only `{ id, name, manufacturer }` per hull,
// sorted by name, so the file holds nothing personal and diffs cleanly when RSI adds or renames a hull (no prices,
// so a price change leaves it alone).
//   node scripts/dump-catalog.mjs [out.json]      (default: tests/fixtures/catalog.json, from any directory)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GQL = 'https://robertsspaceindustries.com/pledge-store/api/upgrade/graphql';
const QUERY = 'query initShipUpgrade { ships { id name manufacturer { name } } }';
const out = process.argv[2] ?? fileURLToPath(new URL('../tests/fixtures/catalog.json', import.meta.url));

const res = await fetch(GQL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([{ operationName: 'initShipUpgrade', variables: {}, query: QUERY }]),
});
if (!res.ok) throw new Error(`RSI store initShipUpgrade: HTTP ${res.status}`);
const body = await res.json();
const first = Array.isArray(body) ? body[0] : undefined;
const ships = first?.data?.ships;
if (!Array.isArray(ships) || !ships.length) throw new Error(`RSI store initShipUpgrade: ${first?.errors?.[0]?.message ?? 'no ships'}`);

const rows = ships
  .map((s) => ({ id: s.id, name: s.name, manufacturer: s.manufacturer?.name ?? '' }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id - b.id);
writeFileSync(out, JSON.stringify(rows, null, 2) + '\n');
console.log(`wrote ${rows.length} hulls to ${out}`);
