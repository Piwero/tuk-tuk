# SQLite + SQLAlchemy 2.0 + Alembic for persistence

v1 persists to a local SQLite file (async via aiosqlite), with SQLAlchemy 2.0 models and Alembic migrations. For a single-user app (ADR 0002) this is zero-ops and fast to develop against; Postgres from day one was rejected as setup weight with no v1 payoff.

Consequence: keep SQL portable (no SQLite-only features in models or migrations) so the eventual multi-user move is a `DATABASE_URL` swap to Postgres plus a data copy, not a rewrite. `DATABASE_URL` in `backend/src/app/config.py` is the single integration point.
