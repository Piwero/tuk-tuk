# tuk-tuk

An all-in-one personal productivity app — task management, calendar, habits, and focus — with a clean, conventional HTTP API.

One instance serves several Users, and each sees only their own data (ADR 0018). Nothing is shared between Users: there are no shared Lists, assignees or invites.

## Accounts

**User**:
A person with their own account on the instance: a username, an email and a password. Everything a User creates belongs to them alone, and no other User can see it. A User is disabled rather than deleted, which ends their sessions and keeps their data.
_Avoid_: Member, tenant (nothing is shared, so a User belongs to no group)

**Admin**:
A User who can also manage accounts: create Users with a temporary password, disable or re-enable them, reset their passwords, and grant or remove Admin. Only an Admin creates accounts; there is no sign-up. Being Admin grants no access to other Users' data.
_Avoid_: Superuser, root

**API token**:
A named, personal credential a User creates in Settings for a client that cannot log in with a password. Shown once when created, acts strictly as the User who created it, and can be revoked on its own without logging the User out anywhere else. Has one of two kinds, its audience: an API token proper (`tuk_pat_…`), which the API accepts, or an MCP token.
_Avoid_: Bearer token (any of these is sent as one), session, password

**MCP token**:
An API token of the MCP kind (`tuk_mcp_…`), whose only audience is the shared MCP server: the API refuses it. A User puts it in their own AI client; on every MCP request the server trades it, with the MCP service key, for a two-minute access credential for that User (issue #525, ADR 0016's amendment). One per client, so each can be revoked on its own.
_Avoid_: Bearer token, MCP bearer token (the retired shared `MCP_BEARER_TOKEN`)

**MCP service key**:
The one secret the shared MCP server deployment holds (`MCP_SERVICE_KEY`), shared with the backend. It lets the server exchange a User's MCP token for an access credential, names no User, and reaches no data without an MCP token.
_Avoid_: Bearer token, API token

**Access credential**:
What the MCP token exchange returns (`tuk_mcpa_…`): signed, naming the User and the MCP token it came from, valid for two minutes, and used by the MCP server for one MCP request. It reaches only the routes the MCP tools call, and stops working as soon as its MCP token is revoked or its User disabled.
_Avoid_: Session, access token (OAuth's term; this is not OAuth)

## Language

**List**:
A user-created container of tasks, shown in the sidebar.
_Avoid_: Project, task list

**Folder**:
A user-created grouping of Lists in the sidebar. Folders contain only Lists, never tasks directly.
_Avoid_: Group, project group

**Task**:
The core unit of work: has a title, optional dates/reminders/recurrence/Planned work, priority, tags, and completion state. A Task converted from an Event (issue #111) additionally carries that Event's calendar and Google event id as provenance — otherwise invisible, purely local state that hides the Event it came from and reappears if the Task is deleted — but is otherwise an ordinary Task in every way: draggable, taggable, prioritisable, completable, focusable.
_Avoid_: Todo, item

**Entry**:
Anything occupying calendar space in the Calendar view (Month/Week/Day). A discriminated union of Task, Planned work and Event (issues #107, #562). The Calendar view's layout code (day-window membership, banner-vs-block classification, block spans, ordering) depends only on an entry's minimal time-shape — start, end, all-day flag, timezone — not on kind-specific fields, which is why an Event arm slotted in without changing any of that code. Mutating paths (create, move, resize, patch) always take a Task directly, never a bare Entry — the type system, not reviewer vigilance, keeps a write from ever targeting an Event, which has no such path. At equal start times an Event sorts before a Task: the immovable obligation reads first. A timed entry whose window spans more than one day is only reachable by an Event — the Task schedule invariant keeps a timed Task inside one calendar day — and renders as a clipped segment in each day's column it touches (issue #108) rather than collapsing into the all-day banner lane.

A Planned work Entry carries its Task, never an Event, and its only write path is the Task's own planned work PATCH: dragging or resizing the block changes the plan and nothing else, never the due date and never an Event, and the Task detail's Planned work row is its non-drag alternative. The range query brings a Task into the window when its schedule *or* its Planned work day falls inside it, so a plan renders even when the due date is elsewhere or absent. It always reads as its own kind, in text and not only by colour: an accent-tinted, dashed block labelled *Planned work*, with its Buffer after drawn beneath it, while an Event keeps a solid neutral treatment labelled *Event · read-only*. When a Task has a plan, its own schedule Entry is named *Due date*, so a schedule and a plan that coincide are never two indistinguishable copies of one commitment; only the Task's own Entry offers completion. At equal start times an Event sorts first, then Planned work, then the Task's schedule.
_Avoid_: Calendar item

The Calendar shows plans, not history: both the grid and the Unscheduled rail read open Tasks only, so a Task completed from the Calendar leaves the view once its completion commits. A recurring Task is the exception that proves the rule — it comes back still open with its dates advanced (ADR 0003), so it stays in the view and moves to its next occurrence's day, which is only on screen when that day is inside the window currently shown.

Entries render in different timezones by kind, and this is deliberate, not a bug: a Task renders in whatever timezone it was scheduled in (a commitment the user made), while an Event renders in the **viewer's own** timezone, whatever timezone it was organised in (an artefact of whoever set it up). Rendering a Tokyo-organised meeting at its Tokyo hour would place it in the wrong row of the grid and cause a missed meeting. This asymmetry is the single most likely thing for a future reader to mistake for a bug — do not "fix" it into symmetry.

**Active hours**:
The band of the day the user marks as when they are usually active (issue #210). Inside it the Week/Day time grid renders at double height (96px/hour) so short tasks stay readable in place; outside it the grid compresses (24px/hour) so dead hours cost little scroll. A per-User setting stored server-side — it describes the User, not a device — disabled by default, prefilling 09:00–17:00 on first enable. The band is aligned to 30 minutes, must start strictly before it ends, and may not wrap past midnight: a wrapping band makes "the start of your day" ambiguous, and night-shift support (a movable day boundary) is out of scope. Degenerate bands (the whole day, or a single 30-minute band) are allowed. Only the Week and Day views are affected; Month has no time axis, and the all-day lane is untouched. See ADR 0010 for the piecewise time-axis invariant this rests on. Active hours shapes the calendar layout only: it never decides when Reminders notify — that is Quiet hours, a separate setting.
_Avoid_: Working hours (the band is about activity, not work), office hours, business hours

**Check Item**:
A lightweight line in a task's checklist — a title with its own done/undone state, nothing more. Belongs to exactly one Task and is not a Task itself (no tags, priority, list, dates or Reminders: a Reminder belongs to its Task). The only nesting mechanism in v1.
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
The single-line capture bar that creates a Task from typed text, parsing structured shortcuts: `#tag`, `!priority`, `~list`, `@date`. Each sigil also opens a suggestion dropdown as it's typed, narrowing by prefix; picking a suggestion swaps the typed text for a removable chip. `#tag` and `~list` additionally offer a "Create …" row when the query names nothing that exists yet — picking it is the only way Quick-Add brings a new List or Tag into being, so an unpicked token never creates one. `!priority`'s three non-default levels (High, Medium, Low — there is no `!none` token) are a closed set and offer no such row. `@date` is a closed day vocabulary (`@today`, `@tomorrow`, `@weekend`, `@next-week`, `@monday`…`@sunday`, and unambiguous weekday abbreviations like `@mon`), resolved deterministically client-side against the local calendar into an all-day due date with no invented hour; its dropdown opens on a bare `@` since the vocabulary is the feature's own, not the user's. A bare clock time (`@8am`, `@8:30pm`, `@14:00`) is the one token that _composes_ rather than replaces: it attaches to the chip's day half — `@tomorrow @8am` is one chip reading "Tomorrow 8:00 AM", a day token overwriting only the day and a time token only the time — and a time with no day means today, even an hour already past. A timed schedule creates the Task with `is_all_day: false` and the browser's IANA zone, like an ordinarily-scheduled Task; a day-only schedule stays all-day. The chip's single × clears both halves. Open-ended natural-language date parsing is still not part of Quick-Add (see Assist for the model-driven path).
_Avoid_: Smart Recognition (NLP date parsing, deferred)

**Tag**:
A first-class label (name + color) applied to any number of Tasks and navigable from the sidebar. Renaming a Tag renames it everywhere.
_Avoid_: Label

**Section**:
A named, ordered sub-group inside a List. Sections subdivide the List view and ARE the Kanban columns — one concept, not two.
_Avoid_: Column, group

**Reminder**:
A relative offset from a Task's date (e.g. "9 hours before") at which the User asks to be notified. Tasks can have several; Check Items have none. Its anchor is always the Task's own date, never its Planned work. Delivery is opt-in, under **Reminder notifications** (issue #557): off by default for every User, so offsets saved before delivery existed never start notifying on their own, and enabled per device with an explicit **Enable on this device** — the browser's permission prompt only ever follows that click. Delivery is **foreground-only**: supported while a signed-in app tab is open on a supported browser served from a secure context (HTTPS or `localhost`); a backgrounded, closed or locked device is unsupported, and tuk-tuk never claims the operating system displayed an alert. A Reminder notifies at most once per Task occurrence however many tabs are open (an open tab claims it from a per-User delivery ledger, ADR 0019; exactly-once display is not promised), and a completed, deleted or already-advanced occurrence never notifies. Reminders that fall due while no tab is open are shown in-app as missed reminders, never replayed as a burst of late alerts. Snoozing delays one occurrence's alert without changing the Task's dates. Denied permission, an unsupported browser or a delivery failure leaves Tasks and Reminders fully usable.
_Avoid_: Alarm, notification (the delivery, not the domain concept), push notification (background push is unsupported)

**Quiet hours**:
A per-User band of the day during which Reminder notifications are held back: a Reminder falling due inside it is deferred until the band ends and then notifies once, and stays visible in-app meanwhile. A notification setting, not Active hours — Active hours changes only the calendar grid and never delivery, and Quiet hours never changes the grid. Nothing bypasses it: there is no critical-alert exception.
_Avoid_: Active hours (the calendar layout band), Do not disturb (the operating system's own setting)

**Planned work**:
An optional block of time a User reserves for working on a Task (issue #558): a start, a positive duration and the timezone it was planned in, plus an optional **Buffer after** — slack kept free after the block. At most one per Task, inside one local calendar day. It is not the Task's schedule: moving or removing it never moves or clears the Task's start or due date, and it is never a Reminder's anchor. Completing or advancing a recurring Task (ADR 0003) clears that occurrence's Planned work rather than carrying it to the next occurrence. On the Calendar it reads as a visibly labelled Planned work block, distinct from both Events and the Task's own schedule. Its duration is an optional estimate used only for planning and never required to capture a Task. The start is an instant and the duration is elapsed minutes, so a block across a DST change keeps its real length; the block plus its buffer may end exactly at the next local midnight, never past it. It needs no due date, and changing the Task's dates never moves it; completing a one-off Task keeps it, so a reopen finds it again. On the wire it is the Task's `planned_work` (`null` when unplanned; a read adds the computed `end`), written whole or removed with `null` on the Task PATCH; a client that never sends the field leaves it untouched.
_Avoid_: Schedule (the Task's start/due dates), time block, appointment (an Event)

## Habits

**Habit**:
A recurring practice tracked by Check-ins rather than completion — either Boolean (done / not done) or Numeric (an amount toward a Target, e.g. 8 glasses of water). The app labels these types "Done / not yet" and "Count"; Boolean and Numeric stay the domain and API terms (`boolean` / `numeric`).

**Target**:
The amount a Numeric Habit's Check-ins count toward in one day. Boolean Habits have a Target of 1, so a single tap fills it. Not a Goal — a Goal is a separate entity with its own window and Key Results (ADR 0012).
_Avoid_: Goal (the field was called `goal` before ADR 0012 and is now `target`)

**Check-in**:
The record of one day's progress on a Habit: a date stamp and, for Numeric habits, a value. Check-ins can be backfilled for missed days.
_Avoid_: Completion, log

**Streak**:
The count of consecutive **eligible** scheduled days a Habit has been checked in without a miss. An eligible day is scheduled, on or after the Habit start, and neither paused nor skipped. Unscheduled, paused and skipped days are stepped over, never counted as done, so a Streak across a Pause or Skip is shorter than a perfect daily record of the same span. Today is graced until it ends.

**Habit start**:
The first local day a Habit can be missed: the User's calendar day when the Habit was created (read in their time zone), or the day of an earlier real Check-in when one exists, and never later than today. Days before it are **not started**: neither missed nor done, and never counted against the Habit, even when a Pause covers them. It is where eligibility begins; a Pause only removes days after it. The API calls it `eligible_from`.
_Avoid_: Start date (no such field is stored), eligibility date

**Pause**:
An explicit date interval, optionally open-ended, during which a Habit is deliberately not practised (issue #559) — for travel or illness. Paused days are neither missed nor done: they create no Check-in and the Streak steps over them without counting them. **Resume today** ends an open pause yesterday, so today is eligible again; **Edit pause** changes its dates. A pause cannot cover a date that already has a Check-in — the conflicting dates are named and nothing is deleted — and a paused date accepts no Check-in until the pause is removed. For a times-per-week Habit, pausing a whole week excludes that week; a partial-week pause leaves the weekly target unchanged. Settled Goal Scores are never rewritten by a later pause (ADR 0012). The app labels the state **Paused**.
_Avoid_: Break, freeze, vacation

**Skip**:
One scheduled day a User explicitly marks as not practised on a Habit — a deliberate choice, unlike a missed day, which is a forgotten Check-in. Like a paused day it creates no Check-in, counts as neither success nor failure, is excluded from the Streak rather than rewarded, and cannot be placed on a date that already has a Check-in; a skipped day accepts no Check-in until the skip is removed. A partial-week skip leaves a times-per-week Habit's weekly target unchanged. The app labels the state **Skipped**.
_Avoid_: Miss (an unplanned absence), excuse, rest day

## Goals

**Goal**:
A durable outcome with a window (ADR 0012): title (the Wish), description (the Outcome), an optional Obstacle and If-Then Plan (WOOP), a start/end date defaulting to the current calendar quarter, a status (active/closed/abandoned), a focused flag, and — once graded — a final score and retro. Carries Key Results. Goals do not nest, and there is no Theme or life-area entity.
_Avoid_: SprintGoal (the untracked text line it supersedes), Objective (OKR's term; tuk-tuk just says Goal)

**Key Result**:
One measurable number belonging to a Goal (ADR 0012): a name, a start value, a target value, and a current value. Its value is either typed in directly (`manual`), or computed on read from work already tracked elsewhere — summed from a linked Habit's Check-ins within the Goal's window (`habit_checkins`), or counted from completed Tasks attached to it (`task_count`). Automatic sources are read-only: writing to their value is rejected with a 409, and no counter is ever stored or updated by a write hook — the value is recomputed every read. A Key Result has no life outside its Goal (nested API, no top-level collection), the same relationship a Stand-up Bullet has to its Entry.
_Avoid_: Metric, KR without spelling it out on first use

**Ratio**:
A Key Result's progress: `(current - start) / (target - start)`, clamped to 0.0-1.0. Falls out the same for descending Key Results (target below start). Not stored.

**Score**:
A Goal's overall progress: the unweighted mean of its Key Results' ratios, rounded to two places. Null (not zero) for a Goal with no Key Results, so "unmeasured" never reads as "failed." Computed live only while a Goal is active. The moment it leaves `active` — closed by its window passing, or abandoned — it **settles**: the Score is frozen as `final_score` and reported from there, so a Check-in backfilled afterward never rewrites it, and never contradicts it on the same payload.
_Avoid_: Weighted score (rejected — see ADR 0012)

**Pace**:
How far through its window an active Goal is: elapsed days ÷ total days of the Goal's window, clamped to 0–1. The Goal card's verdict is Score minus pace in percentage points (ahead, on pace or behind). Shown for active Goals only; a settled Goal has no pace.

**Focused Goal**:
The one Goal, of possibly several active ones, carrying `is_focused`. Setting it clears the previous one in the same transaction, enforced at the service layer (not a database constraint) — the rule the next reader will actually find. Stand-up shows only the Focused Goal and its Key Result progress, never a list of every active Goal. Only an active Goal can be focused: settling drops the flag, since the morning ritual must not keep showing an outcome already closed or abandoned.

**Obstacle**:
The Goal field naming what is expected to get in the way of it (WOOP's mental-contrasting step) — free text, nullable, since a Goal must be creatable in seconds.

**If-Then Plan**:
The Goal field pairing an Obstacle with the action to take when it shows up, in the form "If [obstacle happens], then I will [action]" (WOOP's implementation intention) — free text, nullable, and shown with that format as its placeholder so what gets written is a concrete plan rather than a vague note.

## Assist (v2)

**Assist**:
The optional AI capability family. Assist only ever proposes — every output is a Suggestion the user confirms or discards; it never changes data on its own. The one exception is the Voice Assistant (ADR 0015), which writes within ADR 0014's bounded set after a spoken confirmation. Each Assist feature is configured with its own inference provider (ADR 0009), so one may run locally while another does not; a feature whose provider is unconfigured or unreachable is invisible, and the app is fully functional without any of them.
_Avoid_: Copilot, agent. "AI assistant" as a generic label for the family — the Assistant is one specific member of it (below), so using the phrase loosely makes the family and the feature indistinguishable.

**Assistant**:
The Assist feature that plans a day in conversation: the user describes what they need to do, and the Assistant reads the current week — Tasks, today's Events, List and Tag names, Habits — and answers with prose plus Suggestions to create Tasks, block them into time, and set priorities. Accepted individually; nothing is written until accepted. It plans Tasks *around* Events, never moving an Event (ADR 0006 keeps Google Calendar read-only). The only Assist feature that may be configured against a cloud provider, and the only one that is conversational at all — every other member is a single beat with no transcript. The conversation is ephemeral: held in the browser, sent whole each turn, gone on refresh.
_Avoid_: Chat, bot, agent (it takes no actions), Copilot

**Voice Assistant**:
The Assist feature you talk to (ADR 0015): a spoken session in the browser for organising Tasks, the day and Habits, in English or Spanish. The only Assist member that writes. Its tools follow the MCP server's principle (idempotent, non-destructive, Task-or-Habit scoped, no delete), and each turn's batch of writes is read back and applied only after a spoken yes. The agent (`voice-agent/`) runs on the User's own LiveKit Cloud project, one worker per User deployed by the Admin on request, but every tool call is relayed over LiveKit RPC to that User's open tab, which runs it with its own session cookie. So no backend is ever exposed and no tuk-tuk credential is held at LiveKit. Push-to-talk by default (continuous is opt-in). Sessions start from the Agenda plus the tab's timezone and date, end only when you end them or close the tab, show captions only, and persist nothing. Invisible until that User's own LiveKit credentials are set in Settings; Voice goes unavailable for the rest of the month once free inference credit runs out.
_Avoid_: Voice mode (it is not the Assistant with a microphone), voice agent (the name of the deployable in `voice-agent/`, not the feature), Assistant without "Voice"

**Suggestion**:
One suggestion produced by Assist (a parsed task draft, a proposed order, a proposed date, a proposed time block). Ephemeral: computed on demand, shown inline, and gone once confirmed or discarded — never stored. A Suggestion names a change, never performs one: the Assistant's Suggestions in particular arrive only as structured output, never as a tool call — the model may call a small set of read-only drill-down tools (fewer than six, capped at three iterations per turn), but there is no write tool of any kind, which is what makes "Assist takes no actions" an architectural property rather than a promise (ADR 0009).
_Avoid_: Recommendation, action (Assist takes no actions), Proposal (the same concept under a second name)

**Assisted Capture**:
The Assist feature on Quick-Add: on submit, free text (English or Spanish) is parsed into a proposed Task — date, recurrence, reminder, list, tags, priority — for one confirmation beat before saving. In the one-line Quick-Add bar the proposal is a row of editable ghost chips (Enter confirms, Escape discards); in the Quick add dialog it fills the dialog's own List/Priority/Date controls instead (a second "Add task" saves), with recurrence and reminder — which have no control there — shown as removable chips. Parsed words are stripped from the title; only existing Lists and Tags are matched, never invented. Assist only ever adds value: an unreachable Ollama, a parse that extracts nothing, or a failure all save the Task in the single beat, exactly as Quick-Add behaved before. Replaces the deferred "Smart Recognition" idea.
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

## Now

**Now**:
The one Task a User chose to do next, shown at the top of Today when the Now setting is on. Picking it changes nothing on the Task. It is saved with the occurrence it was picked for, so deleting, completing or advancing that Task (a recurring one advances in place, ADR 0003) clears it.
_Avoid_: Current task, Focus task (Focus is the Focus Session feature)

**Now shortlist**:
A short, ordered list of alternative Tasks kept beside Now, with no cap. A Task appears at most once and never while it is the Now Task; entries are cleared by the same rule as Now.
_Avoid_: Queue, Up next

**Resume note**:
A short free-text note on the Now selection saying where the User left off. It belongs to that selection and occurrence: choosing another Task, or the Task going stale, discards it.
_Avoid_: Task note, Description (the Task's own text)

**Gentle return**:
A Today setting that collapses earlier overdue Tasks behind one counted disclosure, so returning after time away is not a wall of red. Presentation only: no Task dates change.
_Avoid_: Auto-reschedule, Overdue Triage (the Assist feature that does propose new dates)

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

## Clients

**CLI**:
The `tuk` command-line client for the daily loop: capture, review, complete. First console entrypoint of the client package in `cli/oci/`; human-readable output by default, `--json` emitting the API's response untouched for scripting. Takes explicit flags rather than the Quick-Add sigil grammar, and resolves a typed List or Tag name by exact case-insensitive match — never creating what does not exist, so a typo cannot litter the sidebar.
_Avoid_: Console app (says nothing about which contract it speaks)

**MCP server**:
The `tuk-mcp` package in `mcp/oci/`: a Model Context Protocol server exposing reads plus a bounded write set — idempotent, non-destructive, Task-or-Habit scoped, with no delete tool of any kind. Two transports: stdio (default), run as a subprocess of the owner's own AI client; and Streamable HTTP (`--http`), one shared deployment in the cluster reachable only on the tailnet, serving every User: each client authenticates with its User's own MCP token, and the server holds only the MCP service key, no User's credential. Reuses shared HTTP client, session handling and transport seam from `shared/oci`. See ADR 0014 and ADR 0016.
_Avoid_: Agent (it takes no actions on its own; the owner's client directs it turn by turn)

**Session file**:
`session.json` under the XDG config directory (`~/.config/tuk/`, overridable with `TUK_CONFIG_DIR`), holding the cached signed session cookie both clients share. Written owner-only by `tuk login`, which prompts for a username or email and the password on a terminal and posts them to the existing login endpoint — the password itself is never persisted in any form. A lapsed session renders as an instruction to run `tuk login` again.
_Avoid_: Token (the Session file holds the browser's session cookie; an API token is a different credential)

**Agenda**:
The client-side answer to "what am I doing today": the local day's Tasks (with ids), Habits due, and — when the Google integration is configured and healthy — the day's Events, composed from existing endpoints in parallel with no backend endpoint of its own. A calendar failure contributes nothing and never fails the view. The MCP server's broad read reuses the same composition, and every id it returns joins the writable-id allowlist later write tools consult.
_Avoid_: Snapshot (ADR 0009 owns that word for the in-app Assistant's per-turn payload), Smart List (an Agenda is composed across sources, not computed from task attributes)
