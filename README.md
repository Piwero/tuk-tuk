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

- Frontend: http://localhost:5900 — a fresh database boots straight into a
  one-time setup screen where you choose a password (see
  [Authentication](#authentication))
- API: http://localhost:8900 (interactive docs at `/docs`, health at
  `/health`). Everything except `/health` requires a session, so `/docs` is
  reachable only from a browser that has already logged in through the
  frontend.

## Authentication

tuk-tuk is a single-user app gated by one shared password
([ADR 0005](docs/adr/0005-single-user-authentication-gate.md)). There are no
accounts, no signup, and no user records — the password hash and the session
signing key live in a single-row `settings` table in the database, managed
entirely from the app itself rather than `.env`
([ADR 0008](docs/adr/0008-ui-managed-settings.md)).

### How it works

- **First run.** A fresh database has no password set yet. Every route other
  than `/health`, `/api/v1/auth/login`, and `/api/v1/auth/setup` responds
  `401 setup_required` until one exists, and the frontend shows a one-time
  setup screen instead of the login screen. `POST /api/v1/auth/setup` sets
  the password and logs you in; it 404s once a password already exists — it
  is not a way to reset a forgotten one.
- **Login.** `POST /api/v1/auth/login` takes `{"password": "…"}` and verifies
  it against the Argon2id hash stored in `settings`. On success it sets a
  signed `tuktuk_session` cookie (`HttpOnly`, `SameSite=Lax`,
  `Secure` per `AUTH_COOKIE_SECURE`). Nothing else is stored server-side: the
  cookie carries its own issued-at time, signed with the session key
  `settings` generated for itself on first boot.
- **Enforcement.** `SessionAuthMiddleware` runs in front of routing and
  rejects any request without a valid cookie with `401`. Only `/health`,
  `/api/v1/auth/login`, and `/api/v1/auth/setup` are public — every other
  path, including `/docs` and the OpenAPI schema, is gated by default.
- **Rolling window.** Sessions last `AUTH_SESSION_LIFETIME_DAYS` (30). Once a
  session is older than `AUTH_SESSION_REISSUE_THRESHOLD_DAYS` (1), the next
  request refreshes the cookie, so an active browser stays logged in
  indefinitely and an idle one lapses after 30 days.
- **Failed attempts.** A global delay doubles per consecutive failure
  (from `AUTH_LOGIN_DELAY_SECONDS`, capped at 30s) and resets on success.
  Expect wrong-password responses to get progressively slower during local
  testing.
- **Logout.** `POST /api/v1/auth/logout` deletes the cookie. There is no
  server-side session to revoke; revoking every device at once means
  changing the password from Settings, which rotates the session key.
- **Frontend.** `AuthGate` wraps `App`: it probes `GET /api/v1/auth/session`
  on mount, shows the setup screen or the login screen depending on which the
  probe reports, and drops back to the login screen if any later request
  returns `401`.

### `APP_MASTER_KEY`

The one secret that still lives outside the database — generated once at
deploy time, the same way `SECRET_KEY` was before this change. It encrypts
the sensitive columns of `settings` (the Google client secret, once issue
#117 lands) and stored Google refresh tokens. It never appears in the UI or
in any API response: a copy of the SQLite file discloses nothing it protects
without it. The password hash needs no such protection — Argon2id is
one-way, so storing it in the database reveals nothing an attacker could use
directly.

The app refuses to start without `APP_MASTER_KEY` set.

### Upgrading an existing deployment

If `AUTH_PASSWORD_HASH` (and, if you'd connected Google Calendar,
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) are still set in your `.env` from
before this change, the first boot after upgrading imports them into
`settings` automatically and skips the setup screen — you won't be logged
out or lose your Google connection. This happens at most once: after that
first boot, `settings` is authoritative and those env vars are never read
again, even if you leave them in `.env`. `mise run backend:hash-password`
still generates an `AUTH_PASSWORD_HASH` value for this path, if you want one.

### In production

There is no `.env` in the cluster: `APP_MASTER_KEY` lives in the
`tuk-tuk-auth` 1Password item and reaches the backend as a Secret — see
[`backend/chart/README.md`](backend/chart/README.md).

## Moving to PostgreSQL

Moving from the default SQLite file to PostgreSQL is one-way: the SQLite
file is left untouched as a point-in-time backup, but there's no tool to
copy the other direction.

1. **Test the connection.** Confirm your PostgreSQL `DATABASE_URL` is
   reachable before touching anything running.
2. **Stop the application** so nothing writes to the SQLite file while it's
   being copied.
3. **Run the copy**:

   ```sh
   mise run backend:copy-db -- sqlite:///path/to/tuk-tuk.db postgresql+psycopg://user:pass@host/db
   ```

   The tool refuses to proceed if it finds orphaned rows in the source
   (add `--prune-orphans` to delete them explicitly — this also deletes
   rows orphaned by those deletions, and every id it deletes is listed in
   the report) or if the target already has data. `--force` **deletes
   every row in the target** and replaces it with the source; it exists so
   a failed attempt can be retried, not to merge two datasets. An empty
   target is migrated to head automatically. The tool reports per-table row
   counts and confirms the copy before exiting.
4. **Set `DATABASE_URL`** to the PostgreSQL URL used above and **restart**
   the application.
5. **Verify**: log in, confirm your Lists/Tasks/Habits/Goals are all
   present, and that any connected Google account still shows as
   connected, and create one new Task — that last one is the check that
   the PostgreSQL sequence reseed worked.

**On Kubernetes, follow
[`backend/chart/README.md`](backend/chart/README.md#moving-to-postgresql)
instead.** The same five steps, but the copy runs as a one-off Job against
the PVC rather than a shell, and "set `DATABASE_URL`" is a field on a
1Password item rather than an edit to the ConfigMap. That doc also spells
out what reverting costs.

**Do not run more than one replica.** Moving off the PersistentVolumeClaim
makes horizontal scaling look available; it is not supported, and the worst
failure is silent. The login throttle counts consecutive failures in process
memory, so N replicas behind a round-robin balancer weaken brute-force
protection roughly N-fold with no error surfaced. Migrations also run on
every boot of every replica with no advisory lock, and the Inbox seed is an
unguarded read-then-insert. See
[ADR 0013](docs/adr/0013-optional-external-postgres.md).

## Command-line client

`tuk` works your tasks from a terminal: install once from this repo, log
in once with your app password, then read and capture without opening a
browser. See [`cli/oci/README.md`](cli/oci/README.md) for install and
login; non-browser client decisions live in
[ADR 0014](docs/adr/0014-non-browser-clients-credential-write-boundary.md).

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
