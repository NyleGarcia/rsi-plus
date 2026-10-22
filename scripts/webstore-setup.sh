#!/usr/bin/env bash
# One-time Google Cloud setup for publishing RSI+ to the Chrome Web Store from CI (docs/release.md).
# What gcloud can do: the project and the API. What it cannot: the OAuth consent screen and the Desktop OAuth client —
# Google only exposes those in the console, so this prints the two links to click. Then run scripts/webstore-token.mjs.
#
#   bash scripts/webstore-setup.sh [PROJECT_ID]
#
# Log gcloud in as the Google account that owns the Web Store listing first: gcloud auth login
set -euo pipefail
PROJECT="${1:-rsi-plus-publish}"
GCLOUD="${GCLOUD:-$(command -v gcloud || echo "$HOME/google-cloud-sdk/bin/gcloud")}"

acct=$("$GCLOUD" config get-value account 2>/dev/null || true)
[ -n "$acct" ] || { echo "gcloud is not logged in — run: $GCLOUD auth login" >&2; exit 1; }
echo "account: $acct"

if ! "$GCLOUD" projects describe "$PROJECT" >/dev/null 2>&1; then
  echo "creating project $PROJECT"
  err=$(mktemp)
  if ! "$GCLOUD" projects create "$PROJECT" --name="RSI Plus Web Store publishing" 2>"$err"; then
    if grep -q "type: TOS" "$err"; then
      echo "This Google account has not accepted the Google Cloud terms yet. Open https://console.cloud.google.com/ once as $acct, accept, then rerun." >&2
    else
      cat "$err" >&2
    fi
    rm -f "$err"; exit 1
  fi
  rm -f "$err"
fi
"$GCLOUD" config set project "$PROJECT" >/dev/null
"$GCLOUD" services enable chromewebstore.googleapis.com --project "$PROJECT"
echo "Chrome Web Store API enabled on $PROJECT"

cat <<MSG

Two console steps gcloud cannot do (one-time):
 1. OAuth consent screen — https://console.cloud.google.com/auth/overview?project=$PROJECT
    App name "RSI+ publisher", your email, audience External, publish it (In production): a Testing app's refresh
    tokens expire after 7 days. No scopes to add here; the token script asks for chromewebstore.
 2. OAuth client — https://console.cloud.google.com/apis/credentials/oauthclient?project=$PROJECT
    Type "Desktop app", name "GitHub Actions". Copy the client ID and secret into the next step:

   node scripts/webstore-token.mjs --extension-id <WEB_STORE_ITEM_ID>
MSG
