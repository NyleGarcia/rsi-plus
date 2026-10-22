---
title: Release and Web Store publishing
tags: [release, ci, chrome-web-store]
updated: 2026-10-22
---
# Release and Web Store publishing

## Flow
1. Work lands on `dev` (every push → CI + a `vX.Y.Z-devNNNN` prerelease with all zips, `.github/workflows/prerelease.yml`).
2. PR `dev` → `main`, merge. `release-please` (`.github/workflows/release.yml`) opens *chore(main): release X.Y.Z* from the conventional commits (minor bump for `feat`, patch for `fix`, pre-1.0).
3. Merge that PR → the `vX.Y.Z` GitHub release gets `rsi-plus-X.Y.Z-{chrome,edge,brave,firefox}.zip` (+ `-sources.zip`), e.g. `https://github.com/NyleGarcia/rsi-plus/releases/download/vX.Y.Z/rsi-plus-X.Y.Z-chrome.zip`.
4. The `publish` job then submits the Chrome zip to the Chrome Web Store (`npx wxt submit --chrome-api-version v2` — API v1.1 was switched off on 2026-10-15, v2 addresses the item by publisher id, [publish-browser-extension](https://github.com/aklinker1/publish-browser-extension)) — Google's review still applies; the listing updates when it passes. Without the secrets below the job only warns.

## One-time setup (Chrome Web Store API)
The Web Store API takes an OAuth2 refresh token from the Google account that owns the listing (item `jpdcafgdkkhgffohcddpebmippacbide`, publisher id from the developer dashboard → Account), issued by an OAuth client in a Google Cloud project with the API enabled.

1. `gcloud auth login` as that account (the local SDK lives in `~/google-cloud-sdk/bin`). A fresh account must accept the Cloud terms once at https://console.cloud.google.com/ before it can create a project (the CLI reports `type: TOS`).
2. `bash scripts/webstore-setup.sh` — creates project `rsi-plus-publish`, enables `chromewebstore.googleapis.com`, prints the two console links gcloud cannot do: the OAuth consent screen (External, **published** — a Testing app's refresh tokens die after 7 days; gcloud can create it Internal-only via `gcloud iap oauth-brands create`, done 2026-10-22, switch the audience in the console if the listing owner is outside the org) and a **Desktop app** OAuth client. An external account can get Editor + OAuth Config Editor on the project (`gcloud projects add-iam-policy-binding … --role=roles/oauthconfig.editor`); the org forbids external Owners from the CLI.
3. Add the client id and secret to the **1Password Environment `rsi-plus`** (`CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, concealed) — it already holds `CHROME_EXTENSION_ID` and `CHROME_PUBLISHER_ID`, and is mounted at `~/git/rsi-plus/.env.submit` as a live FIFO (1Password feeds it on read; no plaintext on disk; the path is git-ignored). Both the token script and `wxt submit` read that path.
4. `node scripts/webstore-token.mjs --extension-id jpdcafgdkkhgffohcddpebmippacbide --publisher-id <id>` — reads the client id / secret from the mount, opens the consent page, catches the code on a loopback port, verifies the token against the item (v2 `fetchStatus`), stores `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` as secrets of the `chrome-web-store` GitHub environment (`gh secret set` from stdin — never printed), and puts the refresh token on the clipboard: add it to the 1Password Environment as `CHROME_REFRESH_TOKEN` (concealed) so a local `wxt submit --dry-run` works too. The GitHub environment exists (repo → Settings → Environments → `chrome-web-store`; add a required reviewer there to approve each publish).

## Notes
- Refresh tokens from a Desktop client do not expire unless revoked (or the consent screen is left in Testing). Revoke at https://myaccount.google.com/permissions.
- `npx wxt submit --dry-run --chrome-api-version v2 --chrome-zip .output/rsi-plus-X.Y.Z-chrome.zip` checks the credentials locally through the mounted `.env.submit` (passed 2026-10-22).
- Secrets live in 1Password (local) and the `chrome-web-store` GitHub environment (CI) — never in a plain env file.
- Web Store metadata rule (rejection 2026-10-15): no third-party product names in the dashboard fields — `store/LISTING.md`.
