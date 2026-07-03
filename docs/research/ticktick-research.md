# TickTick — Clone Research Dossier

> **Purpose:** First-party research into **TickTick** (an all-in-one task manager: tasks/lists, calendar, habits, Pomodoro/focus, collaboration) to support building a **faithful clone**. This dossier is a *reference for specification and implementation* — it records what TickTick does and how its Open API and data model are shaped, with every non-obvious claim cited to a first-party source.
>
> **Status:** Research complete — 2026-07-03. Not yet turned into a spec (see *Using this research* at the end).

## About this document

- **Scope requested:** feature inventory & user flows, UX/UI patterns, public API & integrations, and the data model — framed for a *faithful clone*.
- **Method:** two research agents run in parallel against **first-party / primary sources only** (marketing site, official Help Center, first-party app-store listings, and the developer API docs). Pages were fetched with `webfetch`; `google_search` was unavailable in the environment, so discovery relied on direct first-party fetches. Every non-obvious claim is cited inline; anything unconfirmed is marked **(Unverified)** / **Not documented**.
- **Sources at a glance:**
  - *Product:* `ticktick.com` (+ `/features`, `/upgrade`, `/download`), `help.ticktick.com` (~94 articles), the Apple App Store & Google Play listings, `blog.ticktick.com`.
  - *API / data:* `developer.ticktick.com` — specifically the hand-written spec markdown `developer.ticktick.com/docs/openapi.md` (retrieved in full), plus the developer-portal JS bundle and `ticktick.com/integrations`.
- **How to read it:** **Part I** is the product surface (*what* to build); **Part II** is the API & data model (*how* the canonical data is named and shaped). **Consolidated Gaps** lists what must be re-verified against the live apps before a spec is locked.

## Contents

- **Part I — Product: Features, User Flows & UX**
  - Scope & sources
  - Feature Inventory — 22 groups (capture, organization, scheduling, subtasks, notes, views, smart lists/filters, calendar sync, habits, focus, countdown, notes & summary, sticky notes, collaboration, search, widgets, cross-platform, templates, import/export, theming, AI, free vs premium)
  - Core User Flows (A–I)
  - UX & UI Patterns (navigation, screens, interactions, views, theming, platforms)
- **Part II — Open API & Data Model**
  - Authentication & Authorization (OAuth 2.0)
  - Endpoints — Task ×8, Project ×6, Focus ×3, Habit ×6 (**23 total**)
  - Data Model & Entities — **10 objects** + cross-cutting semantics
  - Operational Details
  - First-party Integrations
- **Consolidated Gaps & Unverified Items**
- **Using this research (next step)**

---

## Part I — Product: Features, User Flows & UX

### Scope & sources

First-party sources actually used (fetched and read):

- **Marketing site**
  - Home — https://www.ticktick.com/ (also `/home`)
  - Features — https://www.ticktick.com/features
  - Premium/Upgrade — https://www.ticktick.com/upgrade
  - Download — https://www.ticktick.com/download
- **Official Help Center** — https://help.ticktick.com/ (the site embeds its full article tree;
  ~94 articles were read). Specific article URLs are cited inline, e.g.
  `https://help.ticktick.com/articles/<id>`. Key articles referenced:
  - Add Tasks / Task — `/articles/7055782436621254656`
  - Smart Recognition (NLP) — Help Center → Smart Recognition
  - Task Details & Editing; Effective Reminder — `/articles/7055782395743567872`
  - Set Up Recurring Tasks — `/articles/7055782206349770752`
  - Multilevel Tasks (subtasks) — `/articles/7055782219767349248`
  - Manage Tasks with Lists — `/articles/7055782283059396608`; Folders — `/articles/7055782296019795968`
  - Manage Tasks with Group & Sort; Tags — `/articles/7055782072...` area
  - Views: List `/articles/7055782365863346176`, Kanban `/articles/7055782353376903168`,
    Timeline `/articles/7055782331050622976`
  - Calendar: Week `/articles/7055782149730861056`, Month `/articles/7055782128335716352`,
    Year `/articles/7399726920725692416`, List `/articles/7055782110086299648`,
    View Options `/articles/7055782085826445312`
  - Eisenhower Matrix — `/articles/7055782055577124864`, rules `/articles/7055782040439881728`
  - Pomodoro/Focus — start `/articles/7055782010496745472`, maintain `/articles/7055781994591944704`
  - Habit — `/articles/7055781896457814016` (start `/articles/7055781878401335296`)
  - Collaboration — share `/articles/7055781706355179520`, teams `/articles/7055781688281923584`
  - Widgets — `/articles/7055780404896202752`; Notes & Summary — `/articles/7055780476358754304`
  - Google Calendar — `/articles/7055781593733922816`; Notion — `/articles/7263009660070789120`;
    Telegram — `/articles/7467494539406606336`
  - AI Voice Add — `/articles/7444677039392555008`; Transcribe & Summarize — `/articles/7444682584526684160`;
    MCP — `/articles/7438129581631995904`; CLI — `/articles/7465251130025443328`
  - URL Scheme — `/articles/7055781515422072832`
- **Official app-store listings**
  - Apple App Store — https://apps.apple.com/us/app/ticktick-to-do-list-calendar/id626144601
  - Google Play — https://play.google.com/store/apps/details?id=com.ticktick.task
- **Official blog** — https://blog.ticktick.com/ (used only for background/definitions)
- **Developer API** — https://developer.ticktick.com/docs#/openapi (referenced by Help Center)

**Limitation on evidence:** Help Center article pages are client-rendered; their text was
recovered from the page's embedded data (`__NEXT_DATA__`). The marketing pages are largely
image/marketing-driven, so some UI specifics come from Help Center how-to articles and app-store
descriptions rather than the marketing pages. Screenshots referenced by the Help Center were not
visually inspected; claims rest on the accompanying instructional text.

---

### Feature Inventory

TickTick positions itself as an all-in-one productivity app spanning **Task list, Calendar,
Pomodoro, Habit Tracker, Countdown, Eisenhower Matrix, and Sticky Notes**. Source:
https://www.ticktick.com/ ; https://help.ticktick.com/

#### 1. Task capture & quick add

- **Quick-Add bar (desktop)** — type in the "task addition bar" at the top of the list, press
  Enter to create. A dropdown on the right sets priority, adds attachments, or picks a template,
  and switches input-box style. `Shift+Enter` adds a description; `Cmd/Ctrl+Enter` saves.
- **"+" add button (mobile)** — a "+" visible everywhere opens the add sheet; bottom toolbar sets
  date, priority, tag, and destination list; the toolbar order is customizable via "…" → Settings.
- **Natural-language / Smart Recognition (Smart Date Parsing)** — dates/times typed into a task are
  auto-recognized and turned into due date + reminder (e.g. "Meeting at 9 tomorrow"). Also
  recognizes **repeat**, **early reminder**, and **postponed reminder**; ambiguous times resolve to
  the nearest valid time. Toggle in Settings → General → Smart Recognition → Smart Date Parsing;
  you can choose whether the parsed text is stripped from the title.
- **Voice input** — long-press "+" to speak (real-time transcription on iOS); **Recording Mode**
  (drag "+" left) records up to 30 min and saves audio + text (saving audio needs Premium).
- **AI Voice Add (AI Mode)** — speak naturally; AI extracts title, date/time, list, tags, priority,
  and can split one utterance into multiple tasks; long notes become a title + transcribed
  description. Monthly AI quota applies. (Mobile only.)
- **Clipboard capture** — "Recognize information in clipboard" prompts to add a task when copied
  text contains time info; multi-line clipboard text prompts **Batch Add Tasks**.
- **Add via email** — a shared address `todo@mail.ticktick.com` (from your registered email) and a
  personalized address (from any email) turn emails into tasks. Configure on web:
  Settings → Integrations & Import → "Add tasks via email".
- **Siri** (iOS) — "Add … to TickTick"; optional auto-import from Apple Reminders.
- **Widgets / global shortcut / browser & app integrations** — add from home-screen widgets;
  desktop global add shortcut `Shift+Alt+A`; browser right-click, email plugin, Weibo, Telegram Bot.
- **Templates** — save a task (with subtasks/checklist) as a template ("…" → Save as Template) and
  insert via the "…" menu / slash `/` menu / calendar. Templates support search & drag-reorder.
- Sources: Add Tasks `https://help.ticktick.com/articles/7055782436621254656`; Smart Recognition
  (Help Center → Smart Recognition); https://www.ticktick.com/features ; AI Voice Add
  `https://help.ticktick.com/articles/7444677039392555008`; Google Play listing
  (https://play.google.com/store/apps/details?id=com.ticktick.task).

#### 2. Organization

TickTick offers a **5-level hierarchy: Folder → List → Section → Task → Subtask.**
Source: Help Center "How to Manage Numerous Tasks".

- **Lists** — two kinds:
  - *Smart Lists* (built-in filtered views): **All, Today, Tomorrow, Next 7 Days, Inbox,
    Assigned to Me**. Each Smart List can be Show / Hide / "Show if not empty". Inbox cannot be
    hidden or deleted.
  - *Regular Lists* — user-created with name, color, folder, emoji icon, show/hide, and per-list
    **List Background** (follow theme / color / gradient / image; mobile). Lists can be **Task
    lists or Note lists**.
- **Folders** — group lists (drag a list onto another, or List Editing → Folder → Add Folder).
- **Sections** — sub-groups within a list; also smart sections (by List, Time, Priority, Tag,
  Assignee). Sections power the Kanban columns.
- **Tags** — a task may have multiple tags; create via the tag icon, `#` shortcut, or drag; supports
  **second-level (nested) tags**, custom color, custom sort, and pinning.
- **Priorities** — four levels: **High, Medium, Low, None** (URL-scheme values 5/3/1/0).
- **Pin** — pin important tasks/lists/tags/countdowns to the top.
- Sources: Manage Tasks with Lists `https://help.ticktick.com/articles/7055782283059396608`;
  Folders `https://help.ticktick.com/articles/7055782296019795968`; Tags & Group & Sort (Help
  Center); Task Details `https://help.ticktick.com/articles/7055782395743567872`.

#### 3. Scheduling: dates, reminders, recurrence

- **Dates** — Due date; or a **Duration** (start + end time) within a day (e.g. 9:00–12:00) or
  spanning multiple days ("All Day"). Quick-set to Today / Tomorrow / Next Week / custom.
- **Reminders** — set at creation or in Date & Reminder; **multiple reminders per task**
  (Premium: up to 5); custom/relative offsets; per-task default reminder; reminder pop-up offers
  Dismiss / Start Focus / Done / Snooze; in-app, lock-screen, and email reminders; per-priority
  ringtones.
  - **Constant Reminder** — repeats until handled (iOS 26 can use a system-alarm that bypasses
    Silent/DND; Android cycles 30s on/off for 5 min). Can be enabled separately for tasks, habits,
    and anniversaries.
  - **Location Reminder** (iOS/Android only), **End-Time Reminder** ("At the end" of a duration),
    **Daily Reminder** (review your day).
- **Recurring / Repeat** — Daily / Weekly / Monthly / Yearly / Custom. Custom has three modes:
  **By Due Dates**, **By Completion Date** (next occurrence relative to when you actually finish),
  and **By Specific Dates**. End rules: "Repeat Ends On" (date) or "Repeat Ends After N times".
  Advanced patterns e.g. "every 2 weeks from Monday to Thursday", "every 2 months on the first
  Monday". Single occurrences can be edited ("Only this Recurrence").
- **Time Zone** — per-task **Fixed Time Zone** vs **Floating Time**; up to 5 time zones in the
  calendar; alternate calendars (Chinese Lunar, Korean Lunar, Hebrew, Hijri, Indian, Persian).
- Sources: Effective Reminder `https://help.ticktick.com/articles/7055782395743567872`;
  Constant Reminder (Help Center); Set Up Recurring Tasks
  `https://help.ticktick.com/articles/7055782206349770752`; Time Zone (Help Center);
  Apple App Store listing.

#### 4. Subtasks & checklist items

- **Subtasks (multilevel)** — up to **5 nested levels**; each subtask has full task capabilities
  (date, duration, focus, details, tags, priority, assignee, trash-restore). Create via "…" → Add
  Subtask, Enter to add siblings, drag a task to the lower-right of another, or "Link Parent Task"
  (incl. multi-select bulk linking); "Unlink" to detach. Not available in smart lists (Inbox +
  regular lists only).
- **Check items (checklist)** — toggle a task's body between "text/description" and "check items";
  reorder by drag; each check item can have its own reminder time. When both subtasks and check
  items exist, only check-item completion drives parent progress; completing all check items
  auto-completes the parent.
- Sources: Multilevel Tasks `https://help.ticktick.com/articles/7055782219767349248`;
  Task Details `https://help.ticktick.com/articles/7055782395743567872`.

#### 5. Notes, rich text & attachments

- **Rich text body** — Heading, Bold, Highlight, Italic, Underline; **Markdown** syntax; typing `/`
  opens a slash menu for paragraph styles, attachments, and subtasks.
- **Attachments** — images, recordings, files, video. Free: 1 attachment/day (max 10 MB); Premium:
  up to 199/day, 39 per task, max 20 MB each.
- **Notes** (distinct from tasks) — dedicated **Note lists**; no completion concept; support dates,
  reminders, tags, templates, Kanban grouping; convert Task ⇄ Note.
- Sources: Task Details `https://help.ticktick.com/articles/7055782395743567872`;
  Notes & Summary `https://help.ticktick.com/articles/7055780476358754304`.

#### 6. Views

TickTick provides three **list-module views** and multiple **calendar views**, plus the Matrix.

- **List View** — vertical list; group & sort; drag-and-drop sort; swipe actions; batch edit.
- **Kanban View** — columns from your chosen grouping (Sections, or smart groups by Date/Priority/
  Tag/Assignee); drag cards between columns; width small/medium/large (desktop). Available in Smart
  Lists, Folders, Tags, and regular lists.
- **Timeline View** — a "lighter Gantt chart"; tasks on a horizontal timeline; click blank to add,
  drag edges to change duration, drag body to move; Day/Week/Month zoom; unscheduled tasks sit in an
  "Arrange Tasks" side panel. Not available in Today/Tomorrow/Next 7 Days smart lists.
- **Calendar views** — **Year (with heatmap), Month, Week, Multi-Week (desktop), Multi-Day
  (desktop), 3-Day (mobile), Day, Agenda (desktop), and List (tasks by day)**. Marketing lists
  Yearly/Monthly/Weekly/Agenda/Multi-Day/Multi-Week.
- **Split View (desktop)** — show task list + calendar side by side ("Show with Calendar" /
  "Show with Task"); drag tasks between them to schedule.
- **Eisenhower Matrix** — four quadrants by importance × urgency; auto-classifies by rules (default:
  priority→quadrant, or Important=Priority & Urgent=Time); editable rules using List/Tag/Date/
  Priority/Task; drag between quadrants updates attributes.
- Sources: Select Different Views (Help Center); Kanban
  `https://help.ticktick.com/articles/7055782353376903168`; Timeline
  `https://help.ticktick.com/articles/7055782331050622976`; Calendar views
  (`.../7055782149730861056`, `.../7055782128335716352`, `.../7399726920725692416`,
  `.../7055782110086299648`, `.../7055782085826445312`); Eisenhower Matrix
  `https://help.ticktick.com/articles/7055782055577124864`; https://www.ticktick.com/features .

#### 7. Smart Lists, Filters & Suggested Tasks

- **Smart Lists** — Today / Tomorrow / Next 7 Days / All / Inbox / Assigned to Me (see §2).
- **Filters** (Premium) — saved views combining list, tags, date, priority, and keyword.
  - *Normal filter*: pick attributes.
  - *Advanced filter*: multi-clause queries with **AND/OR** operators, with a live **Preview**.
- **Suggested Tasks** (v8.0) — from the **Today** list ("💡" / Suggested Tasks button); buckets:
  **Recently Added, Postponed Tasks (by reschedule count), Long Overdue, Upcoming**; one-tap
  "Add to Today". Excludes recurring, already-today, and completed tasks.
- Sources: Filters (Help Center); Manage Tasks with Lists
  `https://help.ticktick.com/articles/7055782283059396608`; Suggested Tasks
  `https://help.ticktick.com/articles/7401564165023727616`; https://www.ticktick.com/upgrade .

#### 8. Calendar integrations & two-way sync

- **Subscribe vs Integrate (Google)** — *Subscribe from Google Calendar* shows GCal events in
  TickTick (bidirectional add/edit/delete); *Integration with Google Calendar* pushes TickTick
  tasks with times into GCal and syncs events back as tasks; choose lists+calendars, default tag
  ("GCal"), default list; up to **3 accounts × 9 calendars**. Shortcuts in a GCal event title map
  attributes (`!1`/`!High priority`, `#Tag`, `~List`).
- **Other calendars** — iCloud (app-specific password), Outlook, Exchange, **CalDAV**, **URL/ICS**
  subscription, and **Local device calendar** (Android/iOS/Mac). All appear under "Subscribed
  Calendars" in the sidebar.
- **Subscribe to TickTick out** — generate a URL to view TickTick lists in Google/Outlook/etc.
- Sources: Google Calendar `https://help.ticktick.com/articles/7055781593733922816`;
  Calendar Subscriptions (Help Center); iCloud/Outlook/Exchange/CalDAV/URL/Local Calendar articles.

#### 9. Habit Tracker

- Enable via Tab Bar (mobile) / Features (desktop). **Habit Gallery** of 60+ habits across life,
  health, exercise, mentality; or **custom habits** (name, icon, encouraging words).
- **Frequency** (e.g. 3×/week), **Goal** ("reach a certain amount"), **sections by time of day**
  (morning/afternoon/evening/other).
- **Recording methods**: Automatic (swipe = +1 fixed amount), Manual (enter amount), Complete-All
  (single check). **Habit reminders** (multiple times/day), optional **habit logs & mood**.
- **Review**: monthly check-in table, check-in data, **yearly heatmap**, weekly/monthly views
  (monthly is Premium). Archive/restore/delete; log missed check-ins by tapping a date. Habits can
  show in Today/Next 7 Days and on the calendar; can be bound as focus Timers.
- Sources: Habit Tracker `https://help.ticktick.com/articles/7055781896457814016`; Start a New Habit
  `.../7055781878401335296`; Better Achieve Habits; Habit Review.

#### 10. Pomodoro / Focus

- Enable via Tab Bar/Features. Two modes: **Pomo** (25-min focus / 5-min break countdown, adjustable)
  and **Stopwatch** (count-up). Start from the Focus tab, a task's swipe action / context menu / "…"
  menu, task detail, or a reminder pop-up. Optionally associate a task/habit for analytics.
- **Sync across devices**; adjust time mid-session; **Focus Note**; add/edit focus duration after a
  session; add records retroactively.
- **Focus environment**: **White noise** library; Full-Screen styles (Simple Digital / Page-Flip
  Clock / Pixel Clock); Screen-Always-On; Floating Window; **Flip Start** (face-down to run);
  **Strict Mode** with app allowlist; iOS Live Activity.
- **Timers** — saved presets for recurring focus scenarios (e.g. reading, exercise).
- **Focus Statistics** — trend chart (year/month/week), focus timeline, most-focused time, year grid
  (heatmap); by List/Tag/Task pie; filter by Date/Duration/Linked Status; batch edit/delete records.
- Sources: Pomodoro start `https://help.ticktick.com/articles/7055782010496745472`; maintain focus
  `.../7055781994591944704`; Timer; Focus Statistics.

#### 11. Countdown

- Track **Countdowns** (days until) and **Anniversaries/Birthdays** (days since / show age); enable
  via Tab Bar/Features. Rich styles + custom color + custom background image; switch units
  (days/weeks/months/years); Day-Calculation Mode (Standard vs Standard+1); custom repeat (e.g. Xth
  weekday of a month yearly); notes per countdown; group by type; pin/archive/delete; show in Smart
  Lists & Calendar; iOS Live Activities; home-screen widget.
- Sources: Countdown (Help Center); Add/Customize/Manage Countdowns
  `https://help.ticktick.com/articles/7322524237753745408` and related.

#### 12. Notes & Summary

- **Note lists** (see §5). **Summary** generator produces editable text of task completion over a
  time range (filter by list/tag/assignee/priority/status, choose grouping and fields), inserted
  into a note or exported as text/image — used for daily/weekly reports. Summary can be saved as a
  template.
- Source: Notes & Summary `https://help.ticktick.com/articles/7055780476358754304`.

#### 13. Desktop Sticky Notes

- Desktop-only floating notes: open from a task ("Open as Sticky Note") or a global hotkey
  ("New Sticky Note"); pin on top (F12), switch colors, one-click arrange (top/left/right),
  single-line collapse, bulk open; settings for default color/font/grid/pin-by-default; not synced
  to mobile.
- Source: Desktop Sticky Notes (Help Center).

#### 14. Collaboration & sharing

- **Shareable lists** — only regular lists you own (not smart lists/Inbox). Invite by email contact
  or share link. Up to **29 members** per shared list; only the owner needs Premium.
- **Assignees** — assign existing tasks ("Assign" icon), on creation via `@`, in bulk, or via Kanban
  ("Assign to"); assignee gets a notification. **"Assigned to Me"** smart list aggregates across
  shared lists.
- **Comments** — comment on tasks, `@`-mention members (notified).
- **Permissions** — per-member Edit / Comment / Read-only.
- **Notifications** — per-list toggles (complete/undo, add, delete/move); reminder scope (All /
  All except assigned-to-others / Assigned-to-me / None); "Show in Smart List" scope.
- **History** — per-task **Task Activities**; **List Activities** (web only).
- Sources: Collaboration `https://help.ticktick.com/articles/7055781706355179520`; How Teams Can
  Collaborate `.../7055781688281923584`.

#### 15. Search

- Dedicated Search (sidebar on desktop; Tab Bar on mobile). Search **Tasks, Lists, Tags, Filters**;
  when searching tasks, refine by **Lists, Tags, Priorities, Dates**; save a search as a Filter.
- Source: Search (Help Center); Apple App Store version history (Search Filters, v8.0.8x).

#### 16. Widgets & wearables

- **iOS**: home-screen widgets (Tasks, Task Completions, Add Task, Today's Calendar, Daily View,
  Monthly Calendar, Eisenhower Matrix, Today/Weekly Habits, Habit Heat Map, Today Focus, Focus
  Distribution, Countdown); **Lock-Screen widgets** (iOS 16+); **Control Center controls** (iOS 18:
  Add Task, Today's Tasks, Pomodoro, Stopwatch, Open Calendar/Matrix/Focus/Habit); **Apple Watch**
  complications + Smart Stack (one-tap complete).
- **Android**: Tasks, Task Completions, Calendar (Timeline/Week/Month), Matrix, Habits, Pomodoro
  widgets; **Wear OS** watch supported (per store listing).
- **macOS / Windows**: desktop widgets (Tasks, Calendar/Daily/Monthly, Matrix, Habits, Countdowns,
  Pomodoro).
- Sources: Widgets `https://help.ticktick.com/articles/7055780404896202752`; Google Play &
  Apple App Store listings (Apple Watch / Wear OS).

#### 17. Cross-platform & sync

- Real-time cloud sync across **Web, iOS, iPadOS, Android, macOS, Windows, Linux, Apple Watch,
  Wear OS, Apple Vision**, plus a browser **Extension**. Sources: https://www.ticktick.com/download ;
  Apple App Store (Vision/Watch, iOS 15.5+); Google Play (Wear OS).

#### 18. Templates

- Task templates and Note templates; save from a task/summary, insert via "…", slash `/` menu, or
  calendar; searchable and reorderable; managed in Settings → Template. Source: Task Details;
  Notes & Summary; What's New.

#### 19. Import / export & integrations

- **Import from other apps** — Todoist, Microsoft To Do, Any.do, Wunderlist, OmniFocus, Toodledo,
  Apple Reminders, iCal, etc. (web supports the widest set).
- **Backup & Import** — generate/import backups (web: Settings → Account → Backup & Import).
- **Integrations** — **Notion** (two-way DB sync; up to 3 workspaces / 9 databases; property
  mapping), **Telegram** (bot creates tasks from messages, supports Quick-Add syntax), **Spark**
  email, **Apple Health** (import health data to calendar; sync focus time to Mindfulness),
  **Google Calendar/Outlook/etc.** (§8), **MCP** (`https://mcp.ticktick.com`, OAuth/Bearer, for
  Claude/ChatGPT/Cursor/VS Code/Codex; tools for task/list/habit/focus/countdown), **CLI**
  (`@ticktick/ticktick-cli`), **Open API** (`https://developer.ticktick.com`), **URL Scheme**
  (`ticktick://…` add_task/show/search with x-callback-url), **Siri & Shortcuts** (iOS/macOS).
- Sources: Data Backup & Import; Import from Other Apps; Notion
  `https://help.ticktick.com/articles/7263009660070789120`; Telegram
  `.../7467494539406606336`; MCP `.../7438129581631995904`; CLI `.../7465251130025443328`;
  URL Scheme `.../7055781515422072832`; API https://developer.ticktick.com/docs#/openapi .

#### 20. Theming, achievements & account

- **Appearance** — 40+ themes (10+ Premium), custom accent color in Dark mode (iOS/Android/desktop),
  per-list backgrounds, calendar Modern/Classic styles, desktop Card style, adjustable font size,
  iOS 26 "Liquid Glass". Source: https://www.ticktick.com/ ; What's New; Calendar View Options.
- **Achievements & Statistics** — Achievement Value (12 tiers), completion trend & rate; **Badges**
  (VIP, Perseverance, Get Things Done, Mindfulness, Warm Heart, Self-Discipline). Source:
  Achievements and Statistics; Badges.
- **Account & Security** — email sign-up/login, password reset, login-device management,
  **Two-Step Verification** (email code or authenticator + backup codes), account deletion (90-day
  retention). Source: Account & Security; Two-Step Verification; Delete Account.

#### 21. AI features

- **AI Voice Add** (see §1), **Transcribe & Summarize Recordings** (audio → timestamped transcript +
  structured summary; 30+ languages; tap paragraph to seek), **TickTick MCP**, **TickTick CLI**.
  Monthly AI quota; voice/recording data not stored or used for training. Source: AI Features
  (Help Center); AI Voice Add `.../7444677039392555008`; Transcribe & Summarize `.../7444682584526684160`.

#### 22. Free vs Premium (feature gating)

- **Pricing** — Premium **US$35.99/year** ("less than $3/mo") or **US$3.99/month**; older tiers
  ($4.99/mo, $49.99/yr) exist historically; **25% education discount** (yearly, Stripe).
- **Premium unlocks** — full calendar views + subscribe to third-party calendars; **custom Filters**;
  higher limits (**299 lists, 999 tasks/list, 199 subtasks/task**); **up to 5 reminders/task**;
  share lists to **up to 29 members**; up to **99 attachments/day** (39/task, 20 MB each);
  checklist + description together; task/list activity history & historical statistics; estimated
  Pomo; premium themes; premium white noise; Android Quick Ball; checklist-item reminders; calendar
  widgets; monthly habit view. **Free** has 1 attachment/day (10 MB) and reduced limits.
- Sources: https://www.ticktick.com/upgrade ; Apple App Store & Google Play listings;
  Payment and Upgrades / Education (Help Center).

---

### Core User Flows

Each flow is described for both desktop and mobile where they differ.

#### A. Quick-add a task with natural-language parsing

1. Focus the top **Quick-Add bar** (desktop) or tap **"+"** (mobile).
2. Type e.g. **"Submit report tomorrow 5pm #work !high every Friday"** — Smart Recognition parses
   the date/time (→ due + reminder), `#work` (→ tag), and recurrence; parsed date can be kept or
   stripped from the title; tapping the recognized time (or Delete) cancels it.
3. Optionally set list/priority/attachment/template from the add-bar toolbar (mobile bottom toolbar
   is customizable).
4. Press **Enter** (desktop) / tap send (mobile) to create; `Shift+Enter` adds a description first.
- Source: Add Tasks `https://help.ticktick.com/articles/7055782436621254656`; Smart Recognition
  (Help Center); https://www.ticktick.com/features .

#### B. Organize tasks into lists & folders

1. Create a list: sidebar **Add → List** (mobile) / hover **Lists → "+"** (desktop); set name,
   color, emoji icon, folder, background.
2. Move a task into it: task detail **List** field, right-click **Move to**, drag the task's
   hamburger handle to the sidebar list, or swipe → Move (mobile).
3. Create a folder by dragging one list onto another (name the folder) or List Editing → Folder →
   Add Folder; ungroup by swipe/right-click.
4. Add **Sections** within a list ("…" → Manage/Add Section) to further subdivide (also power Kanban
   columns).
- Source: Manage Tasks with Lists `.../7055782283059396608`; Folders `.../7055782296019795968`;
  Group & Sort (Help Center).

#### C. Set reminders + recurrence

1. Open the task → **Date & Reminder**.
2. **Reminder** → choose preset or **Custom** offset; add more for **multiple reminders**; optionally
   enable **Constant Reminder**.
3. **Repeat** → Daily/Weekly/Monthly/Yearly or **Custom** (By Due Dates / By Completion Date / By
   Specific Dates); set **Repeat Ends On** or **Ends After N times**.
4. For durations, enable **"At the end"** to get an End-Time reminder.
- Source: Effective Reminder `.../7055782395743567872`; Set Up Recurring Tasks `.../7055782206349770752`;
  Constant Reminder (Help Center).

#### D. Complete, reschedule, and drag to a date

- **Complete**: tap the checkbox; swipe-right (mobile, default) = Done; desktop hold **Alt/Option**
  in calendar to reveal checkboxes.
- **Reschedule**: right-click → Date (Today/Tomorrow/Next Week/custom); swipe (mobile) → Modify Date;
  drag the task block in a calendar/timeline view; **batch Postpone** multiple tasks (Windows/Web).
- **Drag to a date**: in calendar Split View or "Arrange Tasks" panel, drag an unscheduled task onto
  the calendar; dragging onto a Smart List (e.g. "Today") auto-applies that date; dragging onto a
  tag applies the tag.
- Source: Task Details `.../7055782395743567872`; List View (`.../7055782365863346176`);
  Week View / Show Tasks with Calendar / Desktop Interaction Tips (Help Center).

#### E. Share a list & assign a task

1. Create/choose a **regular list** → "…" → **Share/Collaborate → Invite Member** (email or link).
2. Invitee accepts from the Notifications center.
3. **Assign**: open task → **Assign** icon (or `@` on creation, or bulk "…" → Select → Assign to, or
   right-click in Kanban → Assign to). Assignee is notified; task appears in their "Assigned to Me".
4. **Comment**/`@`-mention for discussion; set member **permissions** (Edit/Comment/Read-only) and
   per-list **notification/reminder** scope.
- Source: How to Share a List `.../7055781706355179520`; How Teams Can Collaborate `.../7055781688281923584`.

#### F. Add & view tasks on the calendar

1. Open the **Calendar** tab; pick a view (Year/Month/Week/Multi-Week/Multi-Day/3-Day/Day/Agenda/List).
2. **Add**: click a date cell or blank timeline slot (long-press on mobile) — the task inherits that
   date/time; long-press-drag for a duration; drag across cells for multi-day.
3. **Adjust**: drag the block to move; drag edges to change duration; **Arrange Tasks** panel holds
   undated tasks to drag in.
4. **View options**: filter which lists show; color by List/Tag/Priority; show completed / check
   items / repeat cycles / habits / focus records; Year View heatmap; pinch-to-zoom Month/Timeline.
- Source: Week View `.../7055782149730861056`; Calendar View Options `.../7055782085826445312`;
  FAQ-Calendar; Show Tasks with Calendar (Help Center).

#### G. Create & check off a habit

1. Enable **Habit** in Tab Bar (mobile) / Features (desktop).
2. Tap **"+"** → pick from the **Habit Gallery** or **Create a new habit**; set icon, **Frequency**,
   **Goal**, reminders, section.
3. **Check in**: swipe/auto-record (+1), enter an amount (manual), or single-tap (complete-all);
   log missed days by tapping a date on the monthly table.
4. **Review**: open the habit for monthly table + data; "More" → yearly heatmap; statistics icon for
   all habits (weekly free; monthly Premium).
- Source: Start a New Habit `.../7055781878401335296`; Better Achieve Habits; Habit Review.

#### H. Run a focus / Pomodoro session

1. Enable **Pomodoro** in Tab Bar/Features.
2. In the **Focus** tab choose **Pomo** or **Stopwatch**; optionally tap **Focus** to link a task/
   habit; adjust minutes; press **Start**. (Or start from a task's "…"/swipe/right-click, or a
   reminder pop-up.)
3. During focus: pick **White Noise**, go Full-Screen, add a **Focus Note**, enable Strict Mode /
   Flip Start; session **syncs across devices**.
4. On end: mark done, **Add Extra Time**, or edit duration; review under **Focus Statistics**.
- Source: How to Start Focus `.../7055782010496745472`; How to Maintain Focus `.../7055781994591944704`;
  Focus Statistics.

#### I. Use a Smart List / custom filter

- **Smart List**: open Today/Tomorrow/Next 7 Days/Inbox/Assigned to Me from the sidebar; manage
  visibility in Smart List settings (Show / Hide / Show if not empty).
- **Custom Filter** (Premium): sidebar **Add → Filter**; **Normal** (pick list/tag/date/priority/
  keyword) or **Advanced** (AND/OR multi-clause, with live Preview); the saved filter appears under
  Lists and can be viewed as List/Kanban/Timeline. You can also save a Search as a Filter.
- Source: Manage Tasks with Lists `.../7055782283059396608`; Filters (Help Center); Search (Help Center).

---

### UX & UI Patterns

#### Navigation & information architecture

- **Desktop three-column layout** — Column 1: navigation/lists sidebar (Smart Lists, Lists, Folders,
  Tags, Filters, plus feature modules like Calendar/Matrix/Pomodoro/Habit/Countdown/Search/Summary).
  Column 2: the task list for the selected list. Column 3: task detail (notes, Markdown, subtasks,
  attachments). Source: https://www.ticktick.com/features (List view description).
- **Mobile bottom Tab Bar** — user-configurable; feature modules (Task, Calendar, Pomodoro, Habit,
  Countdown, Eisenhower Matrix, Search) are enabled/ordered in **Settings → Tab Bar**; less-used
  items hide behind "More". Source: How to Start Focus / Habit / Matrix articles; Design Principles.
- **Feature modularity** — TickTick's stated design principle is letting users turn features on/off
  and reorder them, keeping a minimal task-detail page. Source: Design Principles (Help Center).

#### Primary screens

Task list (per list/smart list/tag/filter) · Task detail · Calendar (multi-view) · Eisenhower Matrix
· Pomodoro/Focus (+ statistics) · Habit (+ review) · Countdown · Search · Summary · Notifications
center · Settings. Source: Help Center feature guide taxonomy (https://help.ticktick.com/).

#### Key interaction patterns

- **Quick-Add bar / "+"** with inline attribute setting and NLP (see Flow A).
- **Swipe actions** (mobile) — swipe left = Move / Delete / Modify Date; swipe right = Done / Pin;
  fully customizable in Settings → General → Swipe Actions.
- **Drag-and-drop** — reorder tasks; drag a task to the lower-right of another to make it a subtask;
  drag onto a sidebar list/tag/smart list to move/tag/schedule; drag calendar/timeline blocks to
  reschedule or resize; drag Kanban cards between columns; drag lists to build folders.
- **Batch actions** — mobile: "…" → Select (or long-press) then edit date/list/priority/tags,
  delete, share, merge, assign, link parent, open sticky notes; desktop: `Shift`/`Ctrl`+click, or
  box-select, then use the right-side batch toolbar (e.g. `Ctrl+0` = set to Today); calendar
  batch-select + Postpone (Windows/Web).
- **Command Menu** — `Cmd/Ctrl+K` opens a command palette to jump anywhere (not on macOS app);
  `?` lists shortcuts; `/` opens a slash formatting menu in bodies; `[[` inserts a task link.
- **Modifier-key power moves (desktop)** — `Ctrl/Cmd`-drag a calendar task to duplicate; `Alt/Option`
  to reveal checkboxes / full times; `Ctrl/Cmd`+wheel to zoom timeline; `Shift`+wheel to scroll
  dates; arrow keys to navigate; `Ctrl+Alt+0` immersive writing.
- **Pin**, **Won't Do** (abandon without deleting; restart later), **Duplicate**, **Copy Link**,
  **Convert to Note/Task**, **Save as Template**, **Open as Sticky Note**.
- Source: List View `.../7055782365863346176`; Desktop Shortcuts & Desktop Interaction Tips (Help
  Center); Task Details `.../7055782395743567872`.

#### Views and where each applies

| View | Module | Scope where available |
|------|--------|-----------------------|
| List | Lists | All lists, smart lists, tags, filters, folders |
| Kanban | Lists | Regular lists, smart lists, folders, tags (group-driven) |
| Timeline | Lists | Regular lists, folders, filters (not Today/Tomorrow/Next 7 Days) |
| Calendar: Year/Month/Week/Multi-Week/Multi-Day/3-Day/Day/Agenda/List | Calendar | Calendar tab (Multi-Day/Multi-Week & Agenda are desktop-only; 3-Day is mobile) |
| Eisenhower Matrix | Matrix | Its own tab; auto-populated by rules |
| Split View (task + calendar) | Desktop | Windows/Web/macOS desktop |

Source: Select Different Views / Kanban / Timeline / calendar-view articles; Agenda View; Show Tasks
with Calendar (Help Center).

#### Theming / appearance

- 40+ themes (subset Premium), custom Dark-mode accent color, per-list backgrounds (color/gradient/
  image), calendar **Modern vs Classic** styles + "Show Item Icons", desktop **Card** interface
  style, adjustable font size, iOS 26 Liquid Glass translucency. Source: https://www.ticktick.com/ ;
  What's New; Calendar View Options; Manage Tasks with Lists (List Background).

#### Platform coverage

- **Web app**, **iOS/iPadOS** (15.5+), **Android**, **macOS**, **Windows**, **Linux**, **Apple
  Watch** (watchOS 9+), **Wear OS**, **Apple Vision** (visionOS), and a **browser extension**;
  ~40 languages; Siri, SharePlay, HealthKit on Apple platforms. Sources:
  https://www.ticktick.com/download ; Apple App Store & Google Play listings; Cross-Platform Support
  (Help Center).

#### Note on evidence quality for UI

Much of the fine-grained UI behavior above comes from the Help Center's step-by-step how-to text,
which is first-party but instructional (not always a live UI spec). The marketing pages
(https://www.ticktick.com/ and /features) confirm the headline views and modules but are largely
screenshot/marketing driven; exact on-screen wording/layout should be re-verified against the live
apps during implementation.

---

## Part II — Open API & Data Model

### Scope & sources

This note documents the **TickTick Open API** (the officially documented, OAuth2-protected REST API for third‑party apps) and the TickTick data model, to support building a faithful clone. Everything below is grounded in first‑party TickTick sources.

**First‑party sources actually used:**

- **API reference (the authoritative spec):** `https://developer.ticktick.com/docs/openapi.md` — the raw Markdown that the docs SPA renders. Retrieved in full (1,500 lines). The human‑facing page `https://developer.ticktick.com/docs#/openapi` is a client‑side [docsify](https://docsify.js.org) app whose `index.html` loads this Markdown inside an iframe (`/docs/index.html` → `openapi.md`); `_sidebar.md` confirms `openapi.md` is the **only** documentation page.
- **Developer portal app shell:** `https://developer.ticktick.com/` (`/static/js/main.9f1b28af.chunk.js`) — reveals the developer‑console management endpoints, OAuth app‑registration fields, and confirms "We adopt the OAuth 2.0 protocol".
- **Marketing / feature pages (first‑party):** `https://ticktick.com/` (homepage feature list) and `https://ticktick.com/integrations` (the integrations catalog; brand list + English copy extracted from its Next.js page bundle `/_next/static/chunks/pages/integrations-*.js`).
- **Help center:** `https://help.ticktick.com/` (feature guide, incl. "Calendar Subscriptions"). `https://support.ticktick.com/hc/en-us` now redirects to this help center.

**Access limitations / caveats:**

- TickTick does **not** publish a machine‑readable OpenAPI/Swagger JSON. The "OpenAPI" doc is hand‑written Markdown (tables + examples), not a formal spec file. Field types shown as `integer (int32)`, `string (date-time)` etc. are the doc's own annotations, transcribed verbatim below.
- `google_search` was unavailable in this environment (authentication error), so discovery relied on direct fetch of first‑party hosts.
- Help‑center article bodies (e.g. the "URL Scheme" article) are client‑rendered and returned no text; only the help‑center index and the marketing/integration copy were machine‑readable.
- The developer‑console management endpoints (`/api/v1/oauthapp…`, `/api/v1/user`) were observed in the portal's own JS bundle. They power the "Manage Apps" UI and are **not part of the documented Open API**; they are included separately and flagged as such.
- Where the docs contain obvious typos (e.g. `proiority`, `Mediunm`, `Projcet`), they are reproduced **exactly** because a clone's request parsing may need to match them, with `[sic]` noted.

---

### Authentication & Authorization

Source: https://developer.ticktick.com/docs/openapi.md (sections "Getting Started", "Authorization") and https://developer.ticktick.com/ (`main.9f1b28af.chunk.js`).

TickTick uses **OAuth 2.0 Authorization Code** grant. There is currently only one grant type (`authorization_code`); no refresh‑token or client‑credentials flow is documented.

#### Base URLs / hosts

| Purpose | Value |
|---|---|
| Authorization endpoint | `https://ticktick.com/oauth/authorize` |
| Token endpoint | `https://ticktick.com/oauth/token` |
| Open API base host | `https://api.ticktick.com` |
| Open API base path | `/open/v1` (all resource endpoints below are relative to `https://api.ticktick.com/open/v1`) |
| Developer center (app registration) | `https://developer.ticktick.com/manage` |

#### Step 1 — Authorization request (redirect user)

`GET https://ticktick.com/oauth/authorize`

| Param | Required | Description |
|---|---|---|
| `client_id` | yes | Application unique id |
| `scope` | yes | Space‑separated permission scope. Currently available: `tasks:write tasks:read` |
| `state` | yes | Passed back to the redirect URL unchanged |
| `redirect_uri` | yes | User‑configured redirect URL (must match the one registered) |
| `response_type` | yes | Fixed value `code` |

Example: `https://ticktick.com/oauth/authorize?scope=scope&client_id=client_id&state=state&redirect_uri=redirect_uri&response_type=code`

#### Step 2 — Redirect back to app

TickTick redirects to the app's `redirect_uri` with query params:

| Param | Description |
|---|---|
| `code` | Authorization code, used to obtain the access token |
| `state` | The same `state` passed in step 1 |

#### Step 3 — Exchange code for token

`POST https://ticktick.com/oauth/token` with `Content-Type: application/x-www-form-urlencoded`.

| Param | Location | Description |
|---|---|---|
| `client_id` | **HTTP Basic Auth username** (Authorization header) | App client id |
| `client_secret` | **HTTP Basic Auth password** (Authorization header) | App client secret |
| `code` | body | The code from step 2 |
| `grant_type` | body | Only `authorization_code` is supported |
| `scope` | body | Space‑separated scopes (`tasks:read`, `tasks:write`) |
| `redirect_uri` | body | The user‑configured redirect URL |

Response JSON contains `access_token`:
```json
{ "access_token": "access token value" }
```
(Only `access_token` is documented; token lifetime / `refresh_token` / `expires_in` are **Not documented**.)

#### Scopes

| Scope | Grants |
|---|---|
| `tasks:read` | Read access to the user's tasks/projects (documented, exact resource coverage not itemized) |
| `tasks:write` | Write access to the user's tasks/projects |

There is no documented separate scope for Focus or Habit resources; those endpoints exist in the reference but the docs do not state which scope authorizes them → **Not documented**.

#### Authenticated API requests

Send the token as a Bearer token:
```
Authorization: Bearer <access token value>
```

#### App registration fields (developer console)

Source: https://developer.ticktick.com/ (`main.9f1b28af.chunk.js` form + validation rules).

| Field | Notes |
|---|---|
| `appName` (Name) | required, max 64 chars |
| `homepage` (App Service URL) | optional, max 256 chars, must be a URL |
| `description` | optional, max 1000 chars |
| App Icon | JPG/PNG only, must be < 2 MB (upload endpoint below) |
| `client_id` | generated, read‑only |
| `client_secret` | generated; can be reset (invalidates old) |
| `redirect_uri` | editable, must be a URL, max ~254–256 chars ("OAuth redirect URL") |

#### Developer‑console management endpoints (OBSERVED — not part of the documented Open API)

Source: https://developer.ticktick.com/ (`main.9f1b28af.chunk.js`). Base host `https://developer.ticktick.com`, cookie‑authenticated (`withCredentials`), **not** Bearer‑token. A `403` triggers a redirect to `/signin`. These back the "Manage Apps" UI, not third‑party integrations, but are relevant when cloning the full developer portal.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/user` | Current signed‑in developer profile (`avatarUrl`, `email`, `name`, `token`, `userType`, `fakedEmail`) |
| GET | `/api/v1/oauthapp` | List the developer's registered OAuth apps |
| POST | `/api/v1/oauthapp` | Create a new OAuth app (`appName`, `homepage`, `description`) |
| GET | `/api/v1/oauthapp/{id}` | Get one app's settings |
| PUT | `/api/v1/oauthapp/{id}` | Update app (`appName`, `homepage`, `description`, `redirect_uri[]`) |
| DELETE | `/api/v1/oauthapp/{id}` | Delete an app |
| PUT | `/api/v1/oauthapp/{id}/secret/reset` | Reset the client secret |
| POST | `/api/v1/oauthapp/{id}/icon` | Upload app icon (multipart `file`) |

---

### Endpoints (Open API)

Source: https://developer.ticktick.com/docs/openapi.md ("API Reference"). All paths are under `https://api.ticktick.com`. All requests require `Authorization: Bearer <token>`; write bodies use `Content-Type: application/json`. **23 endpoints** across 4 resources (Task, Project, Focus, Habit).

Common response codes on every endpoint: `200 OK`, `201 Created` (write ops), `401 Unauthorized`, `403 Forbidden`, `404 Not Found`. No response/error **body** is documented for non‑200 codes ("No Content").

#### Task (8 endpoints)

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/open/v1/project/{projectId}/task/{taskId}` | Get a single task (requires both ids) → `Task` |
| 2 | POST | `/open/v1/task` | Create a task → `Task` |
| 3 | POST | `/open/v1/task/{taskId}` | Update a task (**POST, not PUT**) → `Task` |
| 4 | POST | `/open/v1/project/{projectId}/task/{taskId}/complete` | Mark task complete → No Content |
| 5 | DELETE | `/open/v1/project/{projectId}/task/{taskId}` | Delete a task → No Content |
| 6 | POST | `/open/v1/task/move` | Move one or more tasks between projects → array of `{id, etag}` |
| 7 | POST | `/open/v1/task/completed` | List completed tasks by project + time range → `Task[]` |
| 8 | POST | `/open/v1/task/filter` | Filter tasks by project/date/priority/tag/status → `Task[]` |

**Get task — path params**

| Type | Name | Req | Schema |
|---|---|---|---|
| Path | `projectId` | yes | string |
| Path | `taskId` | yes | string |

**Create task (`POST /open/v1/task`) — body**

| Type | Name | Req | Description | Schema |
|---|---|---|---|---|
| Body | `title` | **yes** | Task title | string |
| Body | `projectId` | **yes** | Project id | string |
| Body | `content` | no | Task content | string |
| Body | `desc` | no | Description of checklist | string |
| Body | `isAllDay` | no | All day | boolean |
| Body | `startDate` | no | Start datetime `"yyyy-MM-dd'T'HH:mm:ssZ"` (e.g. `2019-11-13T03:00:00+0000`) | date |
| Body | `dueDate` | no | Due datetime, same format | date |
| Body | `timeZone` | no | Time zone the time is specified in (e.g. `America/Los_Angeles`) | String |
| Body | `reminders` | no | List of reminder triggers | list |
| Body | `tags` | no | Tags of the task | list |
| Body | `repeatFlag` | no | Recurring rule of task (RRULE) | string |
| Body | `priority` | no | Task priority, default `0` | integer |
| Body | `sortOrder` | no | Order of task | integer |
| Body | `items` | no | List of subtasks (checklist items) | list |
| Body | `items.title` | no | Subtask title | string |
| Body | `items.startDate` | no | Subtask start datetime | date |
| Body | `items.isAllDay` | no | All day | boolean |
| Body | `items.sortOrder` | no | Order of subtask | integer |
| Body | `items.timeZone` | no | Subtask start time zone | string |
| Body | `items.status` | no | Completion status of subtask | integer |
| Body | `items.completedTime` | no | Subtask completed datetime | date |

**Update task (`POST /open/v1/task/{taskId}`) — body** — same fields as Create, plus:

| Type | Name | Req | Description | Schema |
|---|---|---|---|---|
| Path | `taskId` | **yes** | Task identifier | string |
| Body | `id` | **yes** | Task id | string |
| Body | `projectId` | **yes** | Project id | string |
| … | (all Create fields) | no | (as above; docs note `priority` default listed here as "normal" [sic]) | … |

Note: the Update response example includes a top‑level `"kind": "CHECKLIST"` field (see `Task.kind`).

**Move tasks (`POST /open/v1/task/move`) — body is a JSON array**; each element:

| Type | Name | Req | Description | Schema |
|---|---|---|---|---|
| Body | `fromProjectId` | **yes** | Source project id | string |
| Body | `toProjectId` | **yes** | Destination project id | string |
| Body | `taskId` | **yes** | Task to move | string |

Response: array of `{ "id": "<taskId>", "etag": "<newEtag>" }`.

**List completed tasks (`POST /open/v1/task/completed`) — body** (all optional, ≥1 filter recommended):

| Type | Name | Description | Schema |
|---|---|---|---|
| Body | `projectIds` | List of project ids | list |
| Body | `startDate` | Start of range (inclusive); matches `completedTime ≥ startDate` | date |
| Body | `endDate` | End of range (inclusive); matches `completedTime ≤ endDate` | date |

Response `Task[]` (completed tasks have `status: 2`).

**Filter tasks (`POST /open/v1/task/filter`) — body**:

| Type | Name | Description | Schema |
|---|---|---|---|
| Body | `projectIds` | Filter to tasks in these project ids | list |
| Body | `startDate` | Matches task's `startDate ≥ startDate` | date |
| Body | `endDate` | Matches task's `startDate ≤ endDate` | date |
| Body | `proiority` [sic] | Priority levels. Valid values: `None(0), Low(1), Mediunm(3)` [sic], `High(5)` | list |
| Body | `tag` | Tasks containing **all** specified tags | list |
| Body | `status` | Status codes, e.g. `[0]`=Open, `[2]`=Completed | list |

Response `Task[]` (example objects also carry `etag` and `kind`).

#### Project (6 endpoints)

| # | Method | Path | Purpose |
|---|---|---|---|
| 9 | GET | `/open/v1/project` | List the user's projects → `Project[]` |
| 10 | GET | `/open/v1/project/{projectId}` | Get one project → `Project` |
| 11 | GET | `/open/v1/project/{projectId}/data` | Get project + its undone tasks + columns → `ProjectData` |
| 12 | POST | `/open/v1/project` | Create a project → `Project` |
| 13 | POST | `/open/v1/project/{projectId}` | Update a project (**POST**) → `Project` |
| 14 | DELETE | `/open/v1/project/{projectId}` | Delete a project → No Content |

**Create / Update project — body**

| Type | Name | Description | Schema |
|---|---|---|---|
| Path (update only) | `projectId` | Project identifier | string |
| Body | `name` | Project name (**required on create**) | string |
| Body | `color` | Color, e.g. `#F18181` | string |
| Body | `sortOrder` | Sort order value (default 0) | integer (int64) |
| Body | `viewMode` | `list`, `kanban`, or `timeline` | string |
| Body | `kind` | `TASK` or `NOTE` | string |

(`GET /open/v1/project/{projectId}/data` and the single/collection GETs take only the path param / no body.)

#### Focus (3 endpoints) — Pomodoro / Timing records

| # | Method | Path | Purpose |
|---|---|---|---|
| 15 | GET | `/open/v1/focus/{focusId}` | Get one focus record → `OpenFocus` |
| 16 | GET | `/open/v1/focus` | Get focus records in a time range → `OpenFocus[]` |
| 17 | DELETE | `/open/v1/focus/{focusId}` | Delete a focus record → `OpenFocus` |

**Params**

| Endpoint | Type | Name | Req | Description | Schema |
|---|---|---|---|---|---|
| 15, 17 | Path | `focusId` | yes | Focus identifier | string |
| 15, 16, 17 | Query | `type` | yes | Focus type: Pomodoro `0`, Timing `1` | integer (int32) |
| 16 | Query | `from` | yes | Range start `"yyyy-MM-dd'T'HH:mm:ssZ"` (e.g. `2026-04-01T00:00:00+0800`) | string (date-time) |
| 16 | Query | `to` | yes | Range end, same format | string (date-time) |

Note: for endpoint 16, if the range exceeds **30 days**, the server clamps `from` to 30 days before `to`.

#### Habit (6 endpoints)

| # | Method | Path | Purpose |
|---|---|---|---|
| 18 | GET | `/open/v1/habit/{habitId}` | Get one habit → `OpenHabit` |
| 19 | GET | `/open/v1/habit` | Get all habits (no params) → `OpenHabit[]` |
| 20 | POST | `/open/v1/habit` | Create a habit → `OpenHabit` |
| 21 | POST | `/open/v1/habit/{habitId}` | Update a habit (**POST**) → `OpenHabit` |
| 22 | POST | `/open/v1/habit/{habitId}/checkin` | Create/update a check‑in → `OpenHabitCheckin` |
| 23 | GET | `/open/v1/habit/checkins` | Get check‑ins for habits in a date range → `OpenHabitCheckin[]` |

**Create / Update habit — body** (Update adds path `habitId`; on Create `name` is required)

| Name | Description | Schema |
|---|---|---|
| `name` | Habit name, max 1000 chars (on update, empty ⇒ treated as null) | string |
| `iconRes` | Icon resource id | string |
| `color` | Color | string |
| `sortOrder` | Sort order | integer (int64) |
| `status` | Habit status | integer (int32) |
| `encouragement` | Encouragement message | string |
| `type` | Habit type (e.g. `Boolean`) | string |
| `goal` | Goal | number (double) |
| `step` | Step | number (double) |
| `unit` | Unit (e.g. `Count`) | string |
| `repeatRule` | Repeat rule, e.g. `RRULE:FREQ=DAILY;INTERVAL=1` | string |
| `reminders` | Reminders | string[] |
| `recordEnable` | Whether record is enabled | boolean |
| `sectionId` | Section id | string |
| `targetDays` | Target days | integer (int32) |
| `targetStartDate` | `YYYYMMDD` integer, e.g. `20240101` | integer (int32) |
| `completedCycles` | Completed cycles | integer (int32) |
| `exDates` | Excluded dates | string[] |
| `style` | Style | integer (int32) |

**Create/Update check‑in (`POST /open/v1/habit/{habitId}/checkin`) — body**

| Name | Req | Description | Schema |
|---|---|---|---|
| `habitId` (path) | yes | Habit identifier | string |
| `stamp` | **yes** | Date stamp `YYYYMMDD`, e.g. `20260407` | integer (int32) |
| `time` | no | Check‑in time `"yyyy-MM-dd'T'HH:mm:ssZ"` | string (date-time) |
| `opTime` | no | Operation time, same format | string (date-time) |
| `value` | no | Check‑in value, default `1.0` | number (double) |
| `goal` | no | Check‑in goal, default `1.0` | number (double) |
| `status` | no | Check‑in status | integer (int32) |

**Get check‑ins (`GET /open/v1/habit/checkins`) — query**

| Name | Req | Description | Schema |
|---|---|---|---|
| `habitIds` | yes | Comma‑separated habit ids, e.g. `habit-1,habit-2` | string |
| `from` | yes | Start stamp `YYYYMMDD`, e.g. `20260401` | integer (int32) |
| `to` | yes | End stamp `YYYYMMDD`, e.g. `20260407` | integer (int32) |

---

### Data Model & Entities

Source: https://developer.ticktick.com/docs/openapi.md ("Definitions") and endpoint response examples. **10 documented objects.** Field names/types are reproduced exactly as documented.

#### Task

| Field | Type | Req | Allowed values / notes |
|---|---|---|---|
| `id` | string | — | Task identifier (24‑hex ObjectId in examples) |
| `projectId` | string | on write | Parent project id |
| `title` | string | on create | Task title |
| `content` | string | — | Free‑text content |
| `desc` | string | — | "Description of checklist" |
| `isAllDay` | boolean | — | All‑day flag |
| `startDate` | string (date-time) | — | `"yyyy-MM-dd'T'HH:mm:ssZ"`, e.g. `2019-11-13T03:00:00+0000` |
| `dueDate` | string (date-time) | — | Same format |
| `timeZone` | string | — | IANA tz, e.g. `America/Los_Angeles` |
| `reminders` | string[] | — | iCal VALARM `TRIGGER` strings, e.g. `["TRIGGER:P0DT9H0M0S","TRIGGER:PT0S"]` |
| `repeatFlag` | string | — | RRULE, e.g. `RRULE:FREQ=DAILY;INTERVAL=1` |
| `priority` | integer (int32) | — | **None `0`, Low `1`, Medium `3`, High `5`** (default `0`) |
| `sortOrder` | integer (int64) | — | Order value, e.g. `12345` (can be large negative in examples, e.g. `-1099511627776`) |
| `status` | integer (int32) | — | **Task completion: Normal `0`, Completed `2`** |
| `completedTime` | string (date-time) | — | When completed |
| `items` | `ChecklistItem[]` | — | Subtasks |
| `tags` | string[] | — | Tag **names**, e.g. `["work","urgent"]` |
| `kind` | string | — | `TEXT`, `NOTE`, or `CHECKLIST` |
| `etag` | string | — | Entity tag (appears in filter/completed/move responses; not listed in the Definitions table but present in examples) |

#### ChecklistItem (a.k.a. Subtask / `items[]`)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Subtask identifier |
| `title` | string | Subtask title |
| `status` | integer (int32) | **Subtask completion: Normal `0`, Completed `1`** (⚠ different from Task, where completed = `2`) |
| `completedTime` | string (date-time) | `"yyyy-MM-dd'T'HH:mm:ssZ"` |
| `isAllDay` | boolean | All day |
| `sortOrder` | integer (int64) | e.g. `234444` |
| `startDate` | string (date-time) | Subtask start |
| `timeZone` | string | e.g. `America/Los_Angeles` |

#### Project (a.k.a. List)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Project identifier |
| `name` | string | Project name |
| `color` | string | e.g. `#F18181` |
| `sortOrder` | integer (int64) | Order value |
| `closed` | boolean | Project closed/archived ("Projcet closed" [sic]) |
| `groupId` | string | Project **group** (folder) identifier |
| `viewMode` | string | `list`, `kanban`, `timeline` |
| `permission` | string | `read`, `write`, or `comment` |
| `kind` | string | `TASK` or `NOTE` |

#### Column (Kanban column)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Column identifier |
| `projectId` | string | Owning project |
| `name` | string | Column name |
| `sortOrder` | integer (int64) | Order value |

#### ProjectData (returned by `GET /open/v1/project/{projectId}/data`)

| Field | Type | Notes |
|---|---|---|
| `project` | `Project` | Project info |
| `tasks` | `Task[]` | **Undone** tasks in the project |
| `columns` | `Column[]` | Kanban columns in the project |

#### OpenFocus (Pomodoro / Timing record)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Focus unique id |
| `userId` | integer (int64) | User id |
| `type` | integer (int32) | Pomodoro `0`, Timing `1` |
| `taskId` | string | Linked task id |
| `note` | string | Focus note |
| `tasks` | `OpenPomodoroTaskBrief[]` | Related task briefs |
| `status` | integer (int32) | Pomodoro status (example value `2`) |
| `startTime` | string (date-time) | e.g. `2026-04-07T09:00:00+0800` |
| `endTime` | string (date-time) | — |
| `pauseDuration` | integer (int32) | Seconds |
| `adjustTime` | integer (int64) | Seconds |
| `added` | boolean | Whether record was added |
| `createdTime` | string (date-time) | — |
| `modifiedTime` | string (date-time) | — |
| `etimestamp` | integer (int64) | Entity timestamp (epoch ms in example) |
| `etag` | string | Entity tag |
| `duration` | integer (int64) | Focus duration (seconds; example `1500` = 25 min, `5400` = 90 min) |
| `relationType` | integer[] | Relation types, e.g. `[0]` |

#### OpenPomodoroTaskBrief (element of `OpenFocus.tasks`)

| Field | Type | Notes |
|---|---|---|
| `taskId` | string | Task id |
| `title` | string | Task title |
| `habitId` | string | Habit id |
| `timerId` | string | Timer id |
| `timerName` | string | Timer name |
| `startTime` | string (date-time) | Focus start |
| `endTime` | string (date-time) | Focus end |

#### OpenHabit

| Field | Type | Notes |
|---|---|---|
| `id` | string | Habit unique id |
| `name` | string | Habit name |
| `iconRes` | string | Icon resource (e.g. `habit_reading`) |
| `color` | string | e.g. `#4D8CF5` |
| `sortOrder` | integer (int64) | — |
| `status` | integer (int32) | Habit status |
| `encouragement` | string | — |
| `totalCheckIns` | integer (int32) | Total check‑ins |
| `createdTime` | string (date-time) | — |
| `modifiedTime` | string (date-time) | — |
| `archivedTime` | string (date-time) | — |
| `type` | string | e.g. `Boolean` |
| `goal` | number (double) | — |
| `step` | number (double) | — |
| `unit` | string | e.g. `Count` |
| `etag` | string | — |
| `repeatRule` | string | RRULE, e.g. `RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR` |
| `reminders` | string[] | — |
| `recordEnable` | boolean | — |
| `sectionId` | string | — |
| `targetDays` | integer (int32) | — |
| `targetStartDate` | integer (int32) | `YYYYMMDD`, e.g. `20240101` |
| `completedCycles` | integer (int32) | — |
| `exDates` | string[] | Excluded dates |
| `style` | integer (int32) | — |

#### OpenHabitCheckin (a year's worth of check‑ins for one habit)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Check‑in document id |
| `habitId` | string | Habit id |
| `createdTime` | string (date-time) | — |
| `modifiedTime` | string (date-time) | — |
| `etag` | string | — |
| `year` | integer (int32) | Year the check‑ins belong to |
| `checkins` | `OpenHabitCheckinData[]` | The individual entries |

#### OpenHabitCheckinData (one check‑in entry)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Check‑in id |
| `stamp` | integer (int32) | `YYYYMMDD`, e.g. `20260407` |
| `time` | string (date-time) | Check‑in time |
| `opTime` | string (date-time) | Operation time |
| `value` | number (double) | Default `1.0` |
| `goal` | number (double) | Default `1.0` |
| `status` | integer (int32) | Check‑in status |

#### Cross‑cutting semantics (critical for a faithful clone)

Source: https://developer.ticktick.com/docs/openapi.md (aggregated).

- **Priority levels (Task):** `0` None, `1` Low, `3` Medium, `5` High. Note the non‑contiguous values (2 and 4 unused). The Filter endpoint restates these (with typos `Mediunm`, `proiority`).
- **Completion status is object‑specific:** Task `status` uses `0`=Normal/open, `2`=Completed. **ChecklistItem `status` uses `0`=Normal, `1`=Completed.** A clone must not share one enum across both.
- **`sortOrder`** is `int64` and may be negative and very large (e.g. `-1099511627776`, `-2199023255552`, `-3298534883328` in real examples — multiples of 2^40), consistent with a sparse ordering scheme; clone should store as 64‑bit signed.
- **Dates & timezones:** All datetimes use the Java‑style pattern `"yyyy-MM-dd'T'HH:mm:ssZ"` with a numeric offset and **no colon**, e.g. `2019-11-13T03:00:00+0000` or `2026-04-07T09:00:00+0800`. Some responses show milliseconds (`2026-03-04T23:58:20.000+0000`). Tasks/subtasks/habits carry a separate IANA `timeZone` string; `isAllDay` toggles all‑day semantics. Habit `stamp`/`targetStartDate` and check‑in date filters use an **integer `YYYYMMDD`**, not a datetime.
- **Recurrence:** `repeatFlag` (Task) and `repeatRule` (Habit) are **iCalendar RRULE strings**, e.g. `RRULE:FREQ=DAILY;INTERVAL=1`, `RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR`. Habit `exDates` holds excluded dates.
- **Reminders:** array of **iCalendar VALARM `TRIGGER`** strings (relative durations), e.g. `TRIGGER:P0DT9H0M0S` (9h) and `TRIGGER:PT0S` (at time). Not a custom format — standard iCal duration syntax.
- **Tags:** appear **only** as an array of plain string names on `Task` (e.g. `["work","urgent"]`). There is **no** documented Tag object or Tag CRUD endpoint → tags are effectively free‑form labels. (**Not documented:** tag colors, tag rename, tag list retrieval.)
- **`kind`:** Task `kind` ∈ {`TEXT`, `NOTE`, `CHECKLIST`}; Project `kind` ∈ {`TASK`, `NOTE`}. (Create examples sometimes send lowercase `"task"`, but responses normalize to uppercase.)
- **`etag`:** returned on tasks in the newer filter/completed/move responses and on Focus/Habit objects; used as an optimistic‑concurrency/version token. Move returns the **new** etag per moved task.
- **Relationships:**
  - Task → Project via `projectId` (many‑to‑one). Tasks are moved between projects with `/task/move`.
  - Task → Subtasks (ChecklistItem) via embedded `items[]` (composition; no standalone subtask endpoints).
  - Task → Tags via `tags[]` (names only).
  - Project → Columns (Kanban) and belongs to a project **group/folder** via `groupId`. Columns are only returned via `/project/{id}/data`; **no** documented Column CRUD endpoint.
  - `ProjectData` bundles a project with its **undone** tasks + columns (does not include completed tasks — use `/task/completed`).
  - Focus → Task via `taskId` and `tasks[]` (OpenPomodoroTaskBrief).
  - Habit → check‑ins via `OpenHabitCheckin` → `OpenHabitCheckinData`, grouped by `year`.

---

### Operational Details

Source: https://developer.ticktick.com/docs/openapi.md (behavior stated or, where silent, marked Not documented).

| Aspect | Finding |
|---|---|
| **Versioning** | Path‑based: `/open/v1/...`. No header‑based versioning documented. |
| **Content types** | `application/json` for API requests/responses; `application/x-www-form-urlencoded` for the token exchange. |
| **Auth transport** | `Authorization: Bearer <token>` for the Open API; HTTP Basic (client_id:client_secret) for token exchange. |
| **Status codes** | `200`, `201`, `401`, `403`, `404` documented per endpoint. |
| **Error body format** | **Not documented** — non‑200 responses are listed as "No Content"; no error envelope/schema is specified. |
| **Rate limits** | **Not documented.** |
| **Pagination** | **Not documented.** List endpoints (`GET /project`, `GET /habit`, and the POST filter/completed queries) return plain arrays with no page/cursor/limit parameters. |
| **Bulk operations** | Only `POST /task/move` accepts an array; other writes are single‑object. |
| **Server‑side constraints observed** | Focus range endpoint clamps ranges > 30 days; habit `name` max 1000 chars. |
| **Token lifetime / refresh** | **Not documented** (no `refresh_token`, `expires_in`, or refresh endpoint in the docs). |

---

### First‑party Integrations

Source: https://ticktick.com/integrations (catalog + English copy extracted from `/_next/static/chunks/pages/integrations-*.js`), https://ticktick.com/ (homepage feature list), https://help.ticktick.com/ (feature guide).

The integrations page tagline (first‑party): *"Get more done by integrating your tools — TickTick connects with daily apps you love… Stay connected to automate your TickTick experience with tools you use every day."* Apps officially listed there:

| Integration | First‑party one‑liner (verbatim) | Category |
|---|---|---|
| **Zapier** | "Automate workflows by connecting your web apps to save time for your busy schedule." | Automation |
| **IFTTT** | "If This Then That - Your apps and devices work better together in a more connected world." | Automation |
| **Amazon Alexa** | "Stay organized hands-free by talking with Alexa." | Voice assistant |
| **Google Assistant** | "Make Google your assistant by voice to capture inspirations and keep track of to-dos on the go." | Voice assistant |
| **Shortcuts (Siri)** | "Create your personal shortcuts with a tap or by asking Siri to get more things done with apps in Apple." | Apple/Siri Shortcuts |
| **Slack** | "Productive teamwork happens in Slack channels, no matter where you or the team are." | Team chat |
| **Gmail** | "Save time and do more with your inbox." | Email → task |
| **Outlook** | "Stay on top of your most important emails." (has an "How to install Outlook Add-in" setup guide) | Email add‑in |
| **Spark** | "Conquer tasks coming to your Spark inbox" | Email (Readdle Spark) |
| **Chatmind** | "Chat-guided mind mapping powered by AI" | AI mind mapping |

Additional first‑party integration/sync capabilities advertised outside that catalog:

- **Calendar Subscriptions** — subscribe to external calendars inside TickTick (Help Center → Calendar → "Calendar Subscriptions"). Source: https://help.ticktick.com/.
- **Calendar integration / Notion** — homepage feature "Integration": *"Subscribe to calendars and integrate with other apps like Notion. Manage all matters in TickTick."* Source: https://ticktick.com/.
- **Cross‑platform real‑time sync** — *"real‑time sync and seamless experience"* across phone/computer/tablet/watch. Source: https://ticktick.com/.
- **URL Scheme** — first‑party deep‑linking scheme (`ticktick://…`; Android package ids `com.ticktick.task` / `cn.ticktick.task`), documented at https://help.ticktick.com/articles/7055781515422072832 (article body is client‑rendered / not machine‑readable here).
- **Open API** — the OAuth2 REST API documented above (`developer.ticktick.com`).

> Note: The integrations catalog is rendered client‑side; the entries above are exactly those hard‑coded in the page's shipped bundle. Two‑way calendar sync specifics (Google/Outlook/iCloud/Apple Calendar) are advertised across TickTick's apps but the per‑provider help articles were not machine‑readable in this pass → **Not fully verified from a static first‑party page.**

---

## Consolidated Gaps & Unverified Items

These are the points a clone team must **re-verify against the live TickTick apps / current pages** before locking a spec. None invalidate the research above; they mark where first-party *text* was silent, image-only, or client-rendered.

**Product side**

- **Free-tier numeric limits** (max lists / tasks-per-list / subtasks) are not published; only **Premium** limits are stated (299 lists, 999 tasks/list, 199 subtasks/task) plus the free attachment cap (1/day, 10 MB). Confirm free caps in-app.
- **Pricing** — Premium **US$35.99/yr** and **US$3.99/mo** are confirmed, but the App Store also lists historical tiers ($4.99/mo, $49.99/yr) and prices vary by region/promo. Treat as indicative.
- **MCP tool names** — the Help Center lists MCP tool *categories* as images; exact individual tool names are **(Unverified)**.
- **Help Center fidelity** — article bodies were recovered from the pages' embedded `__NEXT_DATA__`; screenshots/GIFs were not visually inspected, so fine-grained UI wording/layout rests on the instructional text.
- **Wear OS / live-app specifics** — marketing pages are image-heavy; exact on-screen wording and Wear OS app specifics should be re-checked in the running apps.

**API / data side**

- **No machine-readable OpenAPI/Swagger JSON exists** — the "OpenAPI" docs are a single hand-written Markdown file. Field types (`int32`, `date-time`, …) are the doc's own annotations, not a formal schema.
- **OAuth token lifecycle** — token lifetime, `expires_in`, and any **refresh-token** flow are **Not documented**; only the `authorization_code` grant and an `access_token` response are shown.
- **Scope coverage** — which scope (`tasks:read` / `tasks:write`) authorizes the **Focus** and **Habit** endpoints is **Not documented**.
- **Operational gaps** — **rate limits, pagination, and the error-response body** are **Not documented** (only status codes 200/201/401/403/404 appear).
- **Model gaps** — there is **no Tag object or Tag CRUD** (tags are bare strings on a task) and **no standalone Column or Subtask endpoints** (both are embedded via composition). Note the **status enums differ**: Task completed = `2`, ChecklistItem completed = `1`.
- **Calendar-sync specifics** — per-provider two-way sync (Google/Outlook/iCloud/Apple) help articles were client-rendered and not machine-readable; those specifics are **not fully verified from a static first-party page**.
- **Tooling note** — `google_search` was unavailable during research; all findings come from direct first-party fetches.

---

## Using this research (next step)

This dossier is **research, not a spec** — it feeds the thinking, it doesn't replace it. A faithful TickTick clone is a large, multi-session build, so the recommended path (per this repo's skill flow) is:

1. **`/grill-with-docs`** — take this dossier in and sharpen *your* scope by interview. TickTick is huge; decide which of the 22 feature groups belong in your first version, and let the grilling record decisions in `CONTEXT.md` + ADRs. Part II's data model is a strong starting vocabulary for the domain glossary.
2. **`/to-prd`** → **`/to-issues`** — turn the sharpened thread into a PRD, then split it into independently-grabbable issues. Keep steps 1–2 in **one unbroken context window**.
3. **`/implement`** (a fresh session per issue) — build each issue test-first via `/tdd`, then `/code-review` the diff before committing.

Keep this file in the repo as the durable reference the PRD and issues cite.
