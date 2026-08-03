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

# 2. Set a session signing key — the backend refuses to start while
#    SECRET_KEY is left at the placeholder "change-me"
openssl rand -base64 32   # paste the result as SECRET_KEY in .env

# 3. Provision tools (python, node, uv, git-cliff)
mise install

# 4. Install dependencies + git hooks
mise run setup

# 5. Run backend + frontend in Docker with hot reload
mise run dev
```

Then open:

- Frontend: http://localhost:5900 — unlock with the password `dev-password`
  (the default in `.env.example`; see [Authentication](#authentication))
- API: http://localhost:8900 (interactive docs at `/docs`, health at
  `/health`). Everything except `/health` requires a session, so `/docs` is
  reachable only from a browser that has already logged in through the
  frontend.

## Authentication

tuk-tuk is a single-user app gated by one shared password
([ADR 0005](docs/adr/0005-single-user-authentication-gate.md)) — there are no
accounts, no signup, and no user records.

### How it works

- **Login.** `POST /api/v1/auth/login` takes `{"password": "…"}` and verifies
  it against the Argon2id hash in `AUTH_PASSWORD_HASH`. On success it sets a
  signed `tuktuk_session` cookie (`HttpOnly`, `SameSite=Strict`,
  `Secure` per `AUTH_COOKIE_SECURE`). Nothing is stored server-side: the
  cookie carries its own issued-at time, signed with `SECRET_KEY`.
- **Enforcement.** `SessionAuthMiddleware` runs in front of routing and
  rejects any request without a valid cookie with `401`. Only `/health` and
  the login endpoint are public — every other path, including `/docs` and the
  OpenAPI schema, is gated by default.
- **Rolling window.** Sessions last `AUTH_SESSION_LIFETIME_DAYS` (30). Once a
  session is older than `AUTH_SESSION_REISSUE_THRESHOLD_DAYS` (1), the next
  request refreshes the cookie, so an active browser stays logged in
  indefinitely and an idle one lapses after 30 days.
- **Failed attempts.** A global delay doubles per consecutive failure
  (from `AUTH_LOGIN_DELAY_SECONDS`, capped at 30s) and resets on success.
  Expect wrong-password responses to get progressively slower during local
  testing.
- **Logout.** `POST /api/v1/auth/logout` deletes the cookie. There is no
  server-side session to revoke; revoking every device at once means rotating
  `SECRET_KEY`, which invalidates all outstanding cookies.
- **Frontend.** `AuthGate` wraps `App`: it probes `GET /api/v1/auth/session`
  on mount, shows the password screen when that fails, and drops back to the
  password screen if any later request returns `401`.

### `AUTH_PASSWORD_HASH` vs. `SECRET_KEY`

Both are secrets, but they answer different questions at different moments.
Typing the password checks it against `AUTH_PASSWORD_HASH`; on success the
backend mints a cookie signed with `SECRET_KEY`, and for the next ~30 days
only that signature matters — the password isn't consulted again.

|                            | `AUTH_PASSWORD_HASH`                                                                    | `SECRET_KEY`                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Answers                    | "Is this the right password?"                                                           | "Did _we_ issue this cookie?"                                |
| Used                       | Once, at login                                                                          | On every request                                             |
| Contains                   | An Argon2id hash of the password, deliberately slow (~200ms) to make guessing expensive | Random bytes, used to sign the session cookie                |
| Derived from the password? | Yes                                                                                     | No — unrelated random value                                  |
| Changing it                | Old password stops working; existing cookies stay valid                                 | Every outstanding cookie is invalidated; all devices log out |

Neither substitutes for the other: the hash is one-way and can't sign
anything, and the key knows nothing about the password. Rotating the hash is
the "change my password" lever; rotating the key is the "log everything out"
lever.

### Local setup

The defaults in `.env.example` work out of the box for local dev:

| Variable             | Local default          | Notes                                                |
| -------------------- | ---------------------- | ---------------------------------------------------- |
| `AUTH_PASSWORD_HASH` | hash of `dev-password` | Argon2id hash, never the plaintext                   |
| `SECRET_KEY`         | `change-me`            | **Must be replaced** — the app won't start otherwise |
| `AUTH_COOKIE_SECURE` | `false`                | Allows the cookie over plain-HTTP LAN/tailnet dev    |

### Worked example: setting your own password

Say you want to log in with `ThisIsAPassword12!`.

**1. Hash the password.** The task prompts twice on stdin — never pass the
password as an argument, or it lands in your shell history:

```bash
mise run backend:hash-password
# Password: ThisIsAPassword12!
# Confirm password: ThisIsAPassword12!
# $argon2id$v=19$m=262144,t=5,p=4$LAqzXoCJXzpJEIPnC6copg$tPs0LHku…
```

**2. Generate a signing key** (skip if you already set one):

```bash
openssl rand -base64 32
# FkxEDVctIH4zGFh13EvwA…
```

**3. Paste both into `.env`,** exactly as printed — no quotes, no escaping of
the hash's `$` separators. `docker-compose.yml` loads `.env` with
`format: raw` precisely so those `$` characters survive:

```dotenv
AUTH_PASSWORD_HASH=$argon2id$v=19$m=262144,t=5,p=4$LAqzXoCJXzpJEIPnC6copg$tPs0LHku…
SECRET_KEY=FkxEDVctIH4zGFh13EvwA…
AUTH_COOKIE_SECURE=false
```

**4. Restart** — `.env` is read at startup, not per request:

```bash
mise run down && mise run dev
```

**5. Verify:**

```bash
curl -i -X POST localhost:8900/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"password":"ThisIsAPassword12!"}'
```

`204` with a `set-cookie: tuktuk_session=…` header means both values are wired
up. A `401` means the hash doesn't match the password; a backend that won't
boot means `SECRET_KEY` is still `change-me`.

A `500` means the backend received a malformed hash — check what actually
reached the container, which is not always what's in `.env`:

```bash
docker compose exec backend printenv AUTH_PASSWORD_HASH
```

If the `$` separators are missing, Compose interpolated them away; make sure
the `env_file` entries in `docker-compose.yml` still carry `format: raw`.

The hash and key above are truncated illustrations, never copy them — use
your own command output. Argon2id salts randomly, so hashing the same password
twice gives two different-looking strings and both work.

Two settings are fail-closed at startup — the backend raises on boot if
`AUTH_PASSWORD_HASH` is empty or `SECRET_KEY` is still `change-me`. If the
backend container exits immediately, check its logs for one of those two
messages.

Changing `SECRET_KEY` invalidates the cookie you already have, so you'll be
asked for the password again on the next load.

### In production

There is no `.env` in the cluster: both values live in the `tuk-tuk-auth`
1Password item and reach the backend as a Secret, so the Compose
interpolation caveat above doesn't apply. `AUTH_PASSWORD_HASH` still holds
the hash and never the plaintext password — see
[`backend/chart/README.md`](backend/chart/README.md) for the field names,
pasting rules, and how to verify the value that reached the pod.

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
