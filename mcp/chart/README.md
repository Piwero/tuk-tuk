# MCP – Kubernetes manifests

Kustomize chart for the `tuk-mcp` server in Streamable HTTP mode
([ADR 0016](../../docs/adr/0016-mcp-network-transport.md)). Targets the
`tuk-tuk` namespace. It is reachable **only on the tailnet**, as `tuk-tuk-mcp`.
Client setup is in [`mcp/oci/README.md`](../oci/README.md).

**One pod serves one User.** It holds that User's API token and acts strictly
as them ([ADR 0018](../../docs/adr/0018-multi-user-row-level-isolation.md)).
Pods are not created automatically: this chart is the first one, and the admin
deploys a pod for any other User on request, following
[the runbook](../../docs/self-hosting/per-user-mcp-and-voice.md).

## Resources

| File                                        | Kind                          | Purpose                                                                                  |
| ------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `configmap.yaml`                            | ConfigMap                     | `TUK_BASE_URL`, pointing at the in-cluster backend Service (`mcp-config`)                |
| `mcp-onepassworditem.yaml`                  | OnePasswordItem               | Syncs `TUK_API_TOKEN` and `MCP_BEARER_TOKEN` (`tuk-tuk-mcp`)                             |
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
| `TUK_TUK_1PASSWORD_VAULT_ID` | The 1Password vault id behind the `tuk-tuk-mcp` item                                        |

## Secret: 1Password item `tuk-tuk-mcp`

Create it by hand in the vault `TUK_TUK_1PASSWORD_VAULT_ID` points at, before
applying. The operator copies field labels verbatim into a Secret of the same
name, loaded with `envFrom`.

| Field              | Value                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| `TUK_API_TOKEN`    | The User's API token (`tuk_pat_...`), created by that User in **Settings → My account → API tokens**. The pod sends it as `Authorization: Bearer`. |
| `MCP_BEARER_TOKEN` | At least 32 characters, e.g. `openssl rand -hex 32`. Shorter and the pod refuses to start. |

Both tokens come only from this Secret, never from the ConfigMap. The pod
never holds a password: changing the User's password does not affect it.
Revoking the API token in **Settings → My account → API tokens** cuts the pod off at once; the User then
creates a new token and the admin updates `TUK_API_TOKEN`.

## Notes

- **One replica.** The server holds its id allowlist in process memory and
  serialises requests. Don't scale it.
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
- The `tuk-tuk-mcp` 1Password item above.

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
curl -s -X POST https://tuk-tuk-mcp.<tailnet>.ts.net/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'                              # 14 tools
```

Then call `get_agenda` from your MCP client. From a device outside the
tailnet, `tuk-tuk-mcp` must not resolve.
