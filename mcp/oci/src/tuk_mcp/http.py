"""MCP Streamable HTTP, JSON responses only (ADR 0016). Stdlib server, no SDK.

`POST /mcp` needs a bearer token (checked before the body is read or parsed)
and a known `Origin` if one is sent. `GET /health` is open, for probes. The
Toolbox is not thread-safe, so requests run one at a time behind a lock.
"""

import hmac
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .protocol import error, handle
from .tools import Toolbox

MIN_TOKEN_LENGTH = 32
MAX_BODY = 1_048_576


def make_server(
    box: Toolbox,
    token: str,
    host: str,
    port: int,
    allowed_origins: frozenset[str] = frozenset(),
) -> ThreadingHTTPServer:
    if len(token) < MIN_TOKEN_LENGTH:
        raise ValueError(f"MCP_BEARER_TOKEN must be at least {MIN_TOKEN_LENGTH} characters.")
    expected = f"Bearer {token}".encode()
    lock = threading.Lock()

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
            presented = self.headers.get("Authorization", "").encode("latin-1")
            if not hmac.compare_digest(presented, expected):
                self._send(401, headers={"WWW-Authenticate": "Bearer"})
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
            raw = self.rfile.read(length)
            try:
                message = json.loads(raw)
            except ValueError:
                self._json(400, error(None, -32700, "Parse error"))
                return
            try:
                with lock:
                    response = handle(box, message)
            except Exception:  # noqa: BLE001 - a bug must not kill the listener or leak details
                self._json(500, error(None, -32603, "Internal error"))
                return
            if response is None:
                self._send(202)
            else:
                self._json(200, response)

    return ThreadingHTTPServer((host, port), Handler)
