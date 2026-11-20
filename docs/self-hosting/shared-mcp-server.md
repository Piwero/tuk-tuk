# Run one MCP server for every User

⏱ 15 min once · For: the Admin · Needs: `kubectl` and Flux access to the cluster, the 1Password
vault the charts read

One MCP deployment, at one tailnet URL, serves every User
([ADR 0016's amendment](../adr/0016-mcp-network-transport.md#amendment-one-shared-server-for-every-user-issue-525)).
Each User connects their own AI client with their own **MCP token**, and sees and changes only
their own data. Nothing is deployed per User, and the server holds no User's credential: you never
handle a User's token.

## How it works

```
AI client ──Bearer tuk_mcp_…──► MCP server (tailnet only)
                                  │ every request: MCP token + service key
                                  ▼
                               backend /api/v1/auth/mcp/exchange
                                  │ token live? User active? no forced step?
                                  ▼
                               a 2-minute access credential for that User,
                               used for this one request, then dropped
```

- An **MCP token** (`tuk_mcp_…`) is made for the MCP server and works nowhere else: the API
  refuses it. The server never passes it on to the API (no token passthrough).
- The **MCP service key** (`MCP_SERVICE_KEY`) is the one secret the deployment holds. It names no
  User and reaches no data without a User's MCP token.
- Every MCP request, `initialize`, `ping` and `tools/list` included, is checked at the backend.
  Nothing is cached, so revoking a token or disabling a User takes effect on the next request,
  with no restart.

## Set it up

1. **Create the 1Password item** `tuk-tuk-mcp-service` in the vault `TUK_TUK_1PASSWORD_VAULT_ID`
   points at, with one field:

   | Field             | Value                                   |
   | ----------------- | --------------------------------------- |
   | `MCP_SERVICE_KEY` | A new value from `openssl rand -hex 32` |

2. **Deploy** a release that includes issue #525. The backend chart syncs the item and loads it
   (`backend/chart/mcp-service-onepassworditem.yaml`); the MCP chart loads the same Secret. Restart
   the backend once the Secret exists if it started before it:
   `kubectl -n tuk-tuk rollout restart deploy/backend`.
3. **Check it runs:**

   ```sh
   kubectl -n tuk-tuk rollout status deploy/mcp
   kubectl -n tuk-tuk logs deploy/mcp     # method and status only, no token values
   ```

   From a tailnet device, a request with no token is refused:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://tuk-tuk-mcp.<tailnet>.ts.net/mcp \
     -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'                     # 401
   ```

   Don't test with a User's token yourself: it would show you their tasks. Ask two Users to
   connect (below) and confirm each sees only their own agenda.

## What each User does

1. In Tuk Tuk, open **Settings → My account → API tokens → New token**, choose **Used by: MCP
   server**, and name it after the client (for example `Claude Code on laptop`). It is shown once.
2. Register `https://tuk-tuk-mcp.<tailnet>.ts.net/mcp` in their AI client with the header
   `Authorization: Bearer <MCP token>`, as in
   [Register a tailnet client](../../mcp/oci/README.md#register-a-tailnet-client). Their device
   must be on the tailnet.

One token per client is best: each gets its own read-before-write memory, and each can be revoked
alone.

## Migrate from per-user pods

Before #525, each User had their own pod (`mcp`, `mcp-<user>`) holding their API token and a
shared `MCP_BEARER_TOKEN`. To move them over:

1. Do **Set it up** above. The `mcp` Deployment keeps loading the old `tuk-tuk-mcp` Secret
   (optional) until cleanup, so the old image keeps working until the new one rolls out.
2. Ask each User to create an MCP token and switch their client to the shared URL with it (see
   above). Their old pod keeps working meanwhile.
3. Once every User has switched, ask for approval to clean up (below).

## Roll back

Revert the #525 change in the deployment repo (or pin `deploy/mcp` back to the previous image).
The pre-#525 image reads `TUK_API_TOKEN` and `MCP_BEARER_TOKEN` from the `tuk-tuk-mcp` Secret,
which stays in place until cleanup, so it starts again unchanged. Clients go back to their old URL
and bearer token. MCP tokens Users created stay harmless: nothing but the exchange accepts them,
and they can be revoked in Settings.

## Clean up (only once approved)

Nothing here is deleted by deploying #525. Once every User has switched and the Admin has
explicitly approved removal:

1. In the repo: delete `mcp/chart/mcp-onepassworditem.yaml`, its entry in
   `mcp/chart/kustomization.yaml`, and the optional `tuk-tuk-mcp` `secretRef` in
   `mcp/chart/deployment.yaml`; make its `tuk-tuk-mcp-service` `secretRef`
   required. Flux then deletes the `tuk-tuk-mcp` Secret.
2. In your cluster-config repo: delete each `mcp-<user>` Flux Kustomization (with
   `prune: true`, Flux deletes the pod, Service, Ingress and Secret it created).
3. In 1Password: delete `tuk-tuk-mcp` and every `tuk-tuk-mcp-<user>` item.
4. Ask each User to revoke the old `tuk_pat_…` token their pod used, in
   **Settings → My account → API tokens**.

Keep the `mcp` chart's `ImageRepository` and `ImagePolicy`: they drive the shared image
automation.

## Later

- **Rotate the service key:** change `MCP_SERVICE_KEY` in the item, then restart both
  Deployments. No client changes.
- **A User leaves or loses a device:** they revoke that MCP token in Settings, or you disable the
  User. Either cuts them off on the next request.
- **The backend is down:** the MCP server answers `503` and shows nothing.

## Next

→ [Security](security.md#remote-mcp-server) · [Give a User their own voice agent](per-user-mcp-and-voice.md)
