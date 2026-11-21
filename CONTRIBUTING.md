# Contributing

Developer guide for tuk-tuk. To just run the app, see
[docs/self-hosting/install.md](docs/self-hosting/install.md). Domain language
lives in [`GLOSSARY.md`](GLOSSARY.md); design decisions in [`docs/adr/`](docs/adr/).

## Stack

- **`backend/oci/`**: Python 3.12 / [FastAPI](https://fastapi.tiangolo.com/)
  service managed with [uv](https://docs.astral.sh/uv/) (`ruff`, `mypy`,
  `pytest`; PostgreSQL via SQLAlchemy + Alembic). `backend/chart/` holds its
  Kubernetes manifests.
- **`frontend/oci/`**: TypeScript / React app built with
  [Vite](https://vitejs.dev/), linted with ESLint, formatted with Prettier,
  tested with Vitest. `frontend/chart/` holds its Kubernetes manifests.
- **`shared/oci/`**: shared HTTP client and user configuration (`tuk-core`).
- **`cli/oci/`**: the `tuk` terminal client. See [`cli/oci/README.md`](cli/oci/README.md).
- **`mcp/oci/`**: standalone MCP server (`tuk-mcp`, stdio and Streamable HTTP). See [`mcp/oci/README.md`](mcp/oci/README.md).
  `mcp/chart/` holds its Kubernetes manifests.
- **`voice-agent/`**: Python LiveKit Cloud worker, with manual text simulations. See [`voice-agent/README.md`](voice-agent/README.md).
- **`mise.toml`**: single dev interface. Provisions tools (python, node, uv,
  git-cliff) and defines every task (`mise tasks`).
- **`docker-compose.yml`**: runs both dev servers in containers with bind
  mounts and hot reload. `docker-compose.prod.yml` is the self-host stack.
- **`.github/workflows/`**: CI for backend, frontend, CLI, shared, MCP, and pre-commit checks,
  plus Dependabot and PR / issue templates.
- **`.pre-commit-config.yaml`**: multi-language hooks (ruff, mypy, eslint,
  prettier, hygiene checks, conventional commits) wired for both stacks.

## Prerequisites

- [mise](https://mise.jdx.dev/): provisions all language tooling
- [Docker](https://docs.docker.com/) with Compose v2: runs the dev servers

## Quickstart

```bash
# 1. Copy env defaults
cp .env.example .env

# 2. Set the master key — the backend refuses to start without APP_MASTER_KEY
openssl rand -base64 32   # paste the result as APP_MASTER_KEY in .env

# 3. Provision tools (python, node, uv, git-cliff)
mise install

# 4. Install dependencies + git hooks
mise run setup

# 5. Run backend + frontend in Docker with hot reload
mise run dev
```

Then open:

- Frontend: http://localhost:5900. A fresh database boots straight into a
  one-time setup screen where you choose a password (see
  [Authentication](#authentication)).
- API: http://localhost:8900 (interactive docs at `/docs`, health at
  `/health`). Everything except `/health` requires a session, so `/docs` is
  reachable only from a browser that has already logged in through the
  frontend.

## Development

Dev servers run in Docker (source bind-mounted, hot reload on both sides).
Install, lint, and test run natively via mise-provisioned uv/npm.

| Task                     | Command                       |
| ------------------------ | ----------------------------- |
| Install dependencies     | `mise run install`            |
| Install deps + git hooks | `mise run setup`              |
| Run backend + frontend   | `mise run dev`                |
| Run backend only         | `mise run backend:dev`        |
| Run frontend only        | `mise run frontend:dev`       |
| Stop all services        | `mise run down`               |
| Lint all                 | `mise run lint`               |
| Test all                 | `mise run test`               |
| Fix backend lint/format  | `mise run backend:lint:fix`   |
| Format frontend          | `mise run frontend:format`    |
| Tag a release            | `mise run release:tag <bump>` |

Run `mise tasks` for the full list. Dependency changes are picked up
automatically: `mise run dev` rebuilds images (`--build`) and re-seeds the
frontend `node_modules` volume (`--renew-anon-volumes`).

### Frontend stylesheets

`frontend/oci/src/main.tsx` imports `index.css` before components. That entry
stylesheet declares the cascade order **once**:
`@layer tokens, base, components, overrides;`. Keep it first: layer order is
fixed by the first declaration, not by selector specificity.

- `tokens.css` is imported with `layer(tokens)`; both light and dark tokens
  stay together. `base.css` is imported with `layer(base)` for global resets.
- A component owns a sibling `ComponentName.css` and imports it with
  `import "./ComponentName.css";`. Wrap its rules in `@layer components { … }`,
  including media queries, states and reduced-motion rules. Copy
  `components/ToastStack.tsx` / `ToastStack.css` as the worked example.
- Keep existing selectors and token references when moving styles. Shared
  styles belong to their shared primitive, not duplicated across consumers.
- `overrides` is reserved for deliberate cross-component overrides. Do not
  redeclare the layer-order list in individual files.
- `index.css` contains only layer declarations and imports. Shared native
  controls, button variants and utility classes live in `primitives.css`,
  imported by that entry in `components`. No unlayered application rules.
- Shell styles live in `App.css`; authentication styles in `AuthGate.css`.
  Self-hosted `fonts.css` loads directly from `main.tsx` after `index.css`.

CSS-source guard tests read owning stylesheets through
`frontend/oci/src/test/stylesheets.ts` and read `tokens.css` separately (jsdom
has no layout). When moving rules those tests assert, update their input files to
include the owning stylesheet; do not remove the assertions. Run the full
frontend tests, lint, typecheck and build after each migration.

## Authentication

One instance serves several Users, each with their own username, email and
password ([ADR 0018](docs/adr/0018-multi-user-row-level-isolation.md)). There
is no signup: the first Admin is created by first-run setup, and Admins create
everyone else. Passwords live on `users.password_hash`; the session signing
key lives in the single-row `settings` table, managed by the app itself rather
than `.env` ([ADR 0008](docs/adr/0008-ui-managed-settings.md)).

### How it works

- **First run.** A fresh database has no Users. Every route other than
  `/health`, `/api/v1/auth/login`, `/api/v1/auth/setup` and the MCP token
  exchange responds
  `401 setup_required` until someone can log in, and the frontend shows a
  one-time setup screen instead of the login screen.
  `POST /api/v1/auth/setup` takes `{"username", "email", "password"}`,
  creates the first Admin and logs them in; it 404s once a User can log in,
  so it is not a way to reset a forgotten password (see
  [Security → Forgotten password](docs/self-hosting/security.md#forgotten-password)).
- **Login.** `POST /api/v1/auth/login` takes `{"login": "…", "password": "…"}`,
  where `login` is a username or an email, either ignoring case. A wrong
  password and an unknown login get the same `401 invalid_credentials`; a
  disabled User with the right password gets `403 account_disabled`. On
  success it sets a signed `tuktuk_session` cookie (`HttpOnly`,
  `SameSite=Lax`, `Secure` per `AUTH_COOKIE_SECURE`). Nothing is stored
  server-side: the cookie carries the User's id, their `session_epoch` and
  its own issued-at time, signed with the session key `settings` generated
  for itself on first boot.
- **Enforcement.** `SessionAuthMiddleware` runs in front of routing, loads
  the cookie's User on every request and rejects the request with `401`
  when there is no valid cookie (`unauthorized`), the User is disabled
  (`account_disabled`), or the cookie's epoch is not the User's current one
  (`unauthorized`). Only `/health`, `/api/v1/auth/login`, and
  `/api/v1/auth/setup` are public, plus `/api/v1/auth/mcp/exchange`, which
  the route itself gates with the MCP service key (issue #525). Every other
  path, including `/docs` and the OpenAPI schema, is gated by default.
- **Forced steps.** A User with a temporary password (`must_change_password`)
  or an unfinished profile (`must_complete_profile`, the upgraded user #1)
  can reach only `GET /api/v1/auth/me`, `POST /api/v1/auth/complete` and
  `POST /api/v1/auth/logout`. Everything else answers `403
  password_change_required` or `403 profile_completion_required`.
  `/auth/complete` takes `{"new_password"}`, plus `username` and `email` for
  a profile; the new password must differ from the current one.
- **Rolling window.** Sessions last `AUTH_SESSION_LIFETIME_DAYS` (30). Once a
  session is older than `AUTH_SESSION_REISSUE_THRESHOLD_DAYS` (1), the next
  request refreshes the cookie, so an active browser stays logged in
  indefinitely and an idle one lapses after 30 days.
- **Failed attempts.** Each User has their own lockout: after 5 consecutive
  failures (login, or change-password's current-password check) login locks
  for a delay that doubles per further failure (from
  `AUTH_LOGIN_DELAY_SECONDS`, capped at 30s) and resets on success.
- **Logout and revocation.** `POST /api/v1/auth/logout` deletes this
  device's cookie. Changing a password (`POST /api/v1/auth/password`, or
  completing a forced step) bumps the User's `session_epoch`, which logs out
  every other session of that User and nobody else's. Rotating the session
  key in `settings` logs out every User, so it is an operator action.
- **`AUTH_DISABLED` (local development only).** No cookie is needed and every
  request acts as the first Admin, with no forced steps. A database with no
  User still needs `/setup` once. The app refuses to start with it unless
  `APP_ENV=development`; any other or missing `APP_ENV` counts as production.
- **Frontend.** `AuthGate` wraps `App`: it probes `GET /api/v1/auth/session`
  on mount, shows the setup screen or the login screen depending on which the
  probe reports, and drops back to the login screen if any later request
  returns `401`.

### `APP_MASTER_KEY`

The one secret that still lives outside the database, generated once at
deploy time. It encrypts the sensitive columns of `settings` (the Google
client secret, AI API keys) and stored Google refresh tokens. It never appears
in the UI or in any API response: a copy of the database discloses nothing
it protects without it. The password hash needs no such protection, because
Argon2id is one-way.

The app refuses to start without `APP_MASTER_KEY` set.

### Pre-v2 env import

If `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `ASSIST_*` are still set in
`.env`, the first User created (by `/setup`, or by the import below) starts
with them in their own settings. If `AUTH_PASSWORD_HASH` is set while no User
can log in yet, it becomes user #1's password (creating user #1, username
`admin`, if the database has none) and the setup screen is skipped; that User
completes their profile on first login. Each import happens at most once;
after that, the database is authoritative. `mise run backend:hash-password` still
generates an `AUTH_PASSWORD_HASH` value for this path.

### In production

There is no `.env` in the cluster: `APP_MASTER_KEY` lives in the
`tuk-tuk-auth` 1Password item and reaches the backend as a Secret. See
[`backend/chart/README.md`](backend/chart/README.md).

## Database

PostgreSQL only ([ADR 0017](docs/adr/0017-postgres-only-tests-on-testcontainers.md);
background in [ADR 0013](docs/adr/0013-optional-external-postgres.md)).
`DATABASE_URL` is required. `docker compose up` brings its own `postgres`
service, and the backend tests start a throwaway one through testcontainers,
so Docker is the only prerequisite for either.

**Do not run more than one backend replica.** The login throttle counts
consecutive failures in process memory, so N replicas weaken brute-force
protection roughly N-fold with no error surfaced. Migrations also run on every
boot with no advisory lock, and the Inbox seed is an unguarded read-then-insert.

## Command-line client

`tuk` works your tasks from a terminal. See
[`cli/oci/README.md`](cli/oci/README.md); non-browser client decisions live in
[ADR 0014](docs/adr/0014-non-browser-clients-credential-write-boundary.md).

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
├── shared/oci/             # `tuk-core` shared client package
├── cli/oci/                # `tuk` terminal client
├── mcp/
│   ├── oci/                # `tuk-mcp` server (stdio + HTTP; the image)
│   └── chart/              # Kubernetes manifests (Kustomize + Flux)
├── voice-agent/            # LiveKit Cloud agent and hand-run simulations
├── docs/                   # User guide, self-hosting, ADRs
├── .github/
│   ├── workflows/          # CI pipelines (backend, frontend, cli, shared, mcp) + release
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS
│   └── dependabot.yml
├── .pre-commit-config.yaml
├── docker-compose.yml      # dev
├── docker-compose.prod.yml # self-host
├── mise.toml
└── .env.example
```
