# ADHD product review

Review date: 2026-11-25. Scope: current local web app, adult ADHD support, and practical product direction.

## Executive recommendation

Make Tuk Tuk easier to start, resume, and return to after a difficult day. Do not make users maintain another productivity system before it helps them.

The app already has most necessary building blocks: one-line task capture, check items, reminders, calendar views, task-linked focus, habits, goals, daily review, and feature visibility controls. The highest-value work is connecting those pieces into a small daily execution loop.

Recommended first release:

1. Fix misleading pre-creation habit history.
2. Make quick capture title-first, with advanced fields collapsed.
3. Add an optional “Now” area inside Today, with one chosen task and its next check item.
4. Connect that action to a short focus session and an explicit return/resume path.
5. Let users restart after absence without rescheduling every overdue task.

This is an accessibility and product proposal, not a claim that an app treats ADHD. People with ADHD differ substantially. Timers, reminders, accountability, and rewards can help some people and irritate or pressure others. Offer choices without requiring a diagnosis.

## Review method and limits

### What ran

Started a separate PostgreSQL 16 container on localhost:55433, a local FastAPI backend on localhost:8900, and Vite frontend on localhost:5900. Used a dedicated browser session and synthetic account/task/habit data. Existing database was not used. Backend used the documented development-only authentication bypass after initial authentication setup friction.

Desktop inspection used 1280-pixel width; mobile inspection used 390 × 844. Screenshots were opened and visually inspected for Quick add, desktop Focus, and mobile Today. Browser accessibility snapshots supplied control names and page structure.

### Exercised directly

- Inline task creation with date/priority tokens, saved successfully.
- Task details, check-item creation, reminder choices, and task-linked Focus navigation.
- Pomodoro start through keyboard activation, running controls, persistence across page navigation, and cancellation.
- Habit creation, weekly/history presentation, and a check-in action.
- Today, Next 7 Days, list and Kanban views.
- Daily calendar and unscheduled area.
- Goal creation form, including obstacle and if-then plan fields.
- Stand-up empty state and Yesterday/Today/Blockers inputs.
- Settings: feature visibility, appearance, active hours, AI settings, voice settings, Google integration, and account/system controls.

### Not verified end to end

Google OAuth/event refresh, actual reminder delivery with browser closed or phone locked, AI inference, voice calls, CLI, MCP, calendar drag/drop, recurrence across time zones, screen-reader behavior, offline synchronization, production deployment, and long-running timer completion. Required providers were not configured for this test. Do not interpret settings being present as integrations working.

Several pointer-driven browser commands did not produce the expected state change; keyboard activation worked. Quick-add modal submission also did not complete during pointer attempts. These observations are inconclusive automation findings, not confirmed app defects. They require a separate minimal pointer-event reproduction before filing bugs. Successful inline task capture is the verified path.

This is a broad product walkthrough, not exhaustive coverage of every feature or a clinical literature review. Web search was unavailable; research used directly retrieved primary-source pages. NICE recommendations returned HTTP 403 and were not used as supporting evidence. Competitor products were reviewed from official pages, not hands-on trials.

## Evidence and design principles

### Health guidance

NHS adult ADHD guidance recommends practical support such as written instructions, help organizing and structuring tasks, and suitable work environments. It also discusses exercise, sleep, and specialist treatment. NIMH describes medication, psychotherapy, coaching, and practical functioning difficulties. Neither retrieved page establishes that a particular planner, Pomodoro interval, body-doubling service, or AI tool is an effective ADHD treatment. [S1, S2]

**Product implication:** externalize steps and context; make useful actions easier to see and execute. Keep support separate from diagnosis or treatment claims.

### Cognitive accessibility

W3C's Making Content Usable for People with Cognitive and Learning Disabilities recommends reducing distractions, supporting memory, making steps/context clear, preserving progress, and allowing personalization. It is supplemental guidance, not a normative WCAG conformance standard. [S3]

**Product implication:** show fewer choices during execution, preserve a visible next action, explain state, and make recovery easy.

WCAG 2.2 AA target-size minimum is 24 × 24 CSS pixels, subject to its exceptions. The enhanced AAA criterion uses 44 × 44. A practical mobile design target is comfortable 44-pixel controls, without misrepresenting that as the AA minimum. This review did not measure every hit area or establish WCAG conformance. [S4]

### Hypotheses to validate

One prominent task, a short starting interval, flexible habit targets, visible time, and gentle re-entry may improve usability for some adults with ADHD. These are testable design hypotheses grounded in accessibility principles and observed product friction; they are not clinical findings.

## Current-feature assessment

| Surface | What works now | ADHD-related friction or risk | Recommended adaptation |
| --- | --- | --- | --- |
| Today | Sparse layout, task details, habit check-in chips observed on mobile | Due dates answer what is due, not what to start; unscheduled intentions can remain elsewhere | Add optional Now area and a user-chosen small daily shortlist |
| Quick capture | Inline title accepts date and priority tokens; keyboard entry is fast | Modal exposes list, priority, dates, times, and tags before saving | Keep title and save visible; move metadata into progressive disclosure; show parsed tokens |
| Lists/folders/tags | Organizes different areas of life; list and Kanban available | Organizing can become prerequisite work and generate too many choices | Default to Inbox; keep taxonomy optional; avoid mandatory tagging |
| Check items | Existing mechanism for small actions; completion counts visible | Next check item is not foregrounded in Focus | Surface first incomplete item as optional next action; allow reordering |
| Reminders | Relative and custom options exist | Delivery reliability and actionable recovery unverified | Test real delivery first; provide explicit snooze/reschedule/open-action flows |
| Calendar | Day/week/month options; task and event context | Users can confuse intended work with deadlines; full days can be unrealistic | Distinguish planned time from due time, show buffers and unscheduled work |
| Focus | Task/habit linking, short/long presets, custom duration, stopwatch; running view becomes simpler | Default 25 minutes can feel too large; initial configuration competes with starting | Add short-start shortcut; carry next check item into running view |
| Habits | Boolean/numeric choices, flexible frequency, encouragement field, history | Newly created habit displayed earlier dates as missed; streak-first framing can feel punitive | Fix eligibility dates; allow pause/skip and emphasize recent practice rather than perfect streaks |
| Goals | Obstacle and if-then plan already present | Goal setup and key results can be too abstract for immediate execution | Link focused goal to one concrete next task; keep extra fields optional |
| Stand-up | Yesterday/Today/Blockers structure supports reflection | Corporate language and three empty sections create more work | Optional “Daily check-in” wording; prefill completed work, ask one prompt at a time |
| Settings | Appearance, feature hiding, active hours already exist | Many technical setup fields compete with personal settings | Preserve existing toggles; offer a simple starter preset and progressive setup |
| AI/voice | Optional setup; documentation describes bounded assistance | Provider setup, cost, privacy, and incorrect plans can add burden | Keep manual workflow complete; preview suggestions; require confirmation for writes |
| CLI/MCP | Alternative entry points documented | Not useful default onboarding for most users; not exercised | Keep available for advanced users without expanding first-run choices |

## Most important observed issue: habit history before creation

Created “Drink water after breakfast” on November 25. Weekly view labeled November 23 and 24 “missed.” Recent-days view also labeled November 5–24 “missed.” The state remained after reopening Habits.

That is misleading for a newly created habit unless a user deliberately chooses an earlier start date. It also presents immediate failure before the person has had a chance to participate.

**Expected rule:** days before the habit's effective start date are “not started,” not missed. Paused days and unscheduled days need separate semantics. Imported habits need an explicit migration policy, not fabricated history.

**Acceptance checks:** create a habit today; no earlier day counts as missed or reduces a rate. Create a weekday-only habit; weekend dates do not count as failures. Change frequency; history policy remains explicit. Use the user's local date around midnight.

This observation concerns history labeling, not a demonstrated calculation bug in every streak or statistic.

## Proposed experience

### 1. Capture without organizing first

The fastest path should require only a title. Save to Inbox unless the user chooses otherwise. Accept keyboard submission and keep a large visible Save control on mobile. Date, priority, list, and tags remain optional.

Show parsing results as editable chips so users can see that “tomorrow” became a date. Provide a way to keep literal text. Preserve drafts during accidental closure; announce successful saves accessibly; offer undo without making a transient toast the only recovery path.

Do not remove advanced fields from the app. Move them behind an optional details control. Reuse existing inline capture rather than build a second parser or capture service.

**Validation:** a first-time user can capture an unscheduled task without selecting a list, date, priority, or tag; task remains after reload.

### 2. Add Now inside Today

Use the existing Today page, not another navigation destination. A selected task appears above the rest with:

- Task title and first incomplete check item.
- One primary action: start a short focus session.
- Secondary choices: choose another task, edit next step, or do it without a timer.
- Optional small shortlist below, chosen by the user.

Three items can be a starting display default, not a hard limit or evidence-based ADHD rule. Keep the whole list reachable. Explain that hidden items remain saved.

Prefer explicit selection and simple ordering over automated priority scoring. Do not infer urgency from how often a user ignores something. Avoid introducing energy/mood metadata until participants demonstrate that it earns its maintenance cost.

**Validation:** users can identify their chosen next action without opening another screen; replacing it does not change deadlines or discard work.

### 3. Make starting and resuming one workflow

Task details already link to Focus, but the observed “Start focus” action navigated to Focus with the task linked and still required starting the timer. Decide whether to label this “Open Focus” or offer a true one-action start. Do not silently change behavior without making it clear.

Add a short-start option such as 5 minutes, plus custom and timer-free choices. Carry check-item text into Focus. Keep pause, finish, and cancel meanings clear. An interruption should offer a brief resume note, not force a reflection form.

After an interval, offer “continue,” “take a break,” “choose next step,” or “stop for now.” A timer ending must not mark the task complete. A break should not automatically begin another work session without consent.

The existing running timer survived page navigation in this test. Preserve that strength. Verify suspended tabs, reload, device sleep, duplicate tabs, and daylight-saving changes using real elapsed-time semantics.

### 4. Design for returning after absence

On return, do not demand that every overdue task be triaged before starting. Offer “Choose one thing for today” with old tasks collapsed but explicitly accessible. Distinguish a genuine missed deadline from an intended work date.

Provide rescheduling previews and undo for bulk changes. Never automatically move legal, financial, medical, or other hard deadlines. Avoid announcing how many days the user has “failed.” No forced catch-up wizard.

A lightweight “not now” action should be reversible and should not disguise tasks as completed.

### 5. Make time visible without promising precision

Keep daily calendar and Focus as complementary views. Add estimated duration only where scheduling needs it; do not make every capture require an estimate. Distinguish deadline, planned work block, and duration before introducing automatic scheduling.

Show transition/setup time and allow generous buffers. Present estimated workload alongside available time after meetings, with an explanation of the calculation. Avoid fake precision: an uncertain 15–30 minute estimate can be more honest than 18 minutes.

Actual focus time is not necessarily total task duration. Treat history as optional context, not an objective performance score.

### 6. Make reminders trustworthy and adjustable

First establish what currently works on desktop/mobile, with the app open, backgrounded, closed, and phone locked. Browser permissions and operating-system restrictions matter. Explain limitations honestly.

Then provide user-selected reminder timing, quiet hours, one-tap snooze, and a link to the actual next action. Avoid escalating alerts by default. Keep urgent deadlines visible without turning the entire app into alarms.

Do not build push infrastructure before verifying the existing delivery architecture and user need. Do not call the existing Active hours feature notification quiet hours unless its behavior is confirmed.

### 7. Build flexible routines on existing habits

Use existing boolean/numeric habits and frequency options. Add plain-language labels such as “Done / not yet” and “Count” instead of Boolean/Numeric. Let users choose a minimal version: “put walking shoes by the door” can be a valid step toward a larger routine.

Pause for illness/travel, distinguish skip from failure, and let people hide streaks. Celebrate returning without inflating achievements or using childish language. Ask before adding routine chaining or habit dependencies; a short checklist may be enough.

### 8. Make support personal, not diagnostic

Offer a simple preference such as “Show fewer choices” or a starter preset that hides optional sections using existing feature toggles. Keep all options reversible. Do not ask for an ADHD diagnosis to unlock support.

Test text resizing, keyboard focus, contrast, reduced motion, modal focus restoration, non-drag alternatives, and touch targets. Provide labels beyond color. Avoid constantly announcing a ticking timer to screen readers; announce meaningful phase changes instead.

Use a first-run path that reaches one useful saved task before introducing goals, integrations, AI providers, or advanced settings.

## External tools worth learning from

There is no defensible universal “best ADHD app” from this review. These are best-fit examples by job. Vendor pages establish offered features, not independent effectiveness or personal fit. Product capabilities can change. [S5–S9]

| Need | Tool | Useful pattern | Trade-off | Tuk Tuk decision |
| --- | --- | --- | --- | --- |
| Turning vague work into steps | Goblin Tools | Magic ToDo breakdown, Compiler brain dump to actions, Estimator | AI output can invent unnecessary steps or inaccurate time estimates | Reuse check items; manual next-step first, optional reviewed suggestions later |
| Seeing routines and transitions | Tiimo | Visual schedule, timers, typed/spoken planning | Another planning system; commercial feature availability can change | Borrow visual clarity; do not copy an entire planner |
| Accountability from another person | Focusmate | Scheduled video sessions with stated goal and closing check-in | Camera/social demand, privacy, availability; independent efficacy not established here | Link out initially; do not build video matching infrastructure |
| Seeing remaining time away from screen | Time Timer | Colored disk visibly shrinks as time passes | Separate device or app; does not decide what to work on | Keep a readable visual timer; recommend physical option for people distracted by screens |
| Planning within available time | Sunsama | Guided daily planning, duration estimates, calendar timeboxing, shutdown | Planning overhead and integration dependence | Borrow capacity visibility and short daily review; avoid mandatory ceremony |

**Practical recommendation:** start with Tuk Tuk alone for capture, one next action, and focus. Add only one external tool for a specific unmet need. A physical timer or an occasional accountability session may help more than adopting another task manager. Use the calendar a person already trusts rather than duplicating appointments across systems.

An OS-level focus mode or app blocker is a reasonable complementary category, but no blocker product was evaluated here. Web apps should not claim they can block distractions across the operating system.

## AI and voice boundaries

Use AI only after the manual path works. Highest-value experiment: suggest a few concrete first steps for a selected task, at adjustable detail, with accept/edit/reject. Do not generate a giant subtask tree by default. Label duration as an estimate and keep the original task intact.

Voice could reduce capture friction for some users; it can also be inaccessible in shared spaces. Maintain text parity. Inspect what data each configured provider receives, disclose cloud processing, and avoid sending unrelated task/calendar history. Do not infer diagnoses, emotions, or medication advice from task behavior.

Retain confirmation and bounded writes. Do not silently reschedule a calendar or erase tasks. Provider outages must leave ordinary capture and focus usable. No provider connection or paid call was tested during this review.

## Prioritized roadmap

Priorities are product judgment, not measured impact scores. No calendar estimates are supplied because delivery capacity and baseline architecture were not fully assessed.

### Phase 1: trust and simpler starts

- Correct habit eligibility/history labels.
- Simplify quick-add presentation using existing capture behavior.
- Clarify task-to-Focus action wording and make primary controls reachable at short viewport heights.
- Use plain-language habit labels.
- Verify save feedback, undo, keyboard activation, and mobile target sizes.

**Release gate:** no newly created habit is already marked as failed; a new user can save a task and begin work without configuration beyond necessary authentication.

### Phase 2: daily execution

- Add optional Now area to Today.
- Surface next check item in Focus.
- Add short-start and timer-free choices.
- Add interruption/resume context.
- Offer gentle re-entry without mandatory backlog processing.

**Release gate:** interrupted users can resume their chosen action; changing the shortlist never mutates hard deadlines; no duplicate timer or task writes on retry.

### Phase 3: reliable time support

- Validate and improve reminder delivery across supported devices.
- Separate planned work from due dates if current semantics require it.
- Add optional duration/buffers and capacity view.
- Add habit pause/skip only with explicit history semantics.

**Release gate:** limitations are documented; timezone, backgrounding, permission-denial, and recovery cases are tested.

### Phase 4: optional experiments

- Small, reviewable task-breakdown suggestions.
- Brain-dump capture that previews separate tasks before saving.
- Lightweight external body-doubling entry point.
- More advanced routines only if simpler checklists fail in testing.

**Release gate:** demonstrated benefit in user sessions, no hidden data sharing, and useful app behavior when optional providers are unavailable.

## What not to build first

- A separate ADHD dashboard or another top-level planner.
- Points, punitive streak loss, leaderboards, or compulsory rewards.
- Complex priority/energy/mood scoring users must maintain.
- Automatic rescheduling that overrides commitments.
- Native video rooms and partner matching.
- Mandatory AI, always-on coaching, or diagnosis-specific onboarding.
- Medication adherence or health-risk workflows without a separate safety/privacy scope.

## Validation plan

Recruit adults with ADHD across different levels of tool familiarity, mobile/desktop use, and support preferences. Include people who dislike timers and reminders, and people using screen readers or keyboard navigation. A small formative round can discover usability problems; it cannot prove clinical effectiveness or represent everyone with ADHD. Compensate participants and avoid collecting unnecessary medical details.

Use realistic tasks:

1. Capture an unscheduled thought while interrupted.
2. Turn a vague household or work task into a first action.
3. Choose what to do among several competing tasks.
4. Start, interrupt, and resume work.
5. Return after several days away.
6. Start a habit without false historical failures.
7. Receive or miss a reminder and recover.

Measure capture success, time/actions to first useful work, ability to find the next step after interruption, accidental changes, reminder recovery, and self-reported burden/clarity. Compare current and proposed flows; define success thresholds after baseline measurement. Completion rate alone rewards trivial tasks and can punish people with variable capacity. Avoid engagement time, notification volume, streak length, or screen time as primary success measures.

Use opt-in, minimal telemetry or moderated observation. Store no diagnosis by default. Report observed results separately from hypotheses.

## Implementation guidance

Keep the first diff small: one Today enhancement, reuse existing Task/Check Item/Focus behavior, and retain existing feature visibility settings. Do not introduce a recommendation engine or new service to select one task.

Before implementation, agree how Now selection persists, whether planned time differs from due time, and how habit start/pause eligibility works. Follow test-first development for those seams. Add regression coverage for local-date boundaries, pre-creation history, selection persistence, discarded drafts, retry safety, and focus recovery; verify real browser flows after automated checks.

No application code changed during this review. This report is a proposal, not an implemented feature set.

## Sources

All retrieved directly on 2026-11-25. Health/accessibility guidance supports general principles; official vendor pages support descriptions of advertised capabilities only.

- **S1 — NHS, ADHD in adults:** https://www.nhs.uk/conditions/adhd-adults/
- **S2 — NIMH, ADHD: What You Need to Know:** https://www.nimh.nih.gov/health/publications/adhd-what-you-need-to-know
- **S3 — W3C, Making Content Usable for People with Cognitive and Learning Disabilities:** https://www.w3.org/TR/coga-usable/ . Relevant portions retrieved; not every section of this long document was read.
- **S4 — W3C, Understanding Target Size (Minimum):** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- **S5 — Goblin Tools:** https://goblin.tools/
- **S6 — Tiimo:** https://www.tiimoapp.com/
- **S7 — Focusmate:** https://www.focusmate.com/
- **S8 — Time Timer:** https://www.timetimer.com/
- **S9 — Sunsama:** https://www.sunsama.com/
