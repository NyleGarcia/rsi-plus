---
title: "Spec: shadcn-svelte + LayerChart migration"
tags: [plans, spec, ui]
updated: 2026-10-13
status: done
---
# Spec: shadcn-svelte + LayerChart migration

Decision (2026-10-13): stop hand-making UI. Hub + popup move to **shadcn-svelte** (bits-ui primitives, Tailwind v4, copy-in components under `src/components/ui/`) and **LayerChart** (shadcn-svelte's chart kit) for every chart. Content scripts (`ThreadBar`, `SiteBar`, `decorate.ts`) stay vanilla so nothing bleeds into RSI's pages.

## Foundation (done)
- `tailwindcss` + `@tailwindcss/vite` in `wxt.config.ts` (`vite: () => ({ plugins: [tailwindcss()] })`).
- `src/app.css`: Tailwind + `tw-animate-css` + shadcn tokens = the old `base.css` palette (`--background #0b0c10`, `--card #14161c`, `--popover #1c1f27`, `--primary #3cc8ff`, `--muted-foreground #9da1b0`, `--destructive #ff5470`, extra `--success #3ddc97`, `--warning #ffd166`, `--chart-1..5`). Dark only (`color-scheme: dark`, no `.dark` toggle). Imported by `entrypoints/hub/main.ts` and `entrypoints/popup/main.ts` **only**.
- `components.json` aliases: `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils` (`cn`), `@/lib/hooks`.
- Installed: `alert badge button card chart checkbox collapsible command dialog dropdown-menu hover-card input input-group label popover progress scroll-area select separator skeleton switch table tabs textarea toggle toggle-group tooltip`. Add more with `npx shadcn-svelte@latest add -y --skip-preflight --no-deps-install <name>` then `npm install`.
- `layerchart` 2.x (Svelte 5), `@lucide/svelte` icons.

## Conventions for every converted panel
1. **Imports**: `import * as Card from '@/components/ui/card'`, `import { Button } from '@/components/ui/button'`, `import { Badge } from '@/components/ui/badge'`, `import * as Table from '@/components/ui/table'`, `import * as Tabs from '@/components/ui/tabs'`, `import * as ToggleGroup from '@/components/ui/toggle-group'`, `import * as Tooltip from '@/components/ui/tooltip'`, `import * as HoverCard from '@/components/ui/hover-card'`, `import * as Select from '@/components/ui/select'`, `import * as Command from '@/components/ui/command'`, `import * as Popover from '@/components/ui/popover'`, `import * as Chart from '@/components/ui/chart'`, `import { Checkbox } from '@/components/ui/checkbox'`, `import { Input } from '@/components/ui/input'`, `import { Switch } from '@/components/ui/switch'`, `import { Progress } from '@/components/ui/progress'`, `import * as Collapsible from '@/components/ui/collapsible'`, `import * as Alert from '@/components/ui/alert'`, `import { Skeleton } from '@/components/ui/skeleton'`.
2. **Replace, don't wrap**: `.card` → `Card.Root/Header/Title/Description/Content`; `.btn` → `Button` (`variant="outline"` for the old neutral button, `variant="default"` for `.primary`, `size="sm"`/`"xs"` for `.small`, `variant="destructive"` for `.danger`, `variant="link"` for `button.link`); `.chip` → `Badge` (`variant="secondary"` default, `"outline"` muted, custom classes `text-success` / `text-warning` / `text-destructive` for ok / warn / err); filter-chip rows (`button.chip.on`) → `ToggleGroup` (`type="single"` / `"multiple"`); `Segmented.svelte` → `ToggleGroup` or `Tabs` (keep the `Segmented` component file as a thin wrapper with the **same props** so callers don't change, or convert callers — your choice, but no visual regressions); `Combobox.svelte` / `ShipSelect.svelte` → `Popover` + `Command` keeping the same props API; `SortTh.svelte` → keep API, render a `Button variant="ghost" size="xs"` inside `Table.Head`; plain `<table>` → `Table.Root/Header/Row/Head/Body/Cell`; `<input>` → `Input`, `<select>` → `Select`, `<input type=checkbox>` → `Checkbox` (or `Switch` for settings toggles); `title=` tooltips that matter → `Tooltip`; the paint-image hover preview → `HoverCard`; fold/unfold sections → `Collapsible`; progress bars → `Progress`; `.stats` KPI tiles → a small shared `Stat.svelte` (`src/components/Stat.svelte`: value, label, optional delta badge, optional sparkline snippet) built on `Card`.
3. **Layout** with Tailwind utilities (`flex flex-wrap items-center gap-2`, `grid gap-4`, `text-muted-foreground text-xs`, …). Delete the component's `<style>` block when nothing is left; keep only truly custom CSS (e.g. the CCU stepper rail).
4. **Charts** = LayerChart via `Chart.Container` + `Chart.Tooltip` (see `src/components/ui/chart/`, docs: https://shadcn-svelte.com/docs/components/chart, https://www.layerchart.com). Bars → `BarChart`, donut → `PieChart` (`innerRadius`), sparklines / running total → `AreaChart` (no axes), with the `ChartConfig` colours from `--chart-1..5`. Remove `Bars.svelte`, `Donut.svelte`, `Sparkline.svelte` once nothing imports them.
5. **Icons**: `@lucide/svelte` instead of emoji where it's an icon (🛒 → `ShoppingCart`, 🏠 → `Home`, ↗ → `ExternalLink`, ★ → `Star`, ✓/✗ → `Check`/`X`, ⚠ → `TriangleAlert`). Emoji that is content (ding ♪ preview) can stay.
6. **Behaviour and copy stay identical**: every button, filter, link, keyboard shortcut, `localStorage` pref, deep link (`#tab?param`) and `aria-*` keeps working. Tests must stay green (`npm test`), `npm run check` 0 errors / 0 warnings, `npm run build` clean.
7. **Don't touch**: `src/lib/*` logic, `entrypoints/*.content*`, `ThreadBar.svelte`, `SiteBar.svelte`, storage keys, message types.
8. `base.css` is a compatibility layer during the migration: do not add to it. When your panel no longer uses a class, leave `base.css` alone — the final pass prunes it.

## Hub shell (from CCU Game's layout, 2026-10-13)
CCU Game (Angular + Fuse + Material + Tailwind) uses a grouped **left sidebar** — every entry has an icon, a title and a grey one-line subtitle; groups: Your Items / RSI Store / CCU Chains / Wishlist / RSI / Statistics — plus a top app bar. RSI+ adopts that with shadcn-svelte's `sidebar` block (collapsible to icons, off-canvas on narrow windows): groups **Spectrum** (Feed, Watching, Friends, Mutes), **Hangar** (Hangar, Ships & paints, Items, Buyback, Wallet), **Store** (Store, CCU planner, Paint rebuy → `#ships?view=bundle`). Tab ids / hash routes are unchanged. Palette stays RSI+'s own (CCU Game's slate `#0f172a` / `#1e293b` / indigo was not adopted).

## Work split (parallel)
| Worker | Files |
|---|---|
| shared | `Hub.svelte` (tabs → `Tabs`), `popup/App.svelte`, `AccountSwitch.svelte`, `Segmented.svelte`, `Combobox.svelte`, `ShipSelect.svelte`, `SortTh.svelte`, new `Stat.svelte` |
| wallet | `WalletPanel.svelte` + LayerChart (`Bars`, `Donut`, `Sparkline` → delete) |
| hangar | `HangarPanel.svelte`, `BuybackPanel.svelte` |
| ships | `ShipsPanel.svelte`, `ItemsPanel.svelte` |
| paints | `PaintBundlePanel.svelte` |
| ccu | `CcuPanel.svelte`, `StorePanel.svelte` |
| social | `FeedPanel.svelte`, `FriendsPanel.svelte`, `WatchingPanel.svelte`, `MutesPanel.svelte` |

Workers other than *shared* use `Segmented` / `Combobox` / `ShipSelect` / `SortTh` / `Stat` by their **existing props** (Stat: `value`, `label`, `delta?`, `tone?: 'credit' | 'accent'`, children snippet for a sparkline) — the shared worker guarantees those APIs.

## Final pass (done 2026-10-13)
Pruned `base.css` to what content scripts still need (`SiteBar` / `ThreadBar` have their own styles — likely nothing; delete the import if empty), update `docs/architecture.md` "Hub styling notes", changelog, README stack line, screenshots check in Chrome.
