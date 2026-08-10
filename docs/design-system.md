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
  - **Priority** (High/Medium/Low = red/amber/blue) appears on the task
    checkbox ring **and nowhere else** (`--priority-*`, driven by the
    `data-priority` attribute on task rows).
  - **Overdue** dates are red text.
  - **Habit success** is green (`--success`, heatmap ramp `--heat-0…4`).
  - **Focus** has its own identity — plum `--focus-accent` `#7a48ec` — so
    deep work feels like a different room.
  - User-chosen List/Tag colors come from the 8 curated `--swatch-*` values.
- **Semantic aliases** (`--surface-*`, `--text-*`, `--border-*`, `--accent`,
  `--danger`, …) are what component CSS should reference; the raw ramps are
  implementation detail.

## Typography

Three faces, loaded from Google Fonts in `index.html`:

| Face | Token | Used for |
| --- | --- | --- |
| Bricolage Grotesque | `--font-display` | Screen titles (26px), big numbers (focus clock 56px), the wordmark |
| Instrument Sans | `--font-body` | All UI text; 14px default |
| JetBrains Mono | `--font-mono` | Timers, date chips, counts — anything tabular |

Uppercase 12px labels with `--tracking-caps` head sections, folders, and
sidebar groups. **There is no logo**: the wordmark is "Tuk Tuk" in
Bricolage Grotesque, semibold/bold, type only.

## Spacing, layout, and radii

- 4px base scale (`--space-1…12`).
- Layout constants: sidebar `--sidebar-width` 248px, detail panel
  `--detail-width` 360px, content column `--content-max` 720px (Calendar and
  Kanban run full width), rows `--row-height` 40px, controls
  `--control-height` 34px.
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
  hovered or the action is keyboard-focused.
- **Keyboard focus** = 3px blue halo (`--focus-ring`).
- **Motion**: 120–180ms ease-out fades/slides (`--duration-*`, `--ease-out`).
  Nothing bounces, nothing loops; the focus clock ticks without animation.

## Iconography

- Icons are **Lucide** via the `lucide-react` package, always rendered
  through `frontend/src/components/Icon.tsx` (1.5px stroke). Add new icons to
  that file's map — never import `lucide-react` directly in a view — so a
  future bespoke icon set is a one-file swap.
- Sizes: 16px inline/rows, 18px sidebar, 20px toolbar. Color:
  `--text-secondary`, or accent/`--text-primary` when active.
- Emoji appear **only** as user-chosen List/Habit icons. 10px color dots
  identify Lists and Tags.
- Established mappings: edit=`pencil`, delete=`x` (a non-destructive
  removal — e.g. deleting a Folder, which only ungroups its Lists), List
  delete=`trash-2` (destroys every Task inside — heavier weight, on
  purpose), archive=`archive`,
  unarchive=`archive-restore`, history=`chart-column`, recurring=`repeat`,
  nav chevrons=`chevron-left/right`; sidebar: Tasks=`list-checks`,
  Calendar=`calendar-days`, Habits=`repeat`, Focus=`timer`, Today=`sun`,
  Next 7 Days=`calendar-range`, All=`layers`, Inbox=`inbox`.

## Sidebar anatomy

Top to bottom: wordmark → feature row (Tasks / Calendar / Habits / Focus —
the active view is a pill with icon + label, the rest icon-only) → search →
Smart Lists → Inbox → Folders and Lists → Tags → bottom-pinned add actions
(Add List, Add Folder).

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

- Sidebar task counts (design shows per-list counts; needs an API aggregate).
- A global "Add Task" sidebar action (Quick-Add is currently per-List).
- Dark mode: not designed; tokens make it feasible later.
