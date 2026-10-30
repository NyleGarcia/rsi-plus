---
title: Release and Web Store publishing
tags: [release, ci, chrome-web-store]
updated: 2026-10-29
---
# Release and Web Store publishing

## Flow
1. Work lands on `dev` (every push → CI + a `vX.Y.Z-devNNNN` prerelease with all zips, `.github/workflows/prerelease.yml`).
2. PR `dev` → `main`, merge. `release-please` (`.github/workflows/release.yml`) opens *chore(main): release X.Y.Z* from the conventional commits (minor bump for `feat`, patch for `fix`, pre-1.0). The `changelog` job then commits `scripts/roll-changelog.mjs X.Y.Z` onto that PR: `docs/changelog.md`'s *Unreleased* entries (the hand-written, user-facing log) move under `## X.Y.Z — date`; root `CHANGELOG.md` is release-please's commit-derived one. Write user-facing entries under *Unreleased* on `dev`; never add a version heading by hand.
3. Merge that PR → the `vX.Y.Z` GitHub release gets `rsi-plus-X.Y.Z-{chrome,edge,brave,firefox}.zip` (+ `-sources.zip`), each with a SLSA provenance attestation, plus `SHA256SUMS` (`scripts/verify-release.sh X.Y.Z` checks them and rebuilds — [CI and security checks](ci.md)), e.g. `https://github.com/NyleGarcia/rsi-plus/releases/download/vX.Y.Z/rsi-plus-X.Y.Z-chrome.zip`.
4. The `publish` job then submits the Chrome zip to the Chrome Web Store (`npx wxt submit --chrome-api-version v2` — API v1.1 was switched off on 2026-10-15, v2 addresses the item by publisher id, [publish-browser-extension](https://github.com/aklinker1/publish-browser-extension)) — Google's review still applies; the listing updates when it passes. Without the secrets below the job only warns. **Only mainline releases go to the Web Store** — dev prereleases are GitHub-only.

## One-time setup (Chrome Web Store API v2)
API v2 (v1.1 was switched off on 2026-10-15) authenticates as a **Google Cloud service account** that the developer dashboard trusts, and addresses the item by **publisher id** (dashboard → Account) and item id (`jpdcafgdkkhgffohcddpebmippacbide`). Done 2026-10-22 as below (service account listed in the dashboard, `fetchStatus` 200 and `wxt submit --dry-run` green the same day); rerun the script to repair.

1. `gcloud auth login` (local SDK: `~/google-cloud-sdk/bin`; a fresh account must accept the Cloud terms once at https://console.cloud.google.com/ — the CLI says `type: TOS`).
2. `bash scripts/webstore-setup.sh` — project `rsi-plus-publish` (number 109799804481), APIs, service account `webstore-publisher@rsi-plus-publish.iam.gserviceaccount.com`, Workload Identity Federation pool `github` / provider `rsi-plus` restricted to this repo and bound to the service account, impersonation for the logged-in user.
3. Dashboard → Account → **Service accounts**: add that email (the API refuses the publisher until then).
4. GitHub: repository variables `GCP_WORKLOAD_IDENTITY_PROVIDER` (`projects/109799804481/locations/global/workloadIdentityPools/github/providers/rsi-plus`) and `GCP_SERVICE_ACCOUNT`; environment `chrome-web-store` secrets `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID` (a required reviewer on that environment gates each publish). The `publish` job gets a short-lived access token from `google-github-actions/auth` (`id-token: write`) and runs `npx wxt submit --chrome-api-version v2` with it — no key file, nothing long-lived in GitHub.
5. Local check: `source scripts/webstore-token.sh && npx wxt submit --dry-run --chrome-api-version v2 --chrome-zip .output/rsi-plus-X.Y.Z-chrome.zip` (mints a one-hour token for the service account through your gcloud login — `gcloud auth print-access-token --impersonate-service-account` ignores `--scopes`, so it calls IAM Credentials `generateAccessToken` with the `chromewebstore` scope), with `CHROME_EXTENSION_ID` / `CHROME_PUBLISHER_ID` from the 1Password Environment `rsi-plus` mounted at `.env.submit` (the file `wxt submit` reads).

The 1Password Environment also still holds the v1.1 OAuth client / refresh token from the first attempt (`CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`, as do the GitHub environment secrets of the same names): unused by v2, safe to delete.

## Notes
- Nothing secret is needed locally: the service account is impersonated through your own gcloud login; ids live in 1Password (local) and the `chrome-web-store` GitHub environment (CI) — never in a plain env file.
- Web Store metadata rule (rejection 2026-10-15): no third-party product names in the dashboard fields — `store/LISTING.md`.
- **Privacy form changes with the StarOrg Tools sync release** (first release carrying the `identity` permission and the optional `https://starorg.tools/*` host): before or with submitting that zip, update the dashboard's *Privacy practices* tab from `store/LISTING.md` → Privacy tab — the single purpose text, the new `identity` and optional-host justifications, and the data-usage ticks (personally identifiable information, authentication information and website content now also cover what the optional sync sends; financial and payment information ticked for the off-by-default *Send pledge values*). Paste the description's new PRIVACY paragraph too. `identity` carries no install warning, so existing users are not asked to re-accept the update; the optional host prompts only on *Connect*. On AMO, the update declares `data_collection_permissions.optional`; keep the listing's privacy policy link on PRIVACY.md.
