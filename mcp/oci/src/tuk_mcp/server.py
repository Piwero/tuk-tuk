"""Minimal MCP (JSON-RPC 2.0 over stdio) — no SDK, because MCP only needs the
shared core's HTTP client.
Only the slice a tools-only server needs: initialize, ping, tools/list,
tools/call."""

import argparse
import json
import os
import sys
from typing import Any

import httpx
from tuk_core.client import Client
from tuk_core.store import resolve_base_url

from .session import PasswordSession
from .tools import Toolbox

DEFAULT_PROTOCOL = "2025-06-18"


def _error(request_id: object, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def handle(box: Toolbox, message: object) -> dict[str, Any] | None:
    """One JSON-RPC message in, one response out (None for notifications)."""
    if not isinstance(message, dict) or not isinstance(message.get("method"), str):
        return _error(None, -32600, "Invalid request")
    method = message["method"]
    request_id = message.get("id")
    if "id" not in message:
        return None  # notification, e.g. notifications/initialized
    params = message.get("params")
    params = params if isinstance(params, dict) else {}
    if method == "initialize":
        version = params.get("protocolVersion")
        result: dict[str, Any] = {
            "protocolVersion": version if isinstance(version, str) else DEFAULT_PROTOCOL,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "tuk-mcp", "version": "0.1.0"},
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": box.describe()}
    elif method == "tools/call":
        name, arguments = params.get("name"), params.get("arguments") or {}
        if not isinstance(name, str) or not box.has(name):
            return _error(request_id, -32602, f"Unknown tool {name!r}")
        if not isinstance(arguments, dict):
            return _error(request_id, -32602, "arguments must be an object")
        result = box.call(name, arguments)
    else:
        return _error(request_id, -32601, f"Method not found: {method}")
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def serve(box: Toolbox, source: Any, sink: Any) -> None:
    for line in source:
        if not line.strip():
            continue
        response: dict[str, Any] | None
        try:
            message = json.loads(line)
        except ValueError:
            response = _error(None, -32700, "Parse error")
        else:
            response = handle(box, message)
        if response is not None:
            sink.write(json.dumps(response) + "\n")
            sink.flush()


def main(transport: httpx.BaseTransport | None = None, argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tuk-mcp")
    parser.add_argument("--http", action="store_true", help="serve Streamable HTTP, not stdio")
    parser.add_argument("--host", default="0.0.0.0")  # noqa: S104 - in-pod listener, tailnet-only
    parser.add_argument("--port", type=int, default=8901)
    args = parser.parse_args(argv)
    if not args.http:
        client = Client(resolve_base_url(None), transport=transport)
        try:
            serve(Toolbox(client), sys.stdin, sys.stdout)
        finally:
            client.close()
        return 0
    token, password = os.environ.get("MCP_BEARER_TOKEN", ""), os.environ.get("TUK_PASSWORD", "")
    if not password:
        print("tuk-mcp: TUK_PASSWORD is required with --http.", file=sys.stderr)
        return 1
    client = Client(resolve_base_url(None), transport=transport)
    from .http import make_server  # here, not at top: http imports this module

    origins = frozenset(filter(None, os.environ.get("MCP_ALLOWED_ORIGINS", "").split(",")))
    try:
        server = make_server(
            Toolbox(client, PasswordSession(client, password)), token, args.host, args.port, origins
        )
    except ValueError as exc:
        client.close()
        print(f"tuk-mcp: {exc}", file=sys.stderr)
        return 1
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        client.close()
    return 0
