# tuk-tuk

An all-in-one personal productivity app — task management, calendar, habits, and focus — with a clean, conventional HTTP API.

tuk-tuk is a single-user app: it is built for one person, not a household or team of distinct accounts.

## Language

**List**:
A user-created container of tasks, shown in the sidebar.
_Avoid_: Project, task list

**Folder**:
A user-created grouping of Lists in the sidebar. Folders contain only Lists, never tasks directly.
_Avoid_: Group, project group

**Task**:
The core unit of work: has a title, optional dates/reminders/recurrence, priority, tags, and completion state.
_Avoid_: Todo, item

**Entry**:
Anything occupying calendar space in the Calendar view (Month/Week/Day). A discriminated union of Task and Event (issue #107). The Calendar view's layout code (day-window membership, banner-vs-block classification, block spans, ordering) depends only on an entry's minimal time-shape — start, end, all-day flag, timezone — not on kind-specific fields, which is why an Event arm slotted in without changing any of that code. Mutating paths (create, move, resize, patch) always take a Task directly, never a bare Entry — the type system, not reviewer vigilance, keeps a write from ever targeting an Event, which has no such path. At equal start times an Event sorts before a Task: the immovable obligation reads first. A timed entry whose window spans more than one day is only reachable by an Event — the Task schedule invariant keeps a timed Task inside one calendar day — and renders as a clipped segment in each day's column it touches (issue #108) rather than collapsing into the all-day banner lane.
_Avoid_: Calendar item

Entries render in different timezones by kind, and this is deliberate, not a bug: a Task renders in whatever timezone it was scheduled in (a commitment the user made), while an Event renders in the **viewer's own** timezone, whatever timezone it was organised in (an artefact of whoever set it up). Rendering a Tokyo-organised meeting at its Tokyo hour would place it in the wrong row of the grid and cause a missed meeting. This asymmetry is the single most likely thing for a future reader to mistake for a bug — do not "fix" it into symmetry.

**Check Item**:
A lightweight line in a task's checklist — a title with its own done/undone state and optional reminder. Belongs to exactly one Task and is not a Task itself (no tags, priority, or list). The only nesting mechanism in v1.
_Avoid_: Subtask (a separate recursive-task concept, out of v1), checklist item

**Smart List**:
A built-in virtual view computed from task attributes — Today, Next 7 Days, All. Not a List: nothing is stored "in" a Smart List.
_Avoid_: Filter (a different, user-defined feature)

**Inbox**:
The built-in List that receives tasks not filed anywhere else. A real List (every task has one), but undeletable and unhideable.

**Completed Occurrence**:
The history record written when one occurrence of a recurring Task is completed. The Task itself stays open with its date advanced; Completed Occurrences are what the completed view and statistics show.
_Avoid_: Completed instance

**Priority**:
One of four levels on a Task: None, Low, Medium, High. Levels are named, not numbered, in domain language.
_Avoid_: Importance, urgency (Eisenhower Matrix concepts, out of v1)

**Quick-Add**:
The single-line capture bar that creates a Task from typed text, parsing structured shortcuts: `#tag`, `!priority`, `~list`. Each sigil also opens a suggestion dropdown as it's typed, narrowing by prefix; picking a suggestion swaps the typed text for a removable chip. `#tag` and `~list` additionally offer a "Create …" row when the query names nothing that exists yet — picking it is the only way Quick-Add brings a new List or Tag into being, so an unpicked token never creates one. `!priority`'s three non-default levels (High, Medium, Low — there is no `!none` token) are a closed set and offer no such row. Natural-language date parsing is not part of v1 Quick-Add.
_Avoid_: Smart Recognition (NLP date parsing, deferred)

**Tag**:
A first-class label (name + color) applied to any number of Tasks and navigable from the sidebar. Renaming a Tag renames it everywhere.
_Avoid_: Label

**Section**:
A named, ordered sub-group inside a List. Sections subdivide the List view and ARE the Kanban columns — one concept, not two.
_Avoid_: Column, group

**Reminder**:
A relative offset from a Task's date (e.g. "9 hours before") at which the user should be notified. Tasks can have several. v1 stores and edits Reminders but does not deliver notifications.
_Avoid_: Alarm, notification (the delivery mechanism, not the domain concept)

## Habits

**Habit**:
A recurring practice tracked by Check-ins rather than completion — either Boolean (done / not done) or Numeric (an amount toward a Goal, e.g. 8 glasses of water).

**Check-in**:
The record of one day's progress on a Habit: a date stamp and, for Numeric habits, a value. Check-ins can be backfilled for missed days.
_Avoid_: Completion, log

**Streak**:
The count of consecutive scheduled days a Habit has been checked in without a miss.

## Assist (v2)

**Assist**:
The optional AI capability family. Assist only ever proposes — every output is a Suggestion the user confirms or discards; it never changes data on its own. When no local model is available, Assist features are invisible, and the app is fully functional without them.
_Avoid_: Copilot, AI assistant, agent

**Suggestion**:
One proposal produced by Assist (a parsed task draft, a proposed order, a proposed date). Ephemeral: computed on demand, shown inline, and gone once confirmed or discarded — never stored.
_Avoid_: Recommendation, action (Assist takes no actions)

**Assisted Capture**:
The Assist feature on Quick-Add: on submit, free text (English or Spanish) is parsed into a proposed Task — date, recurrence, reminder, list, tags, priority shown as editable chips — for one confirmation beat before saving. Parsed words are stripped from the title; only existing Lists and Tags are matched, never invented. Replaces the deferred "Smart Recognition" idea.
_Avoid_: Smart Recognition, NLP parsing

**Overdue Triage**:
The Assist feature over overdue Tasks: one action proposes a realistic new date per overdue Task, in batch; each Suggestion is accepted or discarded individually.
_Avoid_: Auto-reschedule (nothing moves without confirmation)

## Focus

**Focus Session**:
One persisted period of focused work — either a Pomo (fixed countdown, default 25 min) or a Stopwatch (count-up) — optionally linked to a Task or Habit for statistics.
_Avoid_: Focus record, Pomodoro record, Timing

**Timer**:
A saved Focus Session preset (name + mode + duration) for recurring scenarios like "Reading".
_Avoid_: Preset

## Google Calendar

**Google Account**:
A connected Google identity (issue #105): its Google-side id, email, and a refresh credential stored encrypted at rest under its own dedicated key — deliberately not derived from `secret_key`, so rotating the session signing key never disconnects it. Several can be connected at once; each is identified in the UI by its email.
_Avoid_: Google connection, integration

**Google Calendar**:
One calendar exposed by a connected Google Account (issue #106) — primary, secondary, shared, or a subscribed feed. Carries a Google-side id, a cosmetic `summary` refreshed on demand, an `enabled` flag controlling whether its Events appear in the Calendar view, and a `color` chosen from tuk-tuk's own palette (never Google's, so it can't clash with the app's theme). `enabled` is seeded once, on first read, from Google's own per-calendar `selected` flag; from then on it is purely local state that a manual refresh never overwrites for calendars that still exist. Disconnecting the owning Google Account removes its Google Calendars.
_Avoid_: Calendar (ambiguous with the Calendar view itself)

**Event**:
One occurrence on a Google Calendar (issue #107), read live for the Calendar view's visible window and never persisted (ADR 0006) — an Entry arm alongside Task, but read-only: it cannot be dragged, resized, or completed, and offers no affordance suggesting otherwise. A recurring series always arrives already expanded into concrete Events, never as a rule tuk-tuk interprets itself. Declined Events (the authenticated user's own RSVP) are hidden; a pending invitation (needs-action) or a tentative response stays visible, since an unanswered invite must not be invisible. Disabling its owning Google Calendar removes its Events from the view. See the Entry glossary entry above for the deliberate viewer-timezone rendering asymmetry with Task. Unlike a Task, an Event may cross midnight (issue #108): in Week/Day it renders as one segment per day it touches, clipped at each day boundary, so it reads correctly on both the day it starts and the day it ends — the splitting is a Calendar-view rendering concern only, since the backend adapter and API pass the crossing through untouched.
_Avoid_: Calendar item, meeting
