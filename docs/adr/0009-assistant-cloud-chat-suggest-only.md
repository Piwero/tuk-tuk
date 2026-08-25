# The Assistant: a cloud-model day-planning chat that only ever proposes

## Status

Accepted. Supersedes two clauses of
[0005 (Assist)](0005-assist-local-suggest-only-ephemeral.md) — that
inference always runs locally, and that open-ended chat and multi-step
planning are out of scope — for one new surface only. Every other clause
of that ADR, including suggest-only and persists-nothing, is not merely
preserved here but strengthened. Quick-Add's Assisted Capture is untouched
and stays local.

## Context

ADR 0005 built the Assist family around one constraint: a ~14B-class
quantized model running on the owner's own machine via Ollama. Every other
decision in that record followed from it. Structured extraction and
classification were in; open-ended chat and multi-step planning were out,
because a local model of that size is not reliably capable of them.
Anything the model would be bad at deterministically — date arithmetic,
RRULE construction — was resolved in Python from an extracted intent,
which is why `parse_capture` is a single stateless call wrapped in a stack
of resolvers.

What the owner wants now is a conversational day-planner: describe the day
in prose, have the app read the week, and get back a plan — tasks created,
work blocked into the gaps between meetings. That is multi-step planning
over a broad surface, which is precisely the shape ADR 0005 excluded. It
is excluded there as a *consequence* of the local-model constraint, not as
an independent judgement about the feature's worth, so the question this
record answers is whether that constraint should hold everywhere.

It should not hold everywhere, but it should hold somewhere. The two
surfaces have genuinely different constraints, and it is that difference —
not a general change of heart about cloud inference — that decides this.

## Decision: inference provider is configured per feature, not globally

Assisted Capture and the Assistant each carry their own independent
provider configuration on `AppSettings` — base URL, model, and (new for
the Assistant) an API key. Neither reads the other's. Both speak the
OpenAI-compatible chat-completions wire format, which cheap OpenAI models,
Gemini's compatibility endpoint, and Ollama all serve, so "local" and
"cloud" are a configuration value rather than a code path.

The two surfaces are configured separately because they are constrained
separately. Assisted Capture blocks a Quick-Add submission on a four-second
budget and its entire design is to degrade silently to plain text; putting
a metered network round-trip in that path makes capturing a task fail when
the wifi does. The Assistant is a deliberate, session-based interaction
where a two-second wait is unremarkable and being wrong is recoverable,
because nothing it produces is written without a click.

The Assistant's API key is a credential and is encrypted at rest under
`APP_MASTER_KEY` (ADR 0008), unlike the Ollama base URL, which is stored
in plain text because it is not one.

The honest consequence, stated here rather than discovered later: ADR
0005's "no user data leaves the machine" is no longer a property of the
app. It is a property of a configuration. A deployment that configures
nothing, or configures both features against Ollama, still has it in full.
A deployment that points the Assistant at OpenAI does not. Settings must
therefore show, per feature, whether that feature is local — because a
local-first guarantee nobody can see is not one the owner can rely on.

## Decision: writes are Suggestions, and Suggestions cannot be tools

The Assistant reads freely and writes nothing. The model's response is
prose plus a structured `suggestions[]` array; the user accepts Suggestions
individually, and each accepted Suggestion is applied through the ordinary
REST endpoint that already governs it, inheriting its validation and
invariants unchanged.

There are no write tools. This is the load-bearing decision in the record,
and it is deliberately structural rather than instructional: a model that
cannot call a write endpoint cannot write, whatever a prompt does or does
not persuade it of, and whatever a future model does when handed an
ambiguous sentence. ADR 0005's suggest-only posture was a product stance;
here it is an architectural one, which matters more precisely because the
model behind it is now more capable and less predictable than the one that
stance was written for.

The Suggestion vocabulary is `create_task`, `schedule_task`,
`reschedule_task`, `complete_task`, `set_priority`, `set_list`,
`add_tags`, and `add_check_items`. There is no delete of any kind.
Everything in that list is undone by hand in seconds; deletion is the one
operation a confirmation click does not really protect, because the click
that matters is the one made without reading the card. `set_list` and
`add_tags` resolve only against names that already exist, through the same
`resolve_name_phrase` discipline Assisted Capture uses — the Assistant
brings no List or Tag into being, exactly as an unpicked Quick-Add token
does not.

## Decision: the snapshot is the model's entire writable surface

Each turn sends a snapshot of the current week — today and the next seven
days: tasks with their ids, titles, dates and priorities; today's Events;
List and Tag names; habits. Every Suggestion must target an id that appeared
in the snapshot just sent. A Suggestion referencing anything else is not
rejected as suspicious; it is unrepresentable, because there is no other
identifier in play.

This makes the failure mode that would otherwise dominate — a confident
model rewriting a task the user never mentioned, because it invented a
plausible id — impossible rather than rare. It is also why breadth is
affordable here: breadth in the snapshot costs tokens, while breadth in a
tool loop costs reliability.

Beyond the snapshot the Assistant has a small set of read-only drill-down
tools (fewer than six) for questions the week's window cannot answer, and
a cap of three tool iterations per turn. Reaching the cap returns whatever
Suggestions exist rather than failing the turn, following ADR 0005's rule
that Assist only ever adds value and never subtracts it. A well-formed
turn is expected to use no tools at all.

Task `description` bodies and Check Item text are never sent. A planner
needs to know what and when; the substance of a task is where the
genuinely private text lives, and it buys almost nothing for scheduling. A
free-text planning-preferences field in Settings *is* sent every turn, and
is called out in the same egress notice, because the owner will put real
personal detail in it.

## Decision: the Assistant plans Tasks around Events, and never writes to Google

Google Calendar remains read-only and live-fetched (ADR 0006). The
Assistant blocks time by setting a Task's `start_date`, `due_date` and
`time_zone` — fields that already exist — and treats Events as immovable
walls to plan around. This needs no new OAuth scope, no re-consent, and no
schema change.

It also leaves intact the property CONTEXT.md describes as enforced by the
type system rather than by reviewer vigilance: mutating paths take a Task
directly, never a bare Entry, so no write can target an Event. Handing a
language model the ability to move real calendar events would have meant
dismantling that, in the same change that first gives a model the ability
to propose moving anything.

## Decision: nothing about the conversation is persisted

The transcript lives in the browser and is posted whole with each turn.
There is no Conversation entity, no Message table, and no retention
policy — ADR 0005's persists-nothing clause survives this record
unqualified. Day-planning is a bounded session: opened in the morning,
applied, closed. A resumable thread solves a problem this use does not
have, and adding one later is an additive migration rather than a rewrite.

Invalid Suggestions — malformed, or targeting an id outside the snapshot —
are dropped before reaching the UI, which reports how many were discarded.
The count is shown because a silent filter hides the model degrading; the
per-rejection reasons are logged server-side rather than shown, because
they tell the operator whether the prompt or the schema is at fault and
tell the user nothing they can act on.

Applying accepted Suggestions is sequential and fire-and-forget, reporting
success or failure per card. tuk-tuk is single-user (ADR 0002), so the
only way to act on a stale Suggestion is to edit the same task in another
tab within the minute a card is alive — a rare, self-inflicted, visible
conflict whose worst outcome is one wrong time.

## Considered options (and why they were rejected)

- **Keep everything local and spec the chat down to a 14B model.**
  Rejected — the honest version of that feature is not the feature asked
  for. Multi-step planning over a dozen entity types is where a
  14B-class model degrades hardest, and shipping a day-planner that
  frequently plans badly is worse than shipping none.
- **One provider setting for the whole Assist family.** Rejected — it
  buys a simpler Settings screen at the cost of routing every Quick-Add
  through a metered network call with a four-second blocking budget. The
  two surfaces have different latency, failure, and privacy constraints;
  one switch cannot serve both.
- **A provider registry — named connections referenced per feature.**
  Rejected for now — it is the right shape at four or five Assist
  features and premature at two, where it trades a duplicated credential
  field for a new entity, a migration, and a management UI.
- **Act-with-undo autonomy, or write tools guarded by an action log.**
  Rejected again, and more firmly than in ADR 0005. The undo log is a
  second project of comparable size to the Assistant itself, and it would
  be built before there is any evidence the Assistant is worth trusting.
  Suggest-only is also a better daily-planning interaction than watching a
  bot narrate twelve tool calls: "here is your day, apply?" is the
  product.
- **Extending Google Calendar to a read-write scope.** Rejected — a large
  project wearing a small phrase ("arrange my calendar"), requiring a new
  scope, re-consent, and the reversal of an invariant the codebase
  actively enforces. Scheduling Tasks around Events delivers the intent
  with none of that.
- **Persisted conversations.** Rejected — see above; additive later if the
  bounded-session assumption turns out to be wrong.
- **Optimistic concurrency on Suggestions.** Rejected — `Task` has no
  `updated_at`, so this costs a migration and a conflict-resolution UX to
  defend a single user against themselves in a sixty-second window.
- **Streaming responses.** Rejected for now — Suggestions cannot render
  until the JSON is complete and validated, so streaming buys a typing
  effect on the prose in exchange for SSE plumbing on both sides.
- **A right-hand dock panel instead of a full view.** Probably the better
  long-term UX, and rejected for the first version anyway: it invents a
  layout primitive, and competes with `TaskDetail` for the same screen
  edge, in order to find out whether the model plans well. The Assistant
  follows Stand-up's precedent — a view plus a nav item that does not
  render when the feature is unconfigured — and can move later.

## Accepted trade-offs

- The local-first guarantee becomes configurable, and therefore becomes
  something Settings has to communicate rather than something the
  architecture assures. This is the real cost of this record.
- The Assistant costs money per turn, and an ephemeral client-held
  transcript re-sends itself every turn, so a long session's cost grows
  quadratically. Bounded by a ~20-message transcript cap that drops
  oldest-first while retaining the system prompt.
- Per-Suggestion confirmation puts a beat between every conversational turn
  and its effect. Genuine back-and-forth ("now move that one earlier") is
  slower than it would be with an autonomous agent. This is the price of
  the guarantee and is paid deliberately.
- No spend tracking. Both providers offer a dashboard; a token-accounting
  table for one user's cents earns nothing.
- CI cannot tell whether the model is any good. Backend tests run against
  a localhost stub server serving canned completions — following
  `test_assist.py`'s existing seam of standing up a real HTTP server
  rather than mocking the transport — which exercises the plumbing and
  nothing else. Model quality is covered by a separate eval suite, run by
  hand when shopping for a model or changing the prompt. English and
  Spanish are both first-class in it, per ADR 0005; a cheap cloud model
  makes that cheaper to hold than it was locally.

## What would justify revisiting this

Evidence that the snapshot alone plans well would make the read-tool loop
dead weight worth removing. A third and fourth Assist feature would
justify the provider registry rejected above. Wanting an audit trail of
what the Assistant proposed and what was applied — a genuinely different
need from undo — would justify the persisted suggestion tray ADR 0005
also rejected. And if a local model in the 30B class ever plans a day
competently on the owner's hardware, the per-feature split makes returning
the Assistant to local inference a settings change rather than an ADR.
