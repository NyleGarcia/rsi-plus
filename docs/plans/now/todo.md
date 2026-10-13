---
title: Now
tags: [plans]
updated: 2026-10-09
---
# Now
- [ ] Live-verify thread-list row detection + badges on a channel page (logged in)
- [ ] Live-verify reply selectors (`.forum-thread-member-info`, `.nickname-separator`, `.body-content-blocks`) + Mute / Watch author buttons
- [ ] Live-verify which thread endpoints the app calls (v1 `/forum/thread/nested` vs v2 `/v2/forum/thread/get`) — `__spectrumplus.paths()` in the page console
- [ ] Live-verify friend writes: `/friend/remove`, `/friend-request/accept|decline|cancel` (one friend first)
- [ ] Live-verify wide / compact CSS selectors
- [ ] Live-verify hangar loading from the hub page (session cookies on extension-page fetch; fallback = run the loader in an RSI tab via the content script)
- [ ] Live-verify hangar parser on a real hangar (types, LTI, giftable, upgrade JSON ids vs store ids)
- [ ] Live-verify buyback markup (`article.pledge`?) and buyback CCU data-* attributes
- [ ] Live-verify store ship page match (catalog `link` vs page path) for the RSI+ bar
- [ ] Live-verify v2 friend-request list shape + accept/decline endpoints
- [ ] Live-verify item kinds on a real hangar (paint/armor/weapon categories, family matching) and party-mode auto-accept
- [ ] Live-verify incognito split mode: incognito background uses the incognito cookie jar (Friends shows the incognito account), `incognito.*` keys separate, popup/hub tagged
- [ ] Live-verify hangar ↔ store paint title match (`paintKey`) on real hangar paint names; hangar page links land on the right page
- [ ] Live-verify melt duplicate plan against a real hangar (item kinds `Ship`/`Vehicle` for LTI keys)
- [ ] Live-verify `?rsiplus=<id>&rsiplus_do=melt` on the hangar page: row found via `input.js-pledge-id`, `.js-reclaim` click opens RSI's melt modal (and `.js-gift` / `.js-gift-v2` for gift)
- [ ] Live-verify insurance item titles ("120 Month Insurance" vs "10 Year") on a real hangar
- [ ] Live-verify Wallet funding chart across Days / Weeks / Months (key formats `YYYY-MM-DD` / `YYYY-WW` / `YYYY-MM`) and that `fans` is present on every range
- [ ] Live-verify account switcher: cookie names captured (`Rsi-Token`, `Rsi-Account-Auth`, `_rsi_device`, `Rsi-XSRF`), switch lands logged in without 2FA, incognito list separate
- [ ] Live-verify CCU planner v2 on a real hangar: gifted detection (melt value 0), store-start chains, saved-chain re-pricing, `Pledge.value` as paid price for owned CCUs
- [ ] Live-verify Wallet fleet/CCU portfolio matching on real pledge ship titles (single-ship pledges, LTI suffixes)
- [ ] **Live-verify Add to RSI cart** (add, check cart, remove — no checkout): CCU step lands at the planned price from the right ship; standalone ship via `/graphql` + csrf; buy-back step (`pledgeId` + target standard SKU) is the buy-back line; signed-out → 'Sign in to RSI'; refusal with a pending order → 'Cart busy'
