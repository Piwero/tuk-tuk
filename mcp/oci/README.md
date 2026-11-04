# tuk-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for tuk-tuk.
Standalone package: it is **not** part of the `tuk` CLI, and installing one
does not install the other. It reuses the shared client in `shared/oci`
(`tuk-core`).

Two transports, same tools:

| | stdio (default) | Streamable HTTP (`--http`) |
|---|---|---|
| Runs | subprocess of your AI client, on your machine | pod in Kubernetes, next to the backend |
| Reached by | the client's stdin/stdout | `POST /mcp` over the tailnet |
| Backend login | `tuk login` session file | pod logs in with `TUK_PASSWORD`, cookie in memory |
| Client auth | none (local process) | bearer token (`MCP_BEARER_TOKEN`) |
| Decision | [ADR 0014](../../docs/adr/0014-non-browser-clients-credential-write-boundary.md) | [ADR 0016](../../docs/adr/0016-mcp-network-transport.md) |

## Tools

Reads: `get_agenda` (call first), `search_tasks`, `get_task`, `get_goals`,
`get_focus_stats`. Writes: `create_task`, `schedule_task`, `reschedule_task`,
`complete_task`, `set_priority`, `set_list`, `add_tags`, `add_check_items`,
`check_in_habit`.

Write tools only accept ids returned by a read in the same server process. In
HTTP mode that allowlist is shared by every client holding the token. There is
no delete tool, by design (ADR 0014). Task descriptions are sent to the model.
Set `TUK_TIMEZONE` if the server's clock differs from yours.

## stdio (local)

```bash
uv tool install --from ./mcp/oci tuk-mcp   # from a checkout of this repo
uv tool install --from ./cli/oci tuk       # for `tuk login`
tuk login --base-url http://localhost:8900
```

Nothing is published to a package index. `tuk-mcp` reads the session `tuk
login` saved under `~/.config/tuk/` (`TUK_CONFIG_DIR` overrides it).

Register it in your client, for example Claude Code:

```bash
claude mcp add tuk-tuk -- tuk-mcp
```

or any client that takes a JSON config:

```json
{ "mcpServers": { "tuk-tuk": { "command": "tuk-mcp" } } }
```

## Streamable HTTP (remote, Kubernetes)

`tuk-mcp --http [--host H] [--port P]` serves `POST /mcp` (default
`0.0.0.0:8901`) and an unauthenticated `GET /health` for probes. The image is
`ghcr.io/piwero/tuk-tuk/mcp`; the chart in `mcp/chart/` publishes it on the
tailnet as `tuk-tuk-mcp`.

| Variable | Required | Meaning |
|---|---|---|
| `MCP_BEARER_TOKEN` | yes | Shared secret clients send as `Authorization: Bearer ...`. At least 32 characters or the server refuses to start. |
| `TUK_PASSWORD` | yes | Owner's tuk-tuk password; the pod logs in with it. |
| `TUK_BASE_URL` | yes in a pod | Backend URL, e.g. `http://backend.tuk-tuk.svc:8900`. Overrides the config file. |
| `MCP_ALLOWED_ORIGINS` | no | Comma-separated `Origin` values to accept. A request with any other `Origin` gets `403`; requests with no `Origin` are fine. |

Generate a token with `openssl rand -hex 32` and keep it, with the password,
in the 1Password item the chart reads (`tuk-tuk-mcp`).

Try it locally:

```bash
export MCP_BEARER_TOKEN=$(openssl rand -hex 32)
TUK_BASE_URL=http://localhost:8900 TUK_PASSWORD=... tuk-mcp --http
curl -s -X POST localhost:8901/mcp -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'   # 401
curl -s -X POST localhost:8901/mcp -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'                                    # {"jsonrpc":"2.0","id":1,"result":{}}
```

### Register a tailnet client

Keep the token out of checked-in config: export it in your shell and let the
client expand it. Claude Code project `.mcp.json` (safe to commit, it holds no
secret):

```json
{
  "mcpServers": {
    "tuk-tuk": {
      "type": "http",
      "url": "https://tuk-tuk-mcp.<your-tailnet>.ts.net/mcp",
      "headers": { "Authorization": "Bearer ${MCP_BEARER_TOKEN}" }
    }
  }
}
```

`<your-tailnet>` is your tailnet's MagicDNS name (`tailscale status` or the
admin console). Use the full `.ts.net` name: the Tailscale certificate is
issued for it, not for the bare `tuk-tuk-mcp`. The client's device must be on
the tailnet.

One-off alternative, with the token read from your environment or password
manager rather than typed:

```bash
claude mcp add --transport http tuk-tuk https://tuk-tuk-mcp.<your-tailnet>.ts.net/mcp \
  --header "Authorization: Bearer $MCP_BEARER_TOKEN"
```

(this form writes the expanded token into your local, uncommitted client
config.) Then ask the client to call `get_agenda`.

## Security

- **Tailnet only.** The Service is published through a Tailscale Ingress with
  Funnel off: no public hostname, no Cloudflare route. Devices outside the
  tailnet cannot resolve it.
- **Bearer token.** Every `POST /mcp` needs it, checked before the body is
  parsed. One shared token, no per-client revocation; rotate it by updating the
  1Password item and every client.
- **The pod holds your password.** HTTP mode logs in as you. Whoever can read
  the namespace's secrets or the 1Password item has the full password, not a
  revocable session. The session cookie stays in memory and nothing is written
  to disk.
- Anyone with the token on the tailnet can call the write tools (never delete).

See the [self-hosting security guide](../../docs/self-hosting/security.md#remote-mcp-server)
and ADR 0016.
