// Resolve docs/changelog.md when main is merged back into dev after a release (release.yml → backmerge):
//   node scripts/backmerge-changelog.mjs <main-ref> <dev-ref>
// The release PR rolled main's "## Unreleased" into a version section while dev kept adding entries under its own
// "## Unreleased", so git conflicts on the same lines. Takes main's file and puts back every dev Unreleased entry
// main doesn't already have (anywhere — rolled ones stay rolled) under main's "## Unreleased", in dev's order.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [mainRef, devRef] = process.argv.slice(2);
if (!mainRef || !devRef) {
  console.error('usage: node scripts/backmerge-changelog.mjs <main-ref> <dev-ref>');
  process.exit(2);
}
const file = 'docs/changelog.md';
const show = (ref) => execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' });
const unreleased = /^## Unreleased\n([\s\S]*?)(?=^## |(?![\s\S]))/m;
const main = show(mainRef);
const dev = show(devRef);
const m = main.match(unreleased);
if (!m) {
  console.error(`no "## Unreleased" section on ${mainRef}`);
  process.exit(1);
}
const entries = (body) => body.split('\n').filter((l) => l.startsWith('- '));
const have = new Set(main.split('\n'));
const add = entries(dev.match(unreleased)?.[1] ?? '').filter((l) => !have.has(l));
const body = [...add, ...entries(m[1])].join('\n');
const updated = [main, dev].map((s) => s.match(/^updated: (.*)$/m)?.[1] ?? '').sort().at(-1);
const out = main.replace(m[0], `## Unreleased\n${body ? `${body}\n` : ''}\n`).replace(/^updated: .*$/m, `updated: ${updated}`);
writeFileSync(file, out);
console.log(`kept ${add.length} dev Unreleased entr${add.length === 1 ? 'y' : 'ies'} on top of ${mainRef}`);
