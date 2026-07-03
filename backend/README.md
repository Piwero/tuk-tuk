# backend

Python service scaffolded with FastAPI, ruff, mypy, and pytest.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Run

```bash
uvicorn app.main:app --reload
```

Then open http://localhost:8000/health.

## Common commands

| Task     | Command       |
| -------- | ------------- |
| Lint     | `ruff check .`|
| Format   | `ruff format .`|
| Type     | `mypy src`    |
| Test     | `pytest`      |

## Layout

```
backend/
├── src/app/       # Application code (importable as `app`)
├── tests/         # Pytest tests
├── pyproject.toml # Dependencies + tool config
└── Dockerfile
```
