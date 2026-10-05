# tuk CLI

Terminal client for tuk-tuk. Logs in once with the account password, caches
the signed session cookie, and reads Tasks.

## Install

```bash
uv tool install --from ./cli/oci tuk
```

Nothing is published to a package index — install from this repository.

## Use

```bash
tuk login --base-url http://localhost:8900
tuk show 12
tuk show --json 12
tuk ls
tuk ls --week
tuk ls --all
tuk ls --list Groceries --tag home --priority high
tuk ls --completed
tuk ls --unscheduled
tuk ls --search passport
tuk ls --json --limit 10 --offset 20
tuk agenda
tuk agenda --json
tuk habits
tuk habits check 3
tuk habits check 3 --day 2026-10-01 --value 5
tuk habits undo 3
tuk check add 12 "Buy milk"
tuk check tick 12 4
tuk check untick 12 4
```

`agenda` composes three existing reads in parallel — the Today Smart List,
Habits due on the local day, and the day's Events — into one view, with no
new backend endpoint. `--json` emits `{"date", "time_zone", "tasks",
"habits", "events"}`. When the Google integration is unconfigured, a Google
account's grant is revoked, or an Event read otherwise fails, the Agenda
renders with no Events section and still exits zero — Tasks and Habits are
never collateral damage of a Google problem.

`habits --json` emits the Habits collection page unmodified — the API's own
`{"items", "total", "limit", "offset"}` envelope, each item a `HabitRead`.
`agenda --json` is the one composed shape, because it has no single API body
to pass through.

Every listing reads one page, and says how many results it left behind rather
than stopping silently at the page boundary.

`habits check` records today's check-in by default, or an explicit day with
`--day`; `--value` sets a Numeric habit's accumulated amount (default `1`,
the Boolean tap). Repeating a check-in for the same day is harmless. `habits
undo` removes a day's check-in.

`check add` grows a Task's checklist; `check tick` / `check untick` flip one
line. Every mutation returns the full parent Task, so output renders the
checklist from the response already returned. Ticking the last open line
completes the parent (a recurring Task advances to its next occurrence
instead), and the command says so. `--json` emits the parent Task unmodified.

Smart List views are judged against your local day: the client resolves the
operating system's timezone (overridable with `TUK_TIMEZONE`) and passes it to
the API. List output states the resolved zone. The zone is resolved for every
command and flag combination, including the ones that do not consume it, so a
bad `TUK_TIMEZONE` fails loudly rather than silently shifting your days.

Config (`config.json`) and session (`session.json`, owner-only) live under
the XDG config directory (`~/.config/tuk/`); `TUK_CONFIG_DIR` overrides it.
