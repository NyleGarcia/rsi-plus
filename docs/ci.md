---
title: CI and security checks
tags: [ci, security]
updated: 2026-10-29
---
# CI and security checks

Three workflows on every push to `main` / `dev` and every PR; release flow in [release and Web Store publishing](release.md).

| Workflow | Job | What fails it |
|---|---|---|
| CI (`ci.yml`) | `verify` | `svelte-check` errors, failing vitest |
| CI | `zip` | a browser target that does not build (chrome, edge, brave, firefox) |
| Security (`security.yml`) | `codeql` | CodeQL `security-and-quality` findings for JS/TS and for the workflow files (results under *Security → Code scanning*) |
| Security | `audit` | `npm audit`: moderate+ in shipped deps, high+ anywhere |
| Security | `dependency-review` (PRs) | a PR adding a dependency with a high+ advisory or a denied license |
| Security | `secrets` | gitleaks finds a credential anywhere in history |
| Security | `extension` | built manifest off the allowlist (`scripts/manifest-check.mjs`), `eval` / `new Function` in the bundle, `web-ext lint` errors |
| Scorecard (`scorecard.yml`) | `scorecard` | never fails; publishes the OpenSSF score (README badge) and its findings to Code scanning. Runs on `dev` (the default branch — the score is taken there), `main` and weekly |

Security also runs weekly (Monday 06:17 UTC) so new advisories get caught against unchanged code, and on *Actions → Security → Run workflow*.

## Extension audit
`scripts/manifest-check.mjs` reads the built manifests (`npx wxt build`, `npx wxt build -b firefox`) and fails on: a permission outside `storage, unlimitedStorage, alarms, notifications, cookies, offscreen, identity`; a required host or content-script match other than `https://robertsspaceindustries.com/*`; an optional host other than `OPTIONAL_HOSTS` (`https://starorg.tools/*`, the StarOrg Tools sync asked for on *Connect*), whether it sits in MV3 `optional_host_permissions` or as a host-shaped MV2 `optional_permissions` entry; any optional API permission; `externally_connectable`; a CSP with `unsafe-eval` or remote script sources; any `http://` URL, or any third-party URL anywhere else in the manifest (the URL scan runs on a copy without `optional_host_permissions` / `optional_permissions`, so the StarOrg host is allowed under those keys only — a `web_accessible_resources` match or a homepage on starorg.tools fails). StarOrg as a *required* host still fails. `--dev` adds `https://dev.starorg.tools/*` to `OPTIONAL_HOSTS`, for a development-mode build only (`wxt build --mode development`); the store builds CI checks run without it, so a dev host that leaks into a release fails. `tests/manifest-check.test.ts` runs the script on hand-made manifests for the accept and reject cases. Adding a permission is deliberate: extend the allowlist in the script in the same commit and say why in `wxt.config.ts`.

`web-ext lint` (Mozilla's add-on linter, the AMO review tool) fails the job on errors. Its warnings are reported, not fatal: the `innerHTML` warnings come from Svelte's runtime cloning static templates (app code never assigns `innerHTML`), and the manifest-key warnings are the AMO data-collection key against the Firefox minimum version.

## Supply chain
Every `uses:` in the workflows is pinned to a commit SHA with the version in a comment (`actions/checkout@fbc6…  # v5.1.0`); Dependabot's `github-actions` updates move the SHA and the comment together. A moving tag (`@v5`) can be re-pointed by whoever controls the action's repo; a SHA cannot.

Release zips carry SLSA build provenance (`actions/attest-build-provenance` in the `assets` job, verifiable with `gh attestation verify <zip> -R NyleGarcia/rsi-plus`) and the release gets a `SHA256SUMS` (`checksums` job). The build is reproducible: `scripts/verify-release.sh <version>` downloads the release, checks both, clones the tag, runs `npm ci && npx wxt zip -b chrome` and diffs the unpacked zips — checked for 0.6.0 (CI on Node 22 vs a local Node 24 build: identical). `SECURITY.md` holds the reporting policy.

## Dependabot
`.github/dependabot.yml`: weekly npm and GitHub Actions bumps, minor/patch grouped into one PR each, so CI and Security run once per batch. Repo settings also have secret scanning + push protection and Dependabot security updates on.

## Local
```sh
npm audit --omit=dev --audit-level=moderate && npm audit --audit-level=high
npx wxt build && npx wxt build -b firefox
node scripts/manifest-check.mjs .output/chrome-mv3/manifest.json .output/firefox-mv2/manifest.json
npx --yes web-ext lint --source-dir .output/firefox-mv2 --no-config-discovery
```
