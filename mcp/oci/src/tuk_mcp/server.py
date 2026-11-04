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

from .http import make_server
from .protocol import error, handle
from .session import PasswordSession
from .tools import Toolbox


def serve(box: Toolbox, source: Any, sink: Any) -> None:
    for line in source:
        if not line.strip():
            continue
        response: dict[str, Any] | None
        try:
            message = json.loads(line)
        except ValueError:
            response = error(None, -32700, "Parse error")
        else:
            response = handle(box, message)
        if response is not None:
            sink.write(json.dumps(response) + "\n")
            sink.flush()


def main(transport: httpx.BaseTransport | None = None, argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tuk-mcp")
    parser.add_argument("--http", action="store_true", help="serve Streamable HTTP, not stdio")
    parser.add_argument("--host", default="127.0.0.1")
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
