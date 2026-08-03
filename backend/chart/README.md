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
| `gitrepository.yaml`                        | GitRepository                 | Flux source used by image automation                                                  |
| `imagerepository.yaml` / `imagepolicy.yaml` | ImageRepository / ImagePolicy | Scans GHCR for new semver backend images                                              |
| `imageupdateautomation.yaml`                | ImageUpdateAutomation         | Commits image bumps back to `main` (covers both charts)                               |
| `deployment.yaml`                           | Deployment                    | Runs `ghcr.io/piwero/tuk-tuk/backend`                                                 |
| `service.yaml`                              | Service                       | ClusterIP on port 8900, referenced by the frontend nginx proxy                        |
| `tailscale-ingress.yaml`                    | Ingress                       | Exposes the API on the tailnet as `tuk-tuk-backend`                                   |

## Notes

- **No init containers.** The app runs Alembic migrations itself at startup, and
  SQLite means there is no database service to wait for — the DB is a file on
  the PVC (`/data/tuk_tuk.db`).
- **Single replica, `Recreate` strategy.** The SQLite volume is `ReadWriteOnce`
  and the app is single-writer; the old pod must release the volume before the
  new one starts. Don't scale this deployment.
- **`local-path` storage class, not the cluster default (`synology-nfs`).**
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
`homelab-supernova` vault before applying this chart, with two fields:

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

## Deploy

```bash
kubectl apply -k backend/chart
```

## Customise

Edit `configmap.yaml` to change the log level, CORS origins, or database
location, then re-apply. If you change the PVC mount path, keep `DATABASE_URL`
in sync.
