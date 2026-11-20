# PostgreSQL is the only database, and the test suite runs on it

## Status

Accepted. Supersedes two decisions in ADR 0013: that SQLite stays the
default and a supported engine, and that tests stay on SQLite. ADR 0013's
other decisions stand: PostgreSQL rather than MySQL, `psycopg` (psycopg3)
as the driver, `DATABASE_URL` as environment configuration that the UI can
test but never switch, and no multiple replicas.

## Context

ADR 0013 made PostgreSQL an option and kept SQLite as the default. That
meant supporting two engines that behave differently. Foreign keys are the
main difference: SQLite never enforced them, PostgreSQL always does, and a
SQLite test suite cannot see that difference. ADR 0013 accepted that cost
and named what would justify revisiting it: "Making Postgres the default
rather than an option would justify moving the test suite onto it
wholesale."

That has now happened. Prod moved to `postgres-supernova` (#417). The move
itself showed the cost of the two-engine setup. The SQLite file held 122
orphaned rows from deleted Tasks, and the copy had to prune them before
PostgreSQL would accept the data.

## Decision

PostgreSQL is the only engine. `DATABASE_URL` is required and must be a
`postgresql+psycopg://` URL. The app refuses to start otherwise and names
the variable, the same fail-closed posture as `APP_MASTER_KEY`. An install
still pointing at SQLite is told plainly that SQLite is no longer
supported, rather than hitting a missing-driver error. The SQLite engine
branch, the `+aiosqlite` URL rewriting, the `aiosqlite` dependency and the
SQLite-to-PostgreSQL copy tool are all removed. There is nothing left to
copy from.

The test suite runs on PostgreSQL. One throwaway `postgres:16` server per
session, started through `testcontainers`, means `pytest` needs Docker and
nothing else, locally and in CI. The Alembic chain is migrated once into a
template database, and each test gets its own database cloned from it with
`CREATE DATABASE … TEMPLATE`. This replaces the per-test SQLite file copy
from #113 without giving up what it bought.

- **Clone, then drop.** A clone costs about 15ms with the server's fsync
  off. Each test's database is dropped when the test ends (`DROP DATABASE
  … WITH (FORCE)`, about 11ms). The first version never dropped them, to
  save time, but each clone is about 9 MB. By v3.0.0 the suite cloned
  1,125 of them, leaving roughly 10 GB and 500,000 files in the container.
  Removing the container at the end of the session then outlasted the
  Docker client's 60s timeout on GitHub runners, which failed the
  release, and filled the disk on local machines.
- **Durability off.** `fsync`, `synchronous_commit` and `full_page_writes`
  are switched off, because the server's data never needs to survive the
  session.

ADR 0013 rejected exactly this rewrite, as "a larger diff than the
migration itself" while two engines were supported. With one engine it is
a fixture change: the 800-plus tests themselves did not change.

## Consequences

- **Docker is a prerequisite** for running the backend tests and the
  evals, not just for running the app.
- **Deleted rows' ids are never reused.** Behaviour that relied on SQLite
  reusing a deleted row's id (a recycled rowid) is gone. One test asserted
  it and now checks the history directly instead.
- **Old SQLite files can't be read back in.** There is no supported way to
  load a SQLite file into a current install. Anyone self-hosting on SQLite
  must move their data with the copy tool from 2.21.x before upgrading
  (`docs/self-hosting/upgrade.md`).
- **Some delete code is now redundant.** The hand-written cleanup that
  deleting a List, Task or Key Result performs, and the naive-to-UTC
  datetime handling, predate enforced foreign keys and `timestamptz`.
  Removing them was the follow-up ADR 0013 deferred until tests ran on
  PostgreSQL. That condition is now met, but the removal is still its own
  change. Until then the code is kept, with comments saying why it is
  there.
