# Changelog

## [0.9.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.8.0...v0.9.0) (2026-10-31)


### Features

* **cart:** show what is already in the RSI cart; orgs load as you scroll; truncated pack titles count as owned ([ba8dedd](https://github.com/NyleGarcia/rsi-plus/commit/ba8dedd9467d2d4902198a835dc7d03e8a386909))
* **settings:** display currency, debug export; in-game UEC pledges are not dollars ([b095290](https://github.com/NyleGarcia/rsi-plus/commit/b0952907739db39b6bc0db5004cb890fd37787f7))


### Bug Fixes

* **wiki:** link only names the wiki has a page for ([e48c760](https://github.com/NyleGarcia/rsi-plus/commit/e48c760aa7ad9f30e85191d0cfd29acd3396954e))


### Performance Improvements

* **hub:** paint clicks first, lazy rows, no blur layers, indexed ship matching ([274b52e](https://github.com/NyleGarcia/rsi-plus/commit/274b52e74481dee68867773643612378b45fc20b))

## [0.8.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.7.0...v0.8.0) (2026-10-31)


### Features

* **buyback:** group the buyback list by type or by ship ([26a2b51](https://github.com/NyleGarcia/rsi-plus/commit/26a2b51578733ce3361db4e525c4f06f4d7780c6))
* **export:** StarOrg Tools fleet preset with insurance and in-game ships ([1264c47](https://github.com/NyleGarcia/rsi-plus/commit/1264c4771739d41db29d33d0c15c0637cb08eb51))
* **settings:** opt-in StarOrg Tools and account switcher, StarOrg site dropdown ([2b1e377](https://github.com/NyleGarcia/rsi-plus/commit/2b1e3777054e6496e7cbe3fba33147de93703a01))
* **starorg:** connect RSI+ to StarOrg Tools and sync your ship list ([d9beb4a](https://github.com/NyleGarcia/rsi-plus/commit/d9beb4af0dfcffdabec0e4c227f377217a14ed61))
* **starorg:** show exactly what the integration sends, with a payload preview ([41c1e0a](https://github.com/NyleGarcia/rsi-plus/commit/41c1e0aa1be277b686ce1089a253639830874532))
* **ui:** Star Citizen Wiki link next to ships and items ([5a56f59](https://github.com/NyleGarcia/rsi-plus/commit/5a56f5948f85c1fb571beda56b9af72c70963b73))


### Bug Fixes

* **accounts:** log out here parks the active account's data so the next login can't take it over ([7b24b82](https://github.com/NyleGarcia/rsi-plus/commit/7b24b8272152462e47e25d30d3aea91ca85a0be5))
* **buyback:** match only ships, vehicles, paints and components to a hull ([2859bd5](https://github.com/NyleGarcia/rsi-plus/commit/2859bd551674eef8c401db07f03b35839319c5a7))
* **buyback:** store filter for what the store doesn't sell, and load the catalog for ship grouping ([fa2f292](https://github.com/NyleGarcia/rsi-plus/commit/fa2f29282c702ce6b91417064c998a7b5e12d553))
* **ccu:** Open on a fleet goal no longer changes the fleet plan ([daaa8ac](https://github.com/NyleGarcia/rsi-plus/commit/daaa8ac0a1bb20dbc23dd191e9d15bafe13cae09))
* **ccu:** saving a chain or fleet plan keeps its own CCUs in the plan ([ace8311](https://github.com/NyleGarcia/rsi-plus/commit/ace8311d071f60edec623b0fde3d9d9f99375062))
* **export:** each ship in a pack keeps only the name you gave it ([9ad84dd](https://github.com/NyleGarcia/rsi-plus/commit/9ad84dde24aa46f8a379c6f5bd43e7eca55c9876))
* **hangar:** a stopped hangar load no longer counts as the whole hangar ([b785272](https://github.com/NyleGarcia/rsi-plus/commit/b785272db9e829f0e259935f9f80202b215f51f7))
* **paints:** top up the RSI cart from its read-back so a remount can't double the plan ([141556f](https://github.com/NyleGarcia/rsi-plus/commit/141556f2cb0d7b248f9b087c05cf633ad9ad733f))
* **starorg:** preview refuses what a send refuses; cookie and handle wording ([de94e1e](https://github.com/NyleGarcia/rsi-plus/commit/de94e1ea05d27da76a98aea621822d33b724e265))
* **ui:** no wiki link for concierge flair or paint packs ([2365ca6](https://github.com/NyleGarcia/rsi-plus/commit/2365ca66edbbe42f4d4faffb5281c3846aac86a4))

## [0.7.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.6.0...v0.7.0) (2026-10-25)


### Features

* **concierge:** exact Chairman's Club spend and distance to the next level from the order history (orders cash + subscription payments − refunds); subscription payment table in the reader ([5bd2dd0](https://github.com/NyleGarcia/rsi-plus/commit/5bd2dd027050ddd1697edb28b6bad377aa1bab3d))
* **feed:** one Feed page — Activity (watches, friends added/gone, requests, party, store alerts, hangar changes) + Store changes view; kind chips, unseen switch, day headings; nav + popup badges ([650a7dd](https://github.com/NyleGarcia/rsi-plus/commit/650a7dd9ae7057ffa034d249e33b3bbfce67d809))
* **filters:** facet bars with live counts on Pledges, Ships, Ship catalog and Browse; RSI ribbons (Limited time, New, Best value, Bonus, Fits, Low stock) and stage / size / gifted tags; new CCUs page (hangar + buyback upgrades, saving vs MSRP gap, chain use) ([834e8e0](https://github.com/NyleGarcia/rsi-plus/commit/834e8e0df9d367708abb96b03c062526377b1c45))
* **filters:** FacetBar as a filter-button toolbar — option lists with counts, range sliders, + Filter menu, active chips with Clear all (adds ui/slider) ([bb7eea7](https://github.com/NyleGarcia/rsi-plus/commit/bb7eea7259c4cad06afa4190fcf75f8e0b19e722))
* **hub:** dedicated footer on every page (fankit notice, version, links, coffee + referral under More); sidebar keeps the short fankit line ([2e85d8d](https://github.com/NyleGarcia/rsi-plus/commit/2e85d8d82d09040118f03ae3d000b5541a64835b))
* **hub:** referral blurb in the footer (50,000 UEC after a game package) ([f24364e](https://github.com/NyleGarcia/rsi-plus/commit/f24364e7f4915d60f28c31ffc5a3c34409908430))
* **ui:** 21st.dev ports — Stat count-up/trend/context + divided StatGrid, Timeline for the Feed, SkeletonSwap on catalog/browse, NewItemsPill, first-run ProductTour ([08ab976](https://github.com/NyleGarcia/rsi-plus/commit/08ab976b3211db5bacc43c09f6abba9270d08ea6))
* **ui:** facet engine + FacetBar, store ribbons/stock level and ship size in the data, new Tag kinds, sidebar regrouped (Hangar / Store / Plan) with a CCUs page stub ([8427441](https://github.com/NyleGarcia/rsi-plus/commit/84274410cef66138c5f867215a91c41fb6244fc9))
* **ui:** shared pieces for the audit pass — SortTh numeric/class, HintBadge xs, FilterChips hint + count, usd0, fmtDate/fmtDateTime/ago, LINK classes ([3a2f4a8](https://github.com/NyleGarcia/rsi-plus/commit/3a2f4a866d962a68bb564268d9f402cddeb04397))
* wallet order history, Feed, facet filters, CCUs page, audit pass (0.7.0) ([522a58d](https://github.com/NyleGarcia/rsi-plus/commit/522a58d03b16b1c29d3d84d6b0137f396f72c93f))
* **wallet:** one spend card — Order history / Hangar basis switch for heroes and charts; Where the money went + Order history as widgets; order chart buckets ([795d08d](https://github.com/NyleGarcia/rsi-plus/commit/795d08d500d98ce4db5b486b51d2808e44f425c9))
* **wallet:** order history reader built on RSI's real billing markup — orders with lines, cash vs store credit vs discounts, per-year table, 100 a page; fixture + tests ([d4c3387](https://github.com/NyleGarcia/rsi-plus/commit/d4c338758d49072a4be06a7a349556c3d9dadcf2))
* **wallet:** where the money went — hangar spend ledger (new money / cash-or-credit / melted / gifted / cash estimate) + order-history import with billing capture; perf: indexed facet counts, lazy tooltips ([e3c1031](https://github.com/NyleGarcia/rsi-plus/commit/e3c10315da49e95256a3b22852898b01b69e18d0))


### Bug Fixes

* **catalog:** discount column says what it is — Under MSRP badge with the MSRP and the cheapest live offer on hover ([f8d4f4b](https://github.com/NyleGarcia/rsi-plus/commit/f8d4f4b45d2504b794850035c7de9c89cf6fa28e))
* **catalog:** Under MSRP is its own column; Plan CCU in an actions column ([fc0d639](https://github.com/NyleGarcia/rsi-plus/commit/fc0d639048f5409637e23eb932e9a1a4bbf9e080))
* **wallet:** buyback is a stock, credit used is turnover — relabel Sitting in buyback / Store credit cycled; cash estimate hints say credit can cycle ([f9e3a9a](https://github.com/NyleGarcia/rsi-plus/commit/f9e3a9a2e3b3e6b4d6a542c083dee384cf3edd2c))
* **wallet:** derive the spend ledger after the pledge list; changelog ([04738ec](https://github.com/NyleGarcia/rsi-plus/commit/04738ecf59319ef14f8201127fc8326e27223772))
* **wallet:** warbond new-money from order lines when imported (hangar names drop Warbond); $0 pledges stat shows gifts + flair ([a546e19](https://github.com/NyleGarcia/rsi-plus/commit/a546e19fb1f5cbdea0aa22c2e97ce7e7eef23c86))


### Performance Improvements

* **hangar:** stable row keys across Group switch, lazy label editor + row tooltips (LazyTip), chunked by-ship render; Browse/Paint rebuy row tooltips lazy ([4e4d403](https://github.com/NyleGarcia/rsi-plus/commit/4e4d4035ff549c9664d17eacf4eef8a6c462033f))

## [0.6.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.5.0...v0.6.0) (2026-10-22)


### Features

* notifications page, pack tiles with previews and per-piece buying, paints-by-ship cart, store disclaimer ([d47a4a1](https://github.com/NyleGarcia/rsi-plus/commit/d47a4a13eff86362fc9dca8cca563e2da6d741b2))

## [0.5.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.4.0...v0.5.0) (2026-10-21)


### Features

* **browse:** listing contents, bundle savings, add to cart, edition and insurance tags ([e9b3c8d](https://github.com/NyleGarcia/rsi-plus/commit/e9b3c8d0388bfdfc62fb721583e03e7cb6bf5299))
* **ccu:** add a single chain to the fleet plan ([1a8f103](https://github.com/NyleGarcia/rsi-plus/commit/1a8f1036d6049b5505b90783e0c5ba14367cf0c0))
* **ccu:** clear-all for fleet plan never / prefer lists ([a31e2a6](https://github.com/NyleGarcia/rsi-plus/commit/a31e2a609132a1ad316e36ab9fee3bead5efbe2b))
* **ccu:** Kraken, Javelin, Idris-M as plannable hulls (wiki MSRP); fleet plan prefer-to-upgrade list with LTI shortcut ([038353d](https://github.com/NyleGarcia/rsi-plus/commit/038353d244ebbfe803fc051396c318a1f4a3a7d8))
* **ccu:** per-goal LTI preference and store start in fleet plans; want pickers hide owned ships by default ([20f15be](https://github.com/NyleGarcia/rsi-plus/commit/20f15be84ba4b85dffb7950502a5898d1c8d2578))
* **ccu:** plan to ships nothing sells today (Orion, Arrastra) without turning on Plan ahead; not-on-sale tags in pickers ([2729fa6](https://github.com/NyleGarcia/rsi-plus/commit/2729fa616757bb34bf92eda100f3548ca0490005))
* **hangar:** Update — quick refresh that reads from page 1 until the pages match the saved hangar, keeps the rest; full reload unchanged ([6a3229c](https://github.com/NyleGarcia/rsi-plus/commit/6a3229c940f6c35aa21c7b8eae9d436a7689e3e4))
* **store:** on-sale defaults, Browse category tabs and filters ([bcacbee](https://github.com/NyleGarcia/rsi-plus/commit/bcacbee5b8202f8ee30c9610690f8ddec5831a5a))
* **store:** store changes log on Browse — added / removed CCUs, standalones, paints, packs, gear (catalog + hourly listing check), outage guard ([39d972d](https://github.com/NyleGarcia/rsi-plus/commit/39d972d85882cae1b1b5cc2369f01d184f94ae87))
* **wallet:** spend dashboard — headline cards and a customizable widget board; fix payment split (warbond, cash, store credit, free, unknown from RSI's per-pledge currency) ([e85b917](https://github.com/NyleGarcia/rsi-plus/commit/e85b91762d970ef6e536059d2d4ba513894ffc63))
* your own labels on pledges (Keep, LTI token, CCU fodder, Melt…) that steer the melt planners and fleet plans ([f9698ce](https://github.com/NyleGarcia/rsi-plus/commit/f9698ce972972b6c64a6c60a7ad1b6f4f053fefe))


### Bug Fixes

* **ccu:** chains never step down in price — skip owned/buyback CCUs whose target lists at or below the start, store CCUs need a higher target MSRP ([a692e99](https://github.com/NyleGarcia/rsi-plus/commit/a692e998499e48e27e63d1c7ab3a3804c4a51818))
* **labels:** removing a label crashed — labels were stored as objects; save plain arrays and repair old data on read ([1f72404](https://github.com/NyleGarcia/rsi-plus/commit/1f7240448d3f595d8aa228c3ddbcbd3bb7e8cb2a))
* **ui:** pledge labels in their own column ([966ed90](https://github.com/NyleGarcia/rsi-plus/commit/966ed90c1197d3127d355045d32a93cb37769fd5))
* **ui:** ship picker rows two-line with a status pill — names no longer squeezed ([25fd853](https://github.com/NyleGarcia/rsi-plus/commit/25fd8534a4eb8555c1e5088dfedee4a6954bad71))
* **wallet:** drop the cash vs credit split (RSI's pledge currency is the melt currency) — warbond / standard / free; widgets size to content, no inner scrolls ([8f75694](https://github.com/NyleGarcia/rsi-plus/commit/8f7569462e6c656fe4fc761cde9744a34fc3d906))


### Performance Improvements

* **hub:** chunked Browse / Ship catalog rows, lazy thumbnail tooltips, perf audit script ([5192737](https://github.com/NyleGarcia/rsi-plus/commit/51927376c70905f54b4f57d17858df259d29f361))
* **hub:** page switches no longer freeze — chunked Pledges/Melt rows (restart per view), memoized ship matching, pledge item keys, hangar links and USD formatting; fix melt-link page math (RSI serves 10 a page) ([65cb995](https://github.com/NyleGarcia/rsi-plus/commit/65cb9951c1be703dd3b2fcf07a0909d40dbbc65c))

## [0.4.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.3.0...v0.4.0) (2026-10-16)


### Features

* **ccu:** fleet plan — several goals at once with shared CCUs and hulls, auto source, stops, grouped saved chains ([b1573b1](https://github.com/NyleGarcia/rsi-plus/commit/b1573b120b393a485aebc654530297ec7f59c938))
* **ccu:** plan ahead through ships not on sale (long-term goals), sale alerts for saved chains, ship catalog filters + last-seen-on-sale ([37a20d5](https://github.com/NyleGarcia/rsi-plus/commit/37a20d5d471dda39c749ed972da246210de79545))
* Edge and Firefox builds — per-browser manifest, Firefox-safe sound and badge, CI/release matrix over chrome, edge, firefox ([4206595](https://github.com/NyleGarcia/rsi-plus/commit/42065959baa15567768817effe48703b3a498c8f))
* Made By The Community badge and fan-project trademark notice (sidebar, page footer, popup) ([414edfb](https://github.com/NyleGarcia/rsi-plus/commit/414edfbab3966ec411bd72cbddb1988295521471))
* **ships:** track in-game ships (aUEC-bought / earned) so paints, melt and rebuy count them as owned hulls ([f3bca9f](https://github.com/NyleGarcia/rsi-plus/commit/f3bca9fe6b3de88b98ca05597a82971708a7951c))

## [0.3.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.2.0...v0.3.0) (2026-10-16)


### Features

* **cart:** redeem the addToCart ticket, mode guard, Verify chain with RSI ([e5df8ff](https://github.com/NyleGarcia/rsi-plus/commit/e5df8ffc74a5c0a5e5414c75979c850910ab9b29))
* **ccu:** add chain steps to the RSI cart ([16ef435](https://github.com/NyleGarcia/rsi-plus/commit/16ef43592799c54dc813290de0961fdf7f541f12))
* **hub:** searchable Combobox + ShipSelect for CCU planner, Ships compare, Store maker filter ([1ea0b39](https://github.com/NyleGarcia/rsi-plus/commit/1ea0b39b21929bd94e42fc0f1db71f000573d385))
* shadcn hub, flat navigation, store browse, Chairman's Club, keyword watches, passive mode, store kit ([7cc4d85](https://github.com/NyleGarcia/rsi-plus/commit/7cc4d85f3a0b406727e15b4ac5a9c6299bba5abf))


### Bug Fixes

* **cart:** mint the account token before the sign-in check, send X-Rsi-Token, show RSI's reason ([610d54d](https://github.com/NyleGarcia/rsi-plus/commit/610d54d5266d8ca3a838234950ed70c8fa1b4594))
* **cart:** send X-Rsi-Token on setAuthToken/setContextToken like RSI's bootstrap ([79bfb69](https://github.com/NyleGarcia/rsi-plus/commit/79bfb69757a8bbdb9ebc2e90c8c19a4a8cb28f6c))
* **ccu:** type guard on verified steps ([693449b](https://github.com/NyleGarcia/rsi-plus/commit/693449b57de63665c288e8f2f1f1db28482ba000))
