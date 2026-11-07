---
title: RSI handle verification tiers (RSI+ linked / Verified+)
tags: [spec, starorg, privacy]
status: active
updated: 2026-11-07
---
# RSI handle verification tiers

Split StarOrg Tools' single `rsi_verified` flag into tiers: **RSI+ linked** (the handle RSI+ reads from the logged-in RSI session) for everyday use, and **Verified+** (StarOrg's existing short-bio code check) for anything that affects other members. RSI+ does not touch the bio by default.

## Problem
- StarOrg verifies an RSI handle only through a code in the RSI short bio. Some members won't edit their public profile, so they stay *unverified*, and an unverified member can send any handle (`StarOrgCard.svelte`: "any handle you send is accepted until you verify one").
- RSI+ already knows the handle of the logged-in RSI account and only sends a hangar read as that same handle (`starorg.ts` `prepare`: `hangar.handle !== me.handle` → refused). StarOrg treats that the same as a typed handle.
- What RSI+ sends is the user's own claim, not proof: the sync is a bearer token plus JSON, so anyone with a StarOrg token can `PUT` any `rsi_handle` with curl. Calling it "verified" would be wrong.

## Decisions

### Tiers (StarOrg owns them; RSI+ displays them)
| Tier | `rsi_tier` | Earned by | Strength | Unlocks (StarOrg's call; suggested) |
|---|---|---|---|---|
| 0 | `none` | Handle typed on StarOrg, or none | None | Profile only |
| 1 | `linked` | An accepted hangar sync from RSI+ (`client` starts with `rsi-plus/`) for that handle, which passes the server checks below | Medium: faking it means hand-crafting API calls with your own token | Hangar sync; assigning your own ships to events and ops |
| 2 | `verified_plus` | StarOrg's existing bio code check (unchanged) | Strong: StarOrg's server reads it from a public RSI page and can re-check it at any time | Org roles and officer permissions, actions that affect other members, exclusive claim on the handle |

- Naming: tier 1 is never shown as "verified". UI copy: **RSI+ linked**, **Verified+**.
- A member can hold several handles, each with its own tier (matches `verified_handles` today).

### StarOrg rules
1. **Verified+ wins:** if any member holds a handle at `verified_plus`, a sync for that handle from anyone else gets `409 RSI_HANDLE_MISMATCH` (as today), and other members' `linked` claims on it are dropped.
2. **Linked conflicts:** if two members are `linked` to the same handle, both are flagged (`rsi_conflict: true`) and keep only tier 0 perks for that handle until one of them reaches Verified+. No silent winner.
3. **Server-side checks for `linked`** (StarOrg, no RSI+ change):
   - The handle exists: `https://robertsspaceindustries.com/citizens/<handle>` returns a profile.
   - Optional: the main org shown on that public page matches the StarOrg org the member claims.
   - Same identity: the handle in the sync matches the handle the member set on StarOrg; a different handle doesn't link (StarOrg decides whether to auto-add or refuse it).
4. **Downgrade:** a `verified_plus` handle whose bio check later fails drops to `linked` (bio codes may be removed after verifying, so StarOrg decides whether to re-check or keep the result permanently).

### API changes (StarOrg side)
- `StarOrgUser` (answer to `POST /api/auth/extension/exchange`) gains `rsi_tier: 'none' | 'linked' | 'verified_plus'` and `rsi_conflict?: boolean`. **Keep `rsi_verified`** (= `rsi_tier === 'verified_plus'`) for older RSI+ versions.
- `PUT /api/fleet/hangar/sync` answer gains `rsi_tier` for the synced handle, so the card updates after a send without signing in again.
- `GET /api/fleet/hangar/sync` items gain `rsi_tier` per handle.
- New stable URL for the bio flow, e.g. `GET /verify/rsi?handle=<h>` (a StarOrg page; RSI+ only links to it).

### RSI+ changes
1. **Types** (`src/lib/starorg.ts`): `StarOrgUser.rsi_tier?` and `rsi_conflict?`. When `rsi_tier` is missing (older StarOrg), derive it: `rsi_verified ? 'verified_plus' : 'none'`. Read the tier from the sync answer and status items, store it on `StarOrgSync`.
2. **Card badge** (`StarOrgCard.svelte`, replaces the verified/unverified badge):
   - `verified_plus` → success badge **Verified+**, hint: "Verified on StarOrg Tools with your RSI bio code."
   - `linked` → neutral badge **RSI+ linked**, hint: "StarOrg Tools knows this handle from RSI+ syncs. Verify it with a bio code for Verified+."
   - `none` → warning badge **unverified**, hint as today.
   - `rsi_conflict` → warning line: "Another StarOrg member also linked this handle. Verify it to keep it."
3. **Get Verified+** link on the card when the tier is lower than `verified_plus`: opens StarOrg's bio flow for the logged-in handle in a new tab. RSI+ makes no RSI request for this.
4. **No bio access by default.** RSI+ never reads or writes the short bio unless phase 2 below ships and the user turns it on.
5. **Docs:** PRIVACY.md (the card can show your tier; no new data is sent), README StarOrg bullet, `docs/architecture.md` StarOrg section, store listing only if the wording there mentions verification.

### Phase 2 (optional, not default): bio helper
Only if users ask for it. Off by default, behind a setting (*Let RSI+ add the StarOrg code to my RSI bio*) and a confirm click each time.
- Flow: StarOrg issues the code → RSI+ reads the current bio and saves it locally → writes `bio + code` with RSI's own profile-edit request (same session as the site) → asks StarOrg to check → puts the saved bio back exactly as it was, whether the check passed or failed, and also on timeout.
- If putting the bio back fails, the card says so and shows the saved bio for the user to paste back by hand.
- This would be RSI+'s first write to the RSI profile: needs its own PRIVACY.md entry, a store-listing update and a Firefox data-collection review. The RSI profile-edit endpoint still has to be checked against a saved page before building this.

### Later (not in this spec)
- **Spectrum DM challenge:** RSI+ sends a one-time code as a Spectrum private message to a StarOrg RSI bot account. That proves account control without the bio and could raise tier 1 to proof. It needs a StarOrg bot account, an inbox poller and a check against RSI's ToS.

## Out of scope
- RSI+ deciding perks. Tiers and what they unlock are StarOrg's.
- Making tier 1 tamper-proof. Anything an extension asserts can be faked by a determined user; tier 1 is meant to keep out casual or accidental misuse.

## Acceptance (RSI+ side)
RSI+ side built 2026-11-07 (`tierOf`, `verifyUrl`, tier on `StarOrgSync` / `RemoteSync`, card badge). Waits on StarOrg Tools for `rsi_tier` / `rsi_conflict` and the `/verify/rsi` page; until then the card falls back to `rsi_verified`.

- [x] With an older StarOrg (no `rsi_tier`): the badge shows Verified+ or unverified from `rsi_verified`, with no errors.
- [x] `linked` / `verified_plus` / `none` / `rsi_conflict` each show the right badge and hint (vitest on a pure `tierOf(user, sync)` helper, plus the card in the hub).
- [x] The tier updates after *Send hangar now* without disconnecting and connecting again.
- [x] *Get Verified+* opens the StarOrg URL for the logged-in handle and makes no RSI request.
- [x] No new permissions in the manifest; `scripts/manifest-check.mjs` passes.
- [x] PRIVACY.md, README and `docs/architecture.md` updated from the shipped diff.

## Open questions
- Exact perks per tier (StarOrg).
- Should a `linked` handle need N successful syncs, or a minimum age, before it counts?
- Re-check `verified_plus` periodically, or keep it permanently once passed?
- Is the org match on the public citizen page required for `linked`, or only shown as a hint?
