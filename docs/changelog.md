---
title: Changelog
tags: [changelog]
updated: 2026-10-09
---
# Changelog

## 0.2.0 — 2026-10-12
- **Add to RSI cart** from the CCU planner: every store step (CCU SKU or standalone ship) gets an *Add to cart* button and *Add N store steps* adds them one after another in your signed-in RSI session (`setContextToken` → `getPrice` → `addToCart`, the calls RSI's own upgrade window makes; standalone ships via the store's `AddCartItemMutation` with the page CSRF token). Shows RSI's live price when it differs, never retries an add, never pays. Buy-back CCUs add alone (RSI: one buy-back per cart). *Open RSI cart ↗*.
- **UI pass (patterns from 21st.dev)**: `Segmented` control with a sliding pill (CCU objective + source, Wallet ranges, paint ownership), shared KPI stat tiles with ▲/▼ delta chips (base.css — one style for Hangar / Wallet / CCU), and the CCU chain as a vertical stepper (numbered rail, ✓ for owned / in-cart steps, ! on a refused add) instead of a wide table.
- **Searchable dropdowns**: new `Combobox` (type to filter by name / maker, your hangar's ships listed first, arrow keys / Enter / Esc, clear ×, match highlighting) replaces the long native selects — CCU planner source + target, Ships compare "Add any ship", Store manufacturer filter.
- **CCU planner v2** (CCU Game parity): optimisation target (current savings / lowest new money / long-term savings), start from a ship you own, any ship, or *buy a ship from the store* first, pay-with-store-credit and exclude-gifted options, force include / exclude per CCU ("Your CCUs" table), **saved chains** whose CCUs stay out of new plans and get re-priced on today's store, step table with running total, new money, hull value and buy links, "cash after store credit".
- **Wallet**: *Fleet at today's prices* (melt value vs current MSRP per ship), *CCU portfolio* (paid vs today's upgrade worth, winners, gifted), funding average / best period / on-pace projection for the running day / week / month.
- Party mode: a short **ding** when a friend request is auto-accepted (toggle *Ding on party auto-accept* in the popup, ♪ to preview). Played by an offscreen document (`offscreen` permission) since the background can't play audio.
- Fix: the dev build now runs `incognito: split` like the release build — with spanning, Chrome put the hub in a normal window whenever it was opened from incognito, and incognito had no login of its own.
- Fix: opening the hub from an incognito popup or RSI tab opens it in that incognito window (was the normal window); an existing hub tab is reused only when it is the same kind of window.
- **Account switcher** (hub header + popup): save the current RSI login as a profile (its cookies, no password), switch between saved logins in one click — RSI+'s data for each account (feed, reads, watches, friends notes, hangar, buyback, party log) is parked and restored with it, RSI tabs reload. Stale profiles (session expired) are flagged; *Log out here* clears cookies only. Local, plain text, never synced.
- Hangar / Buyback loading shows "page X / Y" with a progress bar — Y from RSI's pagination links, else estimated from the last load.
- **Insurance**: each pledge's insurance term (LTI / 120 mo / 6 mo …) parsed from its items; shown on Hangar rows, My ships (sortable column), Compare and the Store list ("owned ×N · LTI" under ships you have, plus *Ships I own / don't own* filters). The store API exposes no insurance for what it sells.
- **Wallet** tab: store credit / UEC / REC (one-request *Refresh credits*, picked up from `/account/billing`) with hangar melt value and "credit if you melted everything"; **Your spend** — melt value by year, by month (12/24/36), by type and warbond vs credit, plus backing since / per year / in buyback; **Star Citizen funding** — RSI's public counter: raised to date, citizens, per citizen, last 7 days / weeks / months as a bar chart, this period vs last, your hangar as a share of all funding and vs the average citizen. Hangar keeps only a store-credit stat linking here.
- **Credits**: store credit, UEC and REC read from the billing page; the melt calculator shows "store credit after" = current + melt.
- Tabs: *Items & ships* split into **Ships & paints** (fleet, compare, paints by ship) and **Items** (everything else).
- Paints by ship now includes the **store's paints**: toggle Both / Owned / Not owned per ship; every paint has a 🛒 store link (price, sale price) and, when owned, 🏠 links to the hangar page holding it (gift / melt). Ships, items and compare get store + hangar links too.
- Hangar links land on the real page: open the best-guess page, and if the pledge isn't there the RSI page searches the hangar itself and jumps to the right page; scrolls to and outlines the pledge; **melt** / **gift** links open RSI's own dialog for that pledge (password typed on RSI, never in RSI+). The melt calculator lists the picked pledges as a melt-one-by-one checklist.
- Melt calculator: picked pledges say where else you hold each item ("✓ Cutlass Black also in #123" with links, or "✗ last copy"); stack rows read "2 melt · 1 keep"; *Pick duplicates* switches to the picked-only view. **May pick** chips choose which pledge types the dedupe / target planner may touch (e.g. paints and gear only, leave ships), plus *never LTI*. **Pick paints without a ship** adds every paint-only pledge whose paints fit no ship you own. A paint that fits several ships you own keeps one copy per ship (not a duplicate until you have more paints than hulls); the summary flags paints that would go *short*.
- Hangar: identical pledges **stack** into one row (toggle) with a Qty column, per-copy total, date range, and every hangar entry listed with its own link + pick box; stack box picks all copies.
- Fix: buttons no longer wrap mid-label ("Plan CCU") in narrow table cells.
- Hangar rows list the items inside each pledge (first 4, expand per pledge or "Show all items in every pledge").
- **Melt calculator** (Hangar): tick pledges → store credit, items lost for good vs still owned elsewhere; **Pick duplicates** selects the highest-value pledges you can melt without losing any item or LTI hull; **Plan for target** reaches a credit amount losing the fewest unique items; a *Would lose* column shows each pledge's cost on top of your picks. $0 pledges can't be picked.
- Items: **Paints by ship** view — every paint grouped under its ship, ✓ owned hulls or *no ship owned* (+ Plan CCU / Compare for the cheapest hull), filters All / Ship owned / Not owned / Unknown, optional owned ships with no paints. Paints with no ship in the name match the ships in the same pack.
- Items: **Group: event / collection** — known events (Luminalia, IAE, Invictus, …) and shared name prefixes (RSI Disc., AA…).
- Items QoL: sub-view tabs, foldable groups + expand/collapse all, group headers show ownership + counts, CSV export, reset filters, My ships → paints link, unmatched ships listed, view prefs remembered.
- **Incognito**: split mode — incognito uses its own RSI login for friends, party mode, hangar and polling; account data (reads, watches, feed, friends, hangar, buyback, party) is kept separate from the regular window; settings, mutes, catalog and wishlist are shared. Hub and popup show an *incognito* tag.
- **Items & ships** tab: every item of every pledge, merged + categorized (ships, paints, armor, weapons, FPS gear, components, decorations, hangars, games…), grouped by category / ship family / pledge; paints linked to the ships they fit (family-wide paints too); filters incl. *paints for ships I don't own*, duplicates, giftable; *My ships* with copies, LTI and owned paints; side-by-side ship compare (+ any store ship).
- **Party mode**: auto-accepts incoming friend requests every minute (1–8 h or until stopped), flags them *party*, log at the top of Friends, feed + notification; quick toggle in the popup.
- Sortable columns (click header, again to flip; empties last; `src/lib/sort.ts` + `SortTh.svelte`) on Hangar, Buyback, Store (+ discount column), Friends, Watching; replaces the sort dropdowns.
- Fix: hangar / buyback results now persist after every page (plain JSON copy, `unlimitedStorage`) — a refresh, error or Stop keeps what was read; "Resume from page N" continues.
- **RSI+**: rebrand; whole RSI site. Hangar explorer (melt totals, filters, CSV/JSON), buyback list, store catalog with warbond/standalone prices, wishlist alerts, CCU chain planner, RSI+ bar on store/account pages.
- Friend requests: always-visible section, accept-as-party, accept-all, confirm decline-all, new-request notifications; requests merged from v2 + identify.
- Fix: friends list read from `/v2/relationship/*` (identify's `friends` was empty) → Friends / Added / Party now populate. Writes v2 first, v1 fallback.
- Fix: unfriend + re-add starts a fresh "added" time and clears the party flag; party reminder works for friends added before Spectrum+ (uses mark time).
- Hub shows the friend-list source and fetch warnings.
- Fix: Friends panel crashed (Svelte `each_key_duplicate`) for friends with 2+ redacted orgs; orgs, friends and requests are now deduped.

## 0.1.0 — 2026-10-09
Initial version.
- Read tracking: +N new badges, dim/hide read, jump to first new, mark read/unread, mark channel page read.
- Mutes: authors / keywords (regex) / labels, dim or hide (payload-level), collapse muted replies, bump muting.
- Watch + notify: threads, channels (dev / authors / all), authors, friends online; feed hub, notifications, badge.
- Friends manager: filters, sort, tags + notes, bulk tag/unfriend, requests accept/decline all, CSV.
- Friends' orgs: main org from badges, all orgs + rank from RSI citizen pages, group/filter by org.
- Friend added time (tracked locally) + party flag, "added since" filter, party cleanup reminder.
- UI: theme, wide, compact, dev highlight, keyboard shortcuts.
- Verified live: anonymous API calls (identify, channel list, channel threads, thread nested), citizen org page markup.
