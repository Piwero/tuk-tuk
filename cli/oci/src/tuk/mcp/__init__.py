"""`tuk-mcp`: a local MCP server over stdio. See `tuk.mcp.tools` for the
write boundary and ADR 0014 for why it is drawn where it is."""

from .server import main

__all__ = ["main"]
