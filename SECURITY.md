# Security

RSI+ runs entirely in your browser and talks to one site, robertsspaceindustries.com ([PRIVACY.md](PRIVACY.md)). It handles your RSI session cookie, so it is held to that standard.

## Reporting a vulnerability
- Preferred: [GitHub private vulnerability report](https://github.com/NyleGarcia/rsi-plus/security/advisories/new) — only the maintainer sees it.
- Or a GitHub issue for anything that is not exploitable (hardening ideas, a permission that looks wider than needed).
- Expect an acknowledgement within 72 hours and a fix release for confirmed issues within 14 days; the advisory is published with the fix. Please do not test against accounts you do not own.

## Supported versions
The latest release on the Chrome Web Store / GitHub releases. Older versions get no backports — update.

## What is checked on every change
`.github/workflows/security.yml` ([docs/ci.md](docs/ci.md)): CodeQL on the code and the workflow files, `npm audit`, dependency review on PRs, gitleaks, and an extension audit — the built manifests must stay on the permission / host allowlist (`scripts/manifest-check.mjs`), no `eval` / `new Function` in the bundle, Mozilla's `web-ext lint` clean of errors. Actions are pinned by commit SHA; Dependabot bumps dependencies weekly; OpenSSF Scorecard grades the repo.

## Verifying a release
Every release zip carries a SLSA build-provenance attestation (signed statement that GitHub Actions built it from the tagged commit) and a `SHA256SUMS` file, and the build is reproducible:
```sh
scripts/verify-release.sh 0.6.1            # checksums + attestation + rebuild and diff
gh attestation verify rsi-plus-0.6.1-chrome.zip -R NyleGarcia/rsi-plus   # attestation alone
```
The zip submitted to the Chrome Web Store is the same CI artifact that is attached to the GitHub release ([docs/release.md](docs/release.md)).

## Design notes a reviewer should know
- One host: all `content_scripts`, `host_permissions` and fetches are `https://robertsspaceindustries.com/*`; no analytics, no remote code, no third-party endpoints.
- Permissions: `storage`, `unlimitedStorage`, `alarms`, `notifications`, `cookies`, `offscreen` (Chromium only) — why each is needed is in `wxt.config.ts` and the store listing.
- The session cookie is read to call Spectrum's API from the background; the optional account switcher copies your own RSI cookies into extension storage and nowhere else. Uninstalling deletes everything.
- Nothing is bought, melted or sent on RSI without you pressing RSI's own buttons; *Add to cart* only fills your RSI cart.
