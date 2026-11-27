# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [3.8.3](https://github.com/Piwero/tuk-tuk/compare/v3.8.2...v3.8.3) - 2026-11-27

### Bug Fixes

- Keep today's calendar grid neutral ([b54a029](https://github.com/Piwero/tuk-tuk/commit/b54a029dd2701dbb3433eb5b358738febcd6cccc))
- Show three calendar days on mobile ([24caaec](https://github.com/Piwero/tuk-tuk/commit/24caaec5c19cefa09b376a0175dd758161331660))
- Preserve mobile title wrapping and latest calendar data ([befc41f](https://github.com/Piwero/tuk-tuk/commit/befc41f8cb35dce4127e248e0c30836f809e992e))

## [3.8.2](https://github.com/Piwero/tuk-tuk/compare/v3.8.1...v3.8.2) - 2026-11-27

### Features

- Allow admins to delete user accounts ([5d650e4](https://github.com/Piwero/tuk-tuk/commit/5d650e406b1941964ac0b5f52764b76b89223b0c))

## [3.8.1](https://github.com/Piwero/tuk-tuk/compare/v3.8.0...v3.8.1) - 2026-11-26

### Features

- **frontend:** Open and touch-drag Unscheduled tasks in the calendar ([6040b52](https://github.com/Piwero/tuk-tuk/commit/6040b523c0b2458a62205c6c99df4e53ac8dd98b))

### Bug Fixes

- **frontend:** Today's calendar column wash spans the whole day ([5d71186](https://github.com/Piwero/tuk-tuk/commit/5d7118625f9781c18e1463cf99fe64f197682393))
- **frontend:** Keep a tapped Task row's actions hidden on phones ([d820e86](https://github.com/Piwero/tuk-tuk/commit/d820e865e789b9704c6764572abdc05f93e2d61c))
- **frontend:** Fit the Habits week grid and recent-days strips on phones ([004e2f0](https://github.com/Piwero/tuk-tuk/commit/004e2f0877512e9f4c9c60871de592abecff16db))
- **frontend:** Theme the date panel's days and tidy its layout ([55bd973](https://github.com/Piwero/tuk-tuk/commit/55bd973c5811bc770637c81df659d5e1ddeefe45))

## [3.8.0](https://github.com/Piwero/tuk-tuk/compare/v3.7.0...v3.8.0) - 2026-11-26

### Features

- **backend:** Invite-only Google sign-in with optional Calendar onboarding (#586) ([c684c96](https://github.com/Piwero/tuk-tuk/commit/c684c9686b03901570ea722fc5d5235a309f6434))
- **frontend:** Google sign-in, invitation acceptance and Admin invitations (#586) ([ec39f9e](https://github.com/Piwero/tuk-tuk/commit/ec39f9e5a1ee6f640055e8751ee2f47ffb8aec59))

## [3.7.0](https://github.com/Piwero/tuk-tuk/compare/v3.6.0...v3.7.0) - 2026-11-26

### Features

- **github:** Add a GitHub Token through the API (#578) ([299fca3](https://github.com/Piwero/tuk-tuk/commit/299fca34da97acd1e546a1a23bcdfab889f07120))
- **github:** Add and remove GitHub Tokens in a new Settings tab (#578) ([acc781d](https://github.com/Piwero/tuk-tuk/commit/acc781de79eedd12c650c6976fefdc9e8af13fcb))
- **github:** Watched repositories picker API (#581) ([608e79d](https://github.com/Piwero/tuk-tuk/commit/608e79d93eb70fa8a4d4fad19e865754d6238d4b))
- **github:** Watched repositories picker in Settings (#581) ([badc80b](https://github.com/Piwero/tuk-tuk/commit/badc80b45deb071d695e7906d59df39410395e2a))
- **github:** List open Pull Requests of Watched Repositories through the API (#579) ([a980581](https://github.com/Piwero/tuk-tuk/commit/a98058115325ecc52cad224587f307ef4241189c))
- **github:** GitHub view with a Pull Requests tab in the sidebar (#579) ([05e50da](https://github.com/Piwero/tuk-tuk/commit/05e50da2a376f51e164ff2cda423251d2294f455))
- **github:** List open GitHub Issues of Watched Repositories through the API (#582) ([84fe24e](https://github.com/Piwero/tuk-tuk/commit/84fe24efdaf1db74b082511b6f4717daf3f52679))
- **github:** GitHub Issues tab in the GitHub view (#582) ([f3bc817](https://github.com/Piwero/tuk-tuk/commit/f3bc81702c15c2ab517cc03e51c5e2a47d8911d2))
- **github:** Filter the GitHub view by author and label (#585) ([ca96d30](https://github.com/Piwero/tuk-tuk/commit/ca96d308f5bec2d6695517fd4c8b508f6526fb53))
- **github:** Filter GitHub Issues by assignee and hide drafts and bots (#585) ([952f0c8](https://github.com/Piwero/tuk-tuk/commit/952f0c8ca390160008255326be2ab4e0b24cc75b))
- **github:** Keep Pull Request groups with filtered counts and say when filters empty a list (#585) ([b074098](https://github.com/Piwero/tuk-tuk/commit/b07409823043ffe1437401f3aae3fd0b9cd19b75))
- **github:** Forget GitHub view filters on leaving the view (#585) ([11897ad](https://github.com/Piwero/tuk-tuk/commit/11897ad797d985db983982e86c874e1c49f1e3ca))
- **github:** A GitHub Token GitHub rejects while reading needs reconnection, and Reconnect replaces it in place (#584) ([83b243d](https://github.com/Piwero/tuk-tuk/commit/83b243d2ecabaf3146df70c6e8135710633d0507))
- **github:** Warn when a GitHub Token expires within 7 days (#584) ([f2131aa](https://github.com/Piwero/tuk-tuk/commit/f2131aa940879a4c609d35985d5b132aa15bcd2c))
- **github:** Banner per failing or expiring GitHub Token in the GitHub view (#584) ([6bb0840](https://github.com/Piwero/tuk-tuk/commit/6bb0840e952b51552eb69df2145e6c22e4920634))
- **github:** Reconnect a GitHub Token in Settings and warn there before it expires (#584) ([1925688](https://github.com/Piwero/tuk-tuk/commit/1925688de02b2bc0f45dd01f0a87d0615573682e))
- **github:** Create, rename, reorder and delete Repository Views through the API (#580) ([3650103](https://github.com/Piwero/tuk-tuk/commit/3650103f653c83a9499ded828ea3ac7c4b05c800))
- **github:** Read a Repository View's Pull Requests and GitHub Issues, isolated per User (#580) ([569d0ff](https://github.com/Piwero/tuk-tuk/commit/569d0ff6858ecbb4350aa2d542a3ecb3e2b554ec))
- **github:** Repository Views under GitHub in the sidebar, each opening with its saved filters and tab (#580) ([b257105](https://github.com/Piwero/tuk-tuk/commit/b257105fb38a9838698af62487fb34c844d6647f))
- **github:** Cache each GitHub Token's reads for 60 seconds, Refresh bypasses it (#583) ([1824890](https://github.com/Piwero/tuk-tuk/commit/1824890573829b8ca33462acfa35ecfc0bf7d69d))
- **github:** A GitHub view read carries when its results were fetched from GitHub (#583) ([d597bd9](https://github.com/Piwero/tuk-tuk/commit/d597bd9b4e003c67971122fd917413a3d12d9d8f))
- **github:** On a transient GitHub failure, serve a token's last result under 10 minutes old as stale (#583) ([d6601f6](https://github.com/Piwero/tuk-tuk/commit/d6601f64a599b810d936a5d6e5a4b1270ab9bc7b))
- **github:** Never show a cached result for a GitHub Token GitHub has rejected (#583) ([7597426](https://github.com/Piwero/tuk-tuk/commit/75974269d50422c4b2b78a92692974d5e28f453a))
- **github:** A repository watched within the minute is read from GitHub, not missed in the cache (#583) ([337fa0f](https://github.com/Piwero/tuk-tuk/commit/337fa0f875669fe01736fca9efe7e7db87468f54))
- **github:** The GitHub view shows how long ago its data was fetched (#583) ([c7c9627](https://github.com/Piwero/tuk-tuk/commit/c7c96279830b01914095c475739c025ad1ab76d8))
- **github:** Refresh in the GitHub view reads from GitHub now (#583) ([7e4e47f](https://github.com/Piwero/tuk-tuk/commit/7e4e47f06592ece6c4c2a55bc3eac5b2de64acaf))
- **github:** A stale notice with Retry when GitHub can't be reached, and Retry for a token with nothing recent (#583) ([4a68233](https://github.com/Piwero/tuk-tuk/commit/4a6823305b1f69105d6962cd5151959cebb35c1c))

### Bug Fixes

- **frontend:** Age GitHub view rows from when they were opened (#579, #582) ([0cfc0b8](https://github.com/Piwero/tuk-tuk/commit/0cfc0b82b204d7b3d9770cfe9418c11e961d1f33))
- **github:** Never guess a GitHub Token's owner (#578, #581) ([cb6e999](https://github.com/Piwero/tuk-tuk/commit/cb6e9994679e2dc8fd6b5179dfad73b22ca6c223))
- **github:** Follow the documented standards in the GitHub UI and docs (#576) ([1132f3c](https://github.com/Piwero/tuk-tuk/commit/1132f3c5e99ca3a2ae691dba7ccf8e9b7c173663))
- **backend:** Reconnect a GitHub Token GitHub accepts again (#584) ([b0ce933](https://github.com/Piwero/tuk-tuk/commit/b0ce9333262af56b51c89554216816e0181690b5))

## [3.6.0](https://github.com/Piwero/tuk-tuk/compare/v3.5.0...v3.6.0) - 2026-11-26

### Features

- ADHD phase 4 assisted-start experiments (#577) ([a10c2aa](https://github.com/Piwero/tuk-tuk/commit/a10c2aa1d9abda86279efac750310e2a7fb54d69))

## [3.5.0](https://github.com/Piwero/tuk-tuk/compare/v3.4.1...v3.5.0) - 2026-11-26

### Features

- **habits:** Pause a Habit for a date range (#559) ([4687461](https://github.com/Piwero/tuk-tuk/commit/4687461271853fd1f32dc59c617575893da3ed4f))
- **habits:** Show paused Habits with Edit pause and Resume today (#559) ([d0d1ca8](https://github.com/Piwero/tuk-tuk/commit/d0d1ca87693d78972ff27af0f29dbe62554de5f5))
- **backend:** Per-User reminder notifications setting (#557) ([54799c9](https://github.com/Piwero/tuk-tuk/commit/54799c929630cdb31c8c9f5676c4ef3bbc9e7219))
- **frontend:** Opt-in Reminder notifications setup with honest limits (#557) ([1987d4c](https://github.com/Piwero/tuk-tuk/commit/1987d4c790c722551f200c09f2c19d8c20716fe3))
- **tasks:** Planned work block on a Task, separate from the due date (#558) ([d3ff292](https://github.com/Piwero/tuk-tuk/commit/d3ff2923de0fa73af61b54b72f81296952d6c21f))
- **frontend:** Planned work row in Task detail (#558) ([18b8dcf](https://github.com/Piwero/tuk-tuk/commit/18b8dcf276497ad5e45b6323cd225bbd148749a2))
- **calendar:** Include Planned work in the Task range window (#562) ([74f6d9a](https://github.com/Piwero/tuk-tuk/commit/74f6d9a4d965434f9d9f8f4f6bf1300216589641))
- **calendar:** Render Planned work as its own labelled Entry (#562) ([59842cc](https://github.com/Piwero/tuk-tuk/commit/59842cc48e7464bafab952f309e7fb00677f8b5b))
- **backend:** Reminder delivery ledger with claim/lease for open tabs (#561) ([c345a62](https://github.com/Piwero/tuk-tuk/commit/c345a62ee6f9b3751937f5b480623fe0298ee571))
- **frontend:** Show due Reminders as notifications in an open tab (#561) ([d95d04f](https://github.com/Piwero/tuk-tuk/commit/d95d04fba951ae0f4c685dd3d1a1cf520e4172ea))
- **habits:** Skip one scheduled Habit day on purpose (#564) ([c143f52](https://github.com/Piwero/tuk-tuk/commit/c143f5245f9958eb851a8e9274facb63d8a85b90))
- **habits:** Skip today or any scheduled day, and undo it (#564) ([bc3b67e](https://github.com/Piwero/tuk-tuk/commit/bc3b67e22b32cbb04eca76d114b6a88407031452))
- **habits:** Weekly target under pause and skip for times-per-week Habits (#568) ([9d9d46b](https://github.com/Piwero/tuk-tuk/commit/9d9d46bc72b07557b44ea6e360578e9bd7dbddae))
- **reminders:** Hold reminders during quiet hours (#567) ([8bb03e8](https://github.com/Piwero/tuk-tuk/commit/8bb03e8594b8b7ca0659a5d419c88b4c7ae40069))
- **frontend:** Quiet hours settings and deferred state (#567) ([9e0f141](https://github.com/Piwero/tuk-tuk/commit/9e0f14174b1b691b07add20cb3027a0252e6a002))
- **reminders:** Snooze a delivered reminder as a ledger override (#566) ([ecdbc3a](https://github.com/Piwero/tuk-tuk/commit/ecdbc3a82eb848904cad0dbb238f35961e8e9e10))
- **reminders:** Offer snooze on delivered reminders with deadline-unchanged copy (#566) ([226d1e8](https://github.com/Piwero/tuk-tuk/commit/226d1e8cd5daabc6f49a4356cb6e825dc3d338bc))
- **reminders:** List and dismiss missed reminders (#565) ([492abfe](https://github.com/Piwero/tuk-tuk/commit/492abfeb57b45bc35046705fcbc62a820607d71c))
- **reminders:** Show missed reminders in-app instead of late alerts (#565) ([f624627](https://github.com/Piwero/tuk-tuk/commit/f6246274e2485e3ae11fb6d5fd478d25b531133e))
- **settings:** Per-User planning window kept apart from Active hours (#563) ([dac40f0](https://github.com/Piwero/tuk-tuk/commit/dac40f01a7d78d347e165924abfda4d25f80fef6))
- **frontend:** Capacity of a planning window, overlaps counted once (#563) ([8d2a9fb](https://github.com/Piwero/tuk-tuk/commit/8d2a9fb53b51d9ef042c6032b01d9ee4c1670f84))
- **frontend:** Capacity summary for the planning window in the Day view (#563) ([3e92706](https://github.com/Piwero/tuk-tuk/commit/3e927060f4aafcbe4a3d4cd7f44f93ef30392358))
- **reminders:** Offer snooze from the missed list (#566) ([fe61efc](https://github.com/Piwero/tuk-tuk/commit/fe61efc9ddc76c4b029b95ae6778e49326940a13))
- **tasks:** Optional duration estimate for work planning (#563) ([2ef22b8](https://github.com/Piwero/tuk-tuk/commit/2ef22b8147f1ea76adcfa415f12e03e4701c840d))

### Bug Fixes

- **migrations:** Chain planned-work migration after habit pauses (#558) ([32fa058](https://github.com/Piwero/tuk-tuk/commit/32fa058cc8cd1e4f0654cf7b665f4aeb1f7d7e25))
- **migrations:** Chain reminder deliveries after planned work (#561) ([9a99e0d](https://github.com/Piwero/tuk-tuk/commit/9a99e0dda98ce6b01ced6e0fcfc8683cc8a2609b))
- **migrations:** Chain habit skips after reminder deliveries (#564) ([c0efe26](https://github.com/Piwero/tuk-tuk/commit/c0efe26491e4f57c50de529a61ca9e5f8d559e0f))
- **migrations:** Chain planning window after quiet hours (#563) ([b6a9dff](https://github.com/Piwero/tuk-tuk/commit/b6a9dff6a8d1c11d4fada4330d2c46451f9a5671))
- **frontend:** Close Phase 3 accessibility and phone layout gaps (#569) ([2d70773](https://github.com/Piwero/tuk-tuk/commit/2d70773a1f04cf0204b368ae803fd9797f107245))
- **reminders:** Bound missed list by opt-in time (#565) ([1710a37](https://github.com/Piwero/tuk-tuk/commit/1710a37b16c741a0c3a02c38501ba45bd96ff096))
- **reminders:** Per-device opt-in and honest background-tab copy (#557, #561) ([088340a](https://github.com/Piwero/tuk-tuk/commit/088340a6c19319b30af54c69e2c7e9d04fb93c48))
- **frontend:** Flat Phase 3 marks and token sizes, guarded in CSS source (#562, #564, #566, #567) ([fc3f3ba](https://github.com/Piwero/tuk-tuk/commit/fc3f3ba942558344f6cdc3a0f267ab489ce5bff0))

## [3.4.1](https://github.com/Piwero/tuk-tuk/compare/v3.4.0...v3.4.1) - 2026-11-25

_Maintenance release; no user-facing changes._

## [3.4.0](https://github.com/Piwero/tuk-tuk/compare/v3.3.0...v3.4.0) - 2026-11-25

### Features

- **backend:** Per-User gentle return setting (#548) ([0c3b085](https://github.com/Piwero/tuk-tuk/commit/0c3b08523edd88986a7a7449c7e0e726cbb61265))
- **frontend:** Gentle return collapses earlier overdue Tasks in Today (#548) ([17d7ebd](https://github.com/Piwero/tuk-tuk/commit/17d7ebd293fd9e3ce2def656ba67030a75895259))
- **backend:** Store one Now Task per User behind its own endpoint (#547) ([0a8bbdd](https://github.com/Piwero/tuk-tuk/commit/0a8bbddaec6c6297178e7bfa4710e3d9a6f68564))
- **frontend:** Choose, replace and clear a Now Task in Today (#547) ([8f29d01](https://github.com/Piwero/tuk-tuk/commit/8f29d010edcde2da9ad5b40cf75de450a9ea4875))
- **backend:** Retry-safe Focus Session create via client_run_id (#546) ([6cb4d20](https://github.com/Piwero/tuk-tuk/commit/6cb4d20a9603bdb2e4f3ba0010594af32ba6021b))
- **frontend:** Send a per-run id so a retried Focus finish records once (#546) ([80d9c95](https://github.com/Piwero/tuk-tuk/commit/80d9c954bc0fdc54705d42543f5b34bdf1af2d57))
- **backend:** Let a Check Item tick skip auto-completing its Task ([54429a6](https://github.com/Piwero/tuk-tuk/commit/54429a62f814079207daa22af13e413084088c2c))
- **frontend:** Show and tick the next Check Item in Now ([26c8e09](https://github.com/Piwero/tuk-tuk/commit/26c8e09b3529be8a52cbf245859e5988799c7a64))
- **frontend:** Offer deliberate Task completion in Now once every Check Item is done ([76920e0](https://github.com/Piwero/tuk-tuk/commit/76920e0ccecda6a27b1744ad268ad1ded3ee6e8d))
- **backend:** Prune deleted, completed and advanced Now selections on read (#549) ([0312c5f](https://github.com/Piwero/tuk-tuk/commit/0312c5f17f36931fc876dc8d1a78c9fe968d6185))
- **frontend:** Clear the Now panel when its Task is completed or advanced (#549) ([22f1bdb](https://github.com/Piwero/tuk-tuk/commit/22f1bdbc6eb0c94d10090246d6cba6f8b7a50917))
- **now:** Work without timer from the Now panel (#553) ([698dc25](https://github.com/Piwero/tuk-tuk/commit/698dc252ff60705fe6af94cdb886fc0ef3255990))
- **now:** Start 5 min begins a linked five-minute Pomo (#552) ([bf98bc3](https://github.com/Piwero/tuk-tuk/commit/bf98bc33b50d7571487c4f98640ddf7811cf7f9b))
- **now:** Offer return or pause when Focus is already running (#552) ([df439f0](https://github.com/Piwero/tuk-tuk/commit/df439f024d6c5cdcccc865ba709258c50e20f5f3))
- **now:** Store an optional resume note on the Now selection ([58058ef](https://github.com/Piwero/tuk-tuk/commit/58058ef0ab8b3da5d875bf635170f14518c12d43))
- **now:** Offer an optional resume note while Focus is paused ([d7ddba6](https://github.com/Piwero/tuk-tuk/commit/d7ddba6cca2193583e4812c009e8407f9a900a8b))
- **backend:** Ordered Now shortlist stored per User (#551) ([232b8de](https://github.com/Piwero/tuk-tuk/commit/232b8de39eda349453312ef81a712e05c3788a1b))
- **frontend:** Ordered shortlist beside Now (#551) ([9b56b19](https://github.com/Piwero/tuk-tuk/commit/9b56b1971e7d4f4c689e9544e5759358c5471682))

### Bug Fixes

- **backend:** Renumber no-downgrade messages in 0043/0044 migrations ([dd3ae11](https://github.com/Piwero/tuk-tuk/commit/dd3ae11a3e634d784d07cf62f6cf6c470a39dfbb))
- **now:** Meet the 44px tap-target floor across the mobile breakpoint ([1983f6c](https://github.com/Piwero/tuk-tuk/commit/1983f6c8f7f956028b99a1deb8e39d8041e532e7))
- **now:** Keep keyboard focus in the shortlist after row actions ([01a213a](https://github.com/Piwero/tuk-tuk/commit/01a213a6615485612f25b55d13a5be926e811127))
- **now:** Reject completed Tasks and keep shortlist snapshots on rewrite (#534) ([f3ee4e1](https://github.com/Piwero/tuk-tuk/commit/f3ee4e19fbc178643e0fc78cdecf8b894e5cb01f))
- **now:** Announce the confirmed Now Task in the live region (#534) ([4c89987](https://github.com/Piwero/tuk-tuk/commit/4c89987a06a7edb7239b82f0c0f1e50869d6973a))

## [3.3.0](https://github.com/Piwero/tuk-tuk/compare/v3.2.1...v3.3.0) - 2026-11-25

### Features

- **backend:** Expose the Habit start as eligible_from in Habit statistics ([d07489e](https://github.com/Piwero/tuk-tuk/commit/d07489ebc2d0c54c95bed66670e62539b0e327b2))
- **frontend:** Send the browser time zone with Habit statistics reads ([2f8f7ea](https://github.com/Piwero/tuk-tuk/commit/2f8f7ea4ff76b32f2ce594b8c2b8f7a0be5edc0e))
- **frontend:** Label Habit types in plain language ([61babf2](https://github.com/Piwero/tuk-tuk/commit/61babf2477290c1129342ca4664b37e38979b448))
- **frontend:** Put the Quick-Add title first, with details behind a disclosure ([04d056c](https://github.com/Piwero/tuk-tuk/commit/04d056c196cec6e6bcf0e8bde6024609762c8911))
- **frontend:** Show saving, validation and failed-save retry in Quick-Add ([a6503c3](https://github.com/Piwero/tuk-tuk/commit/a6503c390ead1e9a7f4d4de7c447b166c7bee35b))
- **frontend:** Show days before the Habit start as not started, never missed ([fcc92d6](https://github.com/Piwero/tuk-tuk/commit/fcc92d688b788bf7c4c029d7f507d1854571d720))
- **frontend:** Keep an unsent Quick-Add draft for the signed-in User ([f7b2149](https://github.com/Piwero/tuk-tuk/commit/f7b2149721801b9d4f2695d66b63faf217b4da97))

### Bug Fixes

- **frontend:** Scope task selection to its view in render, not an effect ([fdc020c](https://github.com/Piwero/tuk-tuk/commit/fdc020c80e15c8dd730f40864c4ae0479355507e))
- **deps:** Finish the React 19 upgrade in frontend/oci ([72eb4ea](https://github.com/Piwero/tuk-tuk/commit/72eb4ea80dd95f6ec115ebb67ab946b50c845d71))
- **frontend:** Label navigate-only Focus entry points "Open Focus" ([ac551f6](https://github.com/Piwero/tuk-tuk/commit/ac551f6526d11a9afdc6dc48d3c5c8d799d0de4c))
- **frontend:** Keep Quick-Add's Save on screen at short and narrow viewports ([48efeea](https://github.com/Piwero/tuk-tuk/commit/48efeea78f29692899836ab9d33be9bc31ef1bb5))
- **frontend:** Read Habit days with one rule and say today's state on screen ([04d4c9c](https://github.com/Piwero/tuk-tuk/commit/04d4c9cad27984f50c8cc7399f1fda053e034aeb))
- **frontend:** Make a discarded Quick-Add draft undoable and forget others' drafts ([e3be99a](https://github.com/Piwero/tuk-tuk/commit/e3be99a111dc2e7c7c657945e396782d67205813))
- **frontend:** Leave Quick-Add Details as it was after an Assist parse ([5c6aa44](https://github.com/Piwero/tuk-tuk/commit/5c6aa443111a0eb5ba44e9ca353ba27d757a0a7b))

## [3.2.1](https://github.com/Piwero/tuk-tuk/compare/v3.2.0...v3.2.1) - 2026-11-21

### Bug Fixes

- **deps:** Bump backend packages flagged by Dependabot ([03bb721](https://github.com/Piwero/tuk-tuk/commit/03bb721b3d4a8576fcd20e272edcf861125c8b33))

## [3.2.0](https://github.com/Piwero/tuk-tuk/compare/v3.1.1...v3.2.0) - 2026-11-21

### Features

- **mcp:** Serve every User through one shared MCP server ([4f48b75](https://github.com/Piwero/tuk-tuk/commit/4f48b754f1ab6771dbdf6aea7442bc9b3510e23b))

## [3.1.1](https://github.com/Piwero/tuk-tuk/compare/v3.1.0...v3.1.1) - 2026-11-20

### Bug Fixes

- **frontend:** Keep the tapped Task row readable in the dark theme ([cb62a59](https://github.com/Piwero/tuk-tuk/commit/cb62a5955120ed76e9860d446d6887b82135a84e))
- **frontend:** Give every dark-theme surface a semantic colour alias ([bba9a32](https://github.com/Piwero/tuk-tuk/commit/bba9a32cac00ff432a0fec9a6c523ab85dec187e))

## [3.1.0](https://github.com/Piwero/tuk-tuk/compare/v3.0.1...v3.1.0) - 2026-11-20

### Bug Fixes

- **backend:** Let PostgreSQL enforce delete rules on the bare foreign keys ([ec4ad03](https://github.com/Piwero/tuk-tuk/commit/ec4ad03b33158dffd37364c13e7d7e3e3074b479))

## [3.0.1](https://github.com/Piwero/tuk-tuk/compare/v3.0.0...v3.0.1) - 2026-11-20

### Bug Fixes

- **backend:** Drop each test database when its test ends ([bf6d0c0](https://github.com/Piwero/tuk-tuk/commit/bf6d0c0350cdcd6387e3dd236731835c1a113c10))

## [3.0.0](https://github.com/Piwero/tuk-tuk/compare/v2.21.1...v3.0.0) - 2026-11-20

### Features

- **deploy:** Tailnet egress to postgres-supernova ([702d3fc](https://github.com/Piwero/tuk-tuk/commit/702d3fc95491041a158b6f35ba65bab8bd623680))
- **deploy:** Enable tuk-tuk-db secret for PostgreSQL cutover ([f0803c9](https://github.com/Piwero/tuk-tuk/commit/f0803c9b64c91763c0874873683cbd121deacbb3))
- **backend:** PostgreSQL is the only database ([b666354](https://github.com/Piwero/tuk-tuk/commit/b666354c67f183c884a3f868ec97a86fa17e73fb))
- **frontend:** Settings > Database always reports PostgreSQL ([757d7e5](https://github.com/Piwero/tuk-tuk/commit/757d7e5900f201fd2bdd4046c7ffd2098038d621))
- **deploy:** Postgres service in both compose files ([1e6600d](https://github.com/Piwero/tuk-tuk/commit/1e6600d05a4ee5440f64fe0f60defc40667cdbd7))
- **deploy:** DATABASE_URL only from the required tuk-tuk-db secret ([c80872b](https://github.com/Piwero/tuk-tuk/commit/c80872b0536f4baa6521b049fe310d63e3231bbe))
- **backend:** Add users table and owner_id on every owned table ([0f8a338](https://github.com/Piwero/tuk-tuk/commit/0f8a3380bf7c71ae4ac4d409221a07402084d4b3))
- Merge #408 users schema and owner_id ([7dc38db](https://github.com/Piwero/tuk-tuk/commit/7dc38dba9e148fcf01a3328d2902a99c14318b6b))
- **backend:** Per-user login, session epoch and forced steps ([8a91b60](https://github.com/Piwero/tuk-tuk/commit/8a91b60c850d02d415d3ae94531497188c00f134))
- **backend:** Split settings singleton into per-user user_settings ([56cdab8](https://github.com/Piwero/tuk-tuk/commit/56cdab873dd8405b7e8634c4d9739892f370a5cd))
- **backend:** Drop settings.password_hash ([ad4fc33](https://github.com/Piwero/tuk-tuk/commit/ad4fc33d74a5dae4c7a977dbe723cc5424dbc4b0))
- Merge #409 per-user user_settings ([17146df](https://github.com/Piwero/tuk-tuk/commit/17146dfdba65b268c3c3dfd74c92507b5ef42f99))
- Merge #410 per-user auth ([28169c3](https://github.com/Piwero/tuk-tuk/commit/28169c3e6e957cf1e4e020cd51b3711fdcf39120))
- **backend:** Admin users API ([e8e86ea](https://github.com/Piwero/tuk-tuk/commit/e8e86ea53bd391766692b8a718d65f8b5296583b))
- Merge #412 admin users API ([40925ae](https://github.com/Piwero/tuk-tuk/commit/40925ae4cbafdde911d1ced20cff03c0083620a0))
- **frontend:** Per-user sign-in and first-run setup ([7d71de2](https://github.com/Piwero/tuk-tuk/commit/7d71de2f3f84612b3b411183ccc436f830e99206))
- Merge #469 #470 sign-in and first-run setup ([07fa51a](https://github.com/Piwero/tuk-tuk/commit/07fa51a683cd6d3413ff0937d19d4cf05daba78f))
- **backend:** Let a signed-in user edit their own username and email ([2319a13](https://github.com/Piwero/tuk-tuk/commit/2319a13c10f235df4153deda6dd9a77d1c926774))
- **frontend:** Settings tabs and My account profile ([32a8ee5](https://github.com/Piwero/tuk-tuk/commit/32a8ee580e9b12d528498c0b1cbb6c3ded74cc00))
- **frontend:** Forced step to replace a temporary password ([a6141b4](https://github.com/Piwero/tuk-tuk/commit/a6141b428d36b7ad4f8dec34170bad0bfd8b5e30))
- Merge #471 forced password step ([908d840](https://github.com/Piwero/tuk-tuk/commit/908d840d4a92e7da9ddbad576c259a5553b3f556))
- Merge #474 settings tabs and My account profile ([950c6fd](https://github.com/Piwero/tuk-tuk/commit/950c6fdb365f20521da93e71c3bc6aa5eccbce14))
- **backend:** Record when each user's password last changed ([f7cce2b](https://github.com/Piwero/tuk-tuk/commit/f7cce2be9196e01afff43dfa7b59e1574c09b66a))
- **frontend:** Password row and change-password dialog in My account ([2c45945](https://github.com/Piwero/tuk-tuk/commit/2c45945ce19e442a02aa34f01bbc1098eb672060))
- **backend:** Enforce row ownership centrally ([896674e](https://github.com/Piwero/tuk-tuk/commit/896674ed169444ba651c81c7fe370aa92b70659b))
- Merge #411 global owner filter and isolation test ([1489507](https://github.com/Piwero/tuk-tuk/commit/1489507ed8faa18eb2cd9efebeccc70af84b23c8))
- **frontend:** User menu at the top right and at the head of the More sheet ([30eb5be](https://github.com/Piwero/tuk-tuk/commit/30eb5be42372070f0d10d6f2e1d8d29379db7301))
- Merge #473 user menu ([1d41c40](https://github.com/Piwero/tuk-tuk/commit/1d41c40d4343cc1b4133ec8c2d0c9a0233e4c777))
- **frontend:** Forced step to complete the upgraded user's profile ([ca0497f](https://github.com/Piwero/tuk-tuk/commit/ca0497ffae18f6d4f6eb49eefd4f47f653a657f2))
- Merge #472 complete profile step ([5125779](https://github.com/Piwero/tuk-tuk/commit/5125779602c30a4d1890b26710fcd11c982a9f87))
- Merge #475 change password and password-changed time ([e76ff4a](https://github.com/Piwero/tuk-tuk/commit/e76ff4a793461ec397fea1dc9b423ed72c9e531a))
- **frontend:** List accounts in Settings › Users for admins ([cbd2d25](https://github.com/Piwero/tuk-tuk/commit/cbd2d25e48597a7cd3ae2845c082fe0a141ea525))
- Merge #477 users list for admins ([b5a6cf5](https://github.com/Piwero/tuk-tuk/commit/b5a6cf568238f422fce29fee0b5481f796eeac30))
- **frontend:** Create users with a one-time temporary password ([56ba293](https://github.com/Piwero/tuk-tuk/commit/56ba293a4ff4cf7e9812fea9722c079fba3a14cb))
- Merge #479 create user with one-time temporary password ([504b017](https://github.com/Piwero/tuk-tuk/commit/504b01779fe261d38b1ca96de49cb033d324a93b))
- **frontend:** Disable, enable and change a user's role from the Users row menu ([696a5e8](https://github.com/Piwero/tuk-tuk/commit/696a5e8d4b328bda5b3aaea92f8d7ba1e6f2384b))
- Merge #481 disable, enable and role from the Users row menu ([7fa6c3e](https://github.com/Piwero/tuk-tuk/commit/7fa6c3eba59dce62cefcf83d9bc3d962be714902))
- **backend:** Record when each account was last active ([9828f75](https://github.com/Piwero/tuk-tuk/commit/9828f756eb77b94ee021535797398c47ba8ae9d0))
- **frontend:** Show when each account was last active in Settings › Users ([61d34c9](https://github.com/Piwero/tuk-tuk/commit/61d34c9b87126fbd0408f4ff6eb3fe6a09dd1347))
- Merge #478 last active on accounts ([b2a3e74](https://github.com/Piwero/tuk-tuk/commit/b2a3e74afde0b6d05d703a3ab7a886935138c27d))
- **frontend:** Reset a user's password from the Users row menu ([bce7fb7](https://github.com/Piwero/tuk-tuk/commit/bce7fb7d42de87e9c2319e5b4badf93e5904ffba))
- Merge #480 reset a user's password ([0ab4d81](https://github.com/Piwero/tuk-tuk/commit/0ab4d81fa873cc472c77e34833f5a32c04a37d61))
- **backend:** Personal API tokens with Bearer authentication ([1101c57](https://github.com/Piwero/tuk-tuk/commit/1101c57822ae89a54e0f6f12af7a9f412c4db8ac))
- **mcp:** Authenticate HTTP mode with TUK_API_TOKEN ([8193663](https://github.com/Piwero/tuk-tuk/commit/81936638967914cccc74e782d1b84f26ad9af41e))
- Merge #413 personal API tokens ([684fa09](https://github.com/Piwero/tuk-tuk/commit/684fa0949152081a8b1b68094b768404cce57a68))
- **cli:** Tuk login asks for a username or email ([d9b99e3](https://github.com/Piwero/tuk-tuk/commit/d9b99e3f45f642ee6fda264b5c994f6c11d2698d))
- **backend:** Voice room names carry the user's id ([a7ad3c6](https://github.com/Piwero/tuk-tuk/commit/a7ad3c65f64ab03cbf1fc8d122315cb6774f7ce6))
- **deploy:** The MCP chart's secret holds TUK_API_TOKEN ([f0c2356](https://github.com/Piwero/tuk-tuk/commit/f0c2356165752d9b91f900eb2e42dfbbd05bfdb3))
- **frontend:** API tokens card in My account (#476) ([5555c76](https://github.com/Piwero/tuk-tuk/commit/5555c7661081315236a72ca860e716d0c49e04c7))
- Merge #476 API tokens UI in My account ([3ed8be0](https://github.com/Piwero/tuk-tuk/commit/3ed8be0f2f5334985b9c2ee604259f1d20b8e325))
- Merge #416 clients: CLI username login, MCP token, per-user voice ([0bcc125](https://github.com/Piwero/tuk-tuk/commit/0bcc125926bfb41f853d030dca9a45beb2236cd6))

### Bug Fixes

- **backend:** Pin image base to python:3.14-slim and build it in CI ([12f59bd](https://github.com/Piwero/tuk-tuk/commit/12f59bdb63d239b54cbc4b26c22f78ff43dd250e))
- **backend:** Delete a list whose tasks are filed in its sections ([986c6c1](https://github.com/Piwero/tuk-tuk/commit/986c6c1252d3006111e7f835bbe725e10441958c))
- **backend:** Make the database settings admin-only and refuse them to API tokens ([40be1b1](https://github.com/Piwero/tuk-tuk/commit/40be1b19c4f912dfa4b73a262be040d6434e9ef9))
- **backend:** Bind the Google OAuth state to the User who started it ([59000ec](https://github.com/Piwero/tuk-tuk/commit/59000ec98ed830c283ad5e524110d11be6164cdc))
- **backend:** Stop the multi-user migration on data the new uniqueness refuses ([7ca43f3](https://github.com/Piwero/tuk-tuk/commit/7ca43f32340ce982b69f39bbc1279d0a8ef3b038))
- **backend:** Report a username or email lost to a race as 409, not 500 ([afc2d78](https://github.com/Piwero/tuk-tuk/commit/afc2d78893de3a9fb9e9de811a1a5d9c40150d41))
- **backend:** Mark the first Admin active under AUTH_DISABLED ([bcce2f5](https://github.com/Piwero/tuk-tuk/commit/bcce2f5a7e59b6e21fc731d46077e3dd753ea68f))
- Name the first Admin in the CLI and MCP setup_required message ([c69451e](https://github.com/Piwero/tuk-tuk/commit/c69451e535ae23e0e6d2ff9fb254af10ff4fd620))
- **frontend:** Say 'at next sign-in' when showing a reset temporary password ([667bfd9](https://github.com/Piwero/tuk-tuk/commit/667bfd96b5bab7c6d7bff2a9727a0cb199e934db))
- Merge code-review fixes for multi-user ([e000f23](https://github.com/Piwero/tuk-tuk/commit/e000f237b67436674ea34826ebbc156005fd445e))

## [2.21.1](https://github.com/Piwero/tuk-tuk/compare/v2.21.0...v2.21.1) - 2026-11-19

### Bug Fixes

- **backend:** Satisfy ruff 0.17.4 SIM102 and refresh cli lock ([42fa6fc](https://github.com/Piwero/tuk-tuk/commit/42fa6fcdb306d0fb8a3b5cdc2da526e9b93c4ae4))

## [2.21.0](https://github.com/Piwero/tuk-tuk/compare/v2.20.0...v2.21.0) - 2026-11-19

### Features

- **frontend:** Overlay stand-up bullet actions so text spans the column (#429) ([ea78677](https://github.com/Piwero/tuk-tuk/commit/ea786771956bd10b85f6c01f03679d9a2d254d1c))
- **frontend:** Open Today at the root URL (#428) ([3bcccc7](https://github.com/Piwero/tuk-tuk/commit/3bcccc76868d0060483f0b848f5f2495184878ae))
- **frontend:** Context-relative dates on Task rows (#431) ([56a6eb9](https://github.com/Piwero/tuk-tuk/commit/56a6eb94489aacfa240a45d4234c606a6f0d560c))
- **frontend:** Set numeric metadata in body face with tabular figures (#432) ([9ad8994](https://github.com/Piwero/tuk-tuk/commit/9ad899416a8540f1de284f517d2d8a935d52342d))
- **frontend:** Self-host fonts (#430) ([3a2bc0e](https://github.com/Piwero/tuk-tuk/commit/3a2bc0e0e65fbf88dfb3dd689602e382c5150228))
- **frontend:** Introduce stylesheet layers and component convention (#435) ([f20a940](https://github.com/Piwero/tuk-tuk/commit/f20a940a1c18ef0f082a7f03bf0a4e550579caaa))
- **frontend:** Pin shortcut hint strip to the foot of main (#434) ([6cec234](https://github.com/Piwero/tuk-tuk/commit/6cec234e01d7bce681ef1ace4326b9e77db9adf1))
- **frontend:** Hide shortcut hint strip at the mobile breakpoint (#434) ([7140d75](https://github.com/Piwero/tuk-tuk/commit/7140d757b31769cd15e8cb1b4e3bd1a1c00a146a))
- **frontend:** Share token-based button styles (#433) ([07961a7](https://github.com/Piwero/tuk-tuk/commit/07961a74bb4c54e42dbfc561ddb1f81435f02b1f))
- **frontend:** Give Lists Tags and Folders bookmarkable URLs (#450) ([52183b7](https://github.com/Piwero/tuk-tuk/commit/52183b784f9bf7110955613fecba2705b8a8d777))
- **frontend:** Consolidate sidebar navigation and footer (#451) ([6c2c404](https://github.com/Piwero/tuk-tuk/commit/6c2c40412a5dec90624c05b2544ac450ed374c37))
- **frontend:** Goal card with readable window, score bar and pace verdict (#463) ([fc3c908](https://github.com/Piwero/tuk-tuk/commit/fc3c90877988ff9a71792b7ed4d9a0f04d19dedc))
- **frontend:** Focus mode switch, length presets and Timers as presets (#457) ([1954a0d](https://github.com/Piwero/tuk-tuk/commit/1954a0dc4727ab01a6c7edbd59edbc4e7f23270b))
- **frontend:** Group Today into Overdue, Schedule and Anytime sections (#444) ([7bb2b96](https://github.com/Piwero/tuk-tuk/commit/7bb2b96c79152eb28e1e154898a6610314a4453b))
- **frontend:** Show Habits as a Monday-first week grid (#465) ([6eeee4b](https://github.com/Piwero/tuk-tuk/commit/6eeee4be3ba8f433430a9e68e0756ab42e849c89))
- **frontend:** Add Popover primitive and move Quick-Add suggestions onto it (#440) ([a8a5f4e](https://github.com/Piwero/tuk-tuk/commit/a8a5f4e8eb4bab7254eb4bb8773f8f71a0b4d56a))
- **frontend:** Group focus sessions by day with total and daily average (#459) ([7a66aac](https://github.com/Piwero/tuk-tuk/commit/7a66aacfb96d6b764aadae64d7229ae977f7a67b))
- **frontend:** Focus today's Tasks, link headline and totals beside the clock (#458) ([067132e](https://github.com/Piwero/tuk-tuk/commit/067132ee9e50ea78b1835bd4e1fe716250a300da))
- **frontend:** Read-only key result rows and goal actions menu (#464) ([d014721](https://github.com/Piwero/tuk-tuk/commit/d014721adc7363624252274e862fb49731099116))
- **frontend:** One View button for Filters, Group by and Sort by (#445) ([ec9fa40](https://github.com/Piwero/tuk-tuk/commit/ec9fa40a341cff83fc4823dd0017e61562fb718e))
- **frontend:** Day rail with the Focused Goal card beside Today (#446) ([72570e1](https://github.com/Piwero/tuk-tuk/commit/72570e16356b29507b8ff67fd9713fd5a923bcd1))
- **frontend:** Task detail document layout with Priority, Repeat and Key Result rows (#452) ([ed3f530](https://github.com/Piwero/tuk-tuk/commit/ed3f5300403fe03ac24e77f058f07c2f45ca8516))
- **frontend:** Day rail Focus card with today's total and Pomos (#448) ([fe99de4](https://github.com/Piwero/tuk-tuk/commit/fe99de49942bfe65947c88af35b569c9150f3b42))
- **frontend:** Date popover replaces native date inputs (#443) ([007dee5](https://github.com/Piwero/tuk-tuk/commit/007dee5da7428804ac6dac6c6c4d43c77a3d4f3b))
- **frontend:** Habits card with Check-in in the Day rail (#447) ([d18d870](https://github.com/Piwero/tuk-tuk/commit/d18d87042bf6a647055af3d49bdc562840cdf926))
- **frontend:** Focus action on a Task row opens Focus with the Task linked (#449) ([c613c18](https://github.com/Piwero/tuk-tuk/commit/c613c188617661bce23bc95636589b449a4b7aba))
- **frontend:** Loading, empty and error states on Task views (#441) ([590aa8a](https://github.com/Piwero/tuk-tuk/commit/590aa8a4eac0912139a39a1ef408140c056ddc41))
- **frontend:** Mobile tab bar with centre Quick-Add and a More sheet (#462) ([5ffc968](https://github.com/Piwero/tuk-tuk/commit/5ffc9685abb8416a817eb8674dcd706157be90f4))
- **frontend:** Loading, empty and error states on Habits, Goals, Focus and Stand-up (#442) ([3501973](https://github.com/Piwero/tuk-tuk/commit/350197360fe50bee2a1c5915e621ccd1d40eec6d))
- **frontend:** Task detail Tags row with chips and prefix-narrowing popover (#454) ([810952d](https://github.com/Piwero/tuk-tuk/commit/810952d95ac58629c71ba87fd6748b9cea9da9de))
- **frontend:** Compact mobile Today header, View sheet and two-line rows (#460) ([fbac5d3](https://github.com/Piwero/tuk-tuk/commit/fbac5d35c1fa533b1f2c38f446c1721acbee1060))
- **frontend:** Task detail Date and Reminder rows (#453) ([898f545](https://github.com/Piwero/tuk-tuk/commit/898f5455dc161e550ce578fd918c47ad76406823))
- **frontend:** Task detail inline description, Check Item progress, Start focus and overflow menu (#455) ([06a192e](https://github.com/Piwero/tuk-tuk/commit/06a192e940582f91adb11e1c9b0dff109c848918))
- **frontend:** Today Habit chip strip on mobile (#461) ([2b89ac0](https://github.com/Piwero/tuk-tuk/commit/2b89ac0bfb0ed52089624aef3982dbf1f2a5e766))
- **frontend:** Task detail as a bottom sheet on phones (#456) ([e0bdfab](https://github.com/Piwero/tuk-tuk/commit/e0bdfabccb18a1e698168fdce730866f8655eb67))
- **frontend:** Show each day's Focus total in the session history (#427) ([fa2c311](https://github.com/Piwero/tuk-tuk/commit/fa2c3118e7493178e2f679c26768b8590741120c))

### Bug Fixes

- **frontend:** Scan component styles in button guard (#427) ([dcdcbe4](https://github.com/Piwero/tuk-tuk/commit/dcdcbe49bf6cf8388bc48602a0c5abd1c77d612f))
- **frontend:** Show If-Then Plan on its own line on the Goal card (#466) ([bc348c3](https://github.com/Piwero/tuk-tuk/commit/bc348c3ae5479518803e5325347b813019546d16))
- **frontend:** Fit Schedule rows, compact phone rows, restore Habits heat strip (#466) ([12725e6](https://github.com/Piwero/tuk-tuk/commit/12725e68876e7ef777be96e907a317625d522c60))
- **frontend:** Use the shared date picker for repeat end, Goal window and bulk reschedule (#427) ([bebe693](https://github.com/Piwero/tuk-tuk/commit/bebe693de57b17c138ecc85131c9a2957f56c370))
- **frontend:** Share Pomo-of-cycle label and Focus totals read; refresh Focus aside on recorded sessions (#427) ([1756f4a](https://github.com/Piwero/tuk-tuk/commit/1756f4a43723526b7e5a8a5c08b783bd568da97b))
- **frontend:** Still Task detail sheet under reduced motion; drop dead task-tags CSS; correct drawer-scrim comment (#427) ([a27c3f9](https://github.com/Piwero/tuk-tuk/commit/a27c3f90c265d03055d4f21670f259e44196f595))
- **oci:** Use h23 hour cycle so midnight renders 00:00; await section settings in tab bar test ([e1dfe62](https://github.com/Piwero/tuk-tuk/commit/e1dfe62d762d90dccb6b5c1baf9a5ebc5b7cbc6a))

## [2.20.0](https://github.com/Piwero/tuk-tuk/compare/v2.19.4...v2.20.0) - 2026-11-05

### Bug Fixes

- **mcp:** Preserve timed task duration when rescheduling ([20d8435](https://github.com/Piwero/tuk-tuk/commit/20d8435d5df2058aa841ba59a6de26da3380999e))

## [2.19.4](https://github.com/Piwero/tuk-tuk/compare/v2.19.3...v2.19.4) - 2026-11-05

### Bug Fixes

- **voice:** Bound optional agenda calendar read ([9e50a17](https://github.com/Piwero/tuk-tuk/commit/9e50a17bfb77c71de623352a72dce31df1b2822f))

## [2.19.3](https://github.com/Piwero/tuk-tuk/compare/v2.19.2...v2.19.3) - 2026-11-05

### Bug Fixes

- **voice:** Use EU-compatible TTS inference ([f4fd9b5](https://github.com/Piwero/tuk-tuk/commit/f4fd9b504cd77eeda4aaafa337ec44f2cbf8f84c))

## [2.19.2](https://github.com/Piwero/tuk-tuk/compare/v2.19.1...v2.19.2) - 2026-11-05

### Bug Fixes

- **voice:** Grant metadata updates for LiveKit session ([4fd6cb8](https://github.com/Piwero/tuk-tuk/commit/4fd6cb8852fa7dd4445a837a087c47046d1c9aaa))

## [2.19.1](https://github.com/Piwero/tuk-tuk/compare/v2.19.0...v2.19.1) - 2026-11-05

### Bug Fixes

- Allow LiveKit voice connections through CSP ([654fd9f](https://github.com/Piwero/tuk-tuk/commit/654fd9f324f6c9e61cc0c8b566c1049bb7e802ee))

## [2.19.0](https://github.com/Piwero/tuk-tuk/compare/v2.18.0...v2.19.0) - 2026-11-05

### Features

- **voice:** Push-to-talk Voice view with Aura visualizer ([7b6ee21](https://github.com/Piwero/tuk-tuk/commit/7b6ee214e0b1dfcda70400bff9e9ddfd5fa13349))
- **voice:** Add Voice view with push-to-talk (#396) ([d0221ff](https://github.com/Piwero/tuk-tuk/commit/d0221ff689fbf7abc18cc958160b2b046d306553))
- **voice:** Add continuous conversation mode ([01c6a5e](https://github.com/Piwero/tuk-tuk/commit/01c6a5e958a661ed0695cef57b26c0bf85d14a76))
- **voice:** Add shared floating overlay ([45d35dd](https://github.com/Piwero/tuk-tuk/commit/45d35dd36df949245fb1ec2bacd524514349ce83))
- **voice:** Recover disconnected sessions safely ([1cd1cbf](https://github.com/Piwero/tuk-tuk/commit/1cd1cbf9abdd9779fd1f5528d6d224f722d9eeb7))
- **voice:** Configure overlay shortcut ([57c6aa3](https://github.com/Piwero/tuk-tuk/commit/57c6aa345566a2a51abc6844ef6a741151f045cb))
- **voice:** Merge configurable overlay shortcut ([ea13b23](https://github.com/Piwero/tuk-tuk/commit/ea13b23adf3fdf4f5f45faa3d4344a242efb148f))

### Bug Fixes

- **voice:** Preserve turn ownership and serialize mode changes ([5fa23ba](https://github.com/Piwero/tuk-tuk/commit/5fa23ba140aec5b3d145efd152a4fe999277cff6))

## [2.18.0](https://github.com/Piwero/tuk-tuk/compare/v2.17.0...v2.18.0) - 2026-11-05

### Bug Fixes

- Include shared roster in frontend image build ([5ca5f80](https://github.com/Piwero/tuk-tuk/commit/5ca5f808cec98fa19249f451506688c6f5a0c6db))

## [2.17.0](https://github.com/Piwero/tuk-tuk/compare/v2.16.1...v2.17.0) - 2026-11-05

### Features

- **voice:** Add voice-agent package skeleton with roster contract test ([199291c](https://github.com/Piwero/tuk-tuk/commit/199291c19ae975494831a511d0f90f10caccb753))
- **backend:** Add voice settings columns and migration ([be6f1e2](https://github.com/Piwero/tuk-tuk/commit/be6f1e29e00e4ad7789a625b599c91c30a40103c))
- **backend:** Add voice config endpoints ([6d367e5](https://github.com/Piwero/tuk-tuk/commit/6d367e5efae093ede273d7abfd46fe3563bac10f))
- **frontend:** Add voice config api client and fake ([ce324c7](https://github.com/Piwero/tuk-tuk/commit/ce324c76bba925ff3095f36378f66b12727cc369))
- **voice:** Gate disabled mic button on voice availability ([51f9da8](https://github.com/Piwero/tuk-tuk/commit/51f9da822d6589b35fbc83e06ee5250d33cbd903))
- **voice:** Add voice settings panel with egress disclosure ([16dd48a](https://github.com/Piwero/tuk-tuk/commit/16dd48a2b01878dcb6f2212cd7973e84817212a4))
- **backend:** Add stdlib LiveKit token minting for voice ([e717075](https://github.com/Piwero/tuk-tuk/commit/e7170750f58a4135562659afd2d26efc0c7b44ab))
- **backend:** Add POST /voice/session endpoint ([468618d](https://github.com/Piwero/tuk-tuk/commit/468618d8d24d5b00b2fd1eb380f5adab3b05158e))
- **voice:** Add agent read tools relayed over browser RPC ([89f8e80](https://github.com/Piwero/tuk-tuk/commit/89f8e8045be90d55f9dd155ebb38b2a94655ae19))
- **voice:** Add agent entrypoint with contract_version and tz/date handshake ([24301f8](https://github.com/Piwero/tuk-tuk/commit/24301f81f680ce7c101b32534f319fc5b80f1bee))
- **frontend:** Add LiveKit voice session and reads ([1b3d75d](https://github.com/Piwero/tuk-tuk/commit/1b3d75d1b9e0b877160330d4f981e6b16ce1ec7f))
- **voice:** Relay the nine write tools from the agent ([e1b29e0](https://github.com/Piwero/tuk-tuk/commit/e1b29e0ee9240037b5509a76218a1893f687deed))
- **voice:** Enforce batch confirmation in the agent prompt ([16410c5](https://github.com/Piwero/tuk-tuk/commit/16410c58abe16a825dd3843bdb8025daacc9a409))
- **frontend:** Apply voice writes through the API and refresh visible views ([ea7d702](https://github.com/Piwero/tuk-tuk/commit/ea7d7026e42ea8a75f22280ce6fc9f587c65ce46))
- **frontend:** Hide exhausted voice until next month ([c7fd601](https://github.com/Piwero/tuk-tuk/commit/c7fd601eecbc3bd11fad14aee4eb0d05d53c021c))
- **voice:** End sessions on silence disconnect and quota ([416cacb](https://github.com/Piwero/tuk-tuk/commit/416cacbc6088db418ba1563b05fe8640c8fb32bc))

### Bug Fixes

- **voice:** Vendor roster inside agent package so lk agent deploy works ([cbe275a](https://github.com/Piwero/tuk-tuk/commit/cbe275a62250c053c8013a9be9b4ca6bb11923f7))
- **frontend:** Satisfy typecheck for optional voice start date ([825c42c](https://github.com/Piwero/tuk-tuk/commit/825c42c32b9ff40704ecb88c3aad8f00c5d5b485))
- **frontend:** Distinguish voice session failures ([43c478a](https://github.com/Piwero/tuk-tuk/commit/43c478a378d96ed377166c8d16d93f8057df2461))
- **voice:** Report RPC failures without retry ([c67669b](https://github.com/Piwero/tuk-tuk/commit/c67669bf1f53433cab96ba00d746ddecb424ff3b))
- **frontend:** Preserve voice until lapsed session is announced ([35502ae](https://github.com/Piwero/tuk-tuk/commit/35502ae4844d7ec193314b5577d832b0479ed6c1))
- **frontend:** Play subscribed voice audio ([f29829d](https://github.com/Piwero/tuk-tuk/commit/f29829d9df6e69204cce220854cd0e4f1263d37b))
- **voice:** Pause silence timer while agent thinks ([f73ed94](https://github.com/Piwero/tuk-tuk/commit/f73ed9476f8486f2f79b745e3154ad092985c07d))
- **voice:** Limit agenda to local today ([7a63749](https://github.com/Piwero/tuk-tuk/commit/7a637491aed0740343921b6de81108c0d56b6d3f))
- **voice:** Close rooms after cancelled connections ([ed27cc6](https://github.com/Piwero/tuk-tuk/commit/ed27cc6e474702195fe1f98edb8d26521ed3375d))
- **voice:** Stream captions as text arrives ([0d6331a](https://github.com/Piwero/tuk-tuk/commit/0d6331a1ed5bc34e70cb559300b46f3422308403))
- **voice:** Reject agents missing contract version ([8df4a26](https://github.com/Piwero/tuk-tuk/commit/8df4a26f40f693ef44c7dcc2c60f7edcb89d925c))
- **voice:** Report partial checklist writes ([a5c6b85](https://github.com/Piwero/tuk-tuk/commit/a5c6b853793f2bebf4b84dc394711dde4c5fa14f))
- **voice:** Guard late microphone setup ([ee04586](https://github.com/Piwero/tuk-tuk/commit/ee045869d45749d77cf045117d61730547ec688c))
- **voice:** Floor availability recheck delay at 1s ([f771f18](https://github.com/Piwero/tuk-tuk/commit/f771f18fd375a30dbfe4661f225a7659fb0c609d))

## [2.16.1](https://github.com/Piwero/tuk-tuk/compare/v2.16.0...v2.16.1) - 2026-11-04

### Features

- **core:** Honour TUK_BASE_URL in resolve_base_url ([8619d70](https://github.com/Piwero/tuk-tuk/commit/8619d704047ad50db2d9f090ac0b978d2045323e))
- **mcp:** Put session handling behind FileSession and PasswordSession ([8b331db](https://github.com/Piwero/tuk-tuk/commit/8b331db41acc052165a614195f7e50cd265f3088))
- **mcp:** Serve Streamable HTTP with bearer auth behind --http ([02cfc42](https://github.com/Piwero/tuk-tuk/commit/02cfc420fe9de254ab86051838cee543f5c587fd))
- **mcp:** Build and release standalone MCP container image ([84fee5e](https://github.com/Piwero/tuk-tuk/commit/84fee5ef545f03cedc870f5165ba9b4730414776))
- **mcp:** Add Kubernetes chart for Flux deployment ([f02de9c](https://github.com/Piwero/tuk-tuk/commit/f02de9c004335fd7efbe1798d25fcbc3b3889f05))

### Bug Fixes

- **mcp:** Address review findings (ADR refs, protocol module, log redaction, docs) ([f56a10e](https://github.com/Piwero/tuk-tuk/commit/f56a10e9d680818cf6ec949b3a8c25f4612b4dc5))
- **mcp:** Tighten HTTP server defaults ([010f883](https://github.com/Piwero/tuk-tuk/commit/010f883e00decf1a03250a0bf5d45f296999ffe7))
- **ci:** Run mypy hooks once, serially ([3b39f3c](https://github.com/Piwero/tuk-tuk/commit/3b39f3c241a55df1940c337430acf43feeb7736d))

## [2.16.0](https://github.com/Piwero/tuk-tuk/compare/v2.15.0...v2.16.0) - 2026-11-04

_Maintenance release; no user-facing changes._

## [2.15.0](https://github.com/Piwero/tuk-tuk/compare/v2.14.0...v2.15.0) - 2026-11-04

### Features

- **cli:** Read events over a date range, Goals and focus stats in the client ([7160945](https://github.com/Piwero/tuk-tuk/commit/7160945993e90b5ba0179f4b80569ccaacf9f28c))
- **cli:** Add tuk-mcp, a local MCP server over stdio ([8723820](https://github.com/Piwero/tuk-tuk/commit/872382089f17ddedff6b7546619f223d925c5eab))
- Add shared voice tool roster ([5910ed5](https://github.com/Piwero/tuk-tuk/commit/5910ed51c89c735cb385c3f006723af574e16888))

### Bug Fixes

- Update dependencies ([6c60743](https://github.com/Piwero/tuk-tuk/commit/6c607438e2e3facd5f2a98c72fb62527f16fc3ff))
- Force refresh release tags ([011a0d5](https://github.com/Piwero/tuk-tuk/commit/011a0d52b06563f9f3b0d64397061de061095d75))

## [2.14.1](https://github.com/Piwero/tuk-tuk/compare/v2.14.0...v2.14.1) - 2026-10-29

_Maintenance release; no user-facing changes._

## [2.14.0](https://github.com/Piwero/tuk-tuk/compare/v2.13.0...v2.14.0) - 2026-10-23

_Maintenance release; no user-facing changes._

## [2.13.0](https://github.com/Piwero/tuk-tuk/compare/v2.12.0...v2.13.0) - 2026-10-05

### Features

- **cli:** Listing filters and local exclusivity guards (tuk ls) ([b0442c9](https://github.com/Piwero/tuk-tuk/commit/b0442c917ea593368ecd2fb0ecbed0d1d307fdb2))
- **cli:** Complete and re-open a Task (tuk done, tuk reopen) ([11d58bb](https://github.com/Piwero/tuk-tuk/commit/11d58bb4b91bf9c61e1135f87cf8e85256265c8e))
- **cli:** Complete and re-open a Task (tuk done, tuk reopen) ([5eb383d](https://github.com/Piwero/tuk-tuk/commit/5eb383dd4f6f3ea8fd8ea8afc1d1af941c9bbafb))
- **cli:** Edit a Task (tuk edit) ([19d00a8](https://github.com/Piwero/tuk-tuk/commit/19d00a8bbd24a5522dfa515e2cb3e93ca65c14b8))
- **cli:** Delete a Task with confirmation (tuk rm) ([0c94c70](https://github.com/Piwero/tuk-tuk/commit/0c94c70a654c5dc9641f316b27542c72e669486c))
- **cli:** Check items from the terminal (tuk check) ([dc6088b](https://github.com/Piwero/tuk-tuk/commit/dc6088bb96b71069bc57b44272206d61f3cc0866))
- **cli:** Let edit clear a task's tags ([adc6ae4](https://github.com/Piwero/tuk-tuk/commit/adc6ae448adb3aa73f7b70de9edab844306518bf))

### Bug Fixes

- **cli:** Emit the API's response bytes verbatim for --json ([0215add](https://github.com/Piwero/tuk-tuk/commit/0215addee91375628dbd6cc73e565c0d0c798d4f))
- **cli:** Reject ls view with --completed instead of answering wrongly ([c0260ad](https://github.com/Piwero/tuk-tuk/commit/c0260adb5a53fcbbffc4ca65a3478d2017b37b54))
- **cli:** Only call done an advance when the task recurs, and localise its date ([39507bf](https://github.com/Piwero/tuk-tuk/commit/39507bf47ed4d24baade5a4b5fa2e12db21a8d76))
- **cli:** Accept --json after a check subcommand, and localise the advance date ([c640b4f](https://github.com/Piwero/tuk-tuk/commit/c640b4f5256c024a0f6267e6a6d73559b4058570))

## [2.12.0](https://github.com/Piwero/tuk-tuk/compare/v2.11.4...v2.12.0) - 2026-10-05

### Features

- **tasks:** Read single Task by id ([f01cbfd](https://github.com/Piwero/tuk-tuk/commit/f01cbfd4ffbb4f23d4761f40c46f17022e9d7b14))
- **api:** Read every remaining resource by id ([21b42a8](https://github.com/Piwero/tuk-tuk/commit/21b42a8e57cbdb526abbffba32aef8b82483ca7e))
- **cli:** Tracer bullet client package, tuk login, tuk show, CI ([b32cd46](https://github.com/Piwero/tuk-tuk/commit/b32cd460e2ce9ce696397a3048c2b164f9424041))
- **cli:** Smart List listings and timezone resolution (tuk ls) ([e555891](https://github.com/Piwero/tuk-tuk/commit/e555891b4058dee16b147b552fa47fd745a8c534))
- **cli:** Task capture, name resolution and date vocabulary (tuk add) ([051d0bf](https://github.com/Piwero/tuk-tuk/commit/051d0bfc380f338f6b4e0c56beef876c1f5f84ea))
- **cli:** Agenda composition and habit check-ins (tuk agenda, tuk habits) ([955de13](https://github.com/Piwero/tuk-tuk/commit/955de13dd2861e804ceebd4ba1ab22a37709b839))

### Bug Fixes

- **cli:** Hold the client to its spec on JSON, sessions and test seams ([01ef7f4](https://github.com/Piwero/tuk-tuk/commit/01ef7f42d0db16484be7e6be77dbc53fa901b45b))
- **cli:** Make the mypy test override a valid module pattern ([413f532](https://github.com/Piwero/tuk-tuk/commit/413f5327ceef63c68add121a1a7009b958fd3098))
- **frontend:** Keep fakeGoal window in the future ([1c0a36a](https://github.com/Piwero/tuk-tuk/commit/1c0a36ab6e8c0423a4f304d7bc6bc5e678491499))

## [2.11.4](https://github.com/Piwero/tuk-tuk/compare/v2.11.3...v2.11.4) - 2026-09-29

### Features

- **frontend:** Add filters, group by and sort to Today and Next 7 Days ([4cae3bf](https://github.com/Piwero/tuk-tuk/commit/4cae3bffa710575506bc30da3d5bf8cf78d9cf56))

## [2.11.3](https://github.com/Piwero/tuk-tuk/compare/v2.11.2...v2.11.3) - 2026-09-28

### Bug Fixes

- **frontend:** Lay out view controls as a grid on mobile ([007c390](https://github.com/Piwero/tuk-tuk/commit/007c3904867be9d1b985dd13c461936ee380136c))

## [2.11.2](https://github.com/Piwero/tuk-tuk/compare/v2.11.1...v2.11.2) - 2026-09-27

### Bug Fixes

- **shell:** Keep mobile-only controls out of the desktop grid ([274ca42](https://github.com/Piwero/tuk-tuk/commit/274ca42b7513e37a0d650617e3b8ecb0b8e41fbe))

## [2.11.1](https://github.com/Piwero/tuk-tuk/compare/v2.11.0...v2.11.1) - 2026-09-26

### Features

- **calendar:** Complete Tasks from the Calendar views ([41dbea3](https://github.com/Piwero/tuk-tuk/commit/41dbea340f334b48b2361194257170fa64865dca))

## [2.11.0](https://github.com/Piwero/tuk-tuk/compare/v2.10.13...v2.11.0) - 2026-09-26

### Features

- **tasks:** Remove completed tasks from task views ([acef926](https://github.com/Piwero/tuk-tuk/commit/acef9269c9f1150e23c12d5e6d96a1b1ebe947c0))

## [2.10.13](https://github.com/Piwero/tuk-tuk/compare/v2.10.12...v2.10.13) - 2026-09-25

### Bug Fixes

- **mobile:** Pin title, QuickAdd and filters in one sticky chrome (#290) ([27469b2](https://github.com/Piwero/tuk-tuk/commit/27469b237c051b83469930755c218701119f818a))

## [2.10.12](https://github.com/Piwero/tuk-tuk/compare/v2.10.11...v2.10.12) - 2026-09-25

### Features

- **mobile:** Add quick-add control reachable without drawer (#287) ([718cdaf](https://github.com/Piwero/tuk-tuk/commit/718cdaf39de3b8200b658ad79577c1860991a866))
- **mobile:** Make the Quick-Add dialog operable on touch (#288) ([c146813](https://github.com/Piwero/tuk-tuk/commit/c146813b605ff98ec7f85a5ef7ee01c005bd2cdf))
- **mobile:** Size header, filter and Task title controls for touch (#289) ([5a664bd](https://github.com/Piwero/tuk-tuk/commit/5a664bd663b2f0d82ebb9f1173d03e114a7d2152))

### Bug Fixes

- **mobile:** Pin header, lock scroll behind drawer, fix close-control size (#290) ([22ce17a](https://github.com/Piwero/tuk-tuk/commit/22ce17a51d669ebc93bdd7fb8fdabf9a6c193775))
- **mobile:** Route Quick-Add button through IconButton (#287) ([4be43c8](https://github.com/Piwero/tuk-tuk/commit/4be43c81bf1d02db5ab7325e3dfe434af906757d))
- **events:** Narrow converted-events tuple types for mypy ([4fa0683](https://github.com/Piwero/tuk-tuk/commit/4fa0683c00c65a1a531eff8a66fad731a1eb6d2d))

## [2.10.11](https://github.com/Piwero/tuk-tuk/compare/v2.10.10...v2.10.11) - 2026-09-24

### Features

- **auth:** Add AUTH_DISABLED local-dev bypass ([4169ed9](https://github.com/Piwero/tuk-tuk/commit/4169ed9f5f36aa768c664b15a59cd4ccb5454669))

## [2.10.10](https://github.com/Piwero/tuk-tuk/compare/v2.10.9...v2.10.10) - 2026-09-23

### Features

- **stand-up:** Suggest Tasks completed today as Today chips ([e4656db](https://github.com/Piwero/tuk-tuk/commit/e4656db83ac75bd0d0b8802455d312f96956a739))
- **stand-up:** Distinguish done from planned in the Today chips ([0127408](https://github.com/Piwero/tuk-tuk/commit/01274085a3f9ccde669db89971188c16871cff49))

### Bug Fixes

- **deploy:** Disable db-onepassworditem until vault item exists ([4407e3d](https://github.com/Piwero/tuk-tuk/commit/4407e3d6f10cec449d61311d0da230f3178537fd))
- **stand-up:** Scope completion suggestions to the user's calendar day, not UTC ([2cc906b](https://github.com/Piwero/tuk-tuk/commit/2cc906b4d23ebe2dae51b5c63e0a2eebc37d8ca7))

## [2.10.9](https://github.com/Piwero/tuk-tuk/compare/v2.10.8...v2.10.9) - 2026-09-23

### Features

- **settings:** Group sections with jump nav and status pills ([5127525](https://github.com/Piwero/tuk-tuk/commit/5127525262cf0ba57ca6b1b442e60ec215e26f7b))

### Bug Fixes

- **standup:** Restore entry deletion and icon-button guard, update stale tests ([86d9530](https://github.com/Piwero/tuk-tuk/commit/86d95302b756722a406c92a2c90937aeb5a825f8))

## [2.10.8](https://github.com/Piwero/tuk-tuk/compare/v2.10.7...v2.10.8) - 2026-09-23

### Features

- **standup:** Redesign view with cards, dropdown history, goal card ([884b4bc](https://github.com/Piwero/tuk-tuk/commit/884b4bcebb4aef24bdfacec453d307c4ecff4144))

## [2.10.7](https://github.com/Piwero/tuk-tuk/compare/v2.10.6...v2.10.7) - 2026-09-22

### Features

- **focus:** Centre the stage on one column, name the phase, rank the actions ([bd6ce23](https://github.com/Piwero/tuk-tuk/commit/bd6ce23464d4a86f05c1cf269e6dd3031a0a3693))

## [2.10.6](https://github.com/Piwero/tuk-tuk/compare/v2.10.5...v2.10.6) - 2026-09-22

### Features

- **tasks:** Quiet the Task row — settle old overdue dates, drop the repeated Inbox chip, plain Custom sort, two hover actions ([0076bd0](https://github.com/Piwero/tuk-tuk/commit/0076bd08c53ef5c7034502f5b643c15995e002a2))
- **tasks:** Collapse the All view's three filters behind one control ([a33dc62](https://github.com/Piwero/tuk-tuk/commit/a33dc6293d776e2c3c4f1e696d306b29c322f6d6))
- **tasks:** Keep Kanban cards permanently alarmed, drop stale hover actions ([3a11249](https://github.com/Piwero/tuk-tuk/commit/3a1124902ea9cb6ec71a7de945dfede7395a6c59))

## [2.10.5](https://github.com/Piwero/tuk-tuk/compare/v2.10.4...v2.10.5) - 2026-09-22

### Features

- **ui:** Wire long-press touch reveal into hint popover ([4fe119e](https://github.com/Piwero/tuk-tuk/commit/4fe119ecbf8a386924c660133c52e44b560e6ba7))
- **sidebar:** Keyboard-discoverable names for collapsed rail glyphs ([25b415a](https://github.com/Piwero/tuk-tuk/commit/25b415a47d9d20e3aff39b4d1e26b90893be52bf))
- **calendar:** Add hints to toolbar controls and Unscheduled chips ([54ac9a1](https://github.com/Piwero/tuk-tuk/commit/54ac9a1bc175fbac1519e59ebf90c1b5852ab826))
- **habits:** Make history strip, check-in control and Streak readable ([0260a76](https://github.com/Piwero/tuk-tuk/commit/0260a76f6c13fa77ccffc77a37bfcc8d4ef75039))
- **focus:** Explain Pomo, break intervals, Link and the Timers panel ([d9c802b](https://github.com/Piwero/tuk-tuk/commit/d9c802b92f7a0d076b4a8ca6f43f921b622624aa))
- **tasks:** Explain Smart Lists, Inbox, Lists vs Tags, Group/Sort by ([aabf13f](https://github.com/Piwero/tuk-tuk/commit/aabf13f407af49932d1d11b06a2862041bb0b0a7))
- **ui:** Explain Key Result on a Task, Settings toggles, Assist sparkle, Stand-up empty state ([604c31e](https://github.com/Piwero/tuk-tuk/commit/604c31e05886eb33d89d970f7573194b4c5de4f3))

### Bug Fixes

- **ui:** Remove unused INBOX import in taskRowActionNames test ([1e66f8f](https://github.com/Piwero/tuk-tuk/commit/1e66f8f1481c3a4a65d192fbc65dfaf1aa941350))

## [2.10.4](https://github.com/Piwero/tuk-tuk/compare/v2.10.3...v2.10.4) - 2026-09-21

### Features

- **ui:** Contextual help for icon-only controls and domain vocabulary ([40d35e2](https://github.com/Piwero/tuk-tuk/commit/40d35e2a33123eb79941450aa9073ee30b21fb1e))

### Bug Fixes

- **tasks:** Custom sort explains itself as manual order ([b661c96](https://github.com/Piwero/tuk-tuk/commit/b661c963f86c7005f80972513ffc596a898441fc))

## [2.10.3](https://github.com/Piwero/tuk-tuk/compare/v2.10.2...v2.10.3) - 2026-09-21

### Features

- **deploy:** Kubernetes path for moving to PostgreSQL ([97e54ca](https://github.com/Piwero/tuk-tuk/commit/97e54cafaf4696dbe022ea1e2e52ae0d33a89e42))

### Bug Fixes

- **quick-add:** Flag prose captures that read like a date, with a one-click fix ([12fd3b1](https://github.com/Piwero/tuk-tuk/commit/12fd3b11221e3673fe49763b0a7d471801a6795f))

## [2.10.2](https://github.com/Piwero/tuk-tuk/compare/v2.10.1...v2.10.2) - 2026-09-21

### Bug Fixes

- **tasks:** Overdue and repeating Tasks are communicated by more than colour ([8b23883](https://github.com/Piwero/tuk-tuk/commit/8b23883b151b5a0e9aff175b9fbf2f601db110f7))

## [2.10.1](https://github.com/Piwero/tuk-tuk/compare/v2.10.0...v2.10.1) - 2026-09-21

### Bug Fixes

- **tasks:** Widen date chip column and stop clipping the leading edge ([b8b4638](https://github.com/Piwero/tuk-tuk/commit/b8b4638520082bb3ccc49dd335c3e4e8729c2745))
- **tasks:** Fix date chip clipping in wrapped fallback too, add title fallback ([5eb9929](https://github.com/Piwero/tuk-tuk/commit/5eb9929561fa8c44c261d6a840a3b29d458c69e3))

## [2.10.0](https://github.com/Piwero/tuk-tuk/compare/v2.9.0...v2.10.0) - 2026-09-21

### Features

- **db:** PostgreSQL support, operator copy tool, and connection test UI ([7b7e047](https://github.com/Piwero/tuk-tuk/commit/7b7e0475e1455116b38bd3b17657b2251a73cdd5))

### Bug Fixes

- **lists:** Unlink Focus Sessions/Timers and delete Sections on List delete ([82282f1](https://github.com/Piwero/tuk-tuk/commit/82282f13346933e1d3b2605471a813bfcea34dd2))
- **db:** Correct probe reporting, sequence reseed, and destructive copy flags ([2c6475a](https://github.com/Piwero/tuk-tuk/commit/2c6475ae66c574d1a692327ca093638d0a6fa5c5))

## [2.9.0](https://github.com/Piwero/tuk-tuk/compare/v2.8.0...v2.9.0) - 2026-09-19

### Features

- **goals:** Tell the truth about blank dates, no Habits, and no Key Results ([9357750](https://github.com/Piwero/tuk-tuk/commit/935775044be6523b19805e3e6a62592ed4cef286))
- **habits:** Back-fill a missed day by tapping its square on the card ([406ef81](https://github.com/Piwero/tuk-tuk/commit/406ef81475754a6f295fe61bb3ade41942d5d2ee))

### Bug Fixes

- **goals:** Commit a Key Result's value on Enter ([8b4ad41](https://github.com/Piwero/tuk-tuk/commit/8b4ad411ffcd3dd71e921120ff7a3daa4c9aa429))
- **goals:** De-emphasize goal card actions at rest instead of hiding (#251) ([b8d6fd3](https://github.com/Piwero/tuk-tuk/commit/b8d6fd3a89f47d7706fcd608edeced9130090c4c))
- **goals:** Reveal goal card actions on touch behind a long-press ([489e3b8](https://github.com/Piwero/tuk-tuk/commit/489e3b87559dce09abc5ed4f9c5596a26b8bad0d))

## [2.8.0](https://github.com/Piwero/tuk-tuk/compare/v2.7.1...v2.8.0) - 2026-09-19

### Features

- **goals:** Add Goal entity with create, list, edit, delete ([3163d33](https://github.com/Piwero/tuk-tuk/commit/3163d33b9bd6424e637a960a0a0762b47c4f9155))
- **goals:** Key Results, Focused Goal, and Stand-up superseding Sprint Goal ([84a7743](https://github.com/Piwero/tuk-tuk/commit/84a77437a1a92c4927458a5865df85d918e04cfc))
- **goals:** Close on read, freeze Score, retro, abandon, group by window ([0f6da80](https://github.com/Piwero/tuk-tuk/commit/0f6da80e4399bfc4c45f9da7f416d3f373200c51))
- **settings:** Toggle Calendar, Goals, Habits, Focus, Assistant sections ([63c3226](https://github.com/Piwero/tuk-tuk/commit/63c3226c9d2ec0c692532766c198e70527ef5975))

### Bug Fixes

- **goals:** Clear previous focused Goal when focusing another ([b8e4999](https://github.com/Piwero/tuk-tuk/commit/b8e4999f931e23907ec51e3c8c7dd90cfa31edfc))
- **goals:** Repair the frontend typecheck ([8464b14](https://github.com/Piwero/tuk-tuk/commit/8464b1475fcea0e7829775c59f31c9ac5dcd2de5))
- **goals:** Settle Goals honestly and stop orphaning Tasks ([155c29d](https://github.com/Piwero/tuk-tuk/commit/155c29dce297f2269c58a66dbb3d813bb9d62801))

## [2.7.1](https://github.com/Piwero/tuk-tuk/compare/v2.7.0...v2.7.1) - 2026-09-09

### Features

- **assistant:** Read-only drill-down tools ([5c7969e](https://github.com/Piwero/tuk-tuk/commit/5c7969e95a477be08c01df95ba3b18fdc7fada6f))

### Bug Fixes

- **assistant:** Retry without reasoning_effort and log provider failures ([799bb49](https://github.com/Piwero/tuk-tuk/commit/799bb493b3ba6fcf2eec828e2ac9fe2853e836f4))

## [2.7.0](https://github.com/Piwero/tuk-tuk/compare/v2.6.2...v2.7.0) - 2026-09-02

### Features

- **quick-add:** Wire the @date sigil into the command palette ([d8cbaa5](https://github.com/Piwero/tuk-tuk/commit/d8cbaa5280934dcbf780dbdbf3c98e563104ce5d))

## [2.6.2](https://github.com/Piwero/tuk-tuk/compare/v2.6.1...v2.6.2) - 2026-09-02

_Maintenance release; no user-facing changes._

## [2.6.1](https://github.com/Piwero/tuk-tuk/compare/v2.6.0...v2.6.1) - 2026-09-02

### Bug Fixes

- **frontend:** Add @types/node so test files typecheck in CI ([fe51763](https://github.com/Piwero/tuk-tuk/commit/fe51763b29fee8ce992d9418a1333ad96f36ba38))

## [2.6.0](https://github.com/Piwero/tuk-tuk/compare/v2.5.1...v2.6.0) - 2026-09-02

### Features

- **quick-add:** Schedule a Task with @ day tokens ([c36f5bf](https://github.com/Piwero/tuk-tuk/commit/c36f5bf4f796321137ec60483594b72129fcd5be))
- **quick-add:** Compose a clock time onto an @ schedule chip ([e9a6201](https://github.com/Piwero/tuk-tuk/commit/e9a6201591b96779335b926e9e6cc751ef599876))
- **quick-add:** @ tokens fill the Quick-Add dialog's Date fieldset ([b6872a4](https://github.com/Piwero/tuk-tuk/commit/b6872a411434a205ff7f64642b95eb425149f949))
- **quick-add:** @ tokens fill the Quick-Add dialog's Date fieldset (#214) ([01309cc](https://github.com/Piwero/tuk-tuk/commit/01309ccdf803b6cb2996b0dc8244d17e426d05aa))

## [2.5.1](https://github.com/Piwero/tuk-tuk/compare/v2.5.0...v2.5.1) - 2026-09-01

### Features

- **calendar:** Lay out overlapping day-column blocks side by side ([e561c17](https://github.com/Piwero/tuk-tuk/commit/e561c171bf950cfe4ea4335938f4dd221247b44e))

## [2.5.0](https://github.com/Piwero/tuk-tuk/compare/v2.4.1...v2.5.0) - 2026-09-01

### Features

- **calendar:** Active hours with piecewise time axis ([a3718a8](https://github.com/Piwero/tuk-tuk/commit/a3718a89844759a11895913885fef8122b4dc7d6))

## [2.4.1](https://github.com/Piwero/tuk-tuk/compare/v2.4.0...v2.4.1) - 2026-09-01

### Bug Fixes

- **calendar:** Keep block titles legible in short time blocks ([dd38f60](https://github.com/Piwero/tuk-tuk/commit/dd38f6059d4befffc3ec3dab70732fe3eca7e9ee))

## [2.4.0](https://github.com/Piwero/tuk-tuk/compare/v2.3.0...v2.4.0) - 2026-08-28

### Features

- **shell:** Parse #tag ~list !priority inline in the command palette ([e52c897](https://github.com/Piwero/tuk-tuk/commit/e52c897f296022b305dea87cf8fc19df1508dc28))
- **shell:** Show sigil ghost hints in the command palette field ([a8bb83c](https://github.com/Piwero/tuk-tuk/commit/a8bb83cb4d9c3c822b7d7d59689f02d55472c64a))

## [2.3.0](https://github.com/Piwero/tuk-tuk/compare/v2.2.0...v2.3.0) - 2026-08-28

### Features

- **appearance:** Add a dark mode toggle to the sidebar nav ([a7acb5a](https://github.com/Piwero/tuk-tuk/commit/a7acb5a1eb6e27f8f8158e4bc9b6ab813fbcd2ff))
- **tasks:** Move a task to another list from the detail view ([25130b1](https://github.com/Piwero/tuk-tuk/commit/25130b1d28dbe9ce4190acdd5c5ff383aed145b1))

## [2.2.0](https://github.com/Piwero/tuk-tuk/compare/v2.1.0...v2.2.0) - 2026-08-28

### Features

- **brand:** Add the Tuk Tuk mark and retire the placeholder T ([8785782](https://github.com/Piwero/tuk-tuk/commit/87857823d21a4143c7a0ba689502fa508e9e1f9f))
- **brand:** Show the mark in the collapsed sidebar rail ([01b9f9d](https://github.com/Piwero/tuk-tuk/commit/01b9f9dab3885876fce3dfb550167bfffc96a42b))

## [2.1.0](https://github.com/Piwero/tuk-tuk/compare/v2.0.0...v2.1.0) - 2026-08-28

### Features

- **shell:** Global keyboard shortcut layer ([92e8956](https://github.com/Piwero/tuk-tuk/commit/92e89567f5ef73f08375cc7de35b763e0cc42f35))
- **calendar:** Now-line and a readable time grid ([5026b14](https://github.com/Piwero/tuk-tuk/commit/5026b14f9e3fc5cba5227fe93854650426b6d9c5))
- **habits:** Card grid, longer strip, single actions menu ([9aa6e03](https://github.com/Piwero/tuk-tuk/commit/9aa6e0397f327b9491bdd875f7f8f537fefe7a4c))
- **settings:** Dark theme ([53d33ef](https://github.com/Piwero/tuk-tuk/commit/53d33ef6d78cda2f4c1c6ba61a50a0c63cf352a4))
- **tasks:** Show Quick-Add sigils on the capture bar ([eaeeaf0](https://github.com/Piwero/tuk-tuk/commit/eaeeaf0a365d5fe32fb7a947e2c4997b82d4f4a0))
- **focus:** Stage the clock, Task and decisions with a progress dial ([594e8a5](https://github.com/Piwero/tuk-tuk/commit/594e8a5c8893c096af760e4b7677392d79d68589))
- **tasks:** List views fill their content column ([f1f13fd](https://github.com/Piwero/tuk-tuk/commit/f1f13fda134b79989991c8380b5ed918c12c6d21))
- **sidebar:** Vertical labelled feature nav and Tag chips ([f2504ef](https://github.com/Piwero/tuk-tuk/commit/f2504eff79a786614e409d57246acbc27075136d))
- **sidebar:** Open-task counts on Lists and Smart Lists ([06e0c1e](https://github.com/Piwero/tuk-tuk/commit/06e0c1e86af3c99955ef233cd7728358e9a7eaa3))
- **shell:** Command palette shell and jump ([c5a2f56](https://github.com/Piwero/tuk-tuk/commit/c5a2f562ddd703bfac089f0a542d78840d704545))
- **tasks:** Multi-select and bulk action bar ([31fc7e2](https://github.com/Piwero/tuk-tuk/commit/31fc7e2b25fac9999719547fcb88d70c2336e958))
- **calendar:** Colour Entries by List and add an unscheduled rail ([5d5afa1](https://github.com/Piwero/tuk-tuk/commit/5d5afa14d65dafb40d9d81cfebc34c7a43b087eb))
- **shell:** Capture a Task from the command palette ([a95ba12](https://github.com/Piwero/tuk-tuk/commit/a95ba128b368b33972e22e1724ee3ab712fb7248))
- **shell:** Merge palette Task capture (#204) ([99a893a](https://github.com/Piwero/tuk-tuk/commit/99a893acd39ca2ba125e985757e38d93a534ec04))
- **shell:** Act on a Task from the command palette ([b661d60](https://github.com/Piwero/tuk-tuk/commit/b661d608bd57083725b7e2d016cb7379c85d6a29))
- **shell:** Merge palette Task actions (#205) ([bc4d111](https://github.com/Piwero/tuk-tuk/commit/bc4d1111df2647c9e52a1ab2528c2c13143dc825))
- **shell:** Open command palette scoped to the selected Task (#205) ([fa1fb27](https://github.com/Piwero/tuk-tuk/commit/fa1fb2718247c789d060edff1cd02a74d6966916))

### Bug Fixes

- **shell:** Preserve time-of-day on palette reschedule; use type tokens ([3b2fdac](https://github.com/Piwero/tuk-tuk/commit/3b2fdace7892170a3161538533118f5190c6dd70))

## [2.0.0](https://github.com/Piwero/tuk-tuk/compare/v1.6.1...v2.0.0) - 2026-08-27

### Features

- **tasks:** Align the task row into a single-line grid ([2f490af](https://github.com/Piwero/tuk-tuk/commit/2f490af33ae983992c7ad772231178a2565d9ac0))

## [1.6.1](https://github.com/Piwero/tuk-tuk/compare/v1.6.0...v1.6.1) - 2026-08-27

### Features

- **settings:** Show running app version in an About section ([27d24cc](https://github.com/Piwero/tuk-tuk/commit/27d24ccb79f51689677a91ac63db8f37c7283fed))
- **settings:** Surface app version as a tooltip on the nav wordmark ([85ef32f](https://github.com/Piwero/tuk-tuk/commit/85ef32f9fea10a9560302a288bbf7450a885a60e))

## [1.6.0](https://github.com/Piwero/tuk-tuk/compare/v1.5.2...v1.6.0) - 2026-08-27

### Features

- **assist:** Wire Assisted Capture into the Quick add dialog ([1e25ee0](https://github.com/Piwero/tuk-tuk/commit/1e25ee0fd1bf28f82bcdadf384d7aa389f41e645))

### Bug Fixes

- **assist:** Accept "." as a time separator in date phrases ([f329ec7](https://github.com/Piwero/tuk-tuk/commit/f329ec7286e56a4351fdd5057e5ee02a935b34cb))
- **assist:** Resolve spelled-out clock hours in date phrases ([8390009](https://github.com/Piwero/tuk-tuk/commit/8390009f5b198dc9bfb25457920bd2b082e5af47))

## [1.5.2](https://github.com/Piwero/tuk-tuk/compare/v1.5.1...v1.5.2) - 2026-08-27

### Bug Fixes

- **quick-add:** Confirm a created Task with a global toast ([404069f](https://github.com/Piwero/tuk-tuk/commit/404069fe47c9419117bf25bfa78072982f37de3d))
- **quick-add:** Drop the dead Undo from the create toast ([52d25bc](https://github.com/Piwero/tuk-tuk/commit/52d25bcf2ac0519b23428aa77eecf2d8d00ffdf7))
- **habits:** Refresh a Habit's stats after a Check-in ([b6c5811](https://github.com/Piwero/tuk-tuk/commit/b6c5811db69cc3a027e4637de463b67515847fc1))

## [1.5.1](https://github.com/Piwero/tuk-tuk/compare/v1.5.0...v1.5.1) - 2026-08-26

### Bug Fixes

- **assistant:** Normalize suggested schedules to the v1 invariants ([d04e4a4](https://github.com/Piwero/tuk-tuk/commit/d04e4a435a2292295af860b0bddbc821344a6fb1))
- **assistant:** Keep /assistant on direct load and card titles after apply ([8397b3f](https://github.com/Piwero/tuk-tuk/commit/8397b3fbe6cbc7a1e00cbe65cbea66a15dc449aa))

## [1.5.0](https://github.com/Piwero/tuk-tuk/compare/v1.4.1...v1.5.0) - 2026-08-25

### Features

- **assistant:** Provider settings, encrypted key, and availability gate ([a900e4c](https://github.com/Piwero/tuk-tuk/commit/a900e4cb287c9c88ab60ac379688c0a1d2a35a87))
- **assistant:** Week snapshot builder (no model involved) ([8436f8f](https://github.com/Piwero/tuk-tuk/commit/8436f8fc908f9911a5b632dffee71aa3d37a90b2))
- **assistant:** Chat endpoint with validated Suggestions ([07d69cb](https://github.com/Piwero/tuk-tuk/commit/07d69cbfd653ba685e0a1867ea92c74718184205))
- **assistant:** Assistant view, Suggestion cards, and apply path ([2918848](https://github.com/Piwero/tuk-tuk/commit/29188487b51b309a8713ae6384bbd195856e1804))

### Bug Fixes

- **assistant:** Skip the tag-tasks fetch branch for the assistant view ([2aa9577](https://github.com/Piwero/tuk-tuk/commit/2aa9577423061e1dbe40221cf250dea091f745c6))
- **assistant:** Satisfy noUncheckedIndexedAccess in Assistant view test ([a6b3464](https://github.com/Piwero/tuk-tuk/commit/a6b3464432316c98f8f94e7096d4fc0bb848215d))

## [1.4.1](https://github.com/Piwero/tuk-tuk/compare/v1.4.0...v1.4.1) - 2026-08-20

### Bug Fixes

- **assist:** Resolve daypart phrases in date extraction ([89d1f61](https://github.com/Piwero/tuk-tuk/commit/89d1f619744571b29c9c2070a573fb27581cb0c8))
- **assist:** Match list/tag phrases wrapped in extra words ([f7d0495](https://github.com/Piwero/tuk-tuk/commit/f7d04951286b38c70c29aa543d5bcb1ef4e7b9eb))
- **assist:** Render chips for explicit #tag/!priority tokens in draft ([61c4167](https://github.com/Piwero/tuk-tuk/commit/61c4167d0b9a3ac05e4defeda809138bddecdc48))

## [1.4.0](https://github.com/Piwero/tuk-tuk/compare/v1.3.0...v1.4.0) - 2026-08-20

_Maintenance release; no user-facing changes._

## [1.3.0](https://github.com/Piwero/tuk-tuk/compare/v1.2.1...v1.3.0) - 2026-08-20

### Features

- **assist:** Spanish input support for assisted capture ([f85fa5e](https://github.com/Piwero/tuk-tuk/commit/f85fa5e15981a934f86092204418e948e305805f))
- **assist:** Per-chip removal and keyboard flow in the confirmation beat ([a8ca214](https://github.com/Piwero/tuk-tuk/commit/a8ca21457ec148f34a89e598c2d1fd7265091f55))

## [1.2.1](https://github.com/Piwero/tuk-tuk/compare/v1.2.0...v1.2.1) - 2026-08-20

### Features

- **assist:** List/Tag/Priority matching with token precedence ([afe2ab6](https://github.com/Piwero/tuk-tuk/commit/afe2ab691391606754640e7db6c5beda9e4748c7))

## [1.2.0](https://github.com/Piwero/tuk-tuk/compare/v1.1.0...v1.2.0) - 2026-08-20

### Features

- **assist:** Recurrence and reminder resolution in assisted capture ([8a47923](https://github.com/Piwero/tuk-tuk/commit/8a47923aa28ebb1b76072a37b861f664abb33504))

### Bug Fixes

- **frontend:** Correct onKeyDown event type in QuickAdd form ([7dc0cab](https://github.com/Piwero/tuk-tuk/commit/7dc0cab05baf6c148133685d4459b8594daa73d4))

## [1.1.0](https://github.com/Piwero/tuk-tuk/compare/v1.0.1...v1.1.0) - 2026-08-20

### Features

- **assist:** Assisted capture core — parse endpoint, date resolution, confirm beat ([8ffd46d](https://github.com/Piwero/tuk-tuk/commit/8ffd46d389d250ea37636741b39b473e66ccdc3d))

## [1.0.1](https://github.com/Piwero/tuk-tuk/compare/v1.0.0...v1.0.1) - 2026-08-20

### Bug Fixes

- **assist:** Quick-Add's Assist icon was rendering below the input, not in it ([3a2b819](https://github.com/Piwero/tuk-tuk/commit/3a2b81961c330fd9db121192cb5f343017f88c5f))

## [1.0.0](https://github.com/Piwero/tuk-tuk/compare/v0.6.5...v1.0.0) - 2026-08-20

### Features

- **assist:** Availability gate — Ollama settings, status endpoint, invisible-when-absent UI ([911ccde](https://github.com/Piwero/tuk-tuk/commit/911ccdef9bd51d62cc337f6b8ee9687a48b3f0c9))
- **assist:** Settings UI to configure Ollama base URL/model with a test button ([59dae61](https://github.com/Piwero/tuk-tuk/commit/59dae61ba3c700a9640a0e5fb5ad4fbe59d8c579))
- **assist:** Model dropdown in Settings, populated from Ollama's installed list ([1774645](https://github.com/Piwero/tuk-tuk/commit/1774645604ac3608975bff1870d58d8be50b9f2d))

## [0.6.5](https://github.com/Piwero/tuk-tuk/compare/v0.6.4...v0.6.5) - 2026-08-20

### Features

- **calendar:** Add individual URIs for Month/Week/Day ([ea98433](https://github.com/Piwero/tuk-tuk/commit/ea984335909675e82e4c5679ce1f6c0d8bd0ffa5))
- **routing:** Add /today, /next-7-days, /all URIs and default to All ([b653d40](https://github.com/Piwero/tuk-tuk/commit/b653d401eff0206f0d6bf9280d875d157d41edba))

### Bug Fixes

- **calendar:** Default the Calendar view to Day on load ([41787b7](https://github.com/Piwero/tuk-tuk/commit/41787b776061571e5660ea3655630701321a19f5))

## [0.6.4](https://github.com/Piwero/tuk-tuk/compare/v0.6.3...v0.6.4) - 2026-08-19

### Features

- **focus:** Play a sound when a Pomo or break finishes ([b09d4f1](https://github.com/Piwero/tuk-tuk/commit/b09d4f15d038fc14c42e3056f66221ef687787ca))

## [0.6.3](https://github.com/Piwero/tuk-tuk/compare/v0.6.2...v0.6.3) - 2026-08-17

### Bug Fixes

- **nav:** Stop the drawer close button hiding the sidebar wordmark ([77904b0](https://github.com/Piwero/tuk-tuk/commit/77904b0987573a938ab658d9b33bc94af3b0ccc5))

## [0.6.2](https://github.com/Piwero/tuk-tuk/compare/v0.6.1...v0.6.2) - 2026-08-17

### Features

- **habits:** Show streak and recent-days strip on habit card ([43c7228](https://github.com/Piwero/tuk-tuk/commit/43c7228d7103680c41631f901260b0e99557888a))
- **habits:** Merge streak and recent-days strip on habit card (#171) ([98b3069](https://github.com/Piwero/tuk-tuk/commit/98b306989a0bbdbda83fd63d61963785c96068c0))
- **tasks:** Show priority via shape not colour alone ([7d7fde3](https://github.com/Piwero/tuk-tuk/commit/7d7fde374c322bbc304335468706bd200ec82764))
- **tasks:** Merge priority-as-shape indicator (#166) ([266dcca](https://github.com/Piwero/tuk-tuk/commit/266dccae0b99a6018430deabbf746c19607a38c4))
- **mobile:** Add bottom tab bar and dismissible detail sheet ([7ebd3ef](https://github.com/Piwero/tuk-tuk/commit/7ebd3efc5b0fe23be27b6396b37f1b5f4e189638))
- **mobile:** Merge bottom tab bar and dismissible detail sheet (#170) ([6c70fb4](https://github.com/Piwero/tuk-tuk/commit/6c70fb4547e349622d054001f7f4a46dbcc60a55))

### Bug Fixes

- **kanban:** Render checkbox, tags and priority on cards ([84b0320](https://github.com/Piwero/tuk-tuk/commit/84b0320f2722df314c628d32d081a421d22d4f06))
- **kanban:** Merge checkbox, tags and priority on cards (#165) ([86b4691](https://github.com/Piwero/tuk-tuk/commit/86b469150ad0b8ba1b98aa55251820199dfb870a))
- **search:** Add search field with live, contextful results ([46f50b9](https://github.com/Piwero/tuk-tuk/commit/46f50b92ae7d3e16f9cfb9274679c79a426a110d))
- **search:** Merge search field with live, contextful results (#167) ([d1dadd9](https://github.com/Piwero/tuk-tuk/commit/d1dadd9e0be4e93bc7abd27eee3e78e4b11249e9))
- **touch:** Enforce 44x44 targets and hover-free row actions ([e0554a6](https://github.com/Piwero/tuk-tuk/commit/e0554a6fe775f87089f51025df46795c31292c81))
- **touch:** Merge 44x44 targets and hover-free row actions (#168) ([948c1fe](https://github.com/Piwero/tuk-tuk/commit/948c1fe3c14544a8dfbc5996e8f548425a75a33b))
- **calendar:** Make calendar responsive below the narrow breakpoint ([e265aa6](https://github.com/Piwero/tuk-tuk/commit/e265aa674f0aad2cdc525538cf91f46554399fd7))
- **calendar:** Merge responsive calendar below narrow breakpoint (#169) ([bdcd26b](https://github.com/Piwero/tuk-tuk/commit/bdcd26b1920898c56d3a736cc554fae81bb18b32))
- **tasks:** Correct All view test's optional-string type mismatch ([5da5420](https://github.com/Piwero/tuk-tuk/commit/5da542045b37875b169212a960bcad02e0cc0087))
- **touch:** Extend touch fixes to kanban and calendar toolbar ([34d6dd8](https://github.com/Piwero/tuk-tuk/commit/34d6dd8594a185d25528e6af9d439c59f7949ff4))

## [0.6.1](https://github.com/Piwero/tuk-tuk/compare/v0.6.0...v0.6.1) - 2026-08-17

### Features

- **tasks:** Filter and sort the All Smart List ([4eb12ee](https://github.com/Piwero/tuk-tuk/commit/4eb12eee0e476a7b33978f1e90ee8c82e5575d8d))

### Bug Fixes

- **tasks:** Split the All view's filter and sort controls onto two lines ([8d3b53b](https://github.com/Piwero/tuk-tuk/commit/8d3b53bfe17027eb6ec4ec812b874041ed58512f))

## [0.6.0](https://github.com/Piwero/tuk-tuk/compare/v0.5.4...v0.6.0) - 2026-08-17

### Features

- **focus:** Split timer from statistics, add breaks and cancel ([f287491](https://github.com/Piwero/tuk-tuk/commit/f2874913691cdd9750f45892e0b928fd6d7cab3a))
- **focus:** Split timer from statistics, add breaks and cancel (#162) ([e7967b1](https://github.com/Piwero/tuk-tuk/commit/e7967b1e890a614ad70400e9438b3f566f1d697d))
- **polish:** Add empty states and home-screen identity ([73322c6](https://github.com/Piwero/tuk-tuk/commit/73322c61ba96a03b2ebc948752255753944f6f6f))

### Bug Fixes

- **calendar:** Monday-align Week to Month and mark today in Month ([c83c1c4](https://github.com/Piwero/tuk-tuk/commit/c83c1c409a6b0ce8408db0eb297d5f7d64bab35b))
- **calendar:** Seven-day Monday-aligned Week, Month marks today (#161) ([f47a0cc](https://github.com/Piwero/tuk-tuk/commit/f47a0cca518fd9699d14f30b46255f4defecee8b))
- **tasks:** Share a TaskRow so titles never truncate to nothing ([e64540b](https://github.com/Piwero/tuk-tuk/commit/e64540b4386cf43f0dca40e71ddfaa1a9b5c0adc))
- **tasks:** Task rows fill the viewport and never truncate the title (#157) ([7c55752](https://github.com/Piwero/tuk-tuk/commit/7c5575295c0b708c4ba5524273c2586313e3b165))
- **tasks:** Undo toast for delete and complete ([e932dcc](https://github.com/Piwero/tuk-tuk/commit/e932dcc3617df3d945a9354424c163ab3ed0cce1))
- **tasks:** Undo toast for delete and complete (#155) ([a279a0e](https://github.com/Piwero/tuk-tuk/commit/a279a0eb51c7de2daf945c32f57e8d5e4faf0218))
- **habits:** Make row action buttons paint on the Habit card ([096f96b](https://github.com/Piwero/tuk-tuk/commit/096f96b654915029cd55305540ebd0eb55f2d68d))
- **habits:** Habit card actions render (#158) ([729cd02](https://github.com/Piwero/tuk-tuk/commit/729cd02ac77225e148f051e3ad5c9c9922d0802d))
- **layout:** Sidebar, content and detail scroll independently ([587b2ef](https://github.com/Piwero/tuk-tuk/commit/587b2ef88a18c4306d62522f3229406c9bf00c77))
- **layout:** Sidebar, content and detail scroll independently (#159) ([cabbc64](https://github.com/Piwero/tuk-tuk/commit/cabbc646be70d99a53d16e1f2bc8731bc1c0ad8f))
- **nav:** Fix sidebar top nav row so all six destinations fit ([d1dc96c](https://github.com/Piwero/tuk-tuk/commit/d1dc96c4bf3e6ba447ac44c3df6bac6c272b8f5f))
- **nav:** Sidebar nav fits all six destinations (#160) ([931f9d7](https://github.com/Piwero/tuk-tuk/commit/931f9d7f9fa12725ad5a27284db443eb36922215))
- **tasks:** Keep task rows on one line when title and metadata fit ([5afeaff](https://github.com/Piwero/tuk-tuk/commit/5afeaff1a0d3d05df91b9c03204e329850eaba92))

## [0.5.4](https://github.com/Piwero/tuk-tuk/compare/v0.5.3...v0.5.4) - 2026-08-13

### Features

- **calendar:** Show new-task draft as a popup, editable timeframe ([477602c](https://github.com/Piwero/tuk-tuk/commit/477602c60820c564297a126225922a2ee6031332))

## [0.5.3](https://github.com/Piwero/tuk-tuk/compare/v0.5.2...v0.5.3) - 2026-08-12

### Features

- **stand-up:** Include prior day's Today bullets in Yesterday suggestions ([509ddd7](https://github.com/Piwero/tuk-tuk/commit/509ddd72ee4f6e8587fbd08fb29ca26a885eebe4))

### Bug Fixes

- **stand-up:** Drop stale per-date responses when switching dates fast ([e98f64d](https://github.com/Piwero/tuk-tuk/commit/e98f64de36c5ec641479e1f8e8c272c3008c74c8))
- **stand-up:** Confirm before deleting a stand-up entry ([2936ece](https://github.com/Piwero/tuk-tuk/commit/2936ece08134d33be800697e5e775f8c653d4150))

## [0.5.2](https://github.com/Piwero/tuk-tuk/compare/v0.5.1...v0.5.2) - 2026-08-12

### Features

- **frontend:** Add URL routing for static views ([ad616fe](https://github.com/Piwero/tuk-tuk/commit/ad616fe72fd032cd57c4b9f2488744ca4103a0ce))
- **focus:** Add Pomo quick-start menu on Task rows (right-click) ([80a97ad](https://github.com/Piwero/tuk-tuk/commit/80a97ad71b93bad85834cfa0e24441e7f342135f))
- **focus:** Add kebab-button trigger for Pomo quick-start menu ([3a4c604](https://github.com/Piwero/tuk-tuk/commit/3a4c604165bd6f00ef8ed54c98855660600eec55))
- **focus:** Pomo quick-start menu on Calendar Task entries ([cc516f7](https://github.com/Piwero/tuk-tuk/commit/cc516f7942e27dd12b9cf2161a568b127bc77ebb))

### Bug Fixes

- **deploy:** Add production origin to backend CORS_ORIGINS ([23254c0](https://github.com/Piwero/tuk-tuk/commit/23254c08dee4eb7e2929b7b586d9172fe4aec296))

## [0.5.1](https://github.com/Piwero/tuk-tuk/compare/v0.5.0...v0.5.1) - 2026-08-12

### Bug Fixes

- **stand-up:** Allow removing bullets and dedupe suggestion chips ([99245e9](https://github.com/Piwero/tuk-tuk/commit/99245e9b317843597831e98d9195cf8b2ddab5b4))

## [0.5.0](https://github.com/Piwero/tuk-tuk/compare/v0.4.3...v0.5.0) - 2026-08-12

### Features

- **stand-up:** Daily entries with Yesterday/Today/Blockers bullets ([1d2f7a8](https://github.com/Piwero/tuk-tuk/commit/1d2f7a8ddef271db025806318dbb1cd06edc2f2e))
- **stand-up:** Add persistent Sprint goal field with per-entry snapshot ([d20e7cb](https://github.com/Piwero/tuk-tuk/commit/d20e7cb8a47ca032ed993afe84bf0530f89a0016))
- **stand-up:** Add Settings toggle to enable/disable Stand-up ([e804f60](https://github.com/Piwero/tuk-tuk/commit/e804f6082bea20a6545ed12c1cef131333ae5554))
- **stand-up:** Merge settings toggle for Stand-up (#140) ([7d322da](https://github.com/Piwero/tuk-tuk/commit/7d322da38eee2bb3338aee10f528b129cf59330a))
- **stand-up:** Add Today suggestion chips from the Today Smart List ([aeaa0e5](https://github.com/Piwero/tuk-tuk/commit/aeaa0e5fd863484bd423f98303de4f468b4d6d29))
- **stand-up:** Merge Today suggestion chips (#142) ([a4fa54b](https://github.com/Piwero/tuk-tuk/commit/a4fa54b208b774d1e406e66b366eaba5a831ccdd))
- **stand-up:** Add Yesterday suggestion chips from completed Tasks ([164447a](https://github.com/Piwero/tuk-tuk/commit/164447a9e0bdb5d3a04c8cb0948d34285191690a))
- **stand-up:** Merge Yesterday suggestion chips (#141) ([f808448](https://github.com/Piwero/tuk-tuk/commit/f808448ee1e25dd5d0fe3a3cecc4600733aca4a5))

### Bug Fixes

- **stand-up:** Style Today chips and align suggestions endpoint param order ([a63b65c](https://github.com/Piwero/tuk-tuk/commit/a63b65c20650fb76a78b09ad87b4e6bac1991100))

## [0.4.3](https://github.com/Piwero/tuk-tuk/compare/v0.4.2...v0.4.3) - 2026-08-11

### Bug Fixes

- **frontend:** Stop sidebar row actions from truncating folder/list names ([52efc7e](https://github.com/Piwero/tuk-tuk/commit/52efc7e64c13b423eeeb00f92e59cd1bf32e67ae))

## [0.4.2](https://github.com/Piwero/tuk-tuk/compare/v0.4.1...v0.4.2) - 2026-08-10

_Maintenance release; no user-facing changes._

## [0.4.1](https://github.com/Piwero/tuk-tuk/compare/v0.4.0...v0.4.1) - 2026-08-10

_Maintenance release; no user-facing changes._

## [0.4.0](https://github.com/Piwero/tuk-tuk/compare/v0.3.0...v0.4.0) - 2026-08-10

### Features

- **sidebar:** Add Lists heading with unified create menu ([db1aada](https://github.com/Piwero/tuk-tuk/commit/db1aadaaab27ebf0b6db96767ab0e392552f1f9d))
- **sidebar:** Give Folder rows their own visual grammar ([91b2461](https://github.com/Piwero/tuk-tuk/commit/91b246184cb993452099770336f4412a6f1e564d))
- **sidebar:** Add Folder collapse, drag refusal, filing, and Folder view ([a5430eb](https://github.com/Piwero/tuk-tuk/commit/a5430ebdaea20d7f22d8271f8cf54c05588a28ce))

### Bug Fixes

- **sidebar:** Show originating Folder for archived Lists ([2eaafd8](https://github.com/Piwero/tuk-tuk/commit/2eaafd821e82e8cb8b1403070c971896f7d86a5a))
- **sidebar:** Differentiate Folder and List delete confirmations ([8e6b7a0](https://github.com/Piwero/tuk-tuk/commit/8e6b7a0d5f274c647b1f4f8b74dd4298c878ab78))
- **sidebar:** Correct post-merge CSS for breadcrumb, drag-over and empty hint ([0fe88ce](https://github.com/Piwero/tuk-tuk/commit/0fe88ce487b2afb1390358f111ef92657d0ffe6f))
- **sidebar:** Correct CSS specificity so Folder rows actually render ([b4ca9a1](https://github.com/Piwero/tuk-tuk/commit/b4ca9a166e4eeb4c6c47a222a58deedbea8ebda7))

## [0.3.0](https://github.com/Piwero/tuk-tuk/compare/v0.2.2...v0.3.0) - 2026-08-06

### Features

- Connect and disconnect Google accounts (issue #105) ([8d3cafa](https://github.com/Piwero/tuk-tuk/commit/8d3cafad83dbe0d70a4691220138873326807133))
- Choose which Google calendars are visible (issue #106) ([688dd98](https://github.com/Piwero/tuk-tuk/commit/688dd98bdf00fef4c6699fe41263a43dffcef7dd))
- Render Google Calendar Events in the Calendar view (issue #107) ([54f4419](https://github.com/Piwero/tuk-tuk/commit/54f4419b50913b273957b96a53cf2a9e518efedd))
- Split midnight-crossing Events into per-day segments (issue #108) ([2e012d3](https://github.com/Piwero/tuk-tuk/commit/2e012d3fc9d0493dde6ea488b448466fefc83ac4))
- Per-account Google Calendar failure handling and Event refresh (issue #109) ([734d57b](https://github.com/Piwero/tuk-tuk/commit/734d57bf3c85d672a3d168c026171b2dcc3771aa))
- Event detail popover (issue #110) ([62067c4](https://github.com/Piwero/tuk-tuk/commit/62067c4581824a4fa2cc77fdc46fdd858f204c70))
- Convert an Event to a Task (issue #111) ([b997fdf](https://github.com/Piwero/tuk-tuk/commit/b997fdfe705eaaccebbd820bde0644ca2059eeb4))
- **auth:** Move password and session key into a DB-backed settings table ([517339e](https://github.com/Piwero/tuk-tuk/commit/517339e2eddafa968a64341965abc7e4dd3e003d))
- **auth:** Add change-password flow with session key rotation ([9a4cdbb](https://github.com/Piwero/tuk-tuk/commit/9a4cdbb95f4346e5b75a08ffbd27ae1ddbfe699d))
- **auth:** Require a matching confirmation for new passwords ([46feb45](https://github.com/Piwero/tuk-tuk/commit/46feb45fac6a9dab7516cb6f701e988f92f2ba89))
- **google:** Manage Google API credentials from Settings ([c50d3b3](https://github.com/Piwero/tuk-tuk/commit/c50d3b34e8153a58369c8756f609ebd41ca311df))

### Bug Fixes

- Satisfy noUncheckedIndexedAccess in calendar Event tests ([7c4177a](https://github.com/Piwero/tuk-tuk/commit/7c4177afe4cade679bad7b7050dff5fa3e3c008d))
- **google:** Make OAuth callback reachable through the dev proxy ([ee58e7e](https://github.com/Piwero/tuk-tuk/commit/ee58e7e8dcdc6c9f7d6cb228c55964dd77e5798d))
- **google:** Surface a failed calendar load instead of hanging ([1784fa0](https://github.com/Piwero/tuk-tuk/commit/1784fa0119cb2013d838d7279bc3512792c9bd2c))
- **google:** Clear needs_reconnect once a sync or read succeeds ([ceb7bfd](https://github.com/Piwero/tuk-tuk/commit/ceb7bfd48c993b8486e21fbaa363eb860794a784))

### Performance

- **backend:** Build the migrated test DB once per session, not per test ([b89e3c6](https://github.com/Piwero/tuk-tuk/commit/b89e3c69f4ca1f3e7b41bc69dc327a11e9c08542))

## [0.2.2](https://github.com/Piwero/tuk-tuk/compare/v0.2.1...v0.2.2) - 2026-08-03

### Features

- **frontend:** Show the Focus timer in the nav bar ([a882b1f](https://github.com/Piwero/tuk-tuk/commit/a882b1ff680fc6b17ead98bae8421064571dad2a))

## [0.2.1](https://github.com/Piwero/tuk-tuk/compare/v0.2.0...v0.2.1) - 2026-08-03

### Features

- **frontend:** Show a task's List next to its title in cross-list views ([755729b](https://github.com/Piwero/tuk-tuk/commit/755729b946d75b1e75245403acf85d7134c742c2))
- **frontend:** Open task edit panel from calendar views ([74eb1dd](https://github.com/Piwero/tuk-tuk/commit/74eb1dddadb0270ab232c77781f8c503b6301dd4))

## [0.2.0](https://github.com/Piwero/tuk-tuk/compare/v0.1.3...v0.2.0) - 2026-08-03

### Features

- **chart:** Provision auth secrets via 1Password (#79) (#88) ([eed8c0e](https://github.com/Piwero/tuk-tuk/commit/eed8c0e5ad2ff65c7429b5755838af68def2b717))
- **backend:** Authentication settings and password-hash generation task (#82) (#91) ([46ae426](https://github.com/Piwero/tuk-tuk/commit/46ae426c4b604eb2c8497e3dd8573be198af573c))
- **backend:** Require a session on every endpoint by default (#83, #84) ([1dbd88a](https://github.com/Piwero/tuk-tuk/commit/1dbd88ad55c2592f168bb9a0e4c84f692f1b8ae5))
- **frontend:** Add password gate above App (#86) ([e776236](https://github.com/Piwero/tuk-tuk/commit/e776236f27803a017b431b277db3c97e1144a537))
- Add log out action (#87) ([a2ed6d5](https://github.com/Piwero/tuk-tuk/commit/a2ed6d51c05a69bb9b36a2ed6a035092d772e46f))

### Bug Fixes

- **deploy:** Redirect plain-HTTP public traffic to HTTPS (#89) ([a81a221](https://github.com/Piwero/tuk-tuk/commit/a81a221317f69f25ee32e68969e3fea3c00a6eb5))
- **backend:** Refresh sessions by age since issue, not distance to expiry (#85) ([7dcac1e](https://github.com/Piwero/tuk-tuk/commit/7dcac1e65e5643663c01dc7b7620925710f724d6))
- **compose:** Stop Compose interpolating $ out of the password hash ([52f8fa0](https://github.com/Piwero/tuk-tuk/commit/52f8fa0f2306c8145798137eda9f09181ca8520f))

## [0.1.3](https://github.com/Piwero/tuk-tuk/compare/v0.1.2...v0.1.3) - 2026-07-30

### Features

- Add quick-add dialog and sidebar collapse ([d97f547](https://github.com/Piwero/tuk-tuk/commit/d97f547403ffdee5ce32090b0a9450fb3e44a584))
- **habits:** Pick habit colour from a 12-swatch palette ([8398786](https://github.com/Piwero/tuk-tuk/commit/8398786ca8f10e9618482bfecaf59ce403d5a526))
- **habits:** Choose the habit icon from an emoji picker ([8a70290](https://github.com/Piwero/tuk-tuk/commit/8a70290116d28a1c12294fa63faa5630826a6362))
- **lists:** Choose the list emoji from an emoji picker ([c8fd1e9](https://github.com/Piwero/tuk-tuk/commit/c8fd1e9fbd68ae1591c19d93c865386abd230e63))
- **quick-add:** #tag suggestion dropdown ([c3567cf](https://github.com/Piwero/tuk-tuk/commit/c3567cfef2b8401c43377087ec4bbd1b22dcfd80))
- **quick-add:** Create a missing tag from the #dropdown ([e2eb33a](https://github.com/Piwero/tuk-tuk/commit/e2eb33aba33184d919352cf76577fed284c079df))
- **quick-add:** ~list and !priority suggestion dropdowns (#75, #76) ([c5c3c88](https://github.com/Piwero/tuk-tuk/commit/c5c3c881d9c5ce7929f6cd45361a269143e6e36a))
- **quick-add:** Token suggestions in the Quick add dialog title ([990dc8f](https://github.com/Piwero/tuk-tuk/commit/990dc8f994bb80ae6c75933762c21acb0843b3f8))

### Bug Fixes

- Allow to cors with tunnel ([e798f75](https://github.com/Piwero/tuk-tuk/commit/e798f75bcf96f106904435d0929e70125c8d0c7e))
- **quick-add:** Resync caret on pick, guard chip reset against races ([88231f9](https://github.com/Piwero/tuk-tuk/commit/88231f9b9f2314b1455059168454f4245ebf53d4))

## [0.1.2](https://github.com/Piwero/tuk-tuk/compare/v0.1.1...v0.1.2) - 2026-07-11

### Features

- Allow to expand tasks on calendar and focus pomo ([7af813d](https://github.com/Piwero/tuk-tuk/commit/7af813daa3a784a16ebdc8ce0d41ef34aad6ce13))

## [0.1.1](https://github.com/Piwero/tuk-tuk/compare/v0.1.0...v0.1.1) - 2026-07-07

### Features

- **calendar:** Implement 5-day week view with card-based task layout ([6baf1f3](https://github.com/Piwero/tuk-tuk/commit/6baf1f3ad156c009eb93f8f786392b7eeb7fa988))
- **calendar:** Week view starts from today with card-based layout ([b8d6657](https://github.com/Piwero/tuk-tuk/commit/b8d66577d3af2ddbdea7dcd488cc218954433ddd))

### Bug Fixes

- **backend:** Disable service links to avoid BACKEND_PORT env collision ([f825da3](https://github.com/Piwero/tuk-tuk/commit/f825da3e51e8e9680793d4c7a1b9f70b185975f2))

## [0.1.0](https://github.com/Piwero/tuk-tuk/releases/tag/v0.1.0) - 2026-07-06

### Features

- **core:** Walking skeleton with Inbox and basic tasks (#18) ([17d061b](https://github.com/Piwero/tuk-tuk/commit/17d061baba7245cae236238d99352b64e791df63))
- **lists:** Full List and Folder management (#19) ([86e7210](https://github.com/Piwero/tuk-tuk/commit/86e7210ee8677f6e927232d90d2e2fe73e030cce))
- **lists:** Drop zone to drag lists out of folders; review follow-ups (#19) ([b0de242](https://github.com/Piwero/tuk-tuk/commit/b0de2428023d2515f0820aaded59cf15cfb8fc03))
- **tasks:** Task detail with description, Priority, and Check Items (#20) ([f5c701d](https://github.com/Piwero/tuk-tuk/commit/f5c701dfdf59227abe20dfb8bd27cbfbced921b0))
- **tags:** First-class Tags (#21) ([99bad8f](https://github.com/Piwero/tuk-tuk/commit/99bad8f7ef80b639d163c4c0914e70b095e1bc49))
- **sections:** Sections, manual task ordering, group & sort (#22) ([98aaf19](https://github.com/Piwero/tuk-tuk/commit/98aaf1956e73e5e8a7ac06af761c9e4fc12a4f0b))
- **kanban:** Kanban view with per-List view mode (#23) ([06b829e](https://github.com/Piwero/tuk-tuk/commit/06b829ed2819134c99ff2582bbd7a4a2d41d6998))
- **scheduling:** Task dates, durations, all-day spans (#24) ([a4c8942](https://github.com/Piwero/tuk-tuk/commit/a4c894234964b3c54f51eb1ee12b8e88f35edc94))
- **smart-lists:** Today, Next 7 Days, All + completed view (#25) ([b102147](https://github.com/Piwero/tuk-tuk/commit/b1021472b0a325447dabe226132d63583aaef727))
- **reminders:** Stored ISO-8601 offsets per task (#26) ([73197ef](https://github.com/Piwero/tuk-tuk/commit/73197efc649aa7bb27e6f886a9584e1b454a2ff1))
- **recurrence:** Recurring tasks advance in place (#27) ([5388ea1](https://github.com/Piwero/tuk-tuk/commit/5388ea1c41f3bc2f070c0fa15abd974f562be912))
- **quick-add:** #tag, !priority and ~list tokens (#28) ([a5037db](https://github.com/Piwero/tuk-tuk/commit/a5037dbc4726ff190f1fb8d65db5aa49e2ecd2c3))
- **calendar:** Month/Week/Day views with click and drag create (#29) ([f09544b](https://github.com/Piwero/tuk-tuk/commit/f09544befc22af74d067786b24635b45854b1b6a))
- **calendar:** Drag to move, resize and schedule tasks (#30) ([af60082](https://github.com/Piwero/tuk-tuk/commit/af6008282fd1d6681bdce641f5bfe0c9a441af94))
- **search:** Match titles, descriptions and Check Items (#31) ([54c5f0c](https://github.com/Piwero/tuk-tuk/commit/54c5f0cf8674e22c3716161c7ed11845646e7d2e))
- **habits:** Boolean & Numeric Habits with idempotent Check-ins (#32) ([b8eb8c0](https://github.com/Piwero/tuk-tuk/commit/b8eb8c07cd77f92ada77898d8ab7f8bbf902147f))
- **habits:** Streaks, yearly heatmap, backfill grid and archive (#33) ([a898b9b](https://github.com/Piwero/tuk-tuk/commit/a898b9b5696941eac2e2c4b7d661526bb994a7a5))
- **focus:** Pomo & Stopwatch timers persisting Focus Sessions (#34) ([45dd837](https://github.com/Piwero/tuk-tuk/commit/45dd837dd586d2f9887c8a17bdd12faa6f12634d))
- **focus:** Timer presets and server-computed statistics (#35) ([9c54198](https://github.com/Piwero/tuk-tuk/commit/9c54198ca3f3db053b5d1e957f548b539cc82e79))
- **designs:** Apply system design UX/UI ([c1422e2](https://github.com/Piwero/tuk-tuk/commit/c1422e2bfc52cfaf7bde99390dab0ea62fc891a4))
- **icons:** Swap to lucide react icons ([33e2a64](https://github.com/Piwero/tuk-tuk/commit/33e2a64dfc80cf84e887c93824a891d0d5ed6e47))
- **deploy:** Add release workflow and k8s charts for both stacks ([7eb6b77](https://github.com/Piwero/tuk-tuk/commit/7eb6b772ab7c3360b8d580d3b51ec9558d2949f0))

### Bug Fixes

- **frontend:** Surface and fix type errors hidden by vacuous typecheck ([25cc50e](https://github.com/Piwero/tuk-tuk/commit/25cc50e503d767bf64864738dd96e8e0f1542dd4))
- **frontend:** Keep fetch stubbed between tests ([bf941c8](https://github.com/Piwero/tuk-tuk/commit/bf941c8d022d52538a7beb013b1d89a139e280b8))
- **tasks:** Auto-complete only on an open-to-done tick; review follow-ups (#20) ([6288f37](https://github.com/Piwero/tuk-tuk/commit/6288f37a87ae74d7407e84c65e79252fc7fcc8b4))
- **tags:** Surface duplicate-name errors and evict untagged tasks; review follow-ups (#21) ([d505da3](https://github.com/Piwero/tuk-tuk/commit/d505da387dd79e2c23b7c335eb2db268bb1ea6f1))
- **sections:** Drop-at-end targets; review follow-ups (#22) ([4ef759b](https://github.com/Piwero/tuk-tuk/commit/4ef759bd40dd5132d4ff7ebcb0f40bedb724cc17))
- **kanban:** Add Section on the board; review follow-ups (#23) ([fa01e68](https://github.com/Piwero/tuk-tuk/commit/fa01e683a05f9f83b950732645570e930954518a))
- **tests:** Amend frontend tests to pass ([df40431](https://github.com/Piwero/tuk-tuk/commit/df40431035a4875cc60fa007400ffdd1f93a890c))
- **deploy:** Pin sqlite pvc to local-path storage class ([9a7ad4c](https://github.com/Piwero/tuk-tuk/commit/9a7ad4c423784153f7e47fbe99e0fe64b02890bf))
- **release:** Seed CHANGELOG.md on first release, point cliff at tuk-tuk ([85a2963](https://github.com/Piwero/tuk-tuk/commit/85a29639ca8e8344c323105209d40cc454c6b7bd))
- **release:** Normalize changelog EOF so pre-commit hooks pass ([60f6e1b](https://github.com/Piwero/tuk-tuk/commit/60f6e1b5e36ef269ae3bb0d400465335633e34fd))
