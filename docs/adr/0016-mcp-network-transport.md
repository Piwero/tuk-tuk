# MCP network transport: Streamable HTTP on the tailnet, bearer token, pod-held credential

## Status

Accepted. Supersedes two premises of
[0014](0014-non-browser-clients-credential-write-boundary.md) for the
MCP server's HTTP mode only: "the clients run on the owner's own
machine" (credential decision) and "stdio transport, no listener, no
network surface" (enforcement-boundary decision). The stdio mode is
unchanged and 0014 still governs it in full. The write principle, the
no-delete rule and the description egress of 0014 are reused unchanged.
ADR 0014 is left otherwise unedited; it carries a pointer here.

## Context

`tuk-mcp` speaks JSON-RPC over stdio, so it cannot run as a Kubernetes
Deployment: a Service cannot reach a process's stdin/stdout. Running it
in the cluster next to the backend lets any MCP client on the owner's
tailnet use it without a local install. That puts a listener on a
network and a credential in a pod, which is exactly what ADR 0014 said
would "reopen both decisions and need its own record".

## Decision: Streamable HTTP, JSON responses only

`tuk-mcp --http [--host H] [--port P]` serves MCP Streamable HTTP on a
single endpoint, `POST /mcp` (default `0.0.0.0:8901`). Responses are
plain `application/json`; a notification gets `202` with no body;
`GET /mcp` answers `405`. There is no SSE stream: the server is
tools-only and never sends server-initiated messages. `GET /health`
answers `200` without auth for Kubernetes probes and touches nothing
else.

The server uses stdlib `http.server.ThreadingHTTPServer`: no MCP SDK and
no web framework, matching the "no SDK" stance of the stdio server and
adding no runtime dependency beyond `tuk-core`. The `Toolbox` is not
thread-safe (cached cookie, id allowlists), so requests are serialised
behind one lock and the Deployment runs one replica. Stdio stays the
default; HTTP is opt-in.

## Decision: tailnet-only exposure plus a static bearer token

Access control is two layers, neither sufficient alone:

- **Reachability.** The Service is published only through a Tailscale
  Ingress as `tuk-tuk-mcp` with Funnel off. It has no public hostname and
  no Cloudflare route. A device outside the tailnet cannot resolve it.
- **Bearer token.** `POST /mcp` requires `Authorization: Bearer
  <MCP_BEARER_TOKEN>`, compared with `hmac.compare_digest`. A request
  without a valid token gets `401` (`WWW-Authenticate: Bearer`) before any
  JSON is parsed. The server refuses to start if the token is unset or
  shorter than 32 characters.

The `Origin` header is validated when present and unknown origins get
`403`, as the MCP spec requires against DNS rebinding. `Authorization`,
the password and the cookie are redacted from all logs.

One shared token is enough for the same reason ADR 0014 gave: there is
one legitimate user. Per-client tokens, OAuth and the MCP authorization
flows are out of scope; they remain the upgrade path in 0014 when a
client stops being the owner's.

## Decision: the pod holds the owner's password; the session stays in memory

A pod has no logged-in user to supply a session file, so the MCP pod
authenticates itself. It holds the owner's password (`TUK_PASSWORD`,
from a 1Password item) and logs in lazily against the backend, reached
in-cluster at `TUK_BASE_URL` (`http://backend.tuk-tuk.svc:8900`). The
session cookie lives in process memory only; in HTTP mode neither the
password nor the cookie is ever written to disk.

On `unauthorized` the call logs in once and retries once. It never
loops: the backend throttles logins deliberately, and a retry loop
against a wrong password would lock the owner out.

This narrows 0014's "the password is never written to disk and exists
only transiently in a shell" to "the password is never written to disk"
for this mode: it now lives long-term in the pod's environment and the
cluster secret store. Compromise of the pod, the namespace's secrets or
the 1Password item yields the full password, not just a revocable
session. This is the cost of having no token scheme (0014's rejected
option) and is accepted for a single-user app.

## Decision: the write-id allowlist is process-wide

Write tools accept only ids that were read earlier in the same process.
In stdio mode a process serves one client; in HTTP mode it serves every
client holding the token, so the allowlist becomes shared across all of
them. A client may therefore write an id another client read. This is
acceptable because all clients are the one owner, and the allowlist's
job (stopping a model from writing an id it invented) is unaffected.

## What 0014 still holds

The tool roster remains the enforcement boundary and remains pinned by
its test. It still protects against a model, not against a compromised
process. The difference is that "compromised process" now includes a
holder of the bearer token on the tailnet, and the pod holds the full
credential. Therefore the roster is unchanged, no delete tool is added,
and the write set is not widened as part of this work.

## Considered options (and why they were rejected)

- **Official MCP SDK or a web framework.** Rejected: a runtime
  dependency for a single JSON endpoint; see `test_packaging.py`.
- **SSE / streaming responses.** Rejected: nothing to stream; tools-only
  server with no server-initiated messages.
- **Tailnet identity alone (no token).** Rejected: any tailnet device or
  compromised node could call write tools; the token is cheap defence in
  depth.
- **Public hostname behind Cloudflare or Funnel.** Rejected: puts a
  write-capable endpoint holding the owner's credential on the internet.
- **Per-client API tokens against the backend.** Still rejected, as in
  0014: a migration and a Settings surface for a single user.
- **Persisting the session cookie in a volume.** Rejected: a disk
  artefact for no benefit; re-login after a restart costs one request.
- **Multiple replicas.** Rejected: the Toolbox is not thread-safe and
  the allowlist is per-process.

## Accepted trade-offs

- The pod holds the password. Anyone with read access to the namespace's
  secrets or the 1Password item has it.
- One shared bearer token: no per-client revocation or audit trail.
  Rotating it means updating the item and every client.
- The allowlist is shared across clients; there is no isolation between
  concurrent MCP clients.
- Single replica, serialised requests: no HA, and a slow backend call
  blocks the next request.
- Restarting the pod drops the session and the allowlist; clients must
  re-read before writing.

## What would justify revisiting this

A second user, or a client that is not the owner's, reopens the shared
token and the held password together and is the moment for per-client
scoped tokens. Needing server-initiated messages (sampling, progress)
reopens the no-SSE decision. Needing more than one replica reopens the
lock and the process-wide allowlist.
