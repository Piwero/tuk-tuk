"""JSON-RPC message handling shared by the stdio and HTTP transports."""

from typing import Any

from .tools import Toolbox

DEFAULT_PROTOCOL = "2025-06-18"


def error(request_id: object, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def handle(box: Toolbox, message: object) -> dict[str, Any] | None:
    """One JSON-RPC message in, one response out (None for notifications)."""
    if not isinstance(message, dict) or not isinstance(message.get("method"), str):
        return error(None, -32600, "Invalid request")
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
            return error(request_id, -32602, f"Unknown tool {name!r}")
        if not isinstance(arguments, dict):
            return error(request_id, -32602, "arguments must be an object")
        result = box.call(name, arguments)
    else:
        return error(request_id, -32601, f"Method not found: {method}")
    return {"jsonrpc": "2.0", "id": request_id, "result": result}
