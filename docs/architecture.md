---
title: Architecture
tags: [architecture]
updated: 2026-10-09
---
# Architecture

| Piece | File | World | Job |
|---|---|---|---|
| Hook | `src/entrypoints/spectrum-hook.content.ts` | MAIN, document_start | Wraps `fetch` + XHR on `/api/spectrum/*`: forwards thread-list / thread / identify JSON to the content script; with mute mode *hide* drops muted threads from `/forum/channel/threads` payloads |
| Content script | `src/entrypoints/spectrum.content/` | isolated | Settings → `<html>` classes + hook config (localStorage `spectrumplus:config` + postMessage); `decorate.ts` paints list rows + replies; read marking; `keys.ts` shortcuts; `ThreadBar.svelte` (shadow root) |
| Background | `src/entrypoints/background.ts` | SW | Alarm poll (watches, friends snapshot, party reminder) → `local:feed` + notifications + badge; friends/org/channel endpoints for the hub |
| Hub | `src/entrypoints/hub/` + `src/components/*Panel.svelte` | ext page | Feed · Friends · Hangar · Buyback · Store · CCU planner · Watching · Mutes (`#tab?to=<shipId>` deep links) |
| RSI content script | `src/entrypoints/rsi.content/` + `SiteBar.svelte` | isolated, all RSI pages except Spectrum | Bar on store ship pages (catalog match by link path) and account pages |
| Popup | `src/entrypoints/popup/` | ext page | Toggles + hub shortcuts |
| Combobox | `src/components/Combobox.svelte` (+ `ShipSelect.svelte`) | hub | Searchable single-select: closed = button with the pick, open = search input over a grouped listbox (`role=combobox` + `aria-activedescendant`, rows not focusable). Filters label + sublabel substring, groups in first-seen order, no portal. `ShipSelect` feeds it catalog ships with maker · price sublabels, owned ships first (`onlyMine` for the hangar-only mode). |

## Spectrum API (`src/lib/api.ts`)
- `POST https://robertsspaceindustries.com/api/spectrum<endpoint>`, JSON body, header `X-Rsi-Token: <Rsi-Token cookie>`. Anonymous visitors get a token too → public reads work logged out (verified 2026-10: `/auth/identify`, `/v2/forum/channel/list`, `/forum/channel/threads`, `/forum/thread/nested`).
- Background reads the cookie via `browser.cookies` (permission `cookies`); content script reads `document.cookie`.
- Friends: `friendsData()` reads `/v2/relationship/friend/list` + `/v2/relationship/friend-request/list` (what Spectrum's own friends sidebar uses), falling back to `/auth/identify` `friends[]`/`friend_requests[]` (legacy — empty for some accounts, which broke the first version). Normalizers in `src/lib/relationship.ts`. Writes try `/v2/relationship/*` then v1 `/friend/remove`, `/friend-request/*` — **unverified live**. The hub shows which source answered (+ warnings on hover).
- Endpoint list was extracted from Spectrum's bundle (`static.robertsspaceindustries.com/spectrum/static/bundle-*.js`). Payload normalizer (`src/lib/capture.ts`) accepts v1 snake_case (verified) and v2 camelCase (unverified).

## Read tracking (`src/lib/read.ts`, `local:read`)
- Per thread id `{replies, seenAt, at}` written when a thread page's payload arrives (or from list data on SPA navigation). Never moves backwards. Capped at 5000 most recent.
- Row status: unseen / read / new (+N = replies_count − seen). Jump-to-first-new = earliest loaded reply with `time_created > seenAt` → `/thread/<slug>/<replyId>`.
- Local only — independent of Spectrum's own server-side unread dot.

## Rows & replies (`decorate.ts`)
- List rows have no stable class: a row = ancestor of a thread link that has a sibling linking to a *different* thread. Only slugs seen in a captured list payload are painted (sidebar/bookmarks untouched). Classes `sp-row sp-read|sp-new|sp-unseen sp-muted sp-dev-row sp-watched sp-pinned`.
- Replies: `.forum-thread-item` (own `.forum-thread-member-info .nickname-separator` → handle). Muted → own `.body-content-blocks` hidden + "show" button. Hover actions: Mute, Watch author.
- **Unverified live** (no logged-in DOM capture yet): row detection, `.body-content-blocks`, wide/compact selectors.

## Mutes (`src/lib/filters.ts`)
- Authors by lower-cased handle; keywords substring or `/regex/` (always `i`, never `g`); labels by name; optional bump muting (latest reply by muted author). Pinned threads never muted.

## Watches + feed (`src/lib/watch.ts`)
- Threads: `/forum/thread/nested` → replies grew → event `replies:<id>:<count>`. Opening the thread page syncs the count (no notification for replies you read).
- Channels: newest page; first poll = silent baseline (`lastThreadId`). New thread by dev (`tracked_post_role_id`/`isGM`) or watched author → event; `allThreads` → every thread. Older thread whose `latest_activity` is a dev (`highlight_role_id`) or watched author → `reply:<id>:<time>`.
- Authors are only seen inside watched channels (Spectrum has no per-author feed endpoint).
- Feed `local:feed`: deduped by key, newest first, max 300. Max 5 notifications per poll.

## Friends (`src/lib/friends.ts`, `src/lib/orgs.ts`)
- Source: see Spectrum API above (v2 relationship list, identify fallback). Requests normalized to `requesting_member_id`/`target_member_id`/`status`.
- **Added time**: Spectrum has no friendship date (bundle checked: only pending requests carry `createdAt`). `touchNotes()` on every poll + hub load: the very first snapshot marks existing friends `firstSeen: 0` ("before Spectrum+"); friends appearing later get `firstSeen = now`. Accepting a request in the hub stamps it immediately.
- **Unfriend / re-add**: friends missing from a non-empty list (or unfriended in the hub, `markRemoved`) get `removedAt`; when they reappear they count as newly added (`firstSeen = now`, party cleared, tags/note kept). An empty list never marks anyone removed.
- **Party**: `party` flag in `local:friendNotes`; `partyEvent()` emits one feed reminder per set of due party friends after `partyRemindHours`, counted from the add time, or from `partyAt` (when marked) if the add time is unknown.
- **Orgs**: main org = member badge with `/orgs/<SID>` url (free). All orgs = `GET /citizens/<handle>/organizations` (public HTML, regex-parsed: `box-content org main|affiliation`, `visibility-R|H` = redacted), ~1 req/s, hub fetches in batches of 10, `local:orgs` TTL 24 h.

## Storage
| Key | Area | Content |
|---|---|---|
| `settings` | sync | toggles, mutes, poll minutes, party reminder |
| `watches` | sync | threads, channels, authors, friend bells |
| `read`, `feed`, `friendNotes`, `orgs`, `presence`, `lastPoll` | local | see above |

### Incognito
Manifest `incognito: 'split'`: incognito windows get their own background worker, hub and popup, and cookie jar (so a second RSI login works there). `chrome.storage` is shared, so `settings.ts` puts **account data** under `incognito.` keys when `INCOGNITO` is true: read, watches, feed, friendNotes, presence, seenRequests, hangar, buyback, partyMode, partyLog, lastPoll. Shared by both: settings and mutes, orgs cache, store catalog, wishlist. The incognito background runs (polls, party mode) only while an incognito window is open; incognito data persists across sessions. Enable via chrome://extensions → Allow in Incognito. Split in dev too: spanning would put the hub in a normal window even when opened from incognito (Chrome shows no extension pages in incognito windows under spanning) and share one cookie jar. WXT's hot reload registers content scripts from both backgrounds; the loser's "Duplicate script ID" rejection is harmless and swallowed in `background.ts` (dev only). The hub opens in the requesting window (`hub:open` carries the popup's `windowId`; content scripts use the sender tab's).

## Hangar & buyback (`src/lib/hangar.ts`, `src/lib/account.ts`)
- Loaded **from the hub page** (DOMParser available; session cookies via host permission): `/account/pledges?page=N&pagesize=50`, `/account/buy-back-pledges?page=N&pagesize=50`. Stops on an empty page, a page with < 10 items, or a repeated first id (RSI repeats the last page). 429 → retry with backoff.
- Hangar selectors per HangarXPLOR (MIT, 2026-04): `.list-items > li`, `.js-pledge-id|name|value`, `.js-upgrade-data` JSON, `.items .item .title/.kind`, `.js-reclaim`, `.label` "Gift", `.upgraded`, `.custom-name-text`, `.date-col`.
- Buyback parser is **defensive / unverified**: `article.pledge` (or list items), heading, `dt/dd` (Last Modified, Contained), `[data-pledgeid|fromshipid|toshipid]`, `a[href*=buyback]`.
- Cached in `local:hangar` / `local:buyback` only — never synced or sent anywhere. Saved after **every page** (`complete: false`, `page`) as a plain JSON copy; the panels offer *Resume from page N+1*. `unlimitedStorage` lifts the 10 MB `storage.local` quota.

## Store catalog (`src/lib/store.ts`)
- `POST /pledge-store/api/upgrade/graphql` (array body). `initShipUpgrade.ships` = all ships, `msrp` in cents, standalone `skus` — works with no session. Upgrade targets `to(from)` need `POST /api/account/v2/setAuthToken` (+ `setContextToken`) first — no CSRF. Unused declared GraphQL variables → HTTP 400.
- Target sku price is absolute; CCU A→B costs `sku.price − msrp(A)` (RSI's `upgradePrice`). One `to(from: cheapest)` query yields every target.
- Background refreshes every 30 min with a wishlist, else 6 h (`local:catalog`); `wishlistEvents` alerts on the first offer or a lower one (`sync:wishlist.lowest`).
- Verified live 2026-10: 240 ships, 53 CCU targets on sale, warbond detection.

## CCU planner (`src/lib/ccu.ts`)
- Dijkstra over catalog ships (msrp > 0), ties → fewer steps. Edges: on-sale CCU SKUs (`warbond` / `standard` / `limited`, sold-out limited skipped), owned hangar CCUs (cost 0), buyback CCUs (optional, cost ≈ msrp diff).
- Owned CCUs mapped via upgrade JSON ids when the catalog id's name agrees, else `matchShip` (normalized names, longest contained catalog name). Unmatched shown in the panel.
- **v2 (CCU Game parity, spec [plans/specs/ccu-planner-v2](plans/specs/ccu-planner-v2.md))**: `objective` = `spend` (owned CCUs free; CCU Game "current savings") / `cash` (least new money first — warbond + anything store credit can't pay — then spend) / `longterm` (owned CCUs cost their melt value). Ranking is lexicographic (`rank()`), ties → fewer steps.
- Source modes: hangar ship / any ship / **store** (`startId = STORE_START = 0`: virtual node with one `standalone` edge per ship with a standalone SKU on sale; baseline = target MSRP).
- Options: `storeCredit` (off → every step is new money), `excludeGifted` (hangar CCU with melt value 0 = gift), `include[]` (forced CCUs, routed through in MSRP order as segments; null if a leg is impossible), `exclude[]` (force exclude + refs reserved by saved chains, `reservedRefs()`).
- Saved chains: `local:ccuChains` (per account, in `ACCOUNT_ITEMS`), `SavedChain` = name, start/target, steps, totals, options. The panel re-prices each on today's data (other chains' CCUs excluded) and flags drift. "Your CCUs" table = CCU Game's CCU Overview with per-row force include / exclude / auto cycling.
- Not done: speculative prices (needs a price-history store), k-best alternatives.
## Items (`src/lib/items.ts`)
- Flattens `Pledge.items` → `ItemRow` (merged by category + title, with pledges and ×count). Categories from RSI item kinds (Ship, Skin, FPS Equipment → armor/weapon/fps by title, Component, Hangar decoration, Hangar, Insurance) + titles (Digital Download = game, paint/livery).
- Paint/component → ships (`shipsFor`): if the title has a hull before " - ", match only that part (colour words like "Black" would otherwise hit Cutlass Black); exact catalog name wins (longest), else every ship of the **family** (first non-generic, non-model-code token: Cutlass, Hornet, Constellation).
- `paintStatus`: fits a ship you own / only ships you don't / unknown.
- Fallback: a paint whose name names no ship fits the ships packed in the same pledge (`fitsVia: 'pledge'`, "from pack" chip).
- `paintGroups`: paints per ship family + the hulls of it you own (optionally owned families with no paints); `~` = unknown ship, last.
- `seriesOf`: event / collection per non-ship item — known events (Luminalia, IAE, Invictus, Coramor, …) in the title or pledge name, else the longest name prefix (2 words, then 1) shared by ≥ 2 items ("RSI Disc.", "AA"); a lone generic word (RSI, Heavy…) doesn't count; paints only get known events.
- `storePaintsByFamily` / `storePaintFor` / `paintKey`: store paints (below) per ship family, and hangar paint ↔ store paint by normalized title (suffix Paint/Livery/Skin and dashes dropped).
- UI: **Ships & paints** tab (`ShipsPanel`): *Paints by ship* — owned + store paints per family, toggle Both / Owned / Not owned, ship filter (I own / don't own / unknown & packs), 🛒 store link (price, sale) and 🏠 hangar page link per paint, Plan CCU for the cheapest hull of a family you lack; *My ships* (+ Compare with store paints row). **Items** tab (`ItemsPanel`): all items, category chips, show filters, group by category / event / ship / pledge, store + hangar links. Foldable groups, CSV; prefs in `localStorage` `rsiplus:ships` / `rsiplus:items`.
- `stackPledges` / `stackKey`: identical pledges (type, name, value, LTI, warbond, meltable, upgrade, item titles+kinds) as one row; gift / nickname / date don't split a stack. Hangar table renders stacks (unstacked = one per pledge).
- `hangarUrl(all, id, action?)` → `/account/pledges?page=N&pagesize=50&rsiplus=<id>[&rsiplus_do=melt|gift]`; page = the one stamped by `loadAll`, else from the pledge's index at `HANGAR_PAGE` (50). The RSI content script (`rsi.content`) scrolls to / outlines that row (`input.js-pledge-id`) — if the id isn't on the page it fetches hangar pages in the tab until it finds it and navigates there — and, for an action, clicks RSI's own `.js-reclaim` / `.js-gift` button so RSI's dialog opens — melting needs the account password every time (`RSI.Api.Account.reclaimPledge({pledge_id, current_password})`), so RSI+ never melts directly.

### Insurance & credits
- `parseInsurance(text)`: "Lifetime Insurance"/LTI → `LTI`, "N Month/Year Insurance" → `N mo` (longest wins); stored as `Pledge.insurance`; `ItemRow.insurance` / `OwnedShip.insurance` collect distinct terms per hull. Store listings carry no insurance (not in the search API, ship pages are JS-rendered), so the Store tab shows your hangar's insurance for ships you own.
- `parseCredits(doc)` (text nodes joined with spaces — `textContent` glues "USDUEC"): the `/account/billing` credits box, amount-then-label (`$812.17 USD STORE CREDITS`, `¤45,000 UEC`, `¤1,440,000 REC`; `div.credits > div.credit-line`), label-then-amount as fallback; `account.fetchCredits()` tries `/account/billing`, `/account/dashboard`, `/account/settings`, `/account/pledges` (the hangar list page itself has no credits box). Saved on `hangarItem.credits` / `creditsAt`, refreshed quietly after every full hangar load; shown and refreshed on the **Wallet** tab (Hangar shows only store credit with a link, and "store credit after" in the melt card). The credits box is JS-rendered (account dropdown / sidebar), so the RSI content script watches the DOM on every RSI page with a MutationObserver and parses it whenever a node mentioning "store credit" appears, updating the saved hangar.

## Account switcher (`src/lib/accounts.ts`, `AccountSwitch.svelte`)
- A **profile** = an RSI login's cookie jar (`cookies.getAll({domain: 'robertsspaceindustries.com'})` — `Rsi-Token`, `Rsi-Account-Auth`, `_rsi_device`, `Rsi-XSRF`, httpOnly included) + handle/displayname from `/auth/identify`. Saved in `local:profiles` (incognito-prefixed: each context has its own jar and list), plain text, never synced.
- **Switch** (`switchTo`): park the active account's data (`ACCOUNT_ITEMS` in settings.ts — reads, watches, feed, friend notes, presence, seen requests, hangar, buyback, party mode/log, last poll) under `local:profileData.<id>`, clear the jar, `cookies.set` the target's (host-only cookies omit `domain`, session cookies omit `expirationDate`), restore the target's parked data, `identify` again (mismatch → profile `stale`), reload RSI tabs; the hub/popup reloads itself. No `active` profile but someone logged in → captured on the spot first so nothing is lost. Never calls RSI logout (voids the token server-side); *Log out here* only clears the jar.
- Background polling / party mode need no changes: they read cookies and storage on every tick.

## Wallet (`src/lib/wallet.ts`, `WalletPanel.svelte`, `Bars.svelte`, `Donut.svelte`)
- Credits (above) + **your spend**: melt value of the saved hangar bucketed by the pledge's *Created* date — `spendByYear`, `spendByMonth(n)` (every month present, zeros kept), `spendByType`, `spendByFunding` (warbond vs the rest), `spendSummary` (total, warbond, since, years backed, per year). Melt value ≠ cash paid (CCU chains, discounts, gifts, melted pledges) — said on the tab.
- **Game funding**: RSI's public `POST /api/stats/getCrowdfundStats {chart: day|week|month, funds, fans}` (no login) → lifetime `funds` + `fans` (citizens) and `chart[key].gross` for the last 7 periods, all in cents (`parseFunding`). Cached per range in `local:funding` (shared, not per account), refetched when older than an hour or on *Refresh*; `year` isn't a valid chart. Stats: raised to date, citizens, per citizen, current period vs previous, your hangar as a % of all funding and vs the average citizen.
- Charts are dependency-free: `Bars` (HTML flex columns, tallest = 100%, every k-th label when crowded, last bar highlighted for the running period) and `Donut` (SVG stroke arcs + legend with share).

- `account.pageCount(doc)`: highest `?page=N` pagination link → `Progress.pages` for "page X / Y".
- **Fleet at today's prices** (`fleetValue`): single-ship pledges matched to the catalog (`matchShip`), melt value vs current MSRP; multi-ship packs counted, not split. **CCU portfolio** (`ccuOverview` over `ccu.ownedCcus`): paid (melt) vs today's MSRP gap per hangar CCU, winners / gifted counts. Both need `local:catalog` (loaded by the Store tab / background refresh).
- Funding extras (`fundingStats`, `periodElapsed`): mean and best of the completed periods shown, and the running period projected by its elapsed fraction (day: minutes/1440, week: Monday-based, month: days in month).
## Store paints (`fetchPaints`, `local:paints`)
`POST /graphql` (store search, not the upgrade API) `GetBrowseListingQuery` with `skus.products: ["268"]` (paint product type), 100 per page, public. Gives id, name, url, price + discounted (cents), stock, thumbnail. Cached 6 h; `paints:get` message. Pack/collection listings naming no ship land under `~`.

## Melt (`src/lib/melt.ts`)
- `meltSummary(all, picked)`: credit (= sum of pledge values), items lost for good vs still owned via another kept pledge; LTI hull counts as its own thing; a CCU pledge counts as "upgrade A → B".
- `duplicatePlan(all)`: greedy by value — a pledge is pickable only if every item (and LTI hull) in it still has another copy among the pledges not yet picked; skips non-meltable, $0 (`canMelt`), CCUs, game packages. Result: melt everything redundant, lose nothing.
- `copiesElsewhere(all, picked, p)`: for a picked pledge, each item + the unpicked pledges still holding it ("✓ also in #123" / "✗ last copy").
- `DedupeOptions {types, keepLti, keep}` on `duplicatePlan` / `targetPlan` / `meltSummary` / `marginalLoss`: restrict pledge types, never pick LTI, and `keep` = item key → copies to keep. `items.paintCopiesNeeded` fills `keep` with one copy per owned hull a paint fits, so 3 Cutlass paints for 3 Cutlasses aren't duplicates; `MeltSummary.short` lists paints kept below that.
- `marginalLoss(all, picked, p)`: what melting `p` on top of the current picks loses (empty = pure duplicate right now).
- `targetPlan(all, usd)`: reach a credit amount losing the fewest unique items — duplicates first (highest value), then the pledge with the fewest additional losses (most $ per lost item as tie-break), then trim picks the target no longer needs. Never picks game packages. Greedy, not optimal — good enough for hangars of hundreds.
- UI: Hangar tab — tick column, "Pick duplicates / Pick paints without a ship (paint-only pledges whose paints all have `paintStatus` no-ship) / Need $ → Plan for target / Pick shown / Clear", credit + lost/still-owned lists, per-row "Would lose" (−N chip, or *duplicate*), "Hangar ↗" per pledge.

## Party mode (background `doPartyTick`, `local:partyMode`, `local:partyLog`)
- While `partyActive` (on and before `until`), a 1-minute alarm reads requests (`friendsData`) and accepts every incoming pending one not yet accepted and failed < 3 times (`partyTargets`), 0.5 s apart. Accepted → note `party: true`, `firstSeen = partyAt = now`; log entry (ok/error); one feed event + notification per tick, plus a ding (`partySound`, default on) via `lib/sound.ts`: the service worker can't play audio, so it creates an offscreen document (`entrypoints/offscreen`, `offscreen` permission, reason AUDIO_PLAYBACK) and messages it `offscreen:ding`; the page synthesises two sine notes with WebAudio (no sound file). `sound:ding` from the popup previews it. Expiry switches it off and clears the alarm.
