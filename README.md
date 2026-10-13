# RSI+

Chrome/Firefox MV3 extension for the whole [Roberts Space Industries](https://robertsspaceindustries.com) site — Spectrum, hangar, buyback and the pledge store. Sibling of Crunchy+ (same stack: WXT + Svelte 5 + TS). Ideas from [Hangar XPLORer](https://github.com/dolkensp/HangarXPLOR) (MIT) and [CCU Game](https://ccugame.app); no data is sent anywhere but RSI.

## RSI site
- **Hangar** (hub) — loads every hangar page: melt value totals, counts by type, ships / CCUs / LTI / giftable, search + filters (LTI, warbond, giftable, meltable, upgraded, game package), CSV / JSON export. Stays in your browser.
- **Buyback** (hub) — every buyback page, search, type filter, buy-back links; buyback CCUs feed the planner.
- **Store** (hub) — live ship catalog from the pledge store: MSRP, CCU SKUs (standard / warbond / limited + stock), standalone sales, biggest discounts; ★ wishlist.
- **Wishlist alerts** — store checked every 30 min; a warbond CCU or lower price on a wished ship → feed + desktop notification.
- **CCU planner** (hub) — cheapest upgrade chain from a ship (yours or any) to a target using CCUs on sale now + CCUs already in your hangar (free steps) + optional buyback CCUs; shows total, new-money (warbond) part, savings vs MSRP.
- **RSI+ bar** on store ship pages (MSRP, warbond price, wishlist, Plan CCU) and on hangar / buyback / ship-upgrade pages (open the full views).

## Spectrum

- **Read tracking** — "+N new" badges on thread rows, read threads dimmed (or hidden), "+N new since last visit → Jump to first new" on thread pages, mark read/unread, mark a whole channel page read.
- **Mutes** — authors (handle), subject keywords (`/regex/` ok), labels. Threads dimmed or removed from lists before Spectrum renders them; muted authors' replies collapse. One-click **Mute** on any reply (with Undo).
- **Watch + notify** — ☆ on any thread row, watch channels (dev threads/replies, watched authors, or all new threads), watch authors, friends-online bells. Background poll (default 5 min) → desktop notifications + **Feed** in the hub, unseen count on the toolbar icon.
- **Friend requests** — always-visible list: accept / decline / cancel, accept all, *accept as party*, notification when a new request arrives.
- **Friends manager** (hub → Friends) — search/filter/sort, status + activity + last seen, **orgs** (main org free from badges; *Load all orgs* reads each friend's public RSI citizen page incl. affiliations and rank, cached 24 h), group by org, tags + notes, bulk tag / unfriend (two-click confirm), accept/decline all requests, CSV export.
- **When a friend was added + party cleanup** — Spectrum doesn't store a friendship date, so Spectrum+ records it: first snapshot = baseline ("before Spectrum+"), anyone added later is timestamped (within one poll). Filter "Added: last hour / 6 h / 24 h / 7 days", flag people as **party**, get a reminder after N hours (default 12), filter *Party friends* → select all → Unfriend.
- **UI** — modern theme, full-width threads, compact replies, dev-post highlight, keyboard nav (`j/k` move, `o` open, `w` watch, `m/u` read/unread, `n` first new, `?` help).

## Setup
```sh
npm install
npm run dev          # Chrome with the extension + HMR
npm run build        # .output/chrome-mv3 → chrome://extensions → Load unpacked
npm test             # vitest
npm run check        # svelte-check / tsc
```
Log in on robertsspaceindustries.com in the same browser profile — the extension uses your session (`Rsi-Token` cookie). Public reads (threads, channels) also work logged out.

Docs: [docs/README.md](docs/README.md) · [architecture](docs/architecture.md) · [changelog](docs/changelog.md).
