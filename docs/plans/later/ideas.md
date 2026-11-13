---
title: Later
tags: [plans]
updated: 2026-11-11
---
# Later
- **More languages (full localization).** Parked until someone asks or the store stats show a sizable non-English share (German and French are the big Star Citizen communities; start with one language and measure). Today all UI text is hard-coded English: 62 components (~13k lines), the content scripts that build DOM text, and strings made in `src/lib` (feed titles, notifications, lookup reasons). What it takes: a `t('key', vars)` helper with an English catalog, every string moved to keys, plural handling (the `${n} thing${n === 1 ? '' : 's'}` pattern is everywhere), then per-language files and upkeep on every feature. Cost to weigh: about a week of churn across ~80 files (conflicts with open feature branches), a translation step on every release, and more store listing fields to keep justified. RSI's site and Spectrum are English-only and the domain words (CCU, LTI, warbond, melt, buyback) stay English either way. The parsers read RSI's English page text and are not affected by the UI language. Already in place (prep done 2026-11, [architecture](../../architecture.md) → *Formats and languages*): one format module (`lib/fmt.ts`) and the manifest's name and summary in `public/_locales/en/`. Until then, for new code: no sentence built by joining pieces across a variable (write the whole sentence with placeholders), and dates / numbers only through `lib/fmt.ts`.
- Org-mates finder: which of your friends share an org with a thread author
- Jev (TypeSafe) relevance scoring for the feed (optional key, like Crunchy+)
- CCU planner: speculative prices / price history (store a daily MSRP + CCU offer snapshot from the catalog refresh, then "maintain buy prices" and planning on expected sale prices like CCU Game) · k-best alternative chains · CCU graph view
