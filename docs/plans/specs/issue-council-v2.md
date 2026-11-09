---
title: Issue Council v2 (hub tab, duplicates, report helper, Spectrum links)
tags: [spec, issue-council, spectrum]
status: draft
updated: 2026-11-08
---
# Issue Council v2

Builds on the 0.13.0 Issue Council integration (`src/lib/issue-council.ts`, `entrypoints/issue-council.content/`, [architecture](../../architecture.md)). Same ground rules, unchanged:
- RSI+ reads only the Issue Council pages you open (DOM). No Issue Council API, no login token, no background checks.
- Everything is stored locally, per RSI account. Nothing new is sent anywhere, so PRIVACY.md only gains a line about the new local data, and no new permissions are needed.

## Problem
- Tracked issues are only listed in a small *Issue Council* section of Watching. You can't filter them, see how an issue grew, or keep your own notes on one.
- Reporters file duplicates: Report new issue gives no hint that RSI+ has already seen an issue with almost the same title.
- The report helper has one template and no build number. The build is the field people get wrong most, and RSI+ already sees it in Spectrum patch-notes subjects.
- On Spectrum, a STARC chip is just a link. Patch notes don't connect to the issues you track. A thread about a bug can't be tied to its issue unless someone types the code.

## Features

### 1. Hub *Issues* tab
- New hub page `issues` (`HubTab`, `lib/hub-pages.ts`), in the Spectrum group after Watching. Label *Issue Council*, sub *Issues you track, notes, trends*, icon `bug`. It only shows while `Settings.issueCouncil` is on.
- **Table** of `icIssues` with columns code, title, status, contributions (with the change since your last visit), category, relation, last seen and notes.
  - **Default view:** tracked issues only. A *Show all seen* toggle shows all of them (the cap stays 3000).
  - **Filters:** status, relation, category and text. Use the existing facet sidebar pattern ([filters and labels](filters-and-labels.md)).
  - **Row actions:** open on the Issue Council, Watch / Unwatch, mark read, and the Spectrum threads that mention the issue (from `icMentions` plus the manual links in feature 6).
- **Trend:** every time a page shows an issue with a different count or status, append `{at, contributions, status}` to `IcIssue.history`.
  - Capped at the last 30 points per issue, and only for tracked issues, to bound storage.
  - The row shows a sparkline of the history (LayerChart, as in Wallet) and status-change dots.
- **Notes:** `IcIssue.note?: string`, edited inline. Shown on the issue page in the Issue Council next to *Watch in RSI+*. It is your private note, local only.
- **Export:** CSV and JSON of the current view, using the same export helper as Pledges.
- Watching → *Issue Council* becomes a 5-row summary with a link to the tab.

### 2. Duplicate finder (Report new issue)
- As you type the title (debounced 300 ms, at least 3 meaningful words), show up to 5 issues from `icIssues` whose titles match.
  - Each shows code, status and contributions, plus *Open* and *Watch*.
  - Header: *Seen by RSI+, may be the same issue*. Footer: *Only issues you've opened or listed on the Issue Council are checked*. Be honest about the coverage.
- **Matching:** a pure `similarIssues(title, issues, n)` in `lib/issue-council.ts`.
  - Lower-case the title and drop stop words and SC filler words ("bug", "issue", "when", "not working").
  - Score by token overlap (Jaccard), plus a bonus for the same category once one is picked.
  - Ignore statuses `fixed` and `archived` unless *Show fixed* is ticked.
  - Unit-tested on a fixture of real titles.
- **To check before building:** whether Issue Council's create form already shows a "similar issues" list. If it does, add to it (mark issues RSI+ tracks) instead of adding a second list. Check this against a saved page.

### 3. Report helper v2
- **Templates:** `Settings.icTemplates: {id, name, category?, body}[]`, replacing `icTemplate`. Migrate the old value to a single template called *Default*.
  - *Insert template* becomes a menu.
  - A template with a `category` is offered first once that category is picked.
  - Edited in Settings → Integrations → Issue Council: add, rename, delete, reorder.
- **Placeholders** filled when the template is inserted:
  - `{build}`: the newest build RSI+ has seen for the environment you pick (LIVE / PTU / EPTU / Tech-Preview), see below.
  - `{setup}`: your saved *My setup* text.
  - `{date}`: today's date.
  - A placeholder with no value stays as written, so you can see it's missing.
- **Build tracking:** the Spectrum content script already reads thread subjects in lists.
  - For threads in the Patch Notes channel, parse subjects like `Star Citizen Alpha 4.3.2 PTU.10123456 Patch Notes` into `{env, version, build, slug, at}`.
  - Keep the newest per environment in `local:scBuilds`. This is public data, so it is shared across accounts.
  - The pure `parseBuild(subject)` is tested on real subjects.
- **My setup:** a free-text field in Settings, e.g. region, CPU, GPU, RAM and OS. You type it; RSI+ never detects hardware.
  - Also offered as *Insert my setup* on the contribution form ("I have this issue"), where it goes into the text box.

### 4. Hover card on Spectrum STARC chips
- Hovering or focusing a chip opens a small card with title, status, contributions (with the change since your visit), your relation, your note (first line), the Spectrum threads it's mentioned in, and a *Watch in RSI+* button.
- Uses local data only: `st.ic`, plus `icMentions`. The content script sends a message to the background to toggle watch, the same path the Issue Council page uses.
- Unknown code (never seen): *Not seen by RSI+ yet, open it once to track* and *Open*.
- Keyboard: the chip can take focus, the card opens on focus and Esc closes it. Use the existing `.sp-ui` styling.

### 5. Patch notes cross-reference
- On a thread in the Patch Notes channel (the same channel id as the build tracking), scan the post body:
  - **Codes:** any `STARC-…` code that matches a tracked issue gets a chip. This works today, so the change is to highlight tracked ones: *You track this*.
  - **Title words:** for lines under *Known Issues* or *Bug Fixes* headings, run `similarIssues` against tracked issues only. A score over the threshold puts a muted *maybe: STARC-123 ↗* tag under the line, never on top of it. Under *Bug Fixes* the tag reads *maybe fixed*.
- A bar at the top of the thread: *N tracked issues mentioned (M by code, K maybe)*, with a jump to each.
- Optional Feed event: when a patch note lists a tracked issue by code under *Bug Fixes*, a *Possibly fixed in 4.3.2 PTU* event goes to the Feed. It's off by default (`Settings.icPatchNotify`). Title matches never notify; they're too noisy.

### 6. Thread → issue linker
- In the Spectrum bar on a thread: *Link Issue Council issue*. It opens a picker over `icIssues`: search by code or title, with your own reported or contributed issues listed first. A pasted `STARC-…` code is accepted even if RSI+ hasn't seen the issue yet.
- Stored as `local:icLinks: Record<code, {slug, channelId, subject, at}[]>`, per account and kept apart from the automatic `icMentions` so either can be cleared.
- The link shows on:
  - the issue page in the Issue Council (*Spectrum threads* list, marked *linked by you*)
  - the hub tab row
  - the chip hover card
  - a chip at the top of the thread
- Unlink from any of those places.

## Data changes
| Item | Change |
|---|---|
| `IcIssue` | `history?: {at, contributions, status}[]` (tracked only, max 30), `note?: string` |
| `Settings` | `icTemplates` (replaces `icTemplate`, migrated), `icSetup: string`, `icPatchNotify: boolean` (default false) |
| `local:scBuilds` | new, shared: `Record<env, {version, build, slug, at}>` |
| `local:icLinks` | new, per account |
| `debug-export.ts` | include the new keys but leave out `note` and `icSetup` (personal free text) |

## Order (each slice ships on its own)
1. Hub tab: table, filters, notes, export. Add history recording now so the trends have data when the sparkline lands.
2. Hover card + thread linker (Spectrum).
3. Report helper v2: templates, build tracking, My setup.
4. Duplicate finder, which reuses `similarIssues`.
5. Patch notes cross-reference, which reuses `similarIssues` and the build parser.

## Acceptance
- [ ] No new permissions; `scripts/manifest-check.mjs` passes. No requests to Issue Council or its API from RSI+ code.
- [ ] Hub tab lists tracked issues with working filters, notes are saved and shown on the issue page, and CSV / JSON export works.
- [ ] History grows only when a page shows a change; capped at 30; untracked issues have none.
- [ ] `similarIssues`, `parseBuild` and the template placeholder filling have vitest coverage on real fixtures.
- [ ] Old `icTemplate` migrates to one *Default* template with nothing lost.
- [ ] Chip hover card works with mouse and keyboard; *Watch* from it shows up in the hub and on the Issue Council.
- [ ] Patch notes: tracked codes highlighted; title matches shown as *maybe* only; Feed event only for a code match under *Bug Fixes* with the setting on.
- [ ] A linked thread shows on the issue page, hub row and hover card, and unlinking removes it everywhere.
- [ ] PRIVACY.md (new local data: notes, history, links, builds, My setup), README, `docs/architecture.md` Issue Council section, changelog.

## Open questions
- Does Issue Council's create form already suggest similar issues? (Decides feature 2's UI.)
- Patch Notes channel id and subject format: confirm on a few real threads (LIVE, PTU, EPTU, hotfix).
- Similarity threshold for *maybe*: tune on real patch notes against a sample of titles before shipping.
- Does the hub tab show when Issue Council is off but `icIssues` has data (e.g. read-only)? Proposed: hidden, the data stays.
