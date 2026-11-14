---
title: CCU planner — My chains (one list)
tags: [spec, ccu]
status: done
updated: 2026-11-14
---
# CCU planner — My chains (saved chains and the fleet plan become one list)

## Problem
The planner had two lists for the same thing. *Saved chains* held frozen snapshots of single chains; the *Fleet plan* held live goals planned together. *Save plan* copied goals into saved chains and *Add to fleet plan* copied the other way, so one ship could sit in both and drift. Two chains that wanted the same owned CCU were settled by save order in one list and by explicit priority in the other. Cart, export, *Already spent* and Feed alerts existed only on saved chains; priority, auto source and LTI choice only on the fleet plan.

## Design
One stored list, `local:ccuChains` (`SavedChain[]`), shown as **My chains**. The order of the list is the priority.

- **A chain is a goal plus its last plan.** `SavedChain` gains `auto` (the planner picks the source hull), `storeStart` and `lti`. `chainGoal(c)` turns it into a `Goal` carrying the chain's own options (`Goal.opt`).
- **Planned together.** `planChains(ships, owned, chains, fleetOptions)` calls `planFleet`: top first, an earlier chain reserves its CCU refs and hull copy. A goal with `opt` plans with those options (objective, warbond, buyback, forced CCUs, stops); the graph cache key covers every option that changes the graph.
- **Always today's price.** There is no saved snapshot to compare with. `steps` / `total` / `cash` / `startId` on a chain are the last plan, written back by `withPlans` whenever the plan changes (only once the catalog, the saved list and the hangar are loaded). The Feed (`chainEvents`), the Pledges badge and the CCUs page read those without planning. A chain with no chain today keeps no steps, so it holds no CCU back.
- **The planner above is the editor of one chain.** *Open* on a row loads it with its own options and the exclusions of the chains above it (`openedLeg` with `chainId`). *Update chain* writes the options back to that chain in place; *Save as new* / *Save chain* append at the end. A saved chain stores your own options only, never the CCUs other chains hold.
- **One table.** Priority (up / down), name and route, *Already spent*, to pay now / later, saved vs MSRP, and per row: settings (source Auto / My ship / Store, stops, insurance, may start from the store, name), copy code, *Open*, *Delete*. Ticks drive both *Add to RSI cart* and export. Totals, the *waiting for a sale* table and the auto rules (never upgrade / upgrade first) sit with the list.
- *Leave my chains' CCUs alone* (was *Exclude saved chains*) still decides whether a new route in the planner may use CCUs the list holds.

## Conversion (once per account, when the planner page opens)
`ccuGoalsItem.merged` marks it done.
1. `mergeGoals`: each old fleet goal that *Save plan* already saved (same target, same source or an auto goal) marks that chain `auto` / `lti` / `storeStart` instead of adding a second one. The other goals are appended in their order.
2. `dropBakedExcludes`: old saves kept the CCUs other chains held in their own `opt.exclude`; those go, a CCU forced out by hand stays.
3. Existing saved chains keep their id, name, order, route and options. *Never auto-upgrade* and *Prefer to upgrade* stay in `local:ccuGoals`.

## Out of scope
Drag and drop reordering; a marker for "this chain changed since you last looked"; per-chain option editing in the row (use *Open* → *Update chain*).
