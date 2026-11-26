# ADHD Phase 3 release check (#569)

Spec: #535. Tickets #557–#568, merged on `feat/adhd-phase-3`. This page
records what was actually checked before Phase 3 is called done, and what
still needs a person with real devices. Nothing here is an accessibility
certification.

**Checked on 2026-11-26** against a local instance: backend on PostgreSQL 16
(Docker), Vite dev server on `http://127.0.0.1` (a secure context, like
`localhost`), seeded through the public API with a missed Reminder, a
Reminder held by Quiet hours, a Planned work block with a buffer, a
planning window, an open-ended pause, a skipped day and a times-per-week
Habit with a partial pause.

Browser used: **Chrome for Testing 159.0.8154.6, headless, driven by
Playwright 1.65.2, on Ubuntu 24.04.4 LTS (Linux 6.8)**. Headless Chrome
renders, lays out and runs the page like desktop Chrome, but it has no
operating-system notification centre, no real background or lock state and
no touch hardware. Phone results below are Chrome's mobile emulation
(390×844, touch, `is_mobile`), not a phone.

## Delivery matrix

Delivery is foreground-only by design (ADR 0019). "Unsupported" below means
tuk-tuk does not promise delivery there; "unverified" means nobody has
watched it on that platform yet.

Legend: **Observed** = seen in this check · **Unverified** = not yet run on
real hardware · **Unsupported** = not promised, by design.

| Browser / OS                          | HTTPS / secure context | Permission | Foreground (tab open, visible)                                                                   | Background (tab hidden / app switched) | Closed (tab or browser closed) | Device locked |
| ------------------------------------- | ---------------------- | ---------- | ------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------ | ------------- |
| Chrome 159 headless, Ubuntu 24.04     | `http://127.0.0.1`     | granted    | **Observed in headless**: claimed, `show` fired, ledger `shown` attempt 1, in-app card shown (1) | Unverified                             | Unsupported                    | Unsupported   |
| Chrome 159 headless, Ubuntu 24.04     | `http://127.0.0.1`     | default    | **Observed**: Test notification disabled with "Available once notifications are enabled…" (2)    | —                                      | —                              | —             |
| Chrome desktop (Windows/macOS/Linux)  | HTTPS                  | granted    | Unverified                                                                                       | Unverified                             | Unsupported                    | Unsupported   |
| Firefox desktop                       | HTTPS                  | granted    | Unverified                                                                                       | Unverified                             | Unsupported                    | Unsupported   |
| Safari macOS                          | HTTPS                  | granted    | Unverified                                                                                       | Unverified                             | Unsupported                    | Unsupported   |
| Edge desktop                          | HTTPS                  | granted    | Unverified                                                                                       | Unverified                             | Unsupported                    | Unsupported   |
| Safari iOS / iPadOS (Home Screen app) | HTTPS                  | granted    | Unverified                                                                                       | Unsupported                            | Unsupported                    | Unsupported   |
| Chrome Android                        | HTTPS                  | granted    | **Unsupported** (no page `Notification` constructor; the tab reports `failed`, ADR 0019)         | Unsupported                            | Unsupported                    | Unsupported   |
| Any browser                           | plain HTTP on a LAN IP | any        | **Unsupported**: the app shows the unsupported state (app tests only, not seen in a browser)     | Unsupported                            | Unsupported                    | Unsupported   |
| Any browser                           | any                    | denied     | Unsupported: the app shows "Not notifications: this browser blocks them" (app tests only)        | Unsupported                            | Unsupported                    | Unsupported   |

1. A Task due 40 s ahead with a Reminder at the time of the Task, page left
   open on Today: within the 30 s claim interval the page constructed the
   notification, Chrome fired `show`, the ledger row read `shown`, attempt 1,
   and the in-app card "Reminder: Foreground probe" appeared. **This is not
   proof that an operating system displayed an alert.** Headless Chrome
   has no notification centre.
2. With the opt-in on but no browser permission, Settings showed "Off",
   the foreground-only limit, **Enable on this device**, and the disabled
   **Send test notification** with its reason. With permission granted the
   test reported "Sent. Your browser reports it was shown; whether it
   appears also depends on your system's notification settings."

The app-level tests in `frontend/oci/src/App.reminder*.test.tsx`,
`App.quietHours.test.tsx` and `App.missedReminders.test.tsx` use a fake
`Notification`. They prove the app's states and requests, never delivery.

## Responsive and accessibility check

Viewports: desktop 1440×900 light and dark; phone 390×844 (touch) light and
dark; 640×400 at device scale 2 (what a 1280×800 window shows at 200% browser
zoom); phone with `prefers-reduced-motion: reduce`. Screens: Today, Calendar
Day, Habits, Settings, and Task detail's Planned work form on the phone.
Measured with DOM geometry and computed styles; screenshots were looked at
by eye for the phone Habits, phone Calendar, phone Planned work form and
dark desktop Calendar.

| Check                                 | Result                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No horizontal page scroll             | Pass on every screen and viewport above.                                                                                                                                                                                                                                                              |
| Phone: paired panels stack            | Pass. Missed reminders, Capacity, Calendar and the Reminder panel stack in one column; Settings sections stack.                                                                                                                                                                                       |
| Phone: full-width primary controls    | **Fixed.** Save plan / Remove plan were content-width; now full width. Pause actions already were.                                                                                                                                                                                                    |
| Phone: 16px gutters                   | **Fixed.** The Planned work form sat 9px from the screen edge inside its Popover; now 17px.                                                                                                                                                                                                           |
| Phone: ≥44px hit areas                | **Fixed.** Plan fields (34px), Settings time selects (34px, also Active hours) and their checkbox labels were short; all now 44px. Missed, deferred, delivered and pause controls already were. Resize handles stay 7px: see "Left open".                                                             |
| Phone: Habits grid status rows        | **Fixed.** The week grid scrolls sideways, and pause/skip/weekly-target rows spanned the whole table, so Edit pause, Resume today, Undo skip and their notes sat past the right edge (measured right edge 512px on a 390px screen). They now hold at the visible width.                               |
| 200% zoom                             | Pass at 640px CSS width: no clipping, no page scroll. Font sizes are `px` tokens, so a browser "text size only" setting does not enlarge them; **not checked** in Firefox's "Zoom text only" or Safari.                                                                                               |
| Visible 3px focus                     | **Fixed** for Calendar resize handles (only a faint grip before). Every other Phase 3 control showed the 3px `--focus-ring` when tabbed to. The light ring colour (`--blue-100`) is pale on white; that is the existing token, unchanged here.                                                        |
| Logical tab order                     | **Fixed.** The floating Reminder panels were first in the DOM, so Tab reached "Quiet hours deferred" before the sidebar. They now follow the page.                                                                                                                                                    |
| Dialog containment / return focus     | Pass for the Planned work Popover: focus moves to Day on open; Escape returns it to the row. It is a non-modal Popover (as every Task detail row is), so Tab can leave it. Opening Task detail from a calendar entry does not move focus into the panel; that is the pre-existing Calendar behaviour. |
| Error association                     | **Fixed.** Planned work and Quiet hours errors were `role=alert` but not tied to fields; now every field names the error (`aria-describedby`, and `aria-invalid` on Quiet until). Pause and skip forms already did.                                                                                   |
| Non-drag alternative for Planned work | **Fixed for keyboard.** The block only answered a click; its title is now a button, "Open planned work: <title>", which opens Task detail and its Day/Start/Duration/Buffer fields. Touch users tap the block.                                                                                        |
| Live regions                          | **Fixed.** Capacity summary is `aria-live="polite"`. The Reminder panel stack is a polite live region, mounted while delivery runs, so a Quiet hours deferred panel or delivered card is announced. Missed reminders and the weekly target are not live (they render on load, or as `role=status`).   |
| Reduced motion                        | Pass. Phase 3 adds no animation; the only transition is the 120ms grip fade on hover/focus. No timer-tick motion.                                                                                                                                                                                     |
| Meaning not by colour alone           | Pass. Planned work: dashed outline plus "Planned work" text and icon; Events: "Event · read-only"; Paused / Skipped / weekly target in words. In dark mode the plan's tint is close to the today-column tint; the dashed outline and label carry it.                                                  |
| Dark mode                             | Pass by eye on dark desktop Calendar and dark phone Habits / Planned work form; colours come from tokens.                                                                                                                                                                                             |
| Accessible names unchanged            | Pass. No existing name changed; the new title button and live regions only add.                                                                                                                                                                                                                       |

Guards: `frontend/oci/src/App.phase3Accessibility.test.tsx` (roles, names,
live regions, error association, tab order, keyboard path) and the #569
sections of `frontend/oci/src/tapTargetGuard.test.ts` (44px floor, full-width
actions, gutters, Habits rows, focus ring).

### Left open (to file)

- **Resize handles under 44px on touch.** They are 7px strips on the block
  edges; a 44px handle would cover a 15- or 30-minute block. The touch path
  is tapping the block and editing the plan's fields. Same as the existing
  Task handles.
- **Quiet hours deferred panel covers about a quarter of a phone screen**
  for the whole band (overnight) and cannot be collapsed. It does not block
  scrolling, but it hides the lower part of every view.
- **Focus does not move into Task detail** when a calendar entry is opened;
  a keyboard user must Tab on to reach it.

## Release gate (#535 Further Notes)

| Statement                                  | Result                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users can distinguish plans from deadlines | Pass                  | Separate "Due date" and "Planned work" rows, with "Moving this block will not change the due date." (`TaskDetail.plannedWork.test.tsx`). Calendar plan block labelled "Planned work", dashed; the Task's own entry says "Due date" (`App.calendarPlannedWork.test.tsx`; seen in the browser). Backend: `test_planned_work.py::test_a_plan_is_saved_and_read_back_without_touching_the_due_date`, `test_removing_the_plan_keeps_the_task_and_its_deadline`, `test_no_event_route_can_write_planned_work`. |
| Unsupported delivery is unmistakable       | Pass (after #569 fix) | Settings states the foreground-only limit before Enable on this device (seen in the browser); denied, unsupported and insecure states say "Not notifications…" (`App.reminderNotifications.test.tsx`). Inline Quick-Add reminder chips had no note; fixed and tested here. Real-device wording on iOS/Android: needs manual check.                                                                                                                                                                       |
| Stale occurrences cannot notify            | Pass                  | `test_reminder_delivery.py`: completed, deleted, removed-Reminder and advanced recurring occurrences never notify; completing cancels an unreported claim's retry; disabled User can't claim. `test_reminder_snooze.py::test_a_redated_tasks_old_reminder_cannot_be_snoozed`. Missed reminders are recomputed from open Tasks (`test_missed_reminders.py`).                                                                                                                                              |
| Pauses and skips preserve real history     | Pass                  | `test_habit_pauses.py`: a pause over Check-ins is refused listing the dates, an earlier Check-in is kept and counted, a settled Goal Score is unchanged. `test_habit_skips.py`: a skip creates no Check-in, a day with a Check-in can't be skipped. Seen in the browser: Paused and Skipped rows in words.                                                                                                                                                                                               |

Behaviour on real devices is the one part of the gate this check could not
see. It is listed below.

## Manual checks still needed on real devices

Run each against a deployment served over **HTTPS** with a real User, the
Reminder notifications opt-in on, and **Enable on this device** granted. Use
a Task due 2 minutes ahead with a Reminder "At time of task". Record the
browser and OS version and the result in the matrix above.

1. **Desktop Chrome, Firefox, Safari, Edge (one OS each at least).**
   Foreground: tab visible → an OS notification appears within about 30 s;
   clicking it focuses the tab and opens the Task. Background: another tab
   in front, or the window minimised → note whether it appears and how
   late (timers are throttled). Closed: close the tab before the time →
   nothing appears; reopen → the Reminder is listed under Missed reminders.
   Locked: lock the screen with the tab open → note what happens; it stays
   unsupported whatever the result.
2. **Send test notification** on each browser: confirm the OS really shows
   it, and that the app never says more than "your browser reports it was
   shown".
3. **iPhone/iPad Safari** (16.4+, added to the Home Screen) and a regular
   Safari tab: does the permission prompt appear after Enable on this
   device, and does a foreground notification appear? Locked and closed
   stay unsupported.
4. **Android Chrome**: confirm the app reports the Reminder as failed and
   that the unsupported limit is clear in Settings, and that the in-app
   card and Missed reminders still work.
5. **Plain HTTP on a LAN address** (not `localhost`): Settings shows the
   unsupported state and asks for no permission.
6. **Permission denied** in browser settings after enabling: Settings shows
   the blocked state, no prompt repeats, Tasks and Reminders stay usable.
7. **Two tabs or two devices** open at the time: one notification, not two.
8. **Quiet hours** on a real device across the band's end: held Reminders
   notify once at the end, not as a burst.
9. **Phone hardware** (iOS Safari and Android Chrome): the Habits grid
   rows, Planned work form and Settings selects with a finger; the Quiet
   hours deferred panel above the tab bar; VoiceOver/TalkBack reading the
   Capacity summary and a newly held Reminder.
10. **Text-only zoom** at 200% in Firefox ("Zoom text only") and iOS
    Larger Text: Phase 3 text grows without clipping.
