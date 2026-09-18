# Goals are OKRs with WOOP framing, two levels deep, scored from computed reads

A **Goal** is a durable outcome with a window and a measurable score. It
carries **Key Results** — between one and a handful of numbers that move
— and the Goal's score is the mean of how far those numbers have
travelled. Tasks and Habits are the mechanism: a Task can be attached to a
Key Result, and a Key Result can draw its number from a Habit's check-ins.

This is the layer the app was missing. Tasks answer "what do I do now",
Habits answer "what do I repeat", and `SprintGoal` answered "what am I
vaguely pointed at" in a single untracked line of text. Nothing answered
"is the daily work moving anything that matters", because nothing
connected the three.

## Why OKR, and why WOOP on top

Four techniques were on the table. SMART produces one well-formed
sentence and no structure to track — a well-formed Key Result is already
SMART, so SMART is subsumed rather than rejected. Atomic Habits' identity
-and-systems framing says the goal is a direction and the habits are the
mechanism, which is a fair description of the Habits feature that already
exists; building it again under a new name adds nothing. WOOP (Wish,
Outcome, Obstacle, Plan) has the strongest evidence for follow-through but
no progress arithmetic at all.

OKR is the only one of the four that yields something trackable: an
Objective that is qualitative and a set of Key Results that are numbers
with a start, a target, and a current value. That gives a score, and a
score gives an end-of-window verdict.

WOOP's contribution is the half OKR is weakest at — actually doing the
thing. Mental contrasting (naming the obstacle) plus an implementation
intention (`If <obstacle>, then I will <action>`) is the evidence-carrying
part, and it costs two nullable text fields. The other two WOOP elements
need no fields: Wish *is* the Goal's title, Outcome *is* its description.
Adding all four would produce a form with two redundant boxes.

So: OKR spine, `obstacle` and `if_then_plan` on the Goal, both nullable. A
Goal must be creatable in ten seconds or it will not be created.

## Two levels, and no third

Goal → Key Result. That is the whole tree. Goals do not nest, there is no
annual-into-quarterly cascade, and there is no separate Theme or life-area
entity.

Nesting is the classic OKR failure mode: the cascade becomes the artefact
you maintain instead of the work. If grouping is ever genuinely needed,
the existing `Tag` many-to-many (the `task_tags` pattern in `models.py`)
is the cheap answer — a new hierarchy is not.

Key Results are ordered within their Goal by a sparse `sort_order`, the
same way `StandupBullet` orders within `StandupEntry`.

## Scoring

Each Key Result has `start_value`, `target_value`, and a current value.
Its ratio is `(current - start) / (target - start)`, clamped to `0.0`–
`1.0`, guarding `target == start`. Descending Key Results (target below
start) fall out of the same formula correctly. The Goal's score is the
unweighted mean of its Key Results' ratios, rounded to two places.

Clamping is load-bearing: an uncapped `3.0` on one Key Result would mask a
`0.0` on another, and the mean would report a goal as met when half of it
was never touched.

Weights were rejected. A per-Key-Result weight is a tuning knob that
invites fiddling with the model instead of moving the numbers — and if one
Key Result genuinely matters more than the others, it should be the only
Key Result.

Per-Key-Result **confidence** (the red/amber/green or 0–10 field that
team OKR practice uses) was also rejected. Confidence exists to
communicate risk to other people; this is a single-user app (ADR 0002,
ADR 0005) and the only reader already knows how confident they are. It
would be a field updated out of duty. It becomes worth adding the day a
second person reads these goals.

## Progress is computed on read, never stored

A Key Result declares a `source`: `manual`, `habit_checkins`, or
`task_count`.

For `manual`, `current_value` is a stored column the user types into.

For the two automatic sources, `current_value` is **not stored**. It is
computed in the read path — a `SUM` over the linked Habit's check-in
values within the Goal's window, or a `COUNT` of completed work carrying
the Key Result link. Writes to a computed Key Result's value are rejected.

The tempting alternative — a stored counter updated by a hook on check-in
and task-completion — was rejected because this is precisely where such
counters rot. Check-ins are explicitly backfillable, tasks get deleted,
and a Task's Key Result link can change after the Task is already
complete. Every one of those silently desynchronises a stored counter, and
the desync is invisible until someone notices the number is wrong and has
no way to tell when it started being wrong. On SQLite, single-user, with
goals numbering in the tens, the recompute is free.

The single exception is `final_score`, frozen when a Goal closes. That is
a deliberate historical snapshot, not a cache: a check-in backfilled in
March must not quietly rewrite what January's score was.

## Window and close

A Goal has `starts_on` and `ends_on`. The creation form defaults them to
the current quarter and the Goals view groups by window, so the shared
quarterly boundary is the path of least resistance — which is what makes
"grade the quarter" a ritual that can exist at all, and what makes a
`habit_checkins` window unambiguous. But the dates are per-Goal and
arbitrary. Hard-coding quarters breaks the first time a six-week goal is
wanted, and with no organisation to synchronise with there is nothing to
enforce.

Status is `active`, `closed`, or `abandoned`. A past-window `active` Goal
transitions to `closed` on read, freezing `final_score`. An optional
`retro` text field is offered at close; it is not a blocking prompt,
because a ritual that demands prose before it lets you leave is a ritual
you start avoiding.

`abandoned` must exist and must be one click. The honest outcome has to be
cheaper than the dishonest one, or every dead goal stays `active`
forever.

## One focused Goal, replacing SprintGoal

Exactly one Goal carries `is_focused`. Setting it clears the previous
one in the same transaction — enforced at the service layer rather than
by a partial unique index, because the app-level rule is the one that will
actually be read by whoever touches this next.

Stand-up works today because it asks one question. Showing every active
Goal in the daily ritual turns it into a dashboard to scroll past, so
Stand-up reads the focused Goal and its Key Result progress, and nothing
else.

`SprintGoal` is superseded. On migration its text becomes the title of a
seeded focused Goal with no Key Results and no window. The
`sprint_goal_snapshot` column on existing `StandupEntry` rows stays as
frozen history and is **not** backfilled — those rows record what was
true on those days.

## API shape

Key Results are nested under their Goal: `/api/v1/goals/{id}/key-results/
{krId}`. There is no top-level Key Result collection, because a Key Result
has no life outside its Goal — the same relationship `StandupBullet` has
to `StandupEntry`, and the house pattern is already established there.

Following that pattern exactly: Key Result mutations return the full
parent Goal, so the client never reassembles state, and `GoalRead` embeds
its Key Results eager-loaded via `lazy="selectin"`.

## Naming: `Habit.goal` becomes `Habit.target`

`Goal` was already spoken for twice — the `SprintGoal` entity, addressed
above, and the `goal` column on `Habit` meaning "the numeric amount a
check-in counts toward". With a `Goal` entity in the domain, that column's
name is actively misleading, as is the glossary's description of a numeric
Habit tracking "an amount toward a Goal".

The column, its schemas, `habit_stats.intensity`, the frontend callers,
and the `CONTEXT.md` entry all rename to **target**, in a single PR landed
*before* any Goal code. Keeping the API field named `goal` for
compatibility was rejected: ADR 0001 explicitly disclaims wire
compatibility, there are no third-party clients, and compatibility would
preserve the ambiguity in the one place it is most confusing.

## Consequences

- Five sequenced PRs: the `Habit.goal` → `target` rename; `Goal` and
  `KeyResult` models with nested routes; `key_result_id` on Task plus the
  picker and the automatic sources; the Goals view and sidebar
  registration; Stand-up reading the focused Goal and the `sprint_goals`
  table being dropped.
- A Task attaches to at most one Key Result — a nullable FK, not a join
  table. Many-to-many here would let one Task count toward three Key
  Results at once and corrupt `task_count`.
- There is no capture sigil for goals. ADR 0011 scoped `@` to schedule
  deliberately, so a goal sigil is a separate token, a separate parse
  path, and a separate decision. The Task form's picker ships first; the
  sigil is worth adding once it is clear it is wanted.
- There is no weekly review surface. Stand-up is the only ritual, and it
  gains goal context rather than competing with a second one. A dedicated
  review cadence is a real OKR practice, but two half-used rituals is the
  predictable result of building it before the first one carries goals.
- Automatic Key Result values cost a query per read. That is fine at this
  scale; if the Goals view ever gets slow, the fix is to batch the
  aggregate across Key Results in one query, not to start storing the
  counter.
