# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
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
