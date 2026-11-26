# ADHD Phase 4 release check (#574)

Spec: #536. Tickets #571 (contextual Check Item Suggestions), #572 (brain dump
to Tasks), #573 (external accountability), merged on `feat/adhd-phase-4`.
This page records what was actually observed in a real browser, what failed,
and what nobody has checked yet. It is not an accessibility certification, and
it does not say the #536 release gate is met: see **Gate status**.

**Checked on 2026-11-26** against commit `837e701` plus the small fixes listed
under **Fixes made during the check** (committed as `f4f27b3` after the check).

## Environment

- Stack: `docker compose` (project `tuktuk-verify574`, ports `15974` frontend,
  `18974` backend, `55574` Postgres, all bound to `127.0.0.1`). Backend dev image
  (Python 3.14.10), Postgres 16.15, frontend dev server on Node 26.13.1.
- Data: throwaway Postgres volume, one synthetic admin created through `/setup`,
  `AUTH_DISABLED=true` with `APP_ENV=development`, a throwaway `APP_MASTER_KEY`
  in a git-ignored `.env`. Every Task title, description and brain-dump input is
  synthetic. No production DB, private user data or real provider was used.
- Provider: a fake OpenAI-compatible server listening on `127.0.0.1:9574`
  **inside the backend container**, built on the backend test suite's own
  `_ChatHandler` (`backend/oci/tests/test_assistant_chat.py`). It adds `GET
/models` and a small control endpoint to script canned responses and read the
  request bodies it received. It never forwards anywhere. The Assistant was
  configured to it through `PUT /api/v1/assistant/config`.
- Browser: **Chrome for Testing 159.0.8154.6, headless**, on Ubuntu 24.04.4 LTS
  (Linux 6.8.0-151), driven by `agent-browser` 0.27.0. It ran with
  `--no-sandbox`, because AppArmor on this host blocks the user-namespace
  sandbox. The only page loaded was the local app. Phone results are
  Chrome's viewport emulation, not a phone: no touch hardware, no screen reader,
  no real text-zoom setting.
- Viewports: 1280x800 (desktop), 390x844 (phone), and 195x422 at device scale
  factor 2, used as the equivalent of **200% browser zoom on a 390 px phone**.
  The app's type tokens are in `px`, so scaling root font size would prove
  nothing; narrowing the layout viewport is what 200% zoom actually does.
  Phone runs used `prefers-color-scheme: dark` and
  `prefers-reduced-motion: reduce` unless noted.

## Reproduce

```sh
cp .env.example .env   # then set APP_MASTER_KEY (openssl rand -base64 32),
                       # APP_ENV=development, AUTH_DISABLED=true
cat > compose.verify.yml <<'EOF'
name: tuktuk-verify574
services:
  postgres: { ports: !override ["127.0.0.1:55574:5432"] }
  backend:  { ports: !override ["127.0.0.1:18974:8900"] }
  frontend: { ports: !override ["127.0.0.1:15974:5900"] }
EOF
docker compose -f docker-compose.yml -f compose.verify.yml up -d --build --renew-anon-volumes
curl -X POST http://127.0.0.1:18974/api/v1/auth/setup -H 'content-type: application/json' \
  -d '{"username":"verify","email":"verify@example.invalid","password":"<synthetic>"}'
# Fake provider: run a ThreadingHTTPServer subclass of tests.test_assistant_chat._ChatHandler
# inside the backend container on 127.0.0.1:9574, then PUT /api/v1/assistant/config
# with base_url http://127.0.0.1:9574, model fake-model, a fake key.
npm i agent-browser && npx agent-browser --args "--no-sandbox" open http://127.0.0.1:15974/
```

Tear down with `docker compose -f docker-compose.yml -f compose.verify.yml down -v`.
Automated suites run natively: `mise run frontend:test`, `mise run backend:test`.

Mouse clicks on controls below the fold did not reach the page in this driver
(the button was outside the viewport hit-test), so the controls were activated
by keyboard: focus, then Enter or Space. That is itself the keyboard-only path,
but it means mouse-pointer use was **not** exercised below the fold.

## Gate status

**Not met.** One required check failed in a way this check did not fix, and
several required checks are unverified. See **Open failures** and
**Unverified**. #575 (human evaluation) has not been run and is a separate gate.

## Observed passes

Each row was seen in the browser unless the "Evidence" column says otherwise.

| #   | Check (ticket criterion)                                                                                                      | Result | Evidence                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Assistant unconfigured: no "Suggest Check Items", no Assistant route; manual Check Item POST still works                      | Pass   | Task detail showed only "Add a check item"; `/assistant` redirected to `/today`; one `POST /tasks/1/check-items` 201                                                                                                                                               |
| 2   | Disclosure before first send, Check Items: selected Task, limited context, model, host, local/cloud, "Not saved" and refresh  | Pass   | Panel text read: "Only this Task title, description, existing Check Items and your instruction are sent. No other Tasks, preferences or conversation." / "fake-model · 127.0.0.1 · Local processing" / "Not saved until accepted…"                                 |
| 3   | Opening the panel makes no provider call; no health check or background inference                                             | Pass   | Provider request log empty after opening the panel and after opening the brain-dump panel                                                                                                                                                                          |
| 4   | Contextual payload is narrow                                                                                                  | Pass   | Provider received one request: `system` + `user` messages, no `tools`. The user message held only the Task id, title, description, existing Check Item titles and instruction. A second Task, `PRIVATE-PREFS` and "quarterly" were absent                          |
| 5   | Brain-dump payload is narrow                                                                                                  | Pass   | Provider received `system` + `user` only, no `tools`; the user content was exactly the pasted text; no Task titles from the DB                                                                                                                                     |
| 6   | Brain-dump disclosure before send: provider, local/cloud, what is sent, ephemerality and refresh loss, manual Quick-Add stays | Pass   | Panel text read before any request; provider log empty                                                                                                                                                                                                             |
| 7   | Ordinary Enter in the textarea does not send a brain dump                                                                     | Pass   | Enter in `#brain-dump-input`: provider log still empty                                                                                                                                                                                                             |
| 8   | No writes before acceptance (Check Items and brain dump)                                                                      | Pass   | After generating 3 suggestions and 3 drafts, `GET /tasks` and `/tasks/1` were unchanged. Discard and Cancel produced no POST                                                                                                                                       |
| 9   | Duplicate title is identified and blocks Add until the user edits or opts in                                                  | Pass   | "Find passport" matched an existing item: "Exact duplicate title. Keep duplicates deliberately" appeared, Add was disabled; editing the title cleared the gate; toggling the checkbox with Space enabled Add                                                       |
| 10  | Edit before accept                                                                                                            | Pass   | Edited Step 1.1 to "Find passport and visa"; that exact title was saved                                                                                                                                                                                            |
| 11  | Partial group save with lost response after commit is honest                                                                  | Pass   | Browser fetch wrapper let the 2nd POST commit and threw before the response. UI: "1 confirmed saved. Remaining outcome unknown; retry safely with the same titles…", "Retry Add"; server held 2 new items                                                          |
| 12  | Retry sends only unconfirmed steps with their original request ids, and creates no duplicate                                  | Pass   | Retry bodies: step 2 re-sent with the same `request_id`, step 3 with its own; confirmed step 1 not re-sent. Final server titles: 3, no duplicates. UI: "Saved 3 Check Items."                                                                                      |
| 13  | Brain-dump lost response after commit, then retry with the same id                                                            | Pass   | First save's response was dropped; row said "Save outcome unknown. Retry safely…" and the Task existed server-side. "Retry Save" re-sent the same `create_request_id`; still one Task; row read "Task saved." with no save control                                 |
| 14  | Eight concurrent POSTs sharing one request id create one row                                                                  | Pass   | `race_check.py`: Check Item and Task each returned eight `201`s and exactly one row (HTTP, not browser)                                                                                                                                                            |
| 15  | Ambiguous/explicit dates: Save disabled until reviewed; "No date" commits no date                                             | Pass   | Draft with proposed `2026-12-03` showed "Not a deadline until you choose a date below"; Save disabled; after No date the saved Task had `due_date: null`                                                                                                           |
| 16  | Provider failure: honest copy, text preserved, manual fallback                                                                | Pass   | Brain dump (provider 500): "Assistant unavailable. Your text is unchanged; use manual Task creation.", text and "Original text" kept. Check Items: "Assistant unavailable. Task unchanged. Add Check Items manually below."                                        |
| 17  | Ordinary capture works during provider outage and calls no provider                                                           | Pass   | Provider returning 500; Quick-Add Enter produced one `POST /tasks` 201 and zero provider requests                                                                                                                                                                  |
| 18  | Invalid output cannot become a write                                                                                          | Pass   | Check Items: foreign task id (Task 3) and over-count output both returned 503, Task 3 unchanged (HTTP). Brain dump: output with an invented List, Tag and priority returned "Couldn't prepare valid drafts… no Tasks were saved."                                  |
| 19  | Oversized input is refused, not truncated                                                                                     | Pass   | 12,001 characters: Suggest Tasks disabled, `role=alert` "Text exceeds 12,000 characters… nothing has been truncated."                                                                                                                                              |
| 20  | Refresh loses unaccepted work and replays nothing                                                                             | Pass   | Reload with an unsaved draft: panel closed, no POST in the network log, Task count unchanged                                                                                                                                                                       |
| 21  | Task switch discards unaccepted Suggestions                                                                                   | Pass   | Opened Task 2 after generating Task 1 suggestions: no steps shown, no POST, both Tasks unchanged                                                                                                                                                                   |
| 22  | Error association and once-only announcement (brain dump)                                                                     | Pass   | Textarea `aria-describedby="brain-dump-help brain-dump-error"`; `#brain-dump-error` is `role=alert`; save outcomes are in one `role=status` per row. Not run with a screen reader                                                                                  |
| 23  | External link disclosure and safety (static)                                                                                  | Pass   | Entry text states external service, no Task details sent, nothing booked, non-video alternative and continue alone. Link is `https://www.focusmate.com/`, no query, `rel="noopener noreferrer"`, `referrerpolicy="no-referrer"`                                    |
| 24  | No service request before deliberate activation                                                                               | Pass   | Network log with the entry open showed no request to focusmate.com and no non-GET to the app                                                                                                                                                                       |
| 25  | Keyboard-only: Tab order, Enter/Space, Escape                                                                                 | Pass   | Statistics → summary → link in order; summary opened with Enter; Escape in the Check Item panel closed it; Cancel brain dump closed it                                                                                                                             |
| 26  | Focus returns to the opener on dismiss                                                                                        | Pass   | Check Items: Escape returned focus to "Suggest Check Items" (Task detail stayed open on the same Task). Brain dump: returns to "Brain dump to Tasks" after the fix below (before the fix it dropped to `<body>`)                                                   |
| 27  | Visible 3px focus                                                                                                             | Pass   | Existing global `--focus-ring` (`box-shadow 0 0 0 3px`) on buttons, inputs and the Check Item textarea; `outline: solid 3px` on the Focus summary and link; focus-visible true on each                                                                             |
| 28  | Phone 390x844, dark, reduced motion: no horizontal page scroll, targets ≥44px                                                 | Pass   | `scrollWidth == clientWidth == 390` on Check Items, brain dump and Focus; buttons and inputs measured ≥44px; checkbox rows 68px after the fix (the 18px box is by convention)                                                                                      |
| 29  | Reduced motion on the new surfaces                                                                                            | Pass   | No running or infinite animations on P4 elements; only the existing 0.12s border/shadow control transition remains                                                                                                                                                 |
| 30  | Light theme renders                                                                                                           | Pass   | Check Item panel at 390px, `prefers-color-scheme: light`: no overflow, same layout                                                                                                                                                                                 |
| 31  | Focus accountability at 195x422 (200% equivalent) and 390x844                                                                 | Pass   | No overflow, no target below 44px; `phone-dark-focus-accountability.png`                                                                                                                                                                                           |
| 32  | Automated suites                                                                                                              | Pass   | `vitest`: 9 files, 62 tests (P4 App tests + style guards). `pytest tests/test_check_item_suggestions.py tests/test_task_idempotency.py tests/test_assistant_chat.py`: 32 selected passed. `npm run lint` clean. These supplement the table; they do not substitute |

## Failures found and fixed during the check

Each was seen in the browser, then fixed with the smallest change. Frontend
guard tests and the P4 App tests pass after the fixes.

1. **Brain dump overflowed at 200% zoom.** At 195x422 the native date input's
   intrinsic width (204 px) was wider than the 148 px column, so the draft rows
   scrolled sideways and the Save Task and Discard buttons were clipped
   (`zoom200-brain-dump-clipped-before.png`). Fix: grid columns `minmax(0, 1fr)`
   and `min-width: 0` on its controls in `BrainDumpView.css`. Re-measured: no
   overflow in the brain-dump panel.
2. **Duplicate-consent checkbox rendered as an 18x44 pill** on phones, because
   the panel's shared `min-height: 44px` applied to the checkbox itself
   (`phone-dark-duplicate-checkbox-before.png`). Fix: exclude checkboxes from that
   rule and grow the hit area through the label's padding, as the repo's
   tap-target convention requires (`tapTargetGuard.test.ts` rejected the first
   attempt). After: 18x18 box inside a 68 px label row
   (`phone-dark-duplicate-checkbox-after.png`).
3. **Cancelling a brain dump dropped focus to `<body>`**, and the opener lacked
   `aria-expanded`. Fix: return focus to the opener, as Check Item Suggestions
   already did, and set `aria-expanded`. One assertion added to
   `App.brainDump.test.tsx`, seen failing without the fix and passing with it.

4. **"Original text" disclosure was a 21 px target.** Fix: the brain-dump
   `summary` gets the 44 px tap-target floor. Re-measured at 390x844 and
   195x422: no brain-dump control under 44 px, no overflow.

## Open failures

1. **Task detail sheet scrolls sideways at 200% zoom (not P4 code).** At
   195x422 the `aside.task-detail` scroll width is 213 px against a 179 px
   client width with the Suggest panel closed. Overflow comes from existing
   rows: `.property-rows`, the Reminder row and `.task-description`. The
   Suggestions panel itself adds none (0 overflowing P4 elements). The page
   (document) does not scroll; the sheet does, so the Suggestions content
   sits inside a horizontally scrolling sheet at 200% on a phone. This
   breaks the "no horizontal page scroll / let content grow rather than clip"
   contract for the new flow's host. Reported to the parent, not fixed here.
   Owner needs to decide whether to fix the existing property rows.
2. **Assistant page chat input overflows at 200% (not P4 code).** At 195x422
   `Describe your day` and its Send button extend past the main column
   (right edge 281 vs 180). This is the existing text chat that sits above the
   brain-dump panel on `/assistant`. Reported, not fixed.

## Unverified

Nothing below was run. None of it may be reported as passing.

- Real devices and real browsers: any physical phone, iOS Safari, Android
  Chrome, Firefox, Safari, Edge. Only Chrome for Testing 159 headless ran.
- Screen readers (VoiceOver, TalkBack, NVDA, JAWS). Accessible names, `role`
  attributes and live-region placement were read from the accessibility tree;
  announcement timing and "once only" delivery were not heard.
- True browser text zoom (Ctrl +) and OS text-size settings. The 195x422 DPR-2
  viewport is the layout equivalent, not the same code path.
- Phone touch input. No touch hardware; keyboard activation replaced pointer
  clicks for below-the-fold controls (see Reproduce).
- Real hardware `prefers-reduced-motion` and dark-mode toggles. Both came from
  the driver's media emulation.
- Dialog containment (focus trap). Check Item Suggestions and brain dump are
  inline panels in the page, not modal dialogs, so there is nothing to trap
  and this was not tested as one. The ticket's "dialog containment" is
  therefore **not applicable as built**; confirm that is intended.
- Switching Tasks mid-request (cancelling an in-flight provider call): only the
  idle case was tried. Covered by the App test for cancellation, not the browser.
- Return navigation (browser Back) during an open Suggestion panel.
- Live-provider behaviour (structured-output compatibility with real models),
  by design: no live provider calls.
- Actually clicking the Focusmate link. Deliberately not done: it would leave the
  local app for a live third-party site. The `href`, `target`, `rel` and
  `referrerpolicy` were read from the DOM. No Referer header was captured on a
  real navigation, and no booking was seen because the page was never opened.
- A/B User isolation in the browser. The stack ran with `AUTH_DISABLED`, which
  serves every request as the first admin, so a second user could not be signed
  in. Isolation is covered only by the backend HTTP/PostgreSQL tests
  (`test_foreign_context_rejected_before_provider_and_receipts_are_user_scoped`,
  `test_task_request_keys_are_user_scoped`), which passed.
- Voice Assistant confirmation rules (unchanged by design). The Voice tab and
  its tests were not exercised in this check.
- Estimated or generated time labels: no flow produced a generated duration, so
  the "labelled uncertain" rule had nothing to check.
- Design-token fidelity by eye against the private design canvas. The new CSS
  uses existing semantic tokens (`--accent`, `--focus-accent`, `--border-default`,
  `--tap-target`); no hard-coded artwork colours were seen. The canvas itself was
  not opened.

## Gate summary

| Area (ticket criterion)                              | Status                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Privacy / narrow payloads / no writes before accept  | Observed pass (browser + provider log); A/B isolation unverified in browser, covered by backend tests |
| Manual fallback, outage, ordinary Enter              | Observed pass                                                                                         |
| Partial save, lost response, retry, refresh, cancel  | Observed pass (browser fetch fault injection, not a real network drop)                                |
| #536 Required states                                 | Observed, except in-flight cancel and Back navigation (unverified)                                    |
| Keyboard, focus, names, order, errors, announcements | Observed pass in Chrome; screen-reader behaviour unverified                                           |
| Phone, dark, reduced motion, 44px targets            | Observed pass on the new surfaces                                                                     |
| 200% text zoom, no horizontal scroll                 | **Failure (existing code)** in the Task detail sheet and Assistant chat; new panels pass              |
| Dialog containment                                   | Not applicable as built (inline panels); unconfirmed                                                  |
| Real devices, other browsers, screen readers         | Unverified                                                                                            |

Because the 200% check failed on a surface that hosts the new flow, and
screen-reader and real-device checks are unverified, this check does **not**
declare the release gate passed.
