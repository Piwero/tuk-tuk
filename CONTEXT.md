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
The core unit of work: has a title, optional dates/reminders/recurrence, priority, tags, and completion state. A Task converted from an Event (issue #111) additionally carries that Event's calendar and Google event id as provenance — otherwise invisible, purely local state that hides the Event it came from and reappears if the Task is deleted — but is otherwise an ordinary Task in every way: draggable, taggable, prioritisable, completable, focusable.
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
The optional AI capability family. Assist only ever proposes — every output is a Suggestion the user confirms or discards; it never changes data on its own. Each Assist feature is configured with its own inference provider (ADR 0009), so one may run locally while another does not; a feature whose provider is unconfigured or unreachable is invisible, and the app is fully functional without any of them.
_Avoid_: Copilot, agent. "AI assistant" as a generic label for the family — the Assistant is one specific member of it (below), so using the phrase loosely makes the family and the feature indistinguishable.

**Assistant**:
The Assist feature that plans a day in conversation: the user describes what they need to do, and the Assistant reads the current week — Tasks, today's Events, List and Tag names, Habits — and answers with prose plus Suggestions to create Tasks, block them into time, and set priorities. Accepted individually; nothing is written until accepted. It plans Tasks *around* Events, never moving an Event (ADR 0006 keeps Google Calendar read-only). The only Assist feature that may be configured against a cloud provider, and the only one that is conversational at all — every other member is a single beat with no transcript. The conversation is ephemeral: held in the browser, sent whole each turn, gone on refresh.
_Avoid_: Chat, bot, agent (it takes no actions), Copilot

**Suggestion**:
One suggestion produced by Assist (a parsed task draft, a proposed order, a proposed date, a proposed time block). Ephemeral: computed on demand, shown inline, and gone once confirmed or discarded — never stored. A Suggestion names a change, never performs one: the Assistant's Suggestions in particular are structured output, never tool calls the model could invoke, which is what makes "Assist takes no actions" an architectural property rather than a promise (ADR 0009).
_Avoid_: Recommendation, action (Assist takes no actions), Proposal (the same concept under a second name)

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
A connected Google identity (issue #105): its Google-side id, email, and a refresh credential stored encrypted at rest under its own dedicated key — deliberately not derived from `secret_key`, so rotating the session signing key never disconnects it. Several can be connected at once; each is identified in the UI by its email. Carries a `connection_state` of "connected" or "needs_reconnect" (issue #109): a terminal failure reading this account's Events or calendars — the grant was revoked or expired — flips it to "needs_reconnect", surfaced identically in the Calendar view's failure banner and in Settings, both offering Reconnect (the same consent flow as first connecting; it restores the account in place rather than removing and re-adding it). A transient failure (network trouble, a server error, rate limiting) never touches `connection_state` — it's retry-safe, and the account stays connected throughout.
_Avoid_: Google connection, integration

**Google Calendar**:
One calendar exposed by a connected Google Account (issue #106) — primary, secondary, shared, or a subscribed feed. Carries a Google-side id, a cosmetic `summary` refreshed on demand, an `enabled` flag controlling whether its Events appear in the Calendar view, and a `color` chosen from tuk-tuk's own palette (never Google's, so it can't clash with the app's theme). `enabled` is seeded once, on first read, from Google's own per-calendar `selected` flag; from then on it is purely local state that a manual refresh never overwrites for calendars that still exist. Disconnecting the owning Google Account removes its Google Calendars.
_Avoid_: Calendar (ambiguous with the Calendar view itself)

**Event**:
One occurrence on a Google Calendar (issue #107), read live for the Calendar view's visible window and never persisted (ADR 0006) — an Entry arm alongside Task, but read-only: it cannot be dragged, resized, or completed, and offers no affordance suggesting otherwise beyond converting itself away (below). A recurring series always arrives already expanded into concrete Events, never as a rule tuk-tuk interprets itself. Declined Events (the authenticated user's own RSVP) are hidden; a pending invitation (needs-action) or a tentative response stays visible, since an unanswered invite must not be invisible. Disabling its owning Google Calendar removes its Events from the view. See the Entry glossary entry above for the deliberate viewer-timezone rendering asymmetry with Task. Unlike a Task, an Event may cross midnight (issue #108): in Week/Day it renders as one segment per day it touches, clipped at each day boundary, so it reads correctly on both the day it starts and the day it ends — the splitting is a Calendar-view rendering concern only, since the backend adapter and API pass the crossing through untouched. Clicking an Event opens a read-only detail popover (issue #110) — location, attendees, organiser, description, and which account/calendar it came from, plus a link out to Google Calendar for anything tuk-tuk can't show. This is the only home for the parts of an Event with no Task equivalent (the attendee list, the organiser, a video-call link buried in the description); dismissing it, like every other Event interaction, changes nothing. The popover's one write-adjacent affordance is "Convert to task" (issue #111): it turns the Event into a real Task — title, schedule, and description (with location and a link back) carried over, landing in the Inbox — after a preview the user must confirm. Only the clicked occurrence of a recurring series converts; the rest keep showing as Events, since a Task's single recurrence rule can't represent the cancellations and per-instance overrides a real Google series carries. A midnight-crossing Event clamps to the end of its start day (the Task schedule invariant isn't relaxed for this), with its true end kept in the description and shown before confirming. The Event then disappears from the Calendar — filtered out by matching the Task's provenance, since Google access stays read-only and nothing is ever written back — and reappears only if that Task is deleted.
_Avoid_: Calendar item, meeting
