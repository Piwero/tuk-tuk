"""Where the Toolbox gets its backend credential.

`FileSession` is the stdio mode: the cookie `tuk login` saved on disk.
`TokenSession` is the shared HTTP server's (issue #525): the short-lived
access credential the MCP token exchange granted for one MCP request
(tuk_mcp.auth), held in memory for that request only and sent as
`Authorization: Bearer` on every backend call. Nothing is read from or
written to disk, and the pod holds no User's credential at all.
"""

from typing import Protocol

from tuk_core.store import read_session_cookie, write_session_cookie


class Session(Protocol):
    expired_hint: str

    def cookie(self) -> str | None:
        """The current credential, or None when there is none and none can be made."""

    def keep(self, refreshed: str) -> None:
        """Remember a cookie the backend reissued."""

    def renew(self) -> str | None:
        """A new credential after `unauthorized`; None when retrying is pointless."""


class FileSession:
    expired_hint = "Session expired — the owner must run `tuk login` again."

    def cookie(self) -> str | None:
        return read_session_cookie()

    def keep(self, refreshed: str) -> None:
        write_session_cookie(refreshed)

    def renew(self) -> str | None:
        return None


class TokenSession:
    """A bearer credential is the credential itself: there is nothing to log
    in with, nothing reissued to keep, and no way to renew a revoked one."""

    expired_hint = (
        "The backend refused this MCP token: it was revoked, or its owner is disabled. "
        "Create a new MCP token in Settings → My account → API tokens and update this client."
    )

    def __init__(self, credential: str) -> None:
        self._credential = credential

    def cookie(self) -> str | None:
        return self._credential

    def keep(self, refreshed: str) -> None:
        pass

    def renew(self) -> str | None:
        return None
