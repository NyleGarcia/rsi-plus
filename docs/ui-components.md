---
title: UI components and page conventions
tags: [ui, shadcn, conventions]
updated: 2026-10-22
---
# UI components and page conventions

Hub and popup pages are shadcn-svelte (`src/components/ui/`, see [architecture](architecture.md) → Hub styling) plus the shared pieces below. The rule: **if a shared piece exists, use it** — a page never re-implements a chip, a tooltip, a cart button or an empty state.

## Rules
- **Buttons**: always `Button` (variants `default | outline | secondary | ghost | destructive | link`, sizes `xs | sm | default | lg | icon-xs | icon-sm | icon`). No raw `<button>`. A link-looking action is `Button variant="link" size="xs" class="h-auto p-0"`. Icon-only buttons carry `aria-label`.
- **Hints**: anything explanatory, multi-line or on a focusable control is a Tooltip — `TipButton` (Button + tip), `HintBadge` (Badge + tip, focusable), `Tooltip.Root` with the `child` snippet elsewhere. Native `title=` only on plain `<a>` links to say where they go. Never put a `title` on a Badge (it is a span: mouse-only).
- **Badges**: tones are variants — `success | warning | info | muted` (outline-tinted) and `success-soft | warning-soft | destructive` (filled). No inline `border-warning/40 text-warning`.
- **Store / hangar tags**: `Tag kind=…` — one wording and tooltip per kind; `size="xs"` on tiles. Kinds: `warbond standard insurance owned concierge subscribers oos ship sale limited new bestvalue bonus fits lowstock stage size discount gifted giftable meltable upgraded game` (RSI's ribbons come from `StoreItem.tags`, see `lib/store.ts` helpers).
- **Errors**: `Alert variant="destructive"` (`warning` for caveats). Not a bare `<span class="text-destructive">`.
- **Empty state**: `<Empty>Nothing matches.</Empty>`; inside a table `<Empty colspan={n}>`. Every list with filters has one.
- **Card titles**: `Card.Title` is an `<h3 class="text-lg font-semibold">` by default (the hub header owns the page `<h2>`). Do not nest an `<h2>` or add `class="text-lg font-semibold"`. Drop the title when it only repeats the page label.
- **List filters**: `FacetBar` + `lib/facets.ts` — declare facets (options with predicates) and ranges, bind `values`, derive `applyFacets(...)`. The bar is a toolbar of filter buttons (each opens its options with live counts; ranges open a slider + min/max), *+ Filter* for the non-`primary` ones, and the applied filters as removable chips with *Clear all*; `defaults` is what Clear returns to. Spec: [filters and labels](plans/specs/filters-and-labels.md).
- **Segmented choices** (2–5 text options): `Segmented` (hints become Tooltips; `size="sm"` in toolbars). Filter chips with counts: `FilterChips`. Raw `ToggleGroup` only for swatch pickers.
- **Switch settings**: `SwitchRow` (id, label, hint, checked, onchange). Booleans are Switches everywhere, never a Checkbox on one page and a Switch on another; the wording comes from `lib/settings-ui.ts`.
- **Theme tokens only**: `bg-muted`, `bg-accent`, `border-border`, `text-success|warning|info|accent-2`, `chart-1…10`. No `bg-white/…`, hex or `rgb()` in class names (light palettes exist).
- **Toolbar heights**: one per toolbar — controls `size="sm"` (h-7) together, or default (h-8) together; `Input` is h-8 by default, do not add `h-7`/`h-8` classes.
- **Conditional classes**: `cn()`, not Svelte class arrays.
- **Icons**: `@lucide/svelte/icons/<name>`, never the barrel.
- **Destructive one-click actions**: `ConfirmButton` (first click arms "Sure?").

## Shared components (`src/components/`)
| Component | Props | Use |
|---|---|---|
| `TipButton` | ButtonProps + `tip`, `side`, `align` | Button with a Tooltip |
| `HintBadge` | Badge props + `hint`, `variant` | Badge with a Tooltip, keyboard-focusable |
| `Tag` | `kind`, `value` (insurance/sale), `count` (owned), `size`, `label`, `hint` | Warbond / LTI / owned / Concierge / … |
| `CartButton` | `state` (ledger entry), `onadd`, `name`, `available`, `busy`, `qty`, `text` | + cart / adding… / in cart / error |
| `OpenCartButton` | `count`, `always`, `size` | "Open RSI cart (n)" header button |
| `Empty` | `colspan?` | the empty state |
| `LoadStatus` | `loading`, `data`, `count`, `noun`, `empty`, children | "Loading page 3 / 12…" + progress / "n pledges · loaded …" |
| `LoadActions` | `loading`, `data`, `noun`, `onstop`, `onload(resume)`, `onupdate`, `updateHint`, `size`, children | Stop / Resume / Update / Reload ladder |
| `StatGrid` | `min` | auto-fit row of `Stat` tiles |
| `Stat` | `value`, `label`, `delta`, `tone`, `valueTone`, `icon`, `sub`, `hint`, `size` | KPI tile |
| `Chip` | `onremove`, `removeLabel`, `variant` | removable chip |
| `FilterChips` | `options`, `bind:value` (id or Set), `multiple`, `ariaLabel` | pledge-type / category chips |
| `FacetBar` | `facets`, `ranges`, `rows`, `shown`, `bind:values`, `primary`, `keep`, `hideEmpty`, children (search/sort) | the filter bar of every list page |
| `SwitchRow` | `id`, `label`, `hint`, `checked`, `onchange`, `disabled`, children | one setting as a switch |
| `ConfirmButton` | ButtonProps + `onconfirm`, `confirmLabel`, `ms` | two-click delete |
| `Segmented` | `options {id,label,hint}`, `bind:value`, `ariaLabel`, `size`, `disabled`, `class` | radio pill |
| `Thumb` | `src`, `name`, `width`, `height`, `placeholder: 'icon'\|'block'` | thumbnail + hover preview |
| `Section`, `Combobox`, `ShipSelect`, `SortTh`, `Wizard`, `LabelEdit`, `FanNotice`, `WidgetGrid` | unchanged | — |

## Shared helpers (`src/lib/`)
- `cart-ui.svelte.ts` — `createCartLedger()` → `{ state, busy, added, of(key), add(key, task), addAll(lines), reset() }`, `cartErrorLabel(code)`. Pages keep the call (`addStandalone`, `addStep`) and hand it to the ledger.
- `deep-link.svelte.ts` — `useDeepLink({ hash, idParam, elId, apply, rendered })` → `{ flash }`; `hashParam(k)`.
- `hub-pages.ts` — `HUB_GROUPS`, `HUB_PAGES`, `SETTINGS_PAGE`, `pageOf(tab)`, `isHubTab(s)`: the one list of pages (sidebar, popup, links).
- `settings-ui.ts` — `SETTING_TOGGLES` (+ `quick` for the popup), `QUICK_TOGGLES`, `MUTE_MODES`.
- `download.ts` — `downloadFile(name, body, type)`, `dateStamp()`.
- `flash.svelte.ts` — `transient(ms)` → `{ text, show(msg), clear() }` for "Saved …" messages.
- `store.ts` — `priceLabel(discounted, price)`, ribbon tests `isLimitedTime`, `isNewListing`, `isBestValue`, `bonusOf`, `fitsOf`, `isLowStock`, `isLimitedSku`.
- `facets.ts` — `Facet`, `RangeFacet`, `applyFacets`, `facetCounts`, `toggleFacet`, `clearFacets`, `INSURANCE_OPTIONS`, `STAGE_OPTIONS`, `SIZE_OPTIONS`, `yesNo`, `insuranceBucket`, `stageOf`.

## Page scaffold
```svelte
<Card.Root>
  <Card.Header>
    <Card.Title>Pledges</Card.Title>                      <!-- h3, text-lg -->
    <LoadStatus … /> or <Card.Description>…</Card.Description>
    <Card.Action class="flex flex-wrap items-center gap-2"><LoadActions … /><OpenCartButton count={cart.added} /></Card.Action>
  </Card.Header>
  <Card.Content class="grid gap-4">
    {#if error}<Alert variant="destructive"><Alert.Description>{error}</Alert.Description></Alert>{/if}
    <div class="flex flex-wrap items-center gap-2">  <!-- toolbar: Segmented sm · Input · Select sm · Reset -->
    <StatGrid>…</StatGrid>
    <Table.Root> … <SortTh/> … {#if !shown.length}<Empty colspan={n}>Nothing matches.</Empty>{/if}
  </Card.Content>
</Card.Root>
```
