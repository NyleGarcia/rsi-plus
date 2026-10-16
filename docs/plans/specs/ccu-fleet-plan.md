---
title: CCU planner — fleet plan (several goals)
tags: [spec, ccu]
status: done
updated: 2026-10-16
---
# CCU planner — fleet plan (multi-chain, multi-ship)

## Problem
The planner made one chain at a time. Long-term planning means several ships at once — an M80 this sale, a Perseus over the next events — and the chains compete for the same owned CCUs and hulls. Planned one by one, two chains could both count on the same CCU or upgrade the same pledge.

## Decisions
- **Goal** = target + source (`fromId`: a hull, `STORE_START`, or `null` = auto) + stops (`via`). Goals are an ordered list; order = priority.
- `planFleet(ships, owned, goals, opt, { hulls, keep, storeStart })` plans goals in order. Owned and buyback CCUs used by an earlier goal are excluded from later ones. Each owned hull copy (`ownedHulls`: one per pledge listing it) starts at most one chain, and fixed-source goals claim theirs first.
- **Auto source** tries every free hull copy cheaper than the target, minus `keep` (ships to keep flying), plus the store when `storeStart` is on. It keeps the plan with the highest savings vs MSRP, then the least to pay now, then the fewest waits. Preferring the least to pay would always upgrade the most expensive ship you own.
- **Stops** (`PlanOptions.via`) also work in the single planner. They and forced CCUs are visited in MSRP order. A stop that is not between the source and the target → no chain.
- Totals across the plan: pay now / later / new money / already paid / saved, plus the list of CCUs still waiting for a sale.
- **Save plan** stores one `SavedChain` per goal with `group` = the plan name; saving again under that name replaces the group's chains. Saved chains already get feed alerts (`chainEvents`) and reserve their CCUs.
- Verify with RSI and add-to-cart stay in the single planner: each goal has **Open**, which loads it there with the same options and stops.
- Goals persist in `local:ccuGoals` (per account, in `ACCOUNT_ITEMS`).

## Not done
- A global optimum over goal order (all permutations × auto sources is too slow for a live UI). The user reorders instead.
- Per-goal forced CCUs.
