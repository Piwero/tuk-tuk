# MCP server (optional)

Connect an MCP-compatible AI client to your Tuk Tuk tasks, habits, focus stats and goals. The server can read your data and make bounded changes. It cannot delete.

## What it can do

Read today's agenda, search and inspect tasks, list goals and focus stats. Create, schedule, reschedule and complete tasks; set priority or list; add tags or checklist items; check in a habit.

Write tools use IDs returned by a read in the same server process. Task descriptions are sent to the AI client. See [ADR 0014](../../adr/0014-non-browser-clients-credential-write-boundary.md) for the write boundary.

## Choose a connection

| | Local (stdio) | Remote (Streamable HTTP) |
|---|---|---|
| Runs | On your computer, started by AI client | Kubernetes, next to the backend |
| Setup | Install `tuk-mcp` and sign in with `tuk login` | Deploy chart and configure shared bearer token |
| Reached by | Local process stdin/stdout | `POST /mcp` over tailnet |
| Guide | [Package README](../../../mcp/oci/README.md#stdio-local) | [Package README](../../../mcp/oci/README.md#streamable-http-remote-kubernetes) |

### Local

Install the CLI and MCP server from a repository checkout, then sign in:

```sh
uv tool install --from ./cli/oci tuk
uv tool install --from ./mcp/oci tuk-mcp
tuk login --base-url http://localhost:8900
```

Register it with your client:

```sh
# Claude Code
claude mcp add tuk-tuk -- tuk-mcp

# Codex CLI
codex mcp add tuk-tuk -- tuk-mcp
```

For OpenCode, add the local server to `opencode.json`:

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

For other clients, use their stdio MCP config format:

```json
{
  "mcpServers": {
    "tuk-tuk": { "command": "tuk-mcp", "args": [] }
  }
}
```

See the [MCP package README](../../../mcp/oci/README.md) for remote HTTP registration.

### Remote

Deploy `mcp/chart` to your cluster. The server is exposed on the tailnet as `tuk-tuk-mcp`; clients need the tailnet URL and bearer token. Set `MCP_BEARER_TOKEN` in the client environment to the same value configured on the server. HTTP clients send it as `Authorization: Bearer <token>`; keep the token out of checked-in config. The package README has [Claude Code remote setup](../../../mcp/oci/README.md#register-a-tailnet-client), including an example header. For other clients, configure the same HTTP header in their MCP settings. See [self-hosting security notes](../../self-hosting/security.md#remote-mcp-server).

## Security

Local mode uses your saved `tuk login` session. Remote mode stores your Tuk Tuk password in the pod and uses one shared bearer token for every client. Anyone with token access can read and change data using the available tools. Keep secrets out of checked-in config. Remote mode is tailnet-only; do not expose it publicly.

See [Remote MCP server security](../../self-hosting/security.md#remote-mcp-server) and [ADR 0016](../../adr/0016-mcp-network-transport.md).

## Next

→ [Terminal app](cli.md) · [Self-hosting security](../../self-hosting/security.md)
