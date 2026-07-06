# Backend – Kubernetes manifests

Kustomize chart for the FastAPI backend. Targets the `tuk-tuk` namespace.

## Resources

| File | Kind | Purpose |
|---|---|---|
| `namespace.yaml` | Namespace | Creates the `tuk-tuk` namespace |
| `configmap.yaml` | ConfigMap | Runtime config (`BACKEND_LOG_LEVEL`, `CORS_ORIGINS`, `DATABASE_URL`) |
| `pvc.yaml` | PersistentVolumeClaim | Persistent volume for the SQLite database file (ADR 0004) |
| `ghcr-onepassworditem.yaml` | OnePasswordItem | Syncs the GHCR image-pull secret (`tuk-tuk-ghcr`) |
| `git-onepassworditem.yaml` | OnePasswordItem | Syncs Git credentials for Flux image automation (`tuk-tuk-git-auth`) |
| `gitrepository.yaml` | GitRepository | Flux source used by image automation |
| `imagerepository.yaml` / `imagepolicy.yaml` | ImageRepository / ImagePolicy | Scans GHCR for new semver backend images |
| `imageupdateautomation.yaml` | ImageUpdateAutomation | Commits image bumps back to `main` (covers both charts) |
| `deployment.yaml` | Deployment | Runs `ghcr.io/piwero/tuk-tuk/backend` |
| `service.yaml` | Service | ClusterIP on port 8000, referenced by the frontend nginx proxy |
| `tailscale-ingress.yaml` | Ingress | Exposes the API on the tailnet as `tuk-tuk-backend` |

## Notes

- **No init containers.** The app runs Alembic migrations itself at startup, and
  SQLite means there is no database service to wait for — the DB is a file on
  the PVC (`/data/tuk_tuk.db`).
- **Single replica, `Recreate` strategy.** The SQLite volume is `ReadWriteOnce`
  and the app is single-writer; the old pod must release the volume before the
  new one starts. Don't scale this deployment.

## Prerequisites

- [1Password Operator](https://developer.1password.com/docs/k8s/k8s-operator/) installed in the cluster.
- Flux with the image-reflector and image-automation controllers.
- Tailscale operator (for the ingress).
- At least one published image (tag a release, e.g. `v0.1.0`) so the pinned
  image in `deployment.yaml` exists before Flux takes over bumping it.

The referenced 1Password items are the same ones piwero-web uses (GHCR
classic PAT with `read:packages`; `github-auth-repos` fine-grained PAT, which
must also have `contents:write` on `Piwero/tuk-tuk` for image-bump pushes).

## Deploy

```bash
kubectl apply -k backend/chart
```

## Customise

Edit `configmap.yaml` to change the log level, CORS origins, or database
location, then re-apply. If you change the PVC mount path, keep `DATABASE_URL`
in sync.
