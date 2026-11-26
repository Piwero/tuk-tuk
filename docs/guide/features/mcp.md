# MCP server (optional)

Connect an MCP-compatible AI client to your Tuk Tuk tasks, habits, focus stats and goals. The server can read your data and make bounded changes. It cannot delete.

## What it can do

Read today's agenda, search and inspect tasks, list goals and focus stats. Create, schedule, reschedule and complete tasks; set priority or list; add tags or checklist items; check in a habit.

Write tools use IDs returned by an earlier read from the same client. Task descriptions are sent to the AI client. See [ADR 0014](../../adr/0014-non-browser-clients-credential-write-boundary.md) for the write boundary.

## Choose a connection

|            | Local (stdio)                                            | Remote (Streamable HTTP)                                                       |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Runs       | On your computer, started by AI client                   | Kubernetes, next to the backend, shared by every User                          |
| Setup      | Install `tuk-mcp` and sign in with `tuk login`           | Create an MCP token in Settings and add the server to your client              |
| Reached by | Local process stdin/stdout                               | `POST /mcp` over tailnet                                                       |
| Guide      | [Package README](../../../mcp/oci/README.md#stdio-local) | [Package README](../../../mcp/oci/README.md#streamable-http-remote-kubernetes) |

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

One server, at one tailnet URL, serves every User; your Admin sets it up once
([runbook](../../self-hosting/shared-mcp-server.md)). To connect:

1. In **Settings → My account → API tokens**, choose **New token**, pick
   **Used by: MCP server**, and name it after your client. Copy it: it is shown
   once.
2. Add `https://tuk-tuk-mcp.<tailnet>.ts.net/mcp` to your AI client with the
   header `Authorization: Bearer <your MCP token>`. Keep the token out of
   checked-in config. The package README has
   [Claude Code remote setup](../../../mcp/oci/README.md#register-a-tailnet-client).

Your device must be on the tailnet. Use one MCP token per client. See
[self-hosting security notes](../../self-hosting/security.md#remote-mcp-server).

## Security

Both modes act as you and see only your own data. Local mode uses your saved `tuk login` session. Remote mode uses your MCP token, which only the MCP server accepts; the server holds nobody's credentials and checks your token on every request. Revoke the token in **Settings → My account → API tokens** to cut that client off at once. Anyone with your MCP token on the tailnet can read and change your data using the available tools, so keep it out of checked-in config. Remote mode is tailnet-only; do not expose it publicly.

See [Remote MCP server security](../../self-hosting/security.md#remote-mcp-server) and [ADR 0016](../../adr/0016-mcp-network-transport.md).

## Next

→ [Terminal app](cli.md) · [Self-hosting security](../../self-hosting/security.md)
