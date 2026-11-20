# MCP server (optional)

Connect an MCP-compatible AI client to your Tuk Tuk tasks, habits, focus stats and goals. The server can read your data and make bounded changes. It cannot delete.

## What it can do

Read today's agenda, search and inspect tasks, list goals and focus stats. Create, schedule, reschedule and complete tasks; set priority or list; add tags or checklist items; check in a habit.

Write tools use IDs returned by a read in the same server process. Task descriptions are sent to the AI client. See [ADR 0014](../../adr/0014-non-browser-clients-credential-write-boundary.md) for the write boundary.

## Choose a connection

| | Local (stdio) | Remote (Streamable HTTP) |
|---|---|---|
| Runs | On your computer, started by AI client | Kubernetes, next to the backend |
| Setup | Install `tuk-mcp` and sign in with `tuk login` | Create an API token, ask your Admin to deploy a server for you |
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

Each remote server serves one User. To get one, create an API token in **Settings → My account → API tokens** and give it to your Admin, who deploys a server for you by following [the runbook](../../self-hosting/per-user-mcp-and-voice.md). The server is exposed on the tailnet as `tuk-tuk-mcp` (or `tuk-tuk-mcp-<you>`); clients need the tailnet URL and bearer token the Admin gives you. Set `MCP_BEARER_TOKEN` in the client environment to the same value configured on the server. HTTP clients send it as `Authorization: Bearer <token>`; keep the token out of checked-in config. The package README has [Claude Code remote setup](../../../mcp/oci/README.md#register-a-tailnet-client), including an example header. For other clients, configure the same HTTP header in their MCP settings. See [self-hosting security notes](../../self-hosting/security.md#remote-mcp-server).

## Security

Both modes act as you and see only your own data. Local mode uses your saved `tuk login` session. Remote mode stores your API token in the pod, never your password, and uses one shared bearer token for every client of that server. Revoke the API token in **Settings → My account → API tokens** to cut the server off. Anyone with the bearer token can read and change data using the available tools. Keep secrets out of checked-in config. Remote mode is tailnet-only; do not expose it publicly.

See [Remote MCP server security](../../self-hosting/security.md#remote-mcp-server) and [ADR 0016](../../adr/0016-mcp-network-transport.md).

## Next

→ [Terminal app](cli.md) · [Self-hosting security](../../self-hosting/security.md)
