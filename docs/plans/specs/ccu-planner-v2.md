---
title: CCU planner v2
tags: [spec, ccu]
status: done
updated: 2026-10-12
---
# CCU planner v2 — CCU Game parity

Reference: ccugame.app "Create Chain" (Angular app, snapshot 2026-10-12). Goal: same decisions available in the RSI+ hub, on data RSI+ already holds (catalog, hangar, buyback, store credit). No account, no server.

## In scope
| CCU Game | RSI+ | Notes |
|---|---|---|
| Optimization target: current savings / lowest new money / long-term savings | `PlanOptions.objective = 'spend' \| 'cash' \| 'longterm'` | `spend`: owned CCUs free (v1 behaviour). `cash`: minimise new money first (warbond + anything store credit can't cover), then spend. `longterm`: owned CCUs cost what you paid (melt value) — "would I buy this chain today". Ties → fewer steps. |
| Source ship: auto from store / hangar / any | source mode `store` (`startId = STORE_START = 0`) adds a virtual start with one `standalone` edge per ship with a standalone SKU on sale | Baseline for savings then = target MSRP (buying it outright). |
| Include buyback | `buyback` (v1) | cost ≈ msrp diff, credit-payable |
| Disable warbonds | `warbond` (v1) | |
| Don't use store credits | `storeCredit` | off → every step is new money (`cash === total`) |
| Exclude gifted CCUs | `excludeGifted` | hangar CCU with melt value 0 = gifted (`OwnedCcu.gifted`) |
| Force include / exclude CCUs | `include[]` / `exclude[]` pledge refs | include: chain is routed through each forced CCU in MSRP order (segments); exclude: edge dropped |
| Exclude saved chains | UI option → refs used by saved chains merged into `exclude` | |
| Saved chains | `local:ccuChains` (per account, parked with profiles) | name, start/target, steps, totals, options. Panel re-prices on load and flags drift. |
| CCU Overview | "Your CCUs" table in the panel | from→to, source, value, reserved-by, force toggle |

## Out of scope (later)
- Speculative prices / "maintain buy prices" — needs a price-history store; none in RSI+ yet. → `plans/later/ideas.md`.
- "Include unreachable CCUs" — every owned CCU is already an edge; reachability falls out of the search.
- Alternatives (top-N chains). Dijkstra returns one; k-shortest later if wanted.

## Data
- Store credit: `hangarItem.credits.usd` (USD, from /account/billing). Shown as "credit covers … / cash needed …"; not an input to the search (credit amount doesn't change which chain is cheapest, only how it's paid).
- Owned CCU value: `Pledge.value` USD → cents. Buyback items have no value on the list page → 0, `gifted: false`.

## Done when
- `tests/ccu.test.ts` covers: each objective, store start, exclude/include, gifted filter, reserved refs.
- Panel: settings card, result table with running totals + links, Your CCUs table, Saved chains card.
- `docs/architecture.md` CCU section + changelog updated.
