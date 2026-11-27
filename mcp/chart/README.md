# MCP – Kubernetes manifests

Kustomize chart for the `tuk-mcp` server in Streamable HTTP mode
([ADR 0016](../../docs/adr/0016-mcp-network-transport.md)). Targets the
`tuk-tuk` namespace. It is reachable **only on the tailnet**, as `tuk-tuk-mcp`.
Client setup is in [`mcp/oci/README.md`](../oci/README.md).

**One pod serves every User** (issue #525). It holds the deployment's MCP
service key and no User's credential; each client brings its User's own MCP
token. Setup, migration from per-user pods, rollback and cleanup are in
[the runbook](../../docs/self-hosting/shared-mcp-server.md).

## Resources

| File                                        | Kind                          | Purpose                                                                                  |
| ------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `configmap.yaml`                            | ConfigMap                     | `TUK_BASE_URL`, pointing at the in-cluster backend Service (`mcp-config`)                |
| `mcp-onepassworditem.yaml`                  | OnePasswordItem               | **Obsolete**, kept until the approved cleanup: the pre-#525 credentials (`tuk-tuk-mcp`)  |
| `imagerepository.yaml` / `imagepolicy.yaml` | ImageRepository / ImagePolicy | Scans GHCR for new semver `mcp` images                                                   |
| `deployment.yaml`                           | Deployment                    | Runs `ghcr.io/piwero/tuk-tuk/mcp`: one replica, non-root, `/health` probes               |
| `service.yaml`                              | Service                       | ClusterIP on port 8901                                                                   |
| `tailscale-ingress.yaml`                    | Ingress                       | Exposes the server on the tailnet as `tuk-tuk-mcp`, Funnel off                           |

There is no `namespace.yaml`, `ghcr-onepassworditem.yaml`, `git-onepassworditem.yaml`,
`gitrepository.yaml` or `imageupdateautomation.yaml`: the backend chart already
owns the namespace, the pull secret (`tuk-tuk-ghcr`) and the image automation,
which commits bumps for every chart under `./`. Deploy the backend chart first.

## Variables

Placeholders are filled in by Flux at apply time
([`postBuild.substituteFrom`](https://fluxcd.io/flux/components/kustomize/kustomizations/#post-build-variable-substitution)),
not by `kustomize build`. Without Flux, replace them by hand.

| Variable                     | Used for                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `TUK_TUK_TAILNET_TAGS`       | The ingress's `tailscale.com/tags` annotation, full value, e.g. `"tag:foo,tag:bar"`         |
| `TUK_TUK_1PASSWORD_VAULT_ID` | The 1Password vault id behind the `tuk-tuk-mcp` item (obsolete, until cleanup)              |

## Secret: `tuk-tuk-mcp-service`

The pod loads the Secret `tuk-tuk-mcp-service`, which the **backend** chart syncs
from the 1Password item of the same name (`backend/chart/mcp-service-onepassworditem.yaml`),
so the backend and this pod always share the value.

| Field             | Value                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `MCP_SERVICE_KEY` | At least 32 characters, e.g. `openssl rand -hex 32`. Shorter and the pod refuses to start. Names no User. |

The Deployment also loads the old `tuk-tuk-mcp` Secret, optionally, during the
migration only: images from #525 on never read it, and the pre-#525 image (and a
rollback to it) still needs it. It goes in the cleanup step of
[the runbook](../../docs/self-hosting/shared-mcp-server.md#clean-up-only-once-approved).

## Notes

- **One replica.** The server holds each client's read-before-write allowlist
  in process memory. A second replica would refuse writes the first one's
  reads allowed. Don't scale it.
- **Non-root, no service links.** The image runs as uid/gid 1000 (`appuser`);
  `runAsNonRoot` is enforced and all capabilities are dropped.
  `enableServiceLinks: false` stops Kubernetes injecting `MCP_*` service-link
  variables.
- **Tailnet only.** `tailscale.com/funnel: "false"`; there is no Cloudflare
  IngressRoute. Don't add one.
- **Backend URL** is `http://backend.tuk-tuk.svc:8900`; change `configmap.yaml`
  if the backend Service name or port changes.
- **Initial image tag.** `deployment.yaml` pins the latest release, and Flux
  bumps it through the `{"$imagepolicy": "tuk-tuk:mcp"}` marker. The pod stays
  in `ImagePullBackOff` until a release containing the `mcp` image exists.

## Prerequisites

- The backend chart applied (namespace, `tuk-tuk-ghcr`, image automation, backend Service).
- [1Password Operator](https://developer.1password.com/docs/k8s/k8s-operator/), Flux image-reflector/automation controllers, Tailscale operator.
- A published `ghcr.io/piwero/tuk-tuk/mcp` image.
- The `tuk-tuk-mcp-service` 1Password item above.

## Deploy

Point a Flux `Kustomization` in your cluster-config repo at `mcp/chart/`, with
the variables above supplied via `postBuild.substituteFrom`. To render locally:

```bash
kubectl kustomize mcp/chart
kubectl apply --dry-run=client -k mcp/chart
```

## Verify

```bash
kubectl -n tuk-tuk rollout status deploy/mcp
kubectl -n tuk-tuk logs deploy/mcp          # no token values
```

From a tailnet device (`<tailnet>` is your MagicDNS name):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://tuk-tuk-mcp.<tailnet>.ts.net/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'                                   # 401
```

Then a User connects their MCP client with their own MCP token and calls
`get_agenda`; as the Admin, don't test with anyone's token but your own. From a device outside the
tailnet, `tuk-tuk-mcp` must not resolve.
