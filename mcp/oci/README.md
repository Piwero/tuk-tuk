# tuk-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for tuk-tuk.
Standalone package: it is **not** part of the `tuk` CLI, and installing one
does not install the other. It reuses the shared client in `shared/oci`
(`tuk-core`).

Two transports, same tools:

| | stdio (default) | Streamable HTTP (`--http`) |
|---|---|---|
| Runs | subprocess of your AI client, on your machine | one shared pod in Kubernetes, next to the backend, for every User |
| Reached by | the client's stdin/stdout | `POST /mcp` over the tailnet |
| Backend login | `tuk login` session file | a 2-minute credential the backend grants per request for the caller's MCP token |
| Client auth | none (local process) | the User's own MCP token (`tuk_mcp_...`) as bearer |
| Decision | [ADR 0014](../../docs/adr/0014-non-browser-clients-credential-write-boundary.md) | [ADR 0016](../../docs/adr/0016-mcp-network-transport.md) |

## Tools

Reads: `get_agenda` (call first), `search_tasks`, `get_task`, `get_goals`,
`get_focus_stats`. Writes: `create_task`, `schedule_task`, `reschedule_task`,
`complete_task`, `set_priority`, `set_list`, `add_tags`, `add_check_items`,
`check_in_habit`.

Write tools only accept ids returned by an earlier read by the same client: in
stdio mode, the same process; in HTTP mode, the same MCP token. One User's reads
never admit another's writes. There is no delete tool, by design (ADR 0014). Task descriptions are sent to the model.
Set `TUK_TIMEZONE` if the server's clock differs from yours.

## stdio (local)

```bash
uv tool install --from ./mcp/oci tuk-mcp   # from a checkout of this repo
uv tool install --from ./cli/oci tuk       # for `tuk login`
tuk login --base-url http://localhost:8900
```

Nothing is published to a package index. `tuk-mcp` reads the session `tuk
login` saved under `~/.config/tuk/` (`TUK_CONFIG_DIR` overrides it).

### Claude Code

```bash
claude mcp add tuk-tuk -- tuk-mcp
```

### Codex CLI

```bash
codex mcp add tuk-tuk -- tuk-mcp
```

### OpenCode

Add this server to project-level `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tuk-tuk": {
      "type": "local",
      "command": ["tuk-mcp"],
      "enabled": true
    }
  }
}
```

### Custom JSON config

For clients using the `mcpServers` format, add:

```json
{
  "mcpServers": {
    "tuk-tuk": {
      "command": "tuk-mcp",
      "args": []
    }
  }
}
```

Client config formats vary; use that client's stdio MCP configuration format if it differs.

## Streamable HTTP (remote, Kubernetes)

`tuk-mcp --http [--host H] [--port P]` serves `POST /mcp` (default
`0.0.0.0:8901`) and an unauthenticated `GET /health` for probes. The image is
`ghcr.io/piwero/tuk-tuk/mcp`; the chart in `mcp/chart/` publishes it on the
tailnet as `tuk-tuk-mcp`. **One server serves every User** (issue #525): each
client sends its User's own MCP token, and the server holds no User's
credential. The Admin's setup is in
[Run one MCP server for every User](../../docs/self-hosting/shared-mcp-server.md).

| Variable | Required | Meaning |
|---|---|---|
| `MCP_SERVICE_KEY` | yes | The deployment's service key, the same value the backend has. At least 32 characters or the server refuses to start. Names no User. |
| `TUK_BASE_URL` | yes in a pod | Backend URL, e.g. `http://backend.tuk-tuk.svc:8900`. Overrides the config file. MCP tokens and the service key are sent here and nowhere else; redirects are never followed. |
| `MCP_ALLOWED_ORIGINS` | no | Comma-separated `Origin` values to accept. A request with any other `Origin` gets `403`; requests with no `Origin` are fine. |

On every `POST /mcp`, `initialize`, `ping` and `tools/list` included, the
server sends the caller's MCP token with the service key to the backend's
exchange (`POST /api/v1/auth/mcp/exchange`) before reading the body. A refused
token gets `401`; an unreachable backend gets `503`. The tools then run with the
short-lived credential the exchange granted, for that request only. The MCP
token itself is never sent to the API, which refuses it anyway.

Try it locally, with a backend started with the same `MCP_SERVICE_KEY`:

```bash
export MCP_SERVICE_KEY=$(openssl rand -hex 32)   # give the backend the same value
TUK_BASE_URL=http://localhost:8900 tuk-mcp --http
curl -s -X POST localhost:8901/mcp -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'   # 401
curl -s -X POST localhost:8901/mcp -H "Authorization: Bearer $TUK_MCP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'                                    # {"jsonrpc":"2.0","id":1,"result":{}}
```

### Register a tailnet client

First create your MCP token: **Settings → My account → API tokens → New
token**, **Used by: MCP server**. It is shown once. An API token (`tuk_pat_...`)
does not work here.

Your client must let you set an HTTP header on a remote MCP server; Claude
Code, Codex CLI and OpenCode all do. Hosted connectors that run in a vendor's
cloud (claude.ai, ChatGPT) cannot reach the tailnet and are not supported.

Keep the token out of checked-in config: export it in your shell and let the
client expand it. Claude Code project `.mcp.json` (safe to commit, it holds no
secret):

```json
{
  "mcpServers": {
    "tuk-tuk": {
      "type": "http",
      "url": "https://tuk-tuk-mcp.<your-tailnet>.ts.net/mcp",
      "headers": { "Authorization": "Bearer ${TUK_MCP_TOKEN}" }
    }
  }
}
```

Export `TUK_MCP_TOKEN` with your MCP token before starting the client. Other
clients take the same `Authorization: Bearer ...` header through their own HTTP
MCP config or CLI option.

`<your-tailnet>` is your tailnet's MagicDNS name (`tailscale status` or the
admin console). Use the full `.ts.net` name: the Tailscale certificate is
issued for it, not for the bare `tuk-tuk-mcp`. The client's device must be on
the tailnet.

One-off alternative, with the token read from your environment or password
manager rather than typed:

```bash
claude mcp add --transport http tuk-tuk https://tuk-tuk-mcp.<your-tailnet>.ts.net/mcp \
  --header "Authorization: Bearer $TUK_MCP_TOKEN"
```

(this form writes the expanded token into your local, uncommitted client
config.) Then ask the client to call `get_agenda`. Use one MCP token per client,
so each can be revoked on its own.

## Security

- **Tailnet only.** The Service is published through a Tailscale Ingress with
  Funnel off: no public hostname, no Cloudflare route. Devices outside the
  tailnet cannot resolve it.
- **Your MCP token, checked on every request.** Every `POST /mcp` is checked
  at the backend before its body is parsed, with nothing cached: revoking the
  token in Settings, or the Admin disabling you, cuts it off on the next
  request.
- **An MCP token works only here.** The API refuses it, and the server never
  forwards it to the API: it trades it, with the deployment's service key, for
  a 2-minute credential for that one request. A stolen MCP token is useless
  off the tailnet, and on it lets the holder use the MCP tools as you (never
  delete) until you revoke it.
- **The pod holds no User's credential.** Only `MCP_SERVICE_KEY`, which reaches
  no data without a User's MCP token. Nothing is written to disk.
- **Each client is kept apart.** Reads, credentials and the write allowlist are
  per MCP token. Requests from different clients run side by side; one
  client's requests run one at a time.

This is not the MCP specification's OAuth authorization flow: the MCP token is
a static bearer credential issued by Tuk Tuk for this server. See the
[self-hosting security guide](../../docs/self-hosting/security.md#remote-mcp-server)
and ADR 0016.
