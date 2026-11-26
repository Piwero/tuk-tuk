# Visual pass against the redesign mockups (#466)

Spec: #427. Mockups: `today`, `mobile-today`, `task-detail`, `focus`,
`goals-habits`. Every screen was rendered with the seeded fake API (pinned
clock 2026-11-03 09:41) through Playwright at 1440×900 (desktop) and
390×844 (phone, touch), in light and dark, and with
`prefers-reduced-motion: reduce`. Checks were made by DOM and computed-style
measurement. **The retaken screenshots were not compared to the mockups by eye**: no image tooling was available to downscale them, so pixel-level fidelity still needs a human look.

Refreshed screenshots: `docs/assets/screenshots/{today,mobile-today,task-detail,focus,goals,habits}.png`.

## Per-screen checks

| Screen      | Light desktop | Dark desktop | Light phone | Dark phone | Notes                                                           |
| ----------- | ------------- | ------------ | ----------- | ---------- | --------------------------------------------------------------- |
| Today       | ✓             | ✓            | ✓           | –          | Schedule rows fixed (see below); day rail measured              |
| Task detail | ✓             | ✓            | ✓ (sheet)   | –          | Sheet reduced motion **not measured** (only the More sheet was) |
| Focus       | ✓             | ✓            | ✓           | –          | No change needed                                                |
| Goals       | ✓             | ✓            | ✓           | –          | Obstacle / If-Then Plan fixed                                   |
| Habits      | ✓             | ✓            | ✓           | –          | Heat strip restored                                             |
| More sheet  | –             | –            | ✓           | –          | Reduced motion: `animation: none`, `transition: 0s`             |

## Measured risks

- **Phone Today row height.** At 390px rows measure 59–71px (were ~93px).
  The list starts at y=170 and the tab bar at y=788, so ~9 rows fit — meets the
  "about eight" target.
- **Dark Habits heat ramp.** Computed backgrounds: level 0 `#23272f`,
  level 2 `#2f7d50`, level 3 `#46b571`, level 4 (full) `#7ee7a6`. Partial and
  full days are clearly distinct in both themes (light: `#86e0a3` → `#176430`).
- **Day rail 1040px threshold.** The threshold is a container query on `main`,
  not the viewport. `main` is 1052px wide at a 1300px viewport (rail hidden:
  content box under 1040 after padding) and 1152px at 1400px (rail shown, 280px).
  Behaviour matches the rule "rail only when the full list plus the rail fit".
- **Goal card.** Both "Obstacle: …" and "If-Then Plan: …" render, each on its own line.
- **Reduced motion.** More sheet and its scrim compute
  `animation-name: none` and zero transition duration.

## Differences fixed

1. **Schedule rows broke onto extra lines** (Today): the start time and planned
   duration added by #444 had no grid track. They now get their own tracks
   (narrow and ≥620px container); on the phone they are hidden because the date
   chip already carries "09:00–09:30", as the mockup shows. `TaskRow.css`.
2. **Phone rows too tall:** the hidden row-actions box kept a 44px height and
   stretched the meta line. Now collapses to `height: 0` until opened. `TaskRow.css`.
   Guarded in `tapTargetGuard.test.ts`.
3. **Habits heat strip missing on desktop:** the Today chip strip (#461) shared the
   `.habit-strip` class and its desktop `display: none` hid the Habits card strip.
   Chip strip renamed `.today-habit-strip`. Guarded in `tapTargetGuard.test.ts`.
4. **If-Then Plan ran on after the Obstacle** without its label. It now always has
   its own labelled line. `GoalsView.tsx`, tested in `App.goals.test.tsx`.

## Differences left

- **More sheet Lists / Folders / Tags are buttons, not anchors** (the sidebar uses
  `href` anchors). Kept: the sheet is a modal dialog whose entries must close it and
  then navigate; on a touch device there is no middle-click / open-in-new-tab
  affordance to lose, and the client-side route is still reachable by URL. Making
  them anchors is a cheap follow-up if long-press "open in new tab" is wanted.
- **Mockup illustration details** (placeholder avatars, sample copy, exact sample
  data) differ from the seeded data; not product differences.

## Not done

- Dark-phone screenshots (marked `–` above).
- Reduced-motion check of the Task detail sheet and of popovers.
- Eye comparison of the retaken screenshots against the mockups.
