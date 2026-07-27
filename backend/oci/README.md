# backend

Python 3.12 / FastAPI service managed with [uv](https://docs.astral.sh/uv/);
linted with ruff, type-checked with mypy, tested with pytest. SQLite via
SQLAlchemy (async) + Alembic.

## Setup

```bash
uv sync
```

Creates `.venv/` with runtime + dev dependencies from `uv.lock`.

## Run

In Docker with hot reload (from the repo root):

```bash
mise run backend:dev
```

Or natively:

```bash
uv run uvicorn app.main:app --reload
```

Then open http://localhost:8900/health (interactive docs at `/docs`).

Alembic migrations (`migrations/`) run automatically at startup; the SQLite
database lands at `./tuk_tuk.db` (gitignored).

## Common commands

| Task     | Command                 |
| -------- | ----------------------- |
| Lint     | `uv run ruff check .`   |
| Format   | `uv run ruff format .`  |
| Type     | `uv run mypy src`       |
| Test     | `uv run pytest`         |

## Layout

```
backend/
├── src/app/       # Application code (importable as `app`)
├── migrations/    # Alembic migrations
├── tests/         # Pytest tests
├── pyproject.toml # Dependencies + tool config
├── uv.lock        # Locked dependencies
└── Dockerfile     # dev + prod stages
```
