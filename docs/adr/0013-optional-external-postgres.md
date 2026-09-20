# Optional external PostgreSQL, selected by environment and moved by an operator tool

## Status

Accepted. Supersedes ADR 0004.

## Context

ADR 0004 chose a local SQLite file and committed to keeping SQL portable so
that "the eventual multi-user move is a `DATABASE_URL` swap to Postgres plus
a data copy, not a rewrite." That discipline held up better than such
promises usually do: the full 32-migration Alembic chain was run against a
live PostgreSQL 16 server without modifying a single migration. No
identifier collides with a Postgres reserved word. `ilike` compiles to
native `ILIKE` with correct escaping. `DateTime(timezone=True)`, which
SQLite stores as naive text, becomes a real `TIMESTAMPTZ`.

The motivation for moving is not multi-user. It is that the SQLite file
lives on a Kubernetes PersistentVolumeClaim, so backup and restore are
volume-snapshot operations rather than anything the database itself
provides. Pointing tuk-tuk at a PostgreSQL server that is already being
backed up moves that responsibility to a system built for it.

What ADR 0004 did not anticipate is that "plus a data copy" is where all of
the actual work is, and that switching engines changes runtime semantics in
ways that are invisible until they aren't. SQLite does not enforce foreign
keys unless a connection sets `PRAGMA foreign_keys=ON`, which this app has
never done. PostgreSQL always enforces them. That single difference turned
up three delete paths that are broken today and fail loudly on Postgres,
and it means existing SQLite data may contain orphaned rows that Postgres
will refuse to accept.

## Decision: PostgreSQL, not MySQL

The escape hatch ADR 0004 named was Postgres, and that remains the right
target. MySQL was considered and rejected on two concrete grounds, both
user-visible rather than theoretical:

- MySQL 8's default collation (`utf8mb4_0900_ai_ci`) is case- **and**
  accent-insensitive. `tags.name` is `unique=True`. Today `Work` and `work`
  are two tags; on MySQL the second insert raises a duplicate-key error that
  no handler in the codebase catches, surfacing as an HTTP 500. Tag list
  ordering also changes visibly, because SQLite sorts `Zebra` before `apple`
  and MySQL does not.
- MySQL renders `DateTime(timezone=True)` as a bare `DATETIME` with zero
  fractional-second digits, silently dropping the timezone flag and
  truncating the microseconds already present in every existing timestamp.

Postgres has neither problem. Separately, three migrations that run
unmodified on Postgres fail outright on MySQL — `0025_habit_goal_to_target`
most notably, because MySQL requires `existing_type` on every column
alteration and a pure `RENAME` on Postgres does not.

The driver is `psycopg` (psycopg3), not `asyncpg`. psycopg3 drives both
sync and async from one URL string, which means Alembic and the application
share `postgresql+psycopg://…` verbatim. `asyncpg` is async-only and would
require deriving a separate sync URL for Alembic — which is precisely the
string surgery at `db.py`'s `database_url.replace("+aiosqlite", "")` that
this change deletes rather than extends. For one person's task list,
asyncpg's throughput advantage is unmeasurable; the single-URL property is
worth real code.

## Decision: the engine is selected by `DATABASE_URL` alone; the UI can test but never switch

`DATABASE_URL` stays what ADR 0004 made it — the single integration point,
set in the environment, defaulting to the local SQLite file. Switching
engines means setting it and restarting.

This is a deliberate exception to ADR 0008, which moved configuration out of
`.env` and into a DB-backed `settings` table. The exception is forced: a
database cannot hold its own address. This is the same bootstrapping
argument that kept `APP_MASTER_KEY` outside the database, and it has the
same shape — the value that tells the app how to reach its configuration
cannot itself be configuration.

Settings gains a Database section that is read-only about the current state
and can test a candidate connection. It reports which engine is in use, and
offers a form that takes a connection URL, attempts to connect, and reports
what it found: server version, whether the database is empty or already
holds tuk-tuk tables, or the precise failure — unreachable host, rejected
credentials, missing database. The URL is used for that one probe and
discarded.

The URL is never persisted. Storing it would require a new
`APP_MASTER_KEY`-encrypted column alongside `encrypted_google_client_secret`
(it contains a password), and would create a second copy of a credential
that can silently disagree with the one the process is actually connected
to. A settings row claiming to configure a database the app is not using is
worse than no UI at all.

The UI cannot perform the switch. The running process holds an engine bound
to one URL; cutting over means restarting, which a web request cannot
survive. In Kubernetes it would mean asking a pod to rewrite its own
environment and then die. The test endpoint is valuable precisely because it
catches typos, firewall rules, and wrong passwords *before* the chart is
edited and the pod restarts into a crash-loop.

That endpoint accepts a user-supplied URL and makes the server connect to
it, which is server-side request forgery by construction. It sits behind
`SessionAuthMiddleware` (`PUBLIC_PATHS` is exact-match, so it is
authenticated), and tuk-tuk has exactly one user, so the blast radius is one
authenticated operator probing their own network. Accepted, and recorded
here rather than discovered later.

## Decision: the move is one-way, and the data copy is an operator tool

After cutover there is no supported path back. The SQLite file is left
untouched on disk as a point-in-time backup that is correct as of the
moment of the copy. Reverting means setting `DATABASE_URL` back and
accepting the loss of everything written since. Anything better is a
bidirectional sync feature wearing a settings toggle.

The copy runs as `python -m app.copy_database`, following the precedent of
`app.hash_password` — an operator tool invoked from a shell, wired into
`mise.toml`, runnable inside a pod via `kubectl exec`. It is not an API
endpoint, because the copy must run with nothing writing, and an endpoint on
a live application cannot guarantee that.

It works in three phases:

**Preflight.** Scan the source for orphaned rows — one `LEFT JOIN … WHERE
target.id IS NULL` per foreign key — and refuse to proceed if any exist,
listing them. This is the single most likely cause of a failed cutover,
because the delete-path bugs described below have been silently creating
orphans for as long as the app has existed, and Postgres will reject every
one of them. Refusing rather than auto-deleting is deliberate: an orphaned
focus session is logged time, and dropping it silently during a database
migration is exactly the kind of loss that is undiscoverable afterward.
`--prune-orphans` makes the deletion explicit and opt-in.

Pruning re-scans until stable, because deleting an orphaned parent orphans
its own children — a pruned Task takes its Check Items with it. Leaving
them would only re-fail the same preflight, so the deletion cascades; the
protection against silent loss is that every id deleted, first pass or
tenth, is named in the report.

**Copy.** Row-by-row through the existing SQLAlchemy models, in foreign-key
dependency order, preserving `id` values exactly. Preserving ids is not
cosmetic: `tasks.key_result_id`, `focus_sessions.task_id`, and the
`task_tags` join all reference them, and id remapping would reintroduce the
phantom-count class of bug that ADR 0012 exists to prevent. The ORM path is
chosen over an engine-native dump because it reuses the type definitions
already in `models.py` — including the naive-datetime convention in
`schemas.py` — rather than hand-writing a SQLite-to-Postgres type mapping.
The dataset is one person's tasks, so copy speed is irrelevant.

**Reseed and verify.** Integer primary keys render as Postgres `SERIAL`, and
inserting explicit ids does not advance the backing sequence. Left alone,
the first row the application inserts after cutover fails with a duplicate
key violation. All 18 sequences (19 tables, less `task_tags`, which has a
composite key and no sequence) need `setval` to the table's `MAX(id)` —
marked as consumed only where the table actually has rows, since a table
copied empty must still hand out id 1. Verification compares per-table row
counts and `MAX(id)` between source and target — `MAX(id)` is not
decorative here, it is the same number `setval` requires, so verifying it
and fixing the sequence are one operation.

The tool refuses to run against a non-empty target without an explicit
`--force`, which empties the target and replaces it with the source rather
than merging into it — merging two datasets under preserved ids is not a
thing that can succeed. `--force` exists to retry a failed attempt, so
every row it deletes is counted per table in the report, and the refusal
message says plainly what `--force` would destroy. The migration chain runs
against the target only when it is empty: a database that already has data
already has its schema, and re-running migrations against a live database
is not this tool's business.

## Decision: multi-replica is explicitly not supported by this change

Moving off the PVC makes horizontal scaling *look* available. It is not, and
three things stand in the way. This is recorded as a "no" because the most
dangerous of them fails silently.

`LoginThrottle` holds its consecutive-failure counter in process memory. Its
own docstring justifies being global rather than per-client on the grounds
that "with exactly one legitimate user a global counter is nearly equivalent
to a per-user one" — a premise that dies the moment a second process exists.
With N replicas behind a round-robin load balancer, the effective
brute-force delay drops roughly N-fold, with no error surfaced and no effort
required from an attacker; the load balancer does the work. ADR 0005
accepted the absence of per-IP rate limiting *because* this counter
compensated. It must move to shared storage before any scale-out, not after.

Migrations run on every boot of every replica (`run_migrations` in the
FastAPI lifespan) with no advisory lock anywhere in the codebase. Postgres's
transactional DDL softens this — losers of the race roll back rather than
half-applying — but they still crash-loop, and `0030`'s unconditional data
seed has no uniqueness guard.

The Inbox is seeded by a read-then-insert at startup, and `lists.is_inbox`
carries no unique constraint or index. Two replicas booting together produce
two Inboxes and no error.

`EventCache` also becomes per-replica, but that one is benign: it is a
read-through cache of a non-authoritative source, already blessed by ADR
0006 as "cached briefly in process." The cost is N× the Google API calls.

## Decision: foreign-key enforcement flips, and three delete paths are fixed first

On Postgres the database enforces what the schema declares. Fourteen foreign
keys declare no `ondelete` clause at all, and under SQLite's unenforced
regime they have been orphaning rows rather than erroring. Three paths,
all reachable through `DELETE /api/v1/lists/{id}`, fail on Postgres:

- `focus_sessions_task_id_fkey` — the list holds a task with a focus session
- `timers_task_id_fkey` — the list holds a task with a timer
- `sections_list_id_fkey` — the list has any section at all

The third has the widest reach, requiring no focus or timer usage
whatsoever: `Section` declares no relationship back to `TaskList`, and
`TaskList` declares only `folder` and `tasks`, so nothing in the ORM or the
database removes sections when their list is deleted.

The root cause is an asymmetry. The single-task delete path sweeps
`focus_sessions` and `timers` by hand before deleting; the list delete path
removes tasks through ORM cascade and never repeats that sweep. The comment
above the list path shows its author knew about unenforced foreign keys, but
handled only `CompletedOccurrence` — the one foreign key that already
declares `ON DELETE CASCADE`.

**This is a live bug on SQLite today.** It does not error; it silently
orphans. It ships as its own change, before the copy tool is written, both
because it stands alone with an obvious test and because it stops the orphan
population growing while a migration that orphans will block is being
prepared. Fix the leak before draining the tank.

The fix mirrors the sweeps the sibling paths already perform. Adding
`ondelete` to all fourteen bare foreign keys and deleting the roughly twelve
hand-written sweeps scattered across seven routers is the better end state,
but it is deliberately not done here — see below.

## Decision: tests stay on SQLite, with a targeted Postgres job in CI

The suite migrates a template database once per session and then
`shutil.copyfile`s it per test, a strategy with no Postgres analogue and one
that exists to solve a real performance problem. Rewriting it into
per-test `CREATE DATABASE … TEMPLATE` or transaction-rollback isolation is a
larger diff than the migration itself, and re-solves that performance
problem from scratch.

SQLite remains the default and a genuinely supported configuration, so the
suite continues to exercise it. CI gains one PostgreSQL job that runs the
full migration chain and a focused set of integration tests.

The cost is explicit and is the reason this is a decision rather than a
detail: **the delete-path bugs above are invisible to a SQLite test suite.**
The Postgres CI job must cover the list-delete path specifically, or the
next foreign-key violation of this class will be found in production.

## Considered options (and why they were rejected)

- **MySQL.** Rejected on collation and timestamp grounds described above,
  both of which change user-visible behaviour, plus three migrations that do
  not run.
- **`asyncpg` as the driver.** Rejected — async-only, so Alembic needs a
  separately derived sync URL, preserving the URL-rewriting code this change
  deletes. Its performance advantage is unmeasurable at this scale.
- **A Settings screen that performs the switch.** Rejected as not
  implementable honestly: cutover requires a restart, which the request
  performing it cannot survive.
- **Persisting the tested connection URL.** Rejected — it needs a new
  encrypted column for a credential the process may not be using, creating a
  second source of truth that can silently disagree with the environment.
- **A toggle that switches back and forth between engines.** Rejected — with
  no dual-write, the idle engine is stale the instant the active one is
  written to. "Toggleable" is a sync feature in disguise.
- **Squashing the 32 migrations into a `0033` baseline for non-SQLite
  engines.** Rejected — the chain runs on Postgres unmodified, and a
  baseline means two schema definitions drifting apart forever. Postgres
  `downgrade()` paths are explicitly out of scope; nobody downgrades a
  production database and pretending otherwise costs real work.
- **Adding `ondelete` to all fourteen bare foreign keys and deleting the
  hand-written sweeps.** Rejected *for this change*, though it is the
  correct end state. Every one of those deletions is safe only because
  Postgres enforces foreign keys — which is unverifiable on SQLite, where
  the test suite runs. It would remove the only protection those paths have
  on the engine the tests actually exercise. It belongs in its own change,
  after Postgres is the default and tests run against it.
- **Falling back to SQLite when Postgres is unreachable at boot.** Rejected
  as the worst available failure mode: a network blip and the app silently
  starts serving a stale file, accepting writes that land nowhere real, with
  two divergent databases and no signal. The app crashes instead, naming the
  host it could not reach, following the precedent of refusing to start
  without `APP_MASTER_KEY`. Kubernetes already provides restart backoff.

## Accepted trade-offs

- `DATABASE_URL` remains environment configuration, cutting against ADR
  0008's direction of travel. Forced by bootstrapping; the Settings screen
  recovers the diagnostic half of the experience without pretending to own
  the switch.
- Cutover requires shell access, which ADR 0008 worked to eliminate for
  routine operations. Accepted because this is a once-ever operation, not
  routine maintenance, and the operator and the user are the same person.
- The SQLite file becomes a point-in-time backup and nothing more. Anything
  written after the copy exists only in Postgres.
- Microsecond-precision timestamps survive on Postgres, but the naive-to-UTC
  normalisation in `schemas.py` becomes a no-op there, since `timestamptz`
  returns aware datetimes. Harmless, and left in place while SQLite remains
  supported.
- ADR 0012 justifies `detach_tasks` partly on SQLite recycling rowids, so
  that an orphaned Task would reattach to the next Key Result created.
  Postgres sequences do not recycle, and `tasks.key_result_id` already
  declares `ON DELETE SET NULL` — verified enforced. That code is therefore
  redundant on Postgres, though still correct and still required on SQLite.
  ADR 0012 is not amended: it was right when written, and editing old ADRs
  to match present reality destroys the record.
- Two databases are supported, so both must keep working. Portability
  discipline that ADR 0004 imposed speculatively is now load-bearing.

## What would justify revisiting this

Wanting more than one replica — for availability rather than throughput,
since one user does not generate contention — would require moving
`LoginThrottle` to shared state, guarding migrations with an advisory lock
or an init container, and constraining the Inbox uniquely. That is a
separate decision and deserves its own ADR.

Making Postgres the default rather than an option would justify moving the
test suite onto it wholesale, which in turn unlocks the foreign-key cleanup
rejected above: with the database enforcing intent, the twelve hand-written
sweeps become removable and verifiable.
