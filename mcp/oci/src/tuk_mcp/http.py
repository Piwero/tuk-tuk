"""MCP Streamable HTTP, JSON responses only (ADR 0016). Stdlib server, no SDK.

One shared server for every User (issue #525). `POST /mcp` needs the
caller's MCP token as its bearer and a known `Origin` if one is sent. Every
such request, including `initialize`, `ping` and `tools/list`, is
authenticated afresh at the backend's MCP token exchange (tuk_mcp.auth)
before its body is read or parsed; it then runs with that exchange's
short-lived credential only, against that client's own allowlist
(tuk_mcp.clients). One client's requests run one at a time; different
clients' run side by side. `GET /health` is open, for probes, and touches
nothing else.
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from tuk_core.client import Client

from .auth import BackendUnavailableError, Exchanger, TokenRejectedError, bearer_token
from .clients import ClientStates
from .protocol import error, handle
from .session import TokenSession
from .tools import Toolbox

MAX_BODY = 1_048_576


def make_server(
    client: Client,
    exchanger: Exchanger,
    host: str,
    port: int,
    allowed_origins: frozenset[str] = frozenset(),
    states: ClientStates | None = None,
) -> ThreadingHTTPServer:
    clients = states if states is not None else ClientStates()

    class Handler(BaseHTTPRequestHandler):
        timeout = 10

        def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
            # Method and status only: the request line and headers can carry secrets.
            self.log_message("%s %s", self.command, code)

        def log_error(self, format: str, *args: Any) -> None:  # noqa: A002
            pass  # the default echoes the raw request line

        def _send(
            self, status: int, body: bytes = b"", headers: dict[str, str] | None = None
        ) -> None:
            self.send_response(status)
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            if body:
                self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict[str, Any]) -> None:
            self._send(status, json.dumps(payload).encode())

        def _unauthorized(self) -> None:
            self._send(401, headers={"WWW-Authenticate": "Bearer"})

        def do_GET(self) -> None:  # noqa: N802 - http.server hook name
            if self.path == "/health":
                self._json(200, {"status": "ok"})
            elif self.path == "/mcp":
                self._send(405, headers={"Allow": "POST"})
            else:
                self._send(404)

        def do_POST(self) -> None:  # noqa: N802 - http.server hook name
            if self.path != "/mcp":
                self._send(404)
                return
            token = bearer_token(self.headers.get("Authorization", ""))
            if token is None:
                self._unauthorized()
                return
            origin = self.headers.get("Origin")
            if origin is not None and origin not in allowed_origins:
                self._send(403)
                return
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                self._send(411)
                return
            if not 0 <= length <= MAX_BODY:
                self._send(413)
                return
            try:
                grant = exchanger.exchange(token)
            except TokenRejectedError:
                self._unauthorized()
                return
            except BackendUnavailableError:
                self._send(503)
                return
            raw = self.rfile.read(length)
            try:
                message = json.loads(raw)
            except ValueError:
                self._json(400, error(None, -32700, "Parse error"))
                return
            state = clients.get(grant.client_key)
            try:
                with state.lock:
                    box = Toolbox(
                        client, TokenSession(grant.access_token), state.task_ids, state.habit_ids
                    )
                    response = handle(box, message)
            except Exception:  # noqa: BLE001 - a bug must not kill the listener or leak details
                self._json(500, error(None, -32603, "Internal error"))
                return
            if response is None:
                self._send(202)
            else:
                self._json(200, response)

    return ThreadingHTTPServer((host, port), Handler)
