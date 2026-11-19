# Changelog

## [0.23.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.22.0...v0.23.0) (2026-11-19)


### Features

* **catalog:** packs and game packages that grant a hull, with its share of the pack price; pack-only hulls count as on sale ([986228a](https://github.com/NyleGarcia/rsi-plus/commit/986228a63e0a7d7643a6731c2252ce174687dd3f))
* **ccu:** pack-only target — offer the packs that grant it next to the chain ([3ee9afc](https://github.com/NyleGarcia/rsi-plus/commit/3ee9afcc0e4192164acadd80c7323b1b99e69a7b))
* **ccu:** planner source insurance — LTI only narrows my hangar to hulls on LTI pledges ([7f0527c](https://github.com/NyleGarcia/rsi-plus/commit/7f0527cdb150ad92da64bb019126ecdf16040aeb))
* **ccu:** store start insurance — LTI only limits the store start to standalones that come with LTI; insurance tag on the buy-ship step ([8ee9531](https://github.com/NyleGarcia/rsi-plus/commit/8ee95311691c1faec44d29fb88a537ab086e09be))
* pack offers for hulls, LTI source choice, CCU steps that save money ([cae8f67](https://github.com/NyleGarcia/rsi-plus/commit/cae8f6746fe7fb5e16cefaf6cd1682383741b05b))


### Bug Fixes

* **ccu:** prefer more steps counts only steps that save money; store source says it picks the start itself ([6cbc194](https://github.com/NyleGarcia/rsi-plus/commit/6cbc194083a26ff8eeb851a1c6d6ea1ebac7b206))

## [0.22.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.21.0...v0.22.0) (2026-11-19)


### Features

* **settings:** store listing check interval (15 min – 24 h, default hourly) ([fe025f8](https://github.com/NyleGarcia/rsi-plus/commit/fe025f8c5da8cf22a3f2e37d0da536ee698c16ae))
* **store-log:** Refresh button on Store changes (catalog + listing, once a minute) ([f0f3d60](https://github.com/NyleGarcia/rsi-plus/commit/f0f3d600e409eb77f06dfd9065d73e06c5c99043))
* waves watch one listing and rests per wave, Store changes Refresh ([0697dbe](https://github.com/NyleGarcia/rsi-plus/commit/0697dbe1bcb5f85176c71d65c6470813687b95e1))
* **waves:** stock watch rests once a wave is in stock or sold out, until the next wave ([737d473](https://github.com/NyleGarcia/rsi-plus/commit/737d473269719e409b7986454f014ab53f02729e))
* **waves:** watch one listing (warbond or store credit) and poll only its SKU ([f9743c6](https://github.com/NyleGarcia/rsi-plus/commit/f9743c619fbd9eb00c4b3b9c1f637eb0d6b08d0e))

## [0.21.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.20.0...v0.21.0) (2026-11-17)


### Features

* **hub:** Patreon link in the footer ([b277425](https://github.com/NyleGarcia/rsi-plus/commit/b277425fc2ffc5e03228406aaee026fe99161cb2))
* **hub:** Patreon link in the footer next to Coffee ([fdc9205](https://github.com/NyleGarcia/rsi-plus/commit/fdc9205beb065903e6f91de5dee8674cb63b1baf))

## [0.20.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.19.0...v0.20.0) (2026-11-17)


### Features

* **hangar:** nameable ships and Name Reservation items ([39cf4f1](https://github.com/NyleGarcia/rsi-plus/commit/39cf4f1cf7ad9ff748a1453de15741a3a49373bb))
* **hangar:** nameable ships with current and reserved names, Name Reservation items ([4e0f7d2](https://github.com/NyleGarcia/rsi-plus/commit/4e0f7d2e490ce04cebed77422c909d83ef23903a))


### Bug Fixes

* **hangar:** Name Reservation item badge reads '&lt;Hull&gt;: nameable' ([864cee1](https://github.com/NyleGarcia/rsi-plus/commit/864cee13a90c3654b7f5c82cc4207ee914e8b848))
* **store-log:** Concierge listings (Crusader Complete Pack) in Store changes ([18318bd](https://github.com/NyleGarcia/rsi-plus/commit/18318bdac14f440d05ff2be8f4fdc489f5037d45))
* **store-log:** Concierge listings in Store changes ([9f2cb38](https://github.com/NyleGarcia/rsi-plus/commit/9f2cb385fb308a960ad2fbc685d65ccbdee2ee01))

## [0.19.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.18.0...v0.19.0) (2026-11-15)


### Features

* **buyback:** Credit Buy-Back token status — available, none until next quarter, or probably back ([1bcb26b](https://github.com/NyleGarcia/rsi-plus/commit/1bcb26b4cb82c625f29a858426ba9be7e6ca1e97))
* **wallet:** Import / Re-import order history button in the Your spend header ([a58cce6](https://github.com/NyleGarcia/rsi-plus/commit/a58cce64bce53e8074454c7cce64827b131d26d9))
* **wallet:** line under the import button — what it gives, or when it was last read ([6d4a2bd](https://github.com/NyleGarcia/rsi-plus/commit/6d4a2bd6f00240e03e76c4876194119880b79094))
* **wallet:** notice with Import order history at the top until orders are imported ([#41](https://github.com/NyleGarcia/rsi-plus/issues/41)) ([dec4d7d](https://github.com/NyleGarcia/rsi-plus/commit/dec4d7d40d39b39131ed3569a351b017cccbae43))


### Bug Fixes

* RSI+ site bar bottom left with a remembered fold; armour sets and career kits typed gear ([#41](https://github.com/NyleGarcia/rsi-plus/issues/41)) ([fb31b27](https://github.com/NyleGarcia/rsi-plus/commit/fb31b2758588747483a6ab4573b2a49050bc67de))
* site bar position, Wallet order-history prompts, gear typing, buy-back token ([70b5615](https://github.com/NyleGarcia/rsi-plus/commit/70b56152629afcc4971d564fb1516e8d44d76261))
* **wallet:** hangar-basis spend figures say they are melt value with store credit included, not cash ([#41](https://github.com/NyleGarcia/rsi-plus/issues/41)) ([3dc66c9](https://github.com/NyleGarcia/rsi-plus/commit/3dc66c98057a55c62525d41ac3f9453400b73a19))
* **wallet:** import caption on its own line under the header buttons ([c8cd803](https://github.com/NyleGarcia/rsi-plus/commit/c8cd8031dc63c6c0b71691ffa69b12826e579d04))

## [0.18.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.17.0...v0.18.0) (2026-11-15)


### Features

* Limited waves, Paint rebuy grouping and included craft ([3d60150](https://github.com/NyleGarcia/rsi-plus/commit/3d601507747471f08c506613055d8ba91b65389a))
* **paints:** Melt only grouped by hull, with a per-hull off switch for hulls the hangar does not show ([ea9e45b](https://github.com/NyleGarcia/rsi-plus/commit/ea9e45b0498961ccd8e933b2552d83c8615d8218))
* **paints:** rebuy candidates grouped by hull; craft a ship comes with (Galaxy's Skylark) count as hulls ([c085534](https://github.com/NyleGarcia/rsi-plus/commit/c085534e63bd9452ae0fb93ccb749ebf4a7a81d8))
* **waves:** Limited waves page for stock-limited hull waves — schedule, countdown, ready check, stock watch, reminders ([a9e7de2](https://github.com/NyleGarcia/rsi-plus/commit/a9e7de2d935fc077854762277eca00979053f7cb))


### Bug Fixes

* Hornet Mk II paint matching, card header wrapping ([6cdb432](https://github.com/NyleGarcia/rsi-plus/commit/6cdb432cd9787e802fe48a17c29a6c455c3ac30e))
* **paints:** store "F7 Hornet Mk II" paints match the hangar "Hornet Mk II" ones ([ec6c370](https://github.com/NyleGarcia/rsi-plus/commit/ec6c3707f6cf592a9fe6cfb9715fb417280a16d8))
* **store:** Store changes controls sit under the description, which gets the full width ([1c3f920](https://github.com/NyleGarcia/rsi-plus/commit/1c3f9206565d7162413f356b83e6f5772c0cdcb1))
* **ui:** card header text keeps a readable width next to a wide action ([7b07f33](https://github.com/NyleGarcia/rsi-plus/commit/7b07f33f4cb2f52818d5269a5252bb3f6da412bc))

## [0.17.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.16.0...v0.17.0) (2026-11-14)


### Features

* **ccu:** apply on RSI with the pledge pointed out, hangar updates itself after an apply, undo for ignored steps ([0b21af2](https://github.com/NyleGarcia/rsi-plus/commit/0b21af28f2e98e5b6b316113a36e4203d38f8d5c))
* **ccu:** chains know when they were applied — RSI hangar log, Completed list, apply guide ([c4b072e](https://github.com/NyleGarcia/rsi-plus/commit/c4b072e9cead9c9db2c6c7694d8b9f50190636e8))


### Bug Fixes

* **ccu:** quieter apply guide — no bottom note in RSI's window, no password wording ([ed19697](https://github.com/NyleGarcia/rsi-plus/commit/ed1969773b46e0f0dcd3a88e3e758164ca1c0df8))

## [0.16.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.15.0...v0.16.0) (2026-11-14)


### Features

* **ccu:** cart view, add several chains, one-per-cart handling, per-step saving and ignore, sortable Your CCUs ([fe457b3](https://github.com/NyleGarcia/rsi-plus/commit/fe457b3279a794f0c3edd5eaa2a92bf539ba9c60))
* **ccu:** My chains — saved chains and the fleet plan become one list ([0fc6992](https://github.com/NyleGarcia/rsi-plus/commit/0fc6992cabe022aa9245110affd23bf04a3f72ed))
* **ccu:** prefer fewer or more steps when chains cost the same ([96fcfdb](https://github.com/NyleGarcia/rsi-plus/commit/96fcfdbcdfafaa86041b57c5cf199d753ffbd506))
* **ccu:** say how far the chain gets when no chain reaches the target ([9ac825b](https://github.com/NyleGarcia/rsi-plus/commit/9ac825b8bab5f0e871f8ac1bf54ed50d8e5759e3))
* **ccu:** share a chain as a link with its route and options ([850c5db](https://github.com/NyleGarcia/rsi-plus/commit/850c5db42bda2a71de9a007a15edc8ef7cab3e4b))
* **ccu:** show other routes to the same target and plan one in a click ([70090ac](https://github.com/NyleGarcia/rsi-plus/commit/70090accae7c1415df28e918d5b7166f56f3f6a3))
* **ccu:** waits must be worth it, skip a waiting step, routes with or without owned CCUs, quantities in Your CCUs ([8dd14b5](https://github.com/NyleGarcia/rsi-plus/commit/8dd14b5104e7cac2f3b4108b0713406e7ac31eee))
* **hub:** the Feed gets its own sidebar group and pages list their parts ([eb1e59b](https://github.com/NyleGarcia/rsi-plus/commit/eb1e59bbe023e20663d579c155f40da0fde9332c))
* **store:** price history with a shipped archive; planner prices waiting steps at the last sale price; Pledges show the saved chain a CCU belongs to ([e07546e](https://github.com/NyleGarcia/rsi-plus/commit/e07546ecb3157aedf361d65678e4ce21a8868808))


### Bug Fixes

* **ccu:** dedupe alternatives by visible route, honest reach hint, full share links replace stops ([db90295](https://github.com/NyleGarcia/rsi-plus/commit/db90295ed1504434e18a86877ef69fbf92348ee6))
* **ccu:** saved vs MSRP counts owned CCUs, real buy-back prices, already-spent column, chain import/export as text ([22ce371](https://github.com/NyleGarcia/rsi-plus/commit/22ce37134c918f511b6bf23c4eb8fce5a66ae4a5))
* **store:** dismiss X stays top-right on hover; add Dismiss owned to Store changes ([488a6c6](https://github.com/NyleGarcia/rsi-plus/commit/488a6c6100f5a760c0d8eefe69c6f0aa8cdcd35c))
* **store:** pace store reads, retry on 429, one manual refresh a minute ([025e81d](https://github.com/NyleGarcia/rsi-plus/commit/025e81d03f66bee7edcc20c8b9ffbdd6b5751980))

## [0.15.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.14.0...v0.15.0) (2026-11-12)


### Features

* **hub:** resize the expanded sidebar by dragging its edge ([8f70a1b](https://github.com/NyleGarcia/rsi-plus/commit/8f70a1bc498c09a2d50786f95e7d690fbdc13b5f))
* **intel:** clear the lookup cache from Org lookup ([669b8f4](https://github.com/NyleGarcia/rsi-plus/commit/669b8f4f9da5ff10f3149891d24b9bd7a4614fbc))
* **intel:** link to a player's Spectrum posts from Org lookup ([3a2f935](https://github.com/NyleGarcia/rsi-plus/commit/3a2f9356e804710191a0e2581d8ed7cd100e60b9))
* **intel:** suspected orgs for players with hidden memberships ([b89ef36](https://github.com/NyleGarcia/rsi-plus/commit/b89ef36d4fd19ecc32a10d8cc4c7a2f0400caaa5))


### Bug Fixes

* names made of &nbsp; or invisible characters show the handle ([fca39c9](https://github.com/NyleGarcia/rsi-plus/commit/fca39c997f4b6da14c4e05e38835e4d9b9f304b4))

## [0.14.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.13.0...v0.14.0) (2026-11-11)


### Features

* **feed:** delete entries, mark or delete only the entries shown ([2b893ef](https://github.com/NyleGarcia/rsi-plus/commit/2b893ef4aa3b647a22fbb92b7e91f840b9b262cc))
* **intel:** show an org's Discord invite on Org lookup ([b6868f5](https://github.com/NyleGarcia/rsi-plus/commit/b6868f55410ca28aa127f906b023eb987e166b53))
* Issue Council v2 (hub page, duplicate finder, Spectrum links), The Impound integration, org lookup ([0dd38ee](https://github.com/NyleGarcia/rsi-plus/commit/0dd38ee6b7380bee8303d0b6295d988fbcccde38))


### Bug Fixes

* **intel:** Recent shows the last 5 lookups, not 14 ([d53198f](https://github.com/NyleGarcia/rsi-plus/commit/d53198f1b68f740dc57bc300e77e63075c2abc6d))
* **intel:** strip tags from org names until none are left ([e2f998b](https://github.com/NyleGarcia/rsi-plus/commit/e2f998b4404263f374e5700887c615ed03210493))
* **market:** sorted cards no longer leave the first card at the end ([dd4cc82](https://github.com/NyleGarcia/rsi-plus/commit/dd4cc82c005494d071ce5f51cf773b46614e5c82))
* unescape &amp; last in The Impound descriptions, strip stray angle brackets from org names ([30c2046](https://github.com/NyleGarcia/rsi-plus/commit/30c204646546851649beb4e4cb9ae233dc33b57b))

## [0.13.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.12.0...v0.13.0) (2026-11-07)


### ⚠ BREAKING CHANGES

* **starorg:** remove Send pledge values; pledge_cost is always empty

### Features

* **issue-council:** read tracking, follow + notify on visit, STARC links, report helper ([047e059](https://github.com/NyleGarcia/rsi-plus/commit/047e059ab8ccd9882323a14e1ae20f6eb0dce7b4))
* **spectrum:** Spectrum tools switch, off leaves Spectrum alone but keeps Friends ([45c307e](https://github.com/NyleGarcia/rsi-plus/commit/45c307ebb87a45f4f8b727bec5a959f3a24a9ce9))
* **starorg:** remove Send pledge values; pledge_cost is always empty ([d0f59a4](https://github.com/NyleGarcia/rsi-plus/commit/d0f59a46876a84f35d127b2cf61d6b0c82f18e55))
* **starorg:** show RSI handle verification tiers on the StarOrg Tools card ([9702715](https://github.com/NyleGarcia/rsi-plus/commit/970271555bfdbc6fe72076a4bb0b2fa8f2a87be6)), closes [#33](https://github.com/NyleGarcia/rsi-plus/issues/33)


### Bug Fixes

* **spectrum:** bar clears Spectrum's reply footer; Watch author toggles ([b389d02](https://github.com/NyleGarcia/rsi-plus/commit/b389d02caa2c6529fb883ddea5527fcb7c10e73a))
* **spectrum:** bar leaves chat lobbies, and Settings can turn it off ([e62b1de](https://github.com/NyleGarcia/rsi-plus/commit/e62b1deb114b4ef37413b08bd282bee257c587c9))
* **spectrum:** bar paints above the page and is opaque ([1b25b61](https://github.com/NyleGarcia/rsi-plus/commit/1b25b61783e5445acfc8640cf79fdfdfd680e892))
* **spectrum:** find Spectrum's footer by layout, not by position: fixed ([cb43d9c](https://github.com/NyleGarcia/rsi-plus/commit/cb43d9c1b6cabf65eae48dcd6615059d167ec8ed))
* **spectrum:** sample the whole bar area when looking for Spectrum's footer ([ae8cbdf](https://github.com/NyleGarcia/rsi-plus/commit/ae8cbdffd3b679fb86e47258ebe3e52ca3a0e80d))

## [0.12.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.11.1...v0.12.0) (2026-11-01)


### Features

* **hangar:** folded ship rows show insurance, role / size / stage, MSRP, saved and giftable copies ([b07ed89](https://github.com/NyleGarcia/rsi-plus/commit/b07ed896821c2964c24f125e3e067db96703add0))

## [0.11.1](https://github.com/NyleGarcia/rsi-plus/compare/v0.11.0...v0.11.1) (2026-11-01)


### Bug Fixes

* **hangar:** LTI counts ships on LTI pledges so it lines up with the ships count ([9058325](https://github.com/NyleGarcia/rsi-plus/commit/905832551f7cf8fa6e463902236da3789df86839))
* **hangar:** ships the catalog doesn't list (Odin, F8C) are owned ships; add Odin at its $5,000 pledge price ([9738992](https://github.com/NyleGarcia/rsi-plus/commit/9738992477fb0330be281350ff1f654b0effb521))

## [0.11.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.10.0...v0.11.0) (2026-11-01)


### Features

* **hangar:** sticky header that sorts ships and pledges, per-ship sort, sortable labels and entries; accent pills and live slider values ([bd39136](https://github.com/NyleGarcia/rsi-plus/commit/bd391367025b351af96518a2e7b60c90ec120117))

## [0.10.0](https://github.com/NyleGarcia/rsi-plus/compare/v0.9.0...v0.10.0) (2026-11-01)


### Features

* **hangar:** clearer ship-owned badges and a Show filter for group by ship ([f316076](https://github.com/NyleGarcia/rsi-plus/commit/f31607621e095b5dc9b6973a071fa4d4bbac7ff0))
* **hangar:** MSRP column and saved-vs-MSRP total on pledges (upgraded pledges priced at their CCU target) ([b38faed](https://github.com/NyleGarcia/rsi-plus/commit/b38faedd8f85e86effdfe4bb324aeb71913b14c2))


### Bug Fixes

* **hangar:** line up pledge table columns across ship groups ([9d5f50d](https://github.com/NyleGarcia/rsi-plus/commit/9d5f50d0b0519f3442bea85499d4283c6a214798))

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
