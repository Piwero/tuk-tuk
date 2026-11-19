"""Where the Toolbox gets its backend credential.

`FileSession` is the stdio mode: the cookie `tuk login` saved on disk.
`TokenSession` is the network mode: the owner's API token (ADR 0014's
amendment), held in memory only and sent as `Authorization: Bearer` on
every request — nothing is read from or written to disk, so a pod needs no
login step and no volume, and never holds the owner's password.
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
    """An API token is the credential itself: there is nothing to log in
    with, nothing reissued to keep, and no way to renew a revoked one."""

    expired_hint = (
        "The backend rejected TUK_API_TOKEN — it was revoked, or its owner is disabled. "
        "Create a new token in Settings and update the pod's secret."
    )

    def __init__(self, api_token: str) -> None:
        self._api_token = api_token

    def cookie(self) -> str | None:
        return self._api_token

    def keep(self, refreshed: str) -> None:
        pass

    def renew(self) -> str | None:
        return None
