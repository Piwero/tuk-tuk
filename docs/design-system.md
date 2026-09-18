# Tuk Tuk design system

How the app looks and why. The visual identity is defined in the
[Tuk Tuk Design System](https://claude.ai/design/p/31be65ef-4692-497a-b556-0a279af77607)
project (tokens, component specs, and full-screen references); this document
records what is implemented in this repo and the rules to follow when
building new UI.

**Character:** calm, decisive, quiet. Near-white surfaces, one decisive blue,
and color reserved for meaning. Long working sessions should feel restful.

## Where things live

| File | Purpose |
| --- | --- |
| `frontend/src/tokens.css` | All design tokens (colors, type scale, spacing, radii, elevation, motion) |
| `frontend/src/index.css` | Component styles, written entirely against the tokens |
| `frontend/src/components/Icon.tsx` | The Lucide icon subset — the single swap point for the icon set |
| `frontend/index.html` | Webfont loading (Google Fonts) and the app title |

Never hard-code a color, size, or shadow in component styles — use the
`--*` custom properties from `tokens.css`. If a value you need is missing,
add a token first.

## Color

- **Brand accent** `--blue-600` `#4772fa` — comes from
  `frontend/src/theme.ts → DEFAULT_ACCENT` and anchors the blue ramp
  (`--blue-50…800`).
- **Ink neutrals** `--ink-25…900` — cool grays for all text, lines, and
  surfaces.
- **Color = meaning.** Color is never decoration:
  - **Priority** is never color-only. High/Medium/Low each render a distinct
    signal-bar glyph (`PriorityIndicator`, one/two/three bars) with an
    accessible name stating the level; `--priority-*` only varies the
    glyph's lightness (never hue — never red, which stays reserved for
    "overdue") to reinforce weight for sighted users. None renders no
    indicator. Appears on task rows, Kanban cards, and search results —
    everywhere a Task is listed (#166).
  - **Overdue** dates are red text — the only red on a task row.
  - The **calendar now-line** (the rule marking the current time in Week and
    Day, on today's column only) is the one deliberate use of red outside
    overdue. It is a hairline with a dot at the gutter edge — never a fill —
    and today's column is already marked by more than colour (an accent
    edge-rule and a "Today" pill), so the red reads purely as "now".
  - **Due today** is the accent; every other date on a row is
    `--text-secondary`. The accent used to be on every dated row, where it
    meant nothing. Outside a task row (Quick-Add tokens, the Folder and
    Completed views) `.date-chip` keeps its plain accent.
  - **Tags on a task row** are a tint plus a darkened ink, both `color-mix`ed
    from the Tag's own colour, which `TaskRow` passes in as `--chip-color`;
    the outlined pill stays everywhere else. A row's **List** is a 10px dot
    (or the List's emoji) and its name in secondary ink, not a badge.
  - **Habit success** is green (`--success`, heatmap ramp `--heat-0…4`).
  - **Focus** has its own identity — plum `--focus-accent` `#7a48ec` — so
    deep work feels like a different room. Its screen is literally staged: the
    clock (inside a static progress dial), the linked Task and the
    pause/finish/cancel decisions sit together in one bordered `.focus-stage`
    card; presets and statistics sit beside it, and step aside while a session
    runs. Cancel stays visually secondary to Finish (outline, not filled) and
    says it records nothing.
  - User-chosen List/Tag colors come from the 8 curated `--swatch-*` values.
- **Semantic aliases** (`--surface-*`, `--text-*`, `--border-*`, `--accent`,
  `--danger`, …) are what component CSS should reference; the raw ramps are
  implementation detail.

### Dark theme (issue #193)

A dark counterpart to the semantic aliases, chosen in Settings → Appearance
as **Light / Dark / System** — and nothing else; the three options are the
whole scope. The choice is browser-local (`tuktuk.theme` in `localStorage`,
the same path as the sidebar's collapsed state — see `layoutPrefs.ts`), not
account data. A browser with storage disabled falls back to System without
throwing.

`layoutPrefs.ts → applyThemePreference` resolves the choice to a concrete
`data-theme="light" | "dark"` on `<html>`; System also subscribes to
`(prefers-color-scheme: dark)` so an OS flip re-resolves live. The dark
values live in one `:root[data-theme="dark"]` block in `tokens.css`, right
after the light `:root`. **No component knows which theme is on** — every
surface re-points because it references the alias, not the ramp. Dark meets
the same text/border/surface contrast the light theme meets, and keeps
focus rings, the overdue red, the Focus plum, and the Habit heat ramp
legible.

Two rules carry across the inversion unchanged:

- **Priority** stays a lightness-only ink ramp (`--priority-low/medium/high`
  step weight, never hue) — still never red.
- **Overdue** stays the only red on a task row.

One ramp deliberately inverts: the **Habit heat ramp** (`--heat-0…4`). On a
dark ground "more" reads as *brighter*, so the ramp climbs from a dim empty
cell to a bright green rather than darkening. No other ramp changes meaning.

## Typography

Three faces, loaded from Google Fonts in `index.html`:

| Face | Token | Used for |
| --- | --- | --- |
| Bricolage Grotesque | `--font-display` | Screen titles (26px), big numbers (focus clock 56px), the wordmark |
| Instrument Sans | `--font-body` | All UI text; 14px default |
| JetBrains Mono | `--font-mono` | Timers, date chips, counts — anything tabular |

Uppercase 12px labels with `--tracking-caps` head sections, folders, and
sidebar groups. The wordmark is "Tuk Tuk" in Bricolage Grotesque,
semibold/bold — type only, no lettering of its own. It is paired with the
mark below.

## Logo

The mark is two `t` stems sharing one crossbar, each turning into a foot at
the bottom: the doubled name drawn as a single ligature. It reads as
letterforms, not as a hash — the feet are what do that, so they are not
decoration and must survive any redraw.

- **Source of truth** is `frontend/src/components/Logo.tsx`. It is authored
  on a **48-unit grid**; the mark's bounding box is `x 6.5…41`,
  `y 7.75…40.25`, centred on `(23.75, 24)`. Scale it with the `size` prop;
  never edit the viewBox.
- **Colour** is `currentColor`, so the mark re-points between themes from
  CSS exactly like the Lucide subset — the component never learns which
  theme is on. One rule, `.logo`, makes it `--accent`; no surface restates
  the colour.
- **Decorative everywhere.** The wordmark sits beside it in both places it
  appears, so the mark is `aria-hidden` and carries no accessible name;
  naming it would announce the app twice.
- **Sizes:** 21px in the sidebar brand, beside the 17px wordmark; 32px on
  the auth screen.

### Regenerating the raster set

The assets in `public/` are cut from the geometry above, not drawn
separately, so they can be rebuilt from it with any rasteriser. Each is a
full-bleed `--blue-600` (`#4772fa`) tile with a white mark, centred by
`transform="translate(24 24) scale(S) translate(-23.75 -24)"` inside a
`viewBox="0 0 48 48"`:

| Asset | Size | `S` | Mark width |
| --- | --- | --- | --- |
| `icons/icon-512.png` | 512 | `0.807` | ~58% |
| `icons/icon-192.png` | 192 | `0.807` | ~58% |
| `icons/apple-touch-icon.png` | 180 | `0.807` | ~58% |
| `icons/favicon-32x32.png` | 32 | `1.0` | ~72% |
| `icons/favicon-16x16.png` | 16 | `1.0` | ~72% |
| `favicon.ico` | 16 + 32 + 48 | `1.0` | ~72% |

App icons sit back from the edge at 58%; favicons keep the natural 72%,
which is the extra mass 16px needs to stay readable. Render each tile at
512 and downsample — rasterising straight to 16px loses the feet.

**Where the lockup appears.** Three states, one markup:

- **Expanded sidebar** — mark beside the wordmark, the collapse toggle
  opposite.
- **Collapsed rail** — the mark alone. The wordmark steps aside with every
  other label, and since the 56px rail leaves 40px inside its padding, the
  mark stacks above the expand toggle rather than sitting beside it. The
  version tooltip stays on the brand, so hovering the mark still reports it.
- **Mobile drawer** — the full lockup again. The drawer reuses the
  `.collapsed` class, so it has to restore the brand's row direction, flex
  and padding, and bring `.sidebar-brand-name` back explicitly.

`.sidebar-brand-name` is a real element, not a bare text node, for two
reasons: a bare text node is an anonymous flex item that `text-overflow`
cannot reach, and the rail needs something to hide that isn't the mark.

## Spacing, layout, and radii

- 4px base scale (`--space-1…12`).
- Layout constants: sidebar `--sidebar-width` 248px, detail panel
  `--detail-width` 360px, content column `--content-max` 720px, rows
  `--row-height` 40px, controls `--control-height` 34px.
- **What the reading measure applies to.** `--content-max` is a *prose*
  measure: it keeps running text at a comfortable line length. Settings,
  Stand-up, Habits and Focus opt into it. The task list, Search results and
  the Kanban board do *not* — they are dense, columnar surfaces that read
  better edge to edge, so they fill the full width of the content area at
  any window width (issue #196), and the task list's own chrome (the title
  bar, the QuickAdd bar, the view controls) fills with them. Calendar was
  already full width. A consequence worth naming: because the aligned
  single-line task row is gated on the list's own width (next point), a
  full-width list makes the aligned form apply in far more windows and the
  wrapped fallback in fewer — expected and desired.
- **The task row is a grid**, not a wrapping flex line: `--task-row-height`
  36px over seven tracks — done, `--task-col-priority` 16px, a flexing title,
  tags, `--task-col-list` 104px, `--task-col-date` 88px, and
  `--task-col-actions` 68px. Every cell renders whether or not it has
  content, so the columns line up down the list and the title is the only
  thing that truncates. The actions track is *reserved*, so hovering a row
  never shuffles its own metadata sideways.
  The switch is a **container query** on `.tasks` (`tasklist`, min-width
  620px), not a media query: below that the row falls back to the wrapped
  two-line layout of #157, which is what a phone gets — and what a desktop
  window gets once the detail panel has taken the list's width. Query the
  container, not the viewport, or the fallback misses that second case.
- **Habits are a card grid**, not a column: `.habits-grid` is
  `repeat(auto-fill, minmax(260px, 1fr))`, reflowing to one column once the
  content column can't hold two cards. Each card carries its recent-days
  strip (three weeks), current Streak, one Check-in control, and a single
  actions menu — History, Edit, Archive, Delete fold behind one kebab
  trigger rather than four permanent buttons. A met Target is called out in
  words ("Target met") and a check mark, never by the card's green wash
  alone.
- Radii: 6px inputs/buttons/chips (`--radius-sm`), 8px cards/panels
  (`--radius-md`), 12px modals (`--radius-lg`), full-round pills
  (`--radius-full`: timer presets, habit check, tag chips).

## Surfaces, borders, and elevation

- Flat colors only — no gradients, textures, or imagery.
- Content sits on white (`--surface-page`); the sidebar and kanban columns
  sit on `--surface-sunken`.
- Hairline borders (`--border-default`, `--border-subtle`) do the structural
  work. Shadows appear **only** on floating layers (`--shadow-md` popovers,
  `--shadow-lg` modals) and picked-up drag cards (`--shadow-drag`). Cards at
  rest have a 1px border and no shadow.

## Interaction

- **Hover** = background tint (`--surface-hover`), never opacity or scale.
- **Selected** rows = `--surface-selected` (blue-50) + semibold + accent text.
- **Row actions** (edit/delete/archive…) stay hidden until the row is
  hovered or the action is keyboard-focused. On a **task row** the trigger is
  `:focus-within` on the row itself, not on the action group: a
  `visibility: hidden` button can't be tabbed to, so keying the reveal off
  the group alone left the actions unreachable by keyboard entirely.
- **Keyboard focus** = 3px blue halo (`--focus-ring`).
- **Motion**: 120–180ms ease-out fades/slides (`--duration-*`, `--ease-out`).
  Nothing bounces, nothing loops; the focus clock ticks without animation,
  and the Focus progress dial is redrawn each tick from a static
  `stroke-dashoffset` — it has no transition and no keyframes.

## Iconography

- Icons are **Lucide** via the `lucide-react` package, always rendered
  through `frontend/src/components/Icon.tsx` (1.5px stroke). Add new icons to
  that file's map — never import `lucide-react` directly in a view — so a
  future bespoke icon set is a one-file swap.
- Sizes: 14px small inline indicators (e.g. a row's description or
  priority glyph, a habit card's Streak flame), 16px inline/rows, 18px
  sidebar, 20px toolbar. Color: `--text-secondary`, or accent/`--text-primary`
  when active.
- Emoji appear **only** as user-chosen List/Habit icons. 10px color dots
  identify Lists and Tags.
- Established mappings: edit=`pencil`, delete=`x` (a non-destructive
  removal — e.g. deleting a Folder, which only ungroups its Lists), List
  delete=`trash-2` (destroys every Task inside — heavier weight, on
  purpose), archive=`archive`,
  unarchive=`archive-restore`, history=`chart-column`, recurring=`repeat`,
  nav chevrons=`chevron-left/right`; folder row=`folder`; sidebar: Tasks=`list-checks`,
  Calendar=`calendar-days`, Habits=`repeat`, Focus=`timer`, Search=`search`,
  Today=`sun`, Next 7 Days=`calendar-range`, All=`layers`, Inbox=`inbox`;
  Priority=`signal-low`/`signal-medium`/`signal-high` (Low/Medium/High —
  see `PriorityIndicator.tsx`; None has no glyph).

## Sidebar anatomy

Top to bottom: wordmark → feature nav (Tasks / Calendar / Habits / Stand-up /
Focus / Search, plus Assistant when available — a vertical list of labelled
rows, readable rather than guessed from a glyph; the active one is told apart
by an inset accent bar + weight, not colour alone; #194, #160) → inline query
box → Smart Lists → Inbox → Folders and Lists → Tags (a wrapped cloud of
chips, each linking to its Tag view — #194) → bottom-pinned add actions (Add
List, Add Folder). Collapsed, the sidebar is an icon-only rail with every
accessible name preserved on aria-label/title.

Every Smart List, the Inbox, each Folder and each List carries an **open-Task
count** (#195): a trailing tabular numeral, `--text-xs`/`--text-tertiary`,
right-aligned in the row (`.nav-count`; on a Folder the pre-existing
`.folder-count`, which now counts open Tasks — the sum of its Lists — rather
than how many Lists it holds). The numbers are derived client-side from the
open Tasks the app already holds, never an aggregate endpoint, and update the
instant a Task is completed, created, deleted or moved. A count of zero
renders no element at all — never a literal "0". Tags carry no count. The
visible numeral is `aria-hidden`; the spoken form ("3 open tasks") is a
`.visually-hidden` sibling wired to the control via `aria-describedby`, so the
count reaches assistive tech without colliding with the item's accessible
name. Collapsed, the numeral steps aside with the rest of the row.

Standup, Focus, Calendar, Habits, Search, and Settings are URL-addressable
(`/standup`, `/focus`, etc. — #143); their sidebar nav items are real
anchors so cmd/ctrl-click, middle-click, and "copy link" work. List, Tag,
and Folder views stay in-memory only.

## Content rules

- Plain, direct, unhurried voice. Sentence case everywhere; feature nouns
  (List, Smart List, Check-in) capitalized as domain terms — see
  `CONTEXT.md` for the glossary.
- Confirmations state consequences precisely, consequence first, no drama.
- The system never cheerleads; encouragement text on Habits is user-authored.
- **No emoji in system copy.** Tabular numerals for times, counts, progress.
- Empty states: one calm sentence plus the primary action.

## Testing note

The frontend test suite (vitest + jsdom) does not apply external CSS, so
styling lives in CSS against stable class names and data attributes
(`data-priority`, `aria-pressed`, …) rather than in markup. Keep it that
way: restyle by CSS, and when markup must change, preserve accessible names
(`aria-label`s) — that is what the tests key on.

## Known gaps

- A global "Add Task" sidebar action (Quick-Add is currently per-List).
