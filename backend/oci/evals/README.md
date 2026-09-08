# The Assistant's eval suite

Answers the one question CI structurally cannot: **is this model any good
at planning a day?**

Backend tests run the Assistant against a localhost stub serving canned
completions (ADR 0009). That proves the plumbing and says nothing about
judgement — and here the model's judgement is the product. Every prompt
tweak and every model swap is otherwise a coin flip.

This suite is **manual**. It costs money, it needs a real provider, and it
never gates anything.

## It cannot run in CI

Pytest's `testpaths = ["tests"]` means nothing in this directory is ever
collected, by anyone, on any machine — a structural exclusion, not a marker
someone has to remember to deselect. `python -m evals` also always exits 0:
a failing check is information for whoever is shopping for a model, not a
broken build, and a non-zero exit is how a manual suite ends up wired into
a pipeline by someone who assumed it was safe to.

The suite's *judgement* is tested for free, though — the predicates in
`checks.py` are pure functions covered by `tests/test_eval_checks.py`, which
does run on every push. A suite whose verdicts are wrong is worse than no
suite.

## Running it

```bash
cd backend/oci

# One model
EVAL_API_KEY=sk-... uv run python -m evals --model gpt-4o-mini

# Two models, side by side — the point of the suite. Each carries its own
# per-million-token prices as name:price_in:price_out, since two models
# rarely cost the same and one shared price would make the cost column
# wrong in exactly this case.
EVAL_API_KEY=sk-... uv run python -m evals \
  --model gpt-4o-mini:0.15:0.60 --model gpt-5-nano:0.05:0.40

# A local Ollama (any api-key value; it ignores it)
uv run python -m evals --base-url http://localhost:11434/v1 --model qwen2.5:14b

# One scenario while iterating on the prompt
EVAL_API_KEY=sk-... uv run python -m evals --model gpt-4o-mini --only meetings --verbose
```

Output is a pass/fail table with one column per model, followed by wall
time and dollar cost per pass, then the failure detail lines.

## What it seeds

Four planning situations, each in **English and Spanish** (ADR 0005: both
are first-class; a model that plans well in one and badly in the other is a
failed candidate, and this is where that is discovered rather than in daily
use). The Spanish half seeds a Spanish world — task titles, Lists, Tags,
Events — not an English world with a translated prompt, which would hide
exactly the failure being looked for.

| Scenario     | The day                                        | What it probes |
| ------------ | ---------------------------------------------- | -------------- |
| `meetings`   | Two meetings, gaps between them                 | Planning around immovable walls |
| `overloaded` | Six high-priority tasks all due today           | Spreading work across the week |
| `overdue`    | Two tasks whose dates already passed            | The `find_tasks` tool — overdue work is *outside* the snapshot, so answering needs a tool call |
| `packed`     | Meetings from 09:00 to 19:00 with no gap        | Saying "there is no room" instead of inventing one |

The app is booted for real over a throwaway SQLite file and every seed goes
in over the HTTP API, so a scenario can never construct a state a user
couldn't. Google is faked — Events are seeded — because the alternative is
a suite only its author can run. **The provider is the only real thing**,
which is the point.

## What it asserts

Behavioural and phrasing-tolerant. Nothing matches a string the model
authored, because prose changes between runs and between models — that
variance is the thing being shopped for, not a defect. Every scenario
checks the core guarantees of ADR 0009:

- no Suggestion overlaps an Event
- no Suggestion invents a List or Tag
- no delete is proposed (there is no delete type in the schema; one here
  would mean the schema had drifted)
- every Suggestion targets a task that actually exists
- nothing was discarded as invalid
- the planning preferences are honoured — *every* clause of them: nothing
  before 9, nothing after 19, and the 13:30–14:30 lunch left free. A model
  that respects the opening hour and then works through lunch has ignored
  the preferences text, and a check reading only the earliest hour would
  call that a pass
- the reply came back in the language it was asked in

plus per-scenario expectations: an overloaded day is spread over more than
one day, the thing the owner asked about was actually addressed, and on the
packed day nothing at all is scheduled — that last one exists because the
collision check alone cannot catch a model that dodges the walls by
proposing an all-day task, which claims no hours and so collides with
nothing.

## What a pass costs

Cost is measured, not estimated. The suite points the app at a local
pass-through proxy (`proxy.py`) which forwards to the real provider and
reads the `usage` block off each response — the app itself is unchanged and
the request on the wire is the real one. Prices are arguments (per model,
or `--price-in`/`--price-out` as a fallback) rather than a table in this
repo, because a hard-coded price list is wrong the week a provider changes
one, and wrong quietly.

A full pass is 8 turns (4 scenarios × 2 languages), one provider call each
except `overdue`, which spends an extra call per language on its tool round
trip — so roughly 8–10 calls. Each carries the system prompt and the whole
week snapshot.

Record each run here so the trend is visible:

| Date | Model | Passed | Tokens (in/out) | Cost | Wall time |
| ---- | ----- | ------ | --------------- | ---- | --------- |
|      |       |        |                 |      |           |

## Tuning the prompt

The system prompt in `app/assistant_chat.py` was deliberately left open by
the PRD until there was a suite to tune it against. Iterate with `--only`
and `--verbose` against one cheap model, then re-run the full suite across
both languages before keeping a change — a prompt edit that helps English
and hurts Spanish is the failure this suite exists to make visible.
