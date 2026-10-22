---
title: "Spec: facets, labels and the sidebar"
tags: [spec, ui, store, hangar]
updated: 2026-10-22
status: active
---
# Facets, labels and the sidebar

## Why
Every list page had its own 2–3 filters and its own words. Users asked for the facet sets other hangar tools have (place, insurance, stage, size, time-limited, giftable, gifted, meltable, package shape, saving, maker, price ranges) and for RSI's store ribbons (Limited Time, New, Best Value, Bonus …) to show on items.

## Data (done)
- Catalog ships: `size` (Vehicle / Snub / Small / Medium / Large / Capital) from the upgrade API; `flyable` already carried the stage (`stageOf`).
- Store listings: `tags` = RSI's ribbons (`Limited Time`, `New`, `Best Value`, `Bonus Paints|Gear|Items`, `FITS <hull>`), `stockLevel` (`high` normally). Helpers in `lib/store.ts`: `isLimitedTime`, `isNewListing`, `isBestValue`, `bonusOf`, `fitsOf`, `isLowStock`, `isLimitedSku`.
- Not available anywhere on RSI: loaners. Dropped.
- Gifted = a hangar pledge with no melt value (`value === 0`) that is not a $0 flair (RSI shows no gift marker; `OwnedCcu.gifted` already uses this).

## Engine (done)
`lib/facets.ts`: `Facet<T>` (options with predicates, single / multiple), `RangeFacet<T>` (min–max), `applyFacets`, `facetCounts` (per option, with every other facet applied), `toggleFacet`, `clearFacets`, option builders `INSURANCE_OPTIONS`, `STAGE_OPTIONS`, `SIZE_OPTIONS`, `yesNo`. `FacetBar.svelte` renders a page's facets as chip rows with live counts (`LTI · 12`), ranges as min–max fields, "More filters (n active)" fold for non-`primary` facets, "n of m" and Reset. Pages keep `values: FacetValues` in `$state`, persist them in their existing prefs key, and derive `shown = applyFacets(rows, facets, values, ranges)` plus search / sort as before.

## Labels (`Tag` kinds)
`limited` (RSI "Limited Time", destructive), `new` (info), `bestvalue` (success), `bonus` (value = RSI's text), `fits` (value = hull), `lowstock` (warning), `stage` (value = `flyable`: Concept / Flight ready / In production), `size` (value), `discount` (value = `−n%`), `gifted`, `giftable`, `meltable`, `upgraded`, `game`; plus the existing warbond / standard / insurance / owned / concierge / subscribers / oos / ship / sale. Shown on: Browse rows + tiles, Ship catalog rows (stage, size, limited CCU), Store changes tiles, Paints by ship store rows, Pledges rows (gifted / giftable / game / upgraded as tags, not icons), My ships rows (stage, size), My CCUs rows.

## Sidebar (done)
Spectrum · **Hangar** (Pledges, Ships, CCUs *new*, Items, Paints by ship, Buyback, Wallet) · **Store** (Ship catalog, Browse, Store changes) · **Plan** (CCU planner, Paint rebuy, Melt calculator). Popup grid: Feed, Friends, Pledges, Ships, CCUs, Wallet, Catalog, Changes, Planner.

## Facets per page
| Page | Facets (single unless noted) | Ranges | Primary |
|---|---|---|---|
| **Pledges** | Type (multiple, counts) · Insurance (LTI / 120 / <120 / none) · Warbond · Giftable · Gifted · Meltable (meltable / not / $0 value) · Package (with ships / without / with CCU / multiple items / single) · In store (contents sold today / not) · Stage (of the hulls inside) · Game package · Upgraded · Labels (yours) | Melt value $ | Type, Insurance, Warbond, Giftable |
| **Ships** (My ships) | Insurance · Stage · Size · Had as (pledged / in-game / both) · Paints (has paints / none) · Maker | MSRP $ | Insurance, Stage, Size |
| **CCUs** (new) | Place (hangar / buyback) · Saving (saves vs MSRP gap / no saving / negative) · Warbond · Insurance · Stage of target · Giftable · Gifted · Meltable · Source maker · Target maker · In a saved chain (yes / no) | Target MSRP $, Paid $, Saving $ | Place, Saving, Warbond |
| **Ship catalog** | Sale (existing segmented: on sale / not / all) · Offer (warbond CCU / standard CCU / limited CCU / standalone) · Stage · Size · Owned · Wishlist · Maker (existing select) | MSRP $ | Offer, Stage, Size |
| **Browse** | Category tabs (existing) · Audience (existing) · Edition · Special (multiple: Discounted / Limited time / New / Best value / Bonus / Concierge / Subscribers / Low stock) · Hangar (existing 6) · Stock (in stock / out) · Bundles | Price $ | Special, Edition, Hangar |

Group-by: Pledges gets `Group: identical pledges / none` (today's *Stack identical*); CCUs gets `Group: by upgrade / none`.

## Pages
- **CCUs page** (`CcusPanel.svelte`, `#ccus`): rows = `OwnedCcu` from `ownedCcus()` (hangar + buyback) joined with catalog: From → To (names, makers, thumbs), paid (hangar melt value; buyback price when detailed), target MSRP, source MSRP, gap = target − source MSRP, saving = gap − paid (negative = you paid over the gap), place, flags (warbond, insurance from the pledge, giftable, gifted, meltable), stage/size of target, used by a saved chain (SavedChain steps). Actions: open in hangar / buyback, *Plan from this* (CCU planner `#ccu?from=&to=`), exclude from planner. Totals row: count, paid, gap, saving. CSV export.
- Search stays a plain Input in every FacetBar's first row; sort stays `SortTh`.

## Out of scope
Loaners; RSI's "Time Limited" for standalone *ships* (the catalog API has no ribbon; Browse's standalone-ships category carries it, so the catalog row shows `limited` only when the standalone listing by the same name has the tag).
