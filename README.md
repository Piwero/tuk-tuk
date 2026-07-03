# template-python-ts-app

A reusable project template for apps that pair a **Python backend** with a
**TypeScript frontend**. Fork or use this repository as a GitHub template
to bootstrap new services with a consistent structure, tooling, and CI.

## What's included

- **`backend/`** — Python package scaffolded with `pyproject.toml`, `ruff`,
  `mypy`, and `pytest`. Uses [FastAPI](https://fastapi.tiangolo.com/) as a
  default web framework; swap for Flask / Django / etc. as needed.
- **`frontend/`** — TypeScript app scaffolded with [Vite](https://vitejs.dev/)
  and React, linted with ESLint, formatted with Prettier.
- **`.github/workflows/`** — CI pipelines for backend, frontend, and
  pre-commit checks, plus Dependabot and PR / issue templates.
- **`.pre-commit-config.yaml`** — Multi-language hooks (ruff, mypy, eslint,
  prettier, hygiene checks) wired for both stacks.
- **`docker-compose.yml`** — Local dev orchestration for backend + frontend.
- **`Makefile`** — One-liner shortcuts (`make install`, `make dev`,
  `make lint`, `make test`).

## Quickstart

```bash
# 1. Use this repo as a GitHub template, or:
git clone https://github.com/piwero/template-python-ts-app my-app
cd my-app

# 2. Copy env defaults
cp .env.example .env

# 3. Install everything (python venv + npm deps + pre-commit)
make install

# 4. Run backend + frontend in dev mode
make dev
```

## Project layout

```
.
├── backend/                # Python service
│   ├── src/app/            # Application code
│   ├── tests/              # Pytest tests
│   ├── pyproject.toml
│   └── Dockerfile
├── frontend/               # TypeScript app
│   ├── src/                # App source
│   ├── public/             # Static assets
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── Dockerfile
├── .github/
│   ├── workflows/          # CI pipelines
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS
│   └── dependabot.yml
├── .pre-commit-config.yaml
├── docker-compose.yml
├── Makefile
└── .env.example
```

## Development

| Task                | Command                     |
| ------------------- | --------------------------- |
| Install everything  | `make install`              |
| Run backend + web   | `make dev`                  |
| Run backend only    | `make dev-backend`          |
| Run frontend only   | `make dev-frontend`         |
| Lint all            | `make lint`                 |
| Format all          | `make format`               |
| Test all            | `make test`                 |
| Build docker images | `docker compose build`      |

## Using this as a template

1. Click **Use this template → Create a new repository** on GitHub.
2. Update the project name in `backend/pyproject.toml`, `frontend/package.json`,
   this `README.md`, and the `LICENSE` copyright line.
3. Replace `.github/CODEOWNERS` with the right owners for your team.
4. Delete anything you don't need (e.g., drop `frontend/` if you're building
   a Python-only service).

## License

MIT — see [`LICENSE`](./LICENSE).
