# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
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
