# Backend – Kubernetes manifests

Kustomize chart for the FastAPI backend. Targets the `tuk-tuk` namespace.

## Resources

| File                                        | Kind                          | Purpose                                                                               |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `namespace.yaml`                            | Namespace                     | Creates the `tuk-tuk` namespace                                                       |
| `configmap.yaml`                            | ConfigMap                     | Runtime config (`BACKEND_LOG_LEVEL`, `CORS_ORIGINS`)                                  |
| `pvc.yaml`                                  | PersistentVolumeClaim         | Holds the pre-PostgreSQL SQLite file from the cutover; no longer read                 |
| `ghcr-onepassworditem.yaml`                 | OnePasswordItem               | Syncs the GHCR image-pull secret (`tuk-tuk-ghcr`)                                     |
| `git-onepassworditem.yaml`                  | OnePasswordItem               | Syncs Git credentials for Flux image automation (`tuk-tuk-git-auth`)                  |
| `auth-onepassworditem.yaml`                 | OnePasswordItem               | Syncs the backend auth secrets — session signing key + password hash (`tuk-tuk-auth`) |
| `google-onepassworditem.yaml`               | OnePasswordItem               | Syncs the Google Calendar integration's secrets, if enabled (`tuk-tuk-google`)        |
| `sso-onepassworditem.yaml`                  | OnePasswordItem               | Syncs the shared Google client and SMTP for invite-only Google sign-in (`tuk-tuk-sso`) |
| `db-onepassworditem.yaml`                   | OnePasswordItem               | Syncs the PostgreSQL `DATABASE_URL` (`tuk-tuk-db`, required) — ADR 0017               |
| `postgres-egress-service.yaml`              | Service (ExternalName)        | Tailnet egress to `postgres-supernova` as `postgres.tuk-tuk.svc.cluster.local`        |
| `gitrepository.yaml`                        | GitRepository                 | Flux source used by image automation                                                  |
| `imagerepository.yaml` / `imagepolicy.yaml` | ImageRepository / ImagePolicy | Scans GHCR for new semver backend images                                              |
| `imageupdateautomation.yaml`                | ImageUpdateAutomation         | Commits image bumps back to `main` (covers both charts)                               |
| `deployment.yaml`                           | Deployment                    | Runs `ghcr.io/piwero/tuk-tuk/backend`                                                 |
| `service.yaml`                              | Service                       | ClusterIP on port 8900, referenced by the frontend nginx proxy                        |
| `tailscale-ingress.yaml`                    | Ingress                       | Exposes the API on the tailnet as `tuk-tuk-backend`                                   |

## Variables

The manifests reference these as `${VAR}` placeholders rather than literal
values, so this chart stays safe to publish. They aren't substituted by
`kustomize build` — a plain `kubectl apply -k` leaves the literal `${VAR}`
strings in place. Flux fills them in at apply time via
[`postBuild.substituteFrom`](https://fluxcd.io/flux/components/kustomize/kustomizations/#post-build-variable-substitution)
on the `Kustomization` resource that points at this path, reading a
ConfigMap (and/or Secret) supplied by your own cluster-config repo — see that
repo's `tuk-tuk` app for where these are actually set.

| Variable                           | Used for                                                  |
| ----------------------------------- | ---------------------------------------------------------- |
| `TUK_TUK_HOSTNAME`                 | The public hostname, in the IngressRoutes and CORS origins |
| `TUK_TUK_TAILNET_TAGS`              | The Tailscale ingress's `tailscale.com/tags` annotation, full value including the `tag:` prefix(es), e.g. `"tag:foo,tag:bar"` |
| `TUK_TUK_STORAGE_CLASS`             | The PVC's `storageClassName`                                |
| `TUK_TUK_1PASSWORD_VAULT_ID`        | The 1Password vault id behind every `OnePasswordItem` here  |
| `TUK_TUK_1PASSWORD_GHCR_ITEM_ID`    | The item id holding the shared GHCR pull token              |

If you're not using Flux, replace each `${VAR}` with your own value by hand
before applying (or layer a `kustomize` patch/overlay that does), then follow
the rest of this README with your own values in mind wherever it says
"your vault" or "your storage class".

## Notes

- **No init containers.** The app runs Alembic migrations itself at startup.
  There is nothing to wait for: if PostgreSQL is unreachable the app fails
  fast and names the host, and Kubernetes provides the restart backoff.
- **Single replica, `Recreate` strategy.** The app is single-writer (see
  "Don't scale beyond one replica" below), and the leftover PVC is
  `ReadWriteOnce`, so the old pod must release it before the new one starts.
- **The PVC is a leftover.** `backend-data` holds the SQLite file as it was at
  the PostgreSQL cutover (#417). The app no longer reads it, but it stays
  mounted until it is removed on purpose: its reclaim policy is `Delete`, so
  dropping `pvc.yaml` from the kustomization makes Flux delete the file.
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
vault you point `TUK_TUK_1PASSWORD_VAULT_ID` at before applying this chart,
with two fields:

| Field                | Value                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `APP_MASTER_KEY`     | A long random value generated once, e.g. `openssl rand -base64 32`. Encrypts the secrets Users save in Settings. Required to start. |
| `AUTH_PASSWORD_HASH` | The Argon2id hash from `mise run backend:hash-password` (see ADR 0005 / #82).                                                       |

The operator syncs these field labels directly as Secret keys, matching the
env vars the backend actually reads (`app.config.Settings`). If your
`tuk-tuk-auth` 1Password item still has a field named `ADMIN_PASSWORD_HASH`
from before the auth gate landed, rename it to `AUTH_PASSWORD_HASH` — the app
looks for that name and won't start without it. A leftover `SECRET_KEY`
field is unread and can go.

### Never rotate `APP_MASTER_KEY`

Keep the key in `tuk-tuk-auth` unchanged across releases and restores. With
a different key the backend still starts, but none of the secrets Users saved
in Settings (GitHub Tokens among them) can be read any more, and the app does
not flag them for reconnecting: each one has to be entered again by hand.
[Security → The master key](../../docs/self-hosting/security.md#the-master-key)
lists what it covers.

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

## Google sign-in and invitations (optional)

`tuk-tuk-sso` (issue #586, ADR 0021) turns on invite-only Google sign-in,
invitations, and Google Calendar without each User's own Google Cloud
client. Like `tuk-tuk-google`, its `secretRef` is `optional: true`: without
it the app keeps password sign-in only. Create a `tuk-tuk-sso` item in the
same vault as `tuk-tuk-auth` with the fields listed in
`sso-onepassworditem.yaml`, then restart the pod. The field labels must
match `app.config.Settings` exactly (`GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `SMTP_*`).

These are not the migration-only `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
of `tuk-tuk-google`, which only ever seed user #1's own client. Connections
made with a User's own client keep working with it after this is set.

See [the self-hosting guide](../../docs/self-hosting/google-sign-in.md) for
the Google Cloud and SMTP setup, and how to verify both before inviting
anyone.

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
item in the same vault as `tuk-tuk-auth` with two fields, **before** the
first post-upgrade boot:

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

## Database

PostgreSQL only ([ADR 0017](../../docs/adr/0017-postgres-only-tests-on-testcontainers.md)).
Prod uses the shared `postgres-supernova` server on the tailnet, reached
through `postgres-egress-service.yaml` as
`postgres.tuk-tuk.svc.cluster.local:5432`.

`DATABASE_URL` reaches the backend only from the `tuk-tuk-db` Secret, synced
from the 1Password item of the same name, with a single field:

| Field          | Value                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | `postgresql+psycopg://tuk-tuk:<password>@postgres.tuk-tuk.svc.cluster.local:5432/tuk-tuk?sslmode=disable` |

The Secret is required: without it the pod waits with the Secret named.
The app also refuses to start on a non-`postgresql+psycopg://` URL.

To change it, first try the new URL in Settings → Database → Test
connection, which checks it and saves nothing. Then update the item and
restart the backend:

```bash
kubectl -n tuk-tuk rollout restart deployment/backend
```

Backups are `postgres-supernova`'s job, not this chart's.

### Don't scale beyond one replica

Being off the PVC makes horizontal scaling look available. It isn't
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

## Customise

Edit `configmap.yaml` to change the log level or CORS origins, then
re-apply. If you change the PVC mount path, keep `DATABASE_URL` in sync. To
change the *database* itself, don't edit the ConfigMap — see "Moving to
PostgreSQL" above.
