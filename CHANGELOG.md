# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
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
