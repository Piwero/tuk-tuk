# Backend – Kubernetes manifests

Kustomize chart for the FastAPI backend. Targets the `tuk-tuk` namespace.

## Resources

| File                                        | Kind                          | Purpose                                                                               |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `namespace.yaml`                            | Namespace                     | Creates the `tuk-tuk` namespace                                                       |
| `configmap.yaml`                            | ConfigMap                     | Runtime config (`BACKEND_LOG_LEVEL`, `CORS_ORIGINS`, `DATABASE_URL`)                  |
| `pvc.yaml`                                  | PersistentVolumeClaim         | Persistent volume for the SQLite database file (ADR 0004)                             |
| `ghcr-onepassworditem.yaml`                 | OnePasswordItem               | Syncs the GHCR image-pull secret (`tuk-tuk-ghcr`)                                     |
| `git-onepassworditem.yaml`                  | OnePasswordItem               | Syncs Git credentials for Flux image automation (`tuk-tuk-git-auth`)                  |
| `auth-onepassworditem.yaml`                 | OnePasswordItem               | Syncs the backend auth secrets — session signing key + password hash (`tuk-tuk-auth`) |
| `google-onepassworditem.yaml`               | OnePasswordItem               | Syncs the Google Calendar integration's secrets, if enabled (`tuk-tuk-google`)        |
| `db-onepassworditem.yaml`                   | OnePasswordItem               | Syncs the external PostgreSQL `DATABASE_URL`, if used (`tuk-tuk-db`) — ADR 0013       |
| `copy-db-job.yaml`                          | Job                           | One-off SQLite → PostgreSQL copy. **Not in `kustomization.yaml`** — applied by hand   |
| `gitrepository.yaml`                        | GitRepository                 | Flux source used by image automation                                                  |
| `imagerepository.yaml` / `imagepolicy.yaml` | ImageRepository / ImagePolicy | Scans GHCR for new semver backend images                                              |
| `imageupdateautomation.yaml`                | ImageUpdateAutomation         | Commits image bumps back to `main` (covers both charts)                               |
| `deployment.yaml`                           | Deployment                    | Runs `ghcr.io/piwero/tuk-tuk/backend`                                                 |
| `service.yaml`                              | Service                       | ClusterIP on port 8900, referenced by the frontend nginx proxy                        |
| `tailscale-ingress.yaml`                    | Ingress                       | Exposes the API on the tailnet as `tuk-tuk-backend`                                   |

## Notes

- **No init containers.** The app runs Alembic migrations itself at startup.
  On SQLite there is no database service to wait for — the DB is a file on the
  PVC (`/data/tuk_tuk.db`). On PostgreSQL there still isn't anything to wait
  for: the app fails fast and names the unreachable host, and Kubernetes
  provides the restart backoff.
- **Single replica, `Recreate` strategy.** The SQLite volume is `ReadWriteOnce`
  and the app is single-writer; the old pod must release the volume before the
  new one starts. Don't scale this deployment — and note that moving to
  PostgreSQL does *not* lift that restriction (see "Moving to PostgreSQL").
- **`<YOUR_STORAGE_CLASS>` storage class, not the cluster default (`<YOUR_DEFAULT_STORAGE_CLASS>`).**
  SQLite over NFS risks corruption (unreliable locking; WAL doesn't work over
  NFS), so the database lives on node-local disk. The pod is pinned to the
  volume's node, and deleting the PVC deletes the data — back up the SQLite
  file if it matters.
- **Auth secrets are provisioned ahead of the app that reads them.** The
  `tuk-tuk-auth` Secret (session signing key + password hash) is wired into
  the Deployment via `envFrom.secretRef` before anything in the backend
  actually consumes it — deliberately, so the config is already reconciled
  once a fail-closed image rolls out. With `replicas: 1` and `Recreate`, a
  missing secret at that point would be a crash-loop with no old pod left
  serving traffic. The signing key must be a long random value generated once
  and stored in 1Password — never generated at container start, since image
  automation restarts the pod on every release and a per-boot key would log
  every device out several times a week.

## Prerequisites

- [1Password Operator](https://developer.1password.com/docs/k8s/k8s-operator/) installed in the cluster.
- Flux with the image-reflector and image-automation controllers.
- Tailscale operator (for the ingress).
- At least one published image (tag a release, e.g. `v0.1.0`) so the pinned
  image in `deployment.yaml` exists before Flux takes over bumping it.

The referenced 1Password items are the same ones piwero-web uses (GHCR
classic PAT with `read:packages`; `github-auth-repos` fine-grained PAT, which
must also have `contents:write` on `Piwero/tuk-tuk` for image-bump pushes).

`tuk-tuk-auth` is new and namespace-specific — create it manually in the
`<YOUR_1PASSWORD_VAULT_NAME>` vault before applying this chart, with two fields:

| Field                | Value                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `SECRET_KEY`         | A long random value generated once, e.g. `openssl rand -base64 32`. This becomes the session signing key. |
| `AUTH_PASSWORD_HASH` | The Argon2id hash from `mise run backend:hash-password` (see ADR 0005 / #82).                             |

The operator syncs these field labels directly as Secret keys, matching the
env vars the backend actually reads (`app.config.Settings`). If your
`tuk-tuk-auth` 1Password item still has a field named `ADMIN_PASSWORD_HASH`
from before the auth gate landed, rename it to `AUTH_PASSWORD_HASH` — the app
looks for that name and won't start without it.

### `AUTH_PASSWORD_HASH` holds the hash, never the password

Generate it on your own machine and paste the whole PHC string in:

```bash
mise run backend:hash-password
# $argon2id$v=19$m=262144,t=5,p=4$AepMAozS5KvKlHtxaL8Sug$mrCRTos1ZEHV3NH…
```

The backend only ever compares against a hash — `password_hasher.verify()`
needs a parseable PHC string on the stored side. A plaintext password in this
field doesn't fail as a wrong password: it raises `InvalidHashError`, so
**every** login returns `500` rather than a clean `401`.

When pasting:

- **No quotes and no escaping** — the `$` separators are part of the value.
  The operator copies the field verbatim into the Secret and Kubernetes
  injects it as-is; nothing interpolates it here (unlike Compose locally,
  which is why `docker-compose.yml` needs `format: raw`).
- **Strip any trailing newline or wrapped whitespace** picked up when copying
  from a terminal. That's the likeliest way to corrupt an otherwise good hash.
- The hash is one-way, but still belongs in the vault — anyone holding it can
  attack it offline.

To keep the plaintext for your own recall, put it in the **same item under a
different field name** (1Password's built-in `password` field is fine). Any
field named `AUTH_PASSWORD_HASH` becomes that env var, so only the hash may
use that name.

Both values are checked at startup and fail closed, and `deployment.yaml` uses
`strategy: Recreate` for the ReadWriteOnce PVC — so a missing or malformed
field crash-loops the new pod with no old one left serving traffic. Verify
after deploying:

```bash
kubectl -n tuk-tuk exec deploy/backend -- printenv AUTH_PASSWORD_HASH
```

It should begin `$argon2id$v=19$m=…`. Missing `$` separators or a plaintext
value is the `500` waiting to happen.

## Google Calendar integration (optional)

Unlike `tuk-tuk-auth`, `tuk-tuk-google` is genuinely optional (issue
#103/#105; ADR 0006): the Deployment's `secretRef` for it sets
`optional: true`, so the backend starts and runs normally — with the Google
Calendar section and wording absent everywhere — whether or not this Secret,
or the `tuk-tuk-google` 1Password item behind it, exists at all. There is
nothing to do here unless you actually want the integration enabled in the
cluster.

As of ADR 0008 (issue #117), this Secret is migration-only: Google
credentials live in the DB-backed `settings` table and are entered and
edited from the app's own Settings screen, not provisioned here. Populating
`tuk-tuk-google` only matters for carrying an existing Google connection
through the upgrade to ADR 0008 — a deployment that's already past that
upgrade (or starting fresh) never needs this Secret at all; use Settings
instead.

To carry an existing connection through the upgrade, create a `tuk-tuk-google`
item in the `<YOUR_1PASSWORD_VAULT_NAME>` vault (same vault as `tuk-tuk-auth`) with two
fields, **before** the first post-upgrade boot:

| Field                  | Value                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | From a Google Cloud OAuth client, with an exact redirect URI registered for the cluster's origin, and publishing status "In production" (unverified-app refresh tokens expire after 7 days). |
| `GOOGLE_CLIENT_SECRET` | The matching OAuth client secret.                                                                                                                                                            |

The operator syncs these field labels directly as Secret keys — the names
must match `app.config.Settings` exactly (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`), no quotes or trailing whitespace. The former third
field, `GOOGLE_ENCRYPTION_KEY`, is retired: stored Google refresh
credentials are now encrypted with `APP_MASTER_KEY` (the `tuk-tuk-auth`
item), the same key that protects the rest of the `settings` table.

Once imported on that first boot, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
are never read from this Secret again — rotate or remove Google credentials
from Settings afterward, not by editing `tuk-tuk-google`.

Apply the item, then restart the pod to pick it up (`optional: true` means an
existing pod won't be restarted automatically just because the Secret
appeared):

```bash
kubectl -n tuk-tuk rollout restart deployment/backend
```

## Moving to PostgreSQL

Optional, and off by default. SQLite on the PVC stays fully supported — this
section only matters if you'd rather your own PostgreSQL server handled the
backups. See [ADR 0013](../../docs/adr/0013-optional-external-postgres.md) for
why the connection lives in the environment rather than in Settings.

### Before you start: what happens to your data

**Nothing is deleted, and you can go back.** The copy reads the SQLite file
and writes to PostgreSQL. The file is never modified, never moved, and stays
on the PVC exactly as it was — it becomes a point-in-time backup from the
moment you scaled the app down. Reverting is removing one field and
restarting; the app finds the file untouched and picks up where it left off.

Three things make that guarantee weaker, all of them things you have to ask
for explicitly:

- **`--prune-orphans` writes to the source.** It deletes rows from the SQLite
  file. It is the only operation in this whole process that touches your
  original data, and it is not passed by default. Every row it deletes is
  named in the report — read them before agreeing.
- **`--force` deletes every row in the PostgreSQL target** before copying. It
  exists so a failed attempt can be retried, not to merge two datasets. It
  cannot touch SQLite.
- **Deleting the PVC deletes the file.** `<YOUR_STORAGE_CLASS>`'s reclaim policy is
  `Delete`, so the fallback only exists as long as the PVC does. Keep it
  until you're confident, and take a copy of the file if it matters.

Everything you'd worry about losing comes across: Lists, Tasks, Folders,
Sections, Tags, Check Items, Habits, Check-ins, Goals, Key Results, Focus
Sessions, Timers, Stand-up entries, and Google account connections, with ids
and relationships preserved exactly. You stay logged in, and connected Google
accounts stay connected.

The catch is that **going back only returns you to the moment you switched.**
There is no tool to copy PostgreSQL to SQLite. Anything you add after the
cutover exists only in PostgreSQL, so reverting a week later loses that week.
Revert quickly if you're going to revert at all.

### One-time setup

Create a `tuk-tuk-db` item in the `<YOUR_1PASSWORD_VAULT_NAME>` vault (same vault as
`tuk-tuk-auth`) with one field:

| Field          | Value                                                     |
| -------------- | --------------------------------------------------------- |
| `DATABASE_URL` | `postgresql+psycopg://user:password@host:5432/tuk_tuk` |

The `+psycopg` suffix is required — `app.db` accepts only the `postgresql`
and `postgresql+psycopg` schemes, and psycopg3 drives both the async app and
sync Alembic from this one string. No quotes, no trailing whitespace; the
operator copies the field verbatim.

Creating this item does **not** switch anything. The Deployment loads it via
`secretRef` with `optional: true`, and env vars are only read at boot, so
nothing changes until a pod restarts. It's safe to create it and then stop.

The reason this works as a switch at all is ordering: `envFrom` applies its
sources in sequence and later ones win, and `tuk-tuk-db` is listed after
`backend-config`. So `DATABASE_URL` here overrides the SQLite default in
`configmap.yaml`. **Don't edit the ConfigMap** — leaving it pinned at the
SQLite path is what keeps the copy job's source URL correct and makes
reverting a one-field deletion.

### Cutover

Read this through before starting. Step 4 is the point of no easy return,
and steps 2–3 are where you find out whether it'll work.

1. **Test the connection from the running app.** Settings → Database → Test
   connection. It reports whether the host is reachable, whether the
   credentials work, the server version, and whether the target database is
   empty. It saves nothing and switches nothing — the URL you paste is
   discarded when the probe finishes. Do this before touching anything
   running; a typo or a firewall rule is much cheaper to find here.

2. **Scale the backend to zero** so nothing writes to the SQLite file while
   it's being copied:

   ```bash
   kubectl -n tuk-tuk scale deployment/backend --replicas=0
   kubectl -n tuk-tuk get pods -w
   ```

   Wait for the pod to fully terminate. The PVC is `ReadWriteOnce`, so the
   copy Job will sit `Pending` until the volume is released — that's the
   safety net, not a problem to work around.

3. **Run the copy and read the report:**

   ```bash
   kubectl -n tuk-tuk apply -f backend/chart/copy-db-job.yaml
   kubectl -n tuk-tuk logs -f job/copy-db
   ```

   It migrates the empty target to head automatically, copies every table in
   foreign-key order preserving ids, reseeds the PostgreSQL sequences, then
   verifies its own work by comparing per-table row counts and maximum ids.
   The output ends in `SUCCESS` or `FAILURE`.

   **If it refuses, stop and read why.** Two refusals are expected and both
   are deliberate:

   - *Orphaned rows in the source.* Rows pointing at rows that no longer
     exist. PostgreSQL enforces foreign keys and SQLite didn't, so they
     cannot be inserted. The tool lists them by table and id. To delete
     them, `kubectl -n tuk-tuk delete job copy-db`, add `--prune-orphans`
     to the `args` in `copy-db-job.yaml`, and re-apply. This modifies your
     SQLite file — it's the one step that does.
   - *Target already has data.* Something is already in that PostgreSQL
     database. If it's a previous failed attempt, add `--force` the same
     way; it deletes every row in the target first. If it's something
     else, use a different database.

   Do not proceed to step 4 on anything but `SUCCESS`.

4. **Scale back up.** The pod re-reads its environment and now boots against
   PostgreSQL:

   ```bash
   kubectl -n tuk-tuk scale deployment/backend --replicas=1
   kubectl -n tuk-tuk logs -f deployment/backend
   ```

   If PostgreSQL is unreachable the app refuses to start and names the host
   it couldn't reach. It never silently falls back to the SQLite file —
   that would serve stale data and accept writes into a database you'd
   stopped looking at.

5. **Verify before trusting it.** Settings → Database should now report
   PostgreSQL with your host and database name. Check your Lists, Tasks,
   Habits, and Goals are all there, and that any connected Google account
   still shows as connected. Then **create one new Task** — that's the check
   that the sequence reseed worked, and it's the failure you'd otherwise
   hit at the worst moment.

6. **Clean up the Job** once you're satisfied:

   ```bash
   kubectl -n tuk-tuk delete job copy-db
   ```

Leave the PVC alone. It's your rollback.

### Reverting

Remove the `DATABASE_URL` field from the `tuk-tuk-db` 1Password item (or
delete the item), let the operator sync, then restart:

```bash
kubectl -n tuk-tuk rollout restart deployment/backend
```

With the override gone, `backend-config`'s SQLite URL applies again and the
app boots against the untouched file. Confirm in Settings → Database.

Remember what this costs: the file is current as of the moment you scaled
down in step 2, so anything created in PostgreSQL after the cutover is not
in it. There's no tool to copy back.

### Don't scale beyond one replica

Moving off the PVC makes horizontal scaling look available. It isn't
supported, and the worst failure is silent: the login throttle counts
consecutive failures in process memory, so N replicas behind a round-robin
balancer weaken brute-force protection roughly N-fold with no error
anywhere. Migrations also run on every boot of every replica with no
advisory lock, and the Inbox seed is an unguarded read-then-insert with no
unique constraint behind it. ADR 0013 records this as an explicit "no".

## Deploy

```bash
kubectl apply -k backend/chart
```

`copy-db-job.yaml` is deliberately not in `kustomization.yaml`, so neither
this command nor Flux applies it. A Job is a one-shot and Flux reconciles
continuously; a re-applied copy would run against what is by then the live
database. Apply it by hand, once, as part of the cutover above.

## Customise

Edit `configmap.yaml` to change the log level or CORS origins, then
re-apply. If you change the PVC mount path, keep `DATABASE_URL` in sync. To
change the *database* itself, don't edit the ConfigMap — see "Moving to
PostgreSQL" above.
