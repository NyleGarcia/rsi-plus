# Changelog

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
