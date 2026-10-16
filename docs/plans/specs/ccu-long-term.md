---
title: CCU planner — long-term goals
tags: [spec, ccu]
status: done
updated: 2026-10-16
---
# CCU planner — long-term goals (plan ahead)

## Problem
The planner only used CCUs on sale today, so a target hull nobody sells a CCU to right now (most of the catalog: 152 of 241 hulls had no standalone sale on 2026-10-16; CCU targets are ~53) gave "No chain found". Players plan across event sales (IAE in November, Invictus in May, manufacturer showcases): buy the legs that are cheap now, wait for the rest.

## Decisions
- **`planAhead` option** (off by default, `PlanOptions.planAhead`): for every hull with no usable CCU SKU today the graph gets a `future` edge priced at MSRP (`cost = msrp(B) − msrp(A)`, store credit unless off, no SKU). Warbond-at-event prices are not guessed — no price history exists yet; MSRP is the floor RSI always sells a standard CCU at.
- **Ranking**: `future` steps rank after anything buyable today at the same price (`waits` is a tie-break before step count in every objective), so Plan ahead never makes a currently-buyable chain worse.
- **Plan** gains `waits` (count) and `later` (cents) → the panel shows *to pay now* = `total − later` plus a *later* tile; `future` rows carry a *Later · wait for a sale* badge, the hull's last-seen-on-sale date, a Store link, no cart button; *Verify* marks them *waits for a sale* (counted as confirmed so the guided flow can advance); the guided flow's cart / pay steps exclude them.
- **Saved chain = goal**: `chainEvents(chains, ships, now)` in the background's catalog refresh emits a `store` feed event (`hub.html#ccu`, key `ccu:<chain>:<from>><to>:<sku>`) when a waited-for hull gets any in-stock CCU SKU priced above the source hull; the feed's key dedup keeps it to one alert per SKU appearance. Saved chains show *N waiting* and *on sale now — N waiting steps buyable* when re-pricing finds fewer waits.
- **Sale history** (`local:saleHistory`, `recordSales` / `lastSale` in store.ts): every catalog refresh stamps `ccu` / `standalone` timestamps per ship id. RSI publishes no sale calendar, so this starts empty at install and only says "last on sale <date>"; UI copy says so.
- **Ship catalog page** (was "Ships for sale"): already listed every hull; renamed, header counts hulls vs on sale, filters *Not on sale now (N)* and *Concept ships*, "not on sale · last <date>" per row, *Plan CCU* on a not-on-sale hull opens the planner with Plan ahead on (`#ccu?to=<id>&ahead=1`).

## Out of scope / later
- Price history → speculative warbond prices for future steps (CCU Game "speculative" mode).
- A sale calendar (IAE / Invictus manufacturer days) to say *when* a hull likely returns — the history store is the data this would grow from.
- Standalone "buy when it returns" starts for the store-start mode (future edges are CCU-only).

## Verification
- tests/ccu.test.ts `plan ahead (long-term goals)`: off by default; routes through a future MSRP step and counts `waits` / `later`; prefers today's CCU at equal price; store credit off → new money; `chainEvents` once per SKU, silent when sold out; `recordSales` / `lastSale`.
- Live: pick a hull with no CCU on sale, confirm the chain, save it, wait for a sale alert (todo).
