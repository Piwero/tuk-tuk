# Frontend – Kubernetes manifests

Kustomize chart for the React/nginx frontend. Targets the `tuk-tuk` namespace.

## Resources

| File                                        | Kind                          | Purpose                                                  |
| ------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `namespace.yaml`                            | Namespace                     | Creates the `tuk-tuk` namespace                          |
| `configmap.yaml`                            | ConfigMap                     | nginx config mounted at `/etc/nginx/conf.d/default.conf` |
| `imagerepository.yaml` / `imagepolicy.yaml` | ImageRepository / ImagePolicy | Scans GHCR for new semver frontend images                |
| `deployment.yaml`                           | Deployment                    | Runs `ghcr.io/piwero/tuk-tuk/frontend`                   |
| `service.yaml`                              | Service                       | ClusterIP on port 80                                     |
| `tailscale-ingress.yaml`                    | Ingress                       | Exposes the app on the tailnet as `tuk-tuk`              |

No secrets: the frontend is a static bundle behind nginx and needs none. The
image-pull secret (`tuk-tuk-ghcr`), the Flux `GitRepository`, and the
`ImageUpdateAutomation` (which covers this chart's setter marker too) live in
`backend/chart` — deploy the backend chart first.

## nginx proxy

The `nginx.conf` in the ConfigMap proxies `/api/` requests to
`http://backend:8000` — the backend Service in the same `tuk-tuk` namespace.
The image is built with `VITE_API_BASE_URL=""` (see the release workflow), so
the app makes relative `/api/...` requests and everything stays same-origin;
no CORS involved.

## Prerequisites

- Backend chart applied first (namespace, pull secret, Flux automation).
- Tailscale operator (for the ingress).
- At least one published image (tag a release, e.g. `v0.1.0`) so the pinned
  image in `deployment.yaml` exists before Flux takes over bumping it.

## Deploy

```bash
kubectl apply -k frontend/chart
```

## Customise

To change the backend address (e.g. a different namespace or external host),
edit the `proxy_pass` value in `configmap.yaml` and re-apply.
