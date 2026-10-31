# Chrome Web Store listing — RSI+

Copy-paste source for the developer dashboard (same layout as Crunchy+). Assets in this folder; raw screenshots go in
`store/raw/` (git-ignored) and `store/frame.sh store/raw/*.png` fits them to 1280×800 into `store/screenshots/`.

> **Metadata rule (rejection 2026-10-15, "Keyword Spam", ref Yellow Argon):** no third-party product names anywhere in the
> dashboard fields — the reviewer flagged "FleetYards, myfleet.gg and Starjump" in the description. Name only RSI, Star Citizen,
> Spectrum and RSI+'s own features; describe other tools generically ("other fleet-viewer tools"). In-app text is not metadata.

## Store listing

**Title (from package):** RSI+
**Summary (from package, 132 chars max):** RSI, better: Spectrum read tracking, mutes, watches, friends, hangar & buyback explorer, store prices, wishlist alerts, CCU planner.
**Category:** Entertainment (alternative: Productivity)
**Language:** English

**Description:**

```
RSI+ adds the tools the Roberts Space Industries site is missing — for your hangar, the pledge store and Spectrum — in one hub page plus small touches on the site itself. Everything runs in your browser against your own RSI login; there is no RSI+ server or account.

HANGAR, BUYBACK & STORE
• Hangar explorer: every pledge on one page — melt value totals, counts by type, LTI / warbond / giftable / meltable filters, group by ship, hide event sets (IAE, Luminalia, subscriber flair…), CSV / JSON export and a fleet file in the format other hangar and fleet-viewer tools import.
• Melt calculator: tick pledges and see the credit you would get and what you would lose for good, with duplicate and orphan-paint pickers.
• Buyback explorer: everything you ever melted, searchable, with buy-back links and today's store price next to it.
• Store catalog: MSRP, CCU SKUs (standard / warbond / limited with stock), standalone sales and the biggest discounts, refreshed from the pledge store. Star ships for a wishlist and get a notification when a warbond CCU or a lower price shows up.
• CCU planner: the cheapest upgrade chain from a ship you own (or the cheapest starter) to the ship you want, using CCUs on sale now, CCUs already in your hangar and optional buyback CCUs. Shows the total, new money vs store credit, savings under MSRP, verifies each step with RSI and can put the chain in your RSI cart.
• Paint rebuy: RSI's multi-paint discount (2 paints → 15 % … 10+ → 35 %) applied to paints you already own — melt the ones the store sells today, buy them back bundled, keep the difference as credit. A guided flow confirms the cart with RSI before anything is melted, then a checklist to melt from.
• Wallet: store credit, UEC and REC, spend over time, fleet at today's prices, CCU portfolio, your Chairman's Club level and % to the next one, and Star Citizen's public funding figures.
• Browse the store: paints, packs, game packages, gear, add-ons, standalone ships and the Subscribers Store, by category and by audience (everyone / Concierge / subscribers), sortable by price and discount, flagged when already in your hangar.
• My ships and Paints by ship: your fleet, the paints you own per hull and the ones the store has, side-by-side compare.
• Screenshare mode: one click hides your spend, melt values, store credit, buyback prices and account names while you stream.
• Account switcher: save more than one RSI login and swap between them.

SPECTRUM
• Read tracking: "+N new" badges on thread rows, read threads dimmed or hidden, jump to the first new reply.
• Mutes: authors, subject keywords (regex ok) and labels, applied before Spectrum renders the list.
• Watches + notifications: star any thread, watch channels, authors or subject keywords (regex ok), friends-online bells; a background check (every 5 minutes by default) feeds the hub and desktop notifications.
• Friends manager: search, filter and sort, status and last seen, organisations, friend requests (accept / decline / cancel, accept all, party mode that auto-accepts for two hours), and when each friend was added.
• Cleaner UI: full-width threads, compact replies, dev-post highlight, keyboard navigation (j / k, o, w, m / u, n, ?).

ON THE SITE
• An RSI+ bar on store ship pages (MSRP, warbond price, wishlist, Plan CCU) and on hangar / buyback / upgrade pages that opens the matching hub view.

PRIVACY
RSI+ talks only to robertsspaceindustries.com, and to an org fleet site if you connect it. Optional: connect an org fleet site to send your RSI handle and ship list (each ship's model and maker, the name you gave it, LTI / warbond / insurance, pledge id and pledge name; pledge values only if you turn that on). Off until you press Connect; nothing else from RSI is ever sent. Settings shows every field sent and can preview the exact list. Your data stays in your browser's extension storage; nothing is sold, shared or tracked, and nothing is bought or melted without you clicking RSI's own button. Full policy: https://github.com/NyleGarcia/rsi-plus/blob/main/PRIVACY.md

Open source: https://github.com/NyleGarcia/rsi-plus

DISCLAIMER
RSI+ is an unofficial Star Citizen fan tool, made by the community. It is not affiliated with, endorsed by or sponsored by Cloud Imperium Games, Roberts Space Industries or any company of the Cloud Imperium group. Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC; all game content, names and images belong to their owners. Store prices and listings are read from the official RSI pledge store and can lag behind it or differ; RSI+ is not a store, sells nothing and takes no payment — every purchase happens on robertsspaceindustries.com under RSI's own terms.
```

**Graphic assets**
- Store icon 128×128: `store/icon-128.png`
- Screenshots (1–5, 1280×800, no alpha): generated by `store/shoot.py` (headless Chromium + the built extension + a demo hangar, no real account) into `store/screenshots/`. Upload, in order: `hangar.png`, `paint-rebuy.png`, `ccu-planner.png`, `wallet.png`, `store.png` (spares: `melt-calculator.png`, `hangar-by-ship.png`, `buyback.png`, `ships.png`). `store/frame.sh` still fits hand-taken captures from `store/raw/`.
- Small promo tile 440×280: `store/promo-440x280.png` (source `promo-small.svg`)
- Marquee promo tile 1400×560: `store/promo-1400x560.png` (source `promo-marquee.svg`)
- Promo video: none

**Additional fields**
- Official URL: none
- Homepage URL: https://github.com/NyleGarcia/rsi-plus
- Support URL: https://github.com/NyleGarcia/rsi-plus/issues
- Mature content: No

## Privacy tab

**Single purpose description:**
```
RSI+ improves the Roberts Space Industries website for its users: Spectrum read tracking, mutes, watches and notifications, a friends manager, and explorers for the hangar, buyback and pledge store with a CCU upgrade planner and paint-rebuy planner. All features act on the user's own RSI account and only talk to robertsspaceindustries.com, except an optional, off-by-default sync that sends the user's own ship list to StarOrg Tools (starorg.tools), an org fleet manager, after the user connects it.
```

> The description above names the org fleet site generically (metadata rule); the privacy fields below name
> `starorg.tools`, because a host-permission justification has to say which host and why.

**Permission justifications:**
- `storage` — settings, read marks, mutes, watches, friends snapshots, cached hangar / buyback / catalog pages, CCU chains and paint plans, kept in the browser's extension storage.
- `unlimitedStorage` — large hangars and buyback lists plus per-thread read marks can exceed the 10 MB default quota of storage.local.
- `alarms` — the periodic background check (default every 5 minutes) for watched threads, channels, authors, friend requests and wishlist prices.
- `notifications` — desktop notifications for new replies in watched threads, new friend requests, friends coming online and wishlist price drops, each one switchable off.
- `cookies` — reads the user's own `Rsi-Token` session cookie for robertsspaceindustries.com so the background check can call Spectrum's API the way the site does, without keeping a tab open; the optional account switcher saves and restores the user's own RSI cookies to swap between their accounts.
- `offscreen` — a service worker cannot play audio or parse HTML; the optional party-mode "ding" plays in an offscreen document, and the optional StarOrg Tools *Auto-sync* reads the user's own hangar pages there once a week.
- Host permission `https://robertsspaceindustries.com/*` — the only site the extension works on and talks to: content scripts on Spectrum, hangar, buyback and store pages, and API / page requests for the features above.
- `incognito: split` — an incognito window gets its own background (own cookie jar), so an incognito RSI login is kept separate from the normal one.
- `identity` — `launchWebAuthFlow` for the optional StarOrg Tools sign-in (the user presses Connect in Settings → Integrations; StarOrg's own Discord sign-in, PKCE). Unused until then.
- Optional host permissions `https://starorg.tools/*` and `https://dev.starorg.tools/*` (StarOrg Tools production and its dev site, chosen by the user) — only the chosen one is requested, only when the user has turned the StarOrg Tools integration on in Settings and presses Connect, given back if the sign-in is cancelled or fails, removed on Disconnect (kept while an incognito window is still connected, since host permissions are shared). Used to sign in and to send the user's own RSI handle and ship list (per ship: model and maker, the name the user gave that ship, LTI / warbond / insurance, pledge id and title, whether pledged or in-game; pledge values only if the user turns that on — every field is listed in the privacy policy and in the extension, which can preview the exact payload) with *Send hangar now* or the user's *Auto-sync* switch (after each full hangar load, and weekly if the re-read ship list changed since the last successful send).

**Remote code:** No, I am not using remote code.

**Data usage — what the extension collects (ticked):**
- Personally identifiable information — the user's RSI handle / display name and their friends' handles (shown in the extension; stored locally). With the optional StarOrg Tools sync connected, the user's own RSI handle is sent to starorg.tools with the ship list.
- Authentication information — the RSI session cookie, read locally and only sent back to robertsspaceindustries.com; saved logins stored locally only if the user uses the account switcher; the StarOrg Tools sign-in token (optional sync), stored locally and sent only to the StarOrg Tools site that issued it.
- Website content — Spectrum threads and replies, hangar / buyback / store pages the extension reads to build its views. With the optional sync connected, the ship list read from the user's hangar pages is sent to starorg.tools.
- Financial and payment information — ticked only for the optional sync's *Send pledge values* switch (off by default): each pledge's value from the user's own hangar is then sent to starorg.tools (on Firefox the switch asks for the optional `financialAndPaymentInfo` data-collection category, declared in the manifest). Otherwise store credit and pledge values are read from the user's own RSI pages and kept locally; no payment details are touched.
- Not collected: health, personal communications, location, web history, user activity.

**Certifications (all three):** I do not sell or transfer user data to third parties outside the approved use cases · I do not use or transfer user data for purposes unrelated to my item's single purpose · I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/NyleGarcia/rsi-plus/blob/main/PRIVACY.md

## Distribution
- Visibility: Public (or Unlisted while testing)
- Regions: all
- Pricing: free

## Test instructions (for the reviewer)
```
RSI+ works on robertsspaceindustries.com with the reviewer's own RSI account (free to create at https://robertsspaceindustries.com/enlist). Log in on robertsspaceindustries.com in the same browser profile first.

Without logging in: open the extension popup → Store (public ship catalog, prices, discounts) and Settings (theme, screenshare mode) work; Spectrum thread lists still get the RSI+ UI.
Logged in: popup → Hangar → Load hangar reads the account's pledges; Buyback, Wallet, CCU planner and Paint rebuy build on that. Spectrum (https://robertsspaceindustries.com/spectrum/community/SC) shows read badges, Mute / Watch buttons on rows, and the Friends tab lists friends and requests.
Nothing is purchased or melted by the extension: "Add to cart" only fills the RSI cart; melting opens RSI's own confirmation dialog.
```
