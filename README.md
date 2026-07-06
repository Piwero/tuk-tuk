# tuk-tuk

An all-in-one personal productivity app — task management, calendar, habits,
and focus — with a clean, conventional HTTP API.

## Stack

- **`backend/oci/`** — Python 3.12 / [FastAPI](https://fastapi.tiangolo.com/)
  service managed with [uv](https://docs.astral.sh/uv/) (`ruff`, `mypy`,
  `pytest`; SQLite via SQLAlchemy + Alembic). `backend/chart/` holds its
  Kubernetes manifests.
- **`frontend/oci/`** — TypeScript / React app built with
  [Vite](https://vitejs.dev/), linted with ESLint, formatted with Prettier,
  tested with Vitest. `frontend/chart/` holds its Kubernetes manifests.
- **`mise.toml`** — single dev interface: provisions tools (python, node, uv,
  git-cliff) and defines every task (`mise tasks`).
- **`docker-compose.yml`** — runs both dev servers in containers with bind
  mounts and hot reload.
- **`.github/workflows/`** — CI for backend, frontend, and pre-commit checks,
  plus Dependabot and PR / issue templates.
- **`.pre-commit-config.yaml`** — multi-language hooks (ruff, mypy, eslint,
  prettier, hygiene checks, conventional commits) wired for both stacks.

## Prerequisites

- [mise](https://mise.jdx.dev/) — provisions all language tooling
- [Docker](https://docs.docker.com/) with Compose v2 — runs the dev servers

## Quickstart

```bash
# 1. Copy env defaults
cp .env.example .env

# 2. Provision tools (python, node, uv, git-cliff)
mise install

# 3. Install dependencies + git hooks
mise run setup

# 4. Run backend + frontend in Docker with hot reload
mise run dev
```

Then open:

- Frontend: http://localhost:5173
- API: http://localhost:8000 (interactive docs at `/docs`, health at `/health`)

## Development

Dev servers run in Docker (source bind-mounted, hot reload on both sides).
Install, lint, and test run natively via mise-provisioned uv/npm.

| Task                     | Command                 |
| ------------------------ | ----------------------- |
| Install dependencies     | `mise run install`      |
| Install deps + git hooks | `mise run setup`        |
| Run backend + frontend   | `mise run dev`          |
| Run backend only         | `mise run backend:dev`  |
| Run frontend only        | `mise run frontend:dev` |
| Stop all services        | `mise run down`         |
| Lint all                 | `mise run lint`         |
| Test all                 | `mise run test`         |
| Fix backend lint/format  | `mise run backend:lint:fix` |
| Format frontend          | `mise run frontend:format`  |
| Tag a release            | `mise run release:tag <bump>` |

Run `mise tasks` for the full list. Dependency changes are picked up
automatically: `mise run dev` rebuilds images (`--build`) and re-seeds the
frontend `node_modules` volume (`--renew-anon-volumes`).

## Project layout

```
.
├── backend/
│   ├── oci/                # Python service (the image)
│   │   ├── src/app/        # Application code (routers/v1 = API endpoints)
│   │   ├── migrations/     # Alembic migrations
│   │   ├── tests/          # Pytest tests
│   │   ├── pyproject.toml
│   │   ├── uv.lock
│   │   └── Dockerfile      # dev + prod stages
│   └── chart/              # Kubernetes manifests (Kustomize + Flux)
├── frontend/
│   ├── oci/                # TypeScript app (the image)
│   │   ├── src/            # App source
│   │   ├── public/         # Static assets
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── Dockerfile      # dev + build + runtime stages
│   └── chart/              # Kubernetes manifests (Kustomize + Flux)
├── .github/
│   ├── workflows/          # CI pipelines
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS
│   └── dependabot.yml
├── .pre-commit-config.yaml
├── docker-compose.yml
├── mise.toml
└── .env.example
```

## License

MIT — see [`LICENSE`](./LICENSE).
