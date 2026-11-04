"""Where the Toolbox gets its backend session cookie.

`FileSession` is the stdio mode: the cookie `tuk login` saved on disk.
`PasswordSession` is the network mode: log in with the owner's password and
keep the cookie in memory only (ADR 0015) — nothing is read from or written to
disk, so a pod needs no login step and no volume.
"""

from typing import Protocol

from tuk_core.client import Client
from tuk_core.store import read_session_cookie, write_session_cookie


class Session(Protocol):
    expired_hint: str

    def cookie(self) -> str | None:
        """The current cookie, or None when there is none and none can be made."""

    def keep(self, refreshed: str) -> None:
        """Remember a cookie the backend reissued."""

    def renew(self) -> str | None:
        """A new cookie after `unauthorized`; None when retrying is pointless."""


class FileSession:
    expired_hint = "Session expired — the owner must run `tuk login` again."

    def cookie(self) -> str | None:
        return read_session_cookie()

    def keep(self, refreshed: str) -> None:
        write_session_cookie(refreshed)

    def renew(self) -> str | None:
        return None


class PasswordSession:
    expired_hint = "The backend rejected the session even after a fresh login — check TUK_PASSWORD."

    def __init__(self, client: Client, password: str) -> None:
        self._client = client
        self._password = password
        self._cookie: str | None = None
        self._fresh = False  # logged in during the current call: a re-login cannot help

    def cookie(self) -> str | None:
        self._fresh = self._cookie is None
        if self._cookie is None:
            self._cookie = self._client.login(self._password)
        return self._cookie

    def keep(self, refreshed: str) -> None:
        self._cookie = refreshed

    def renew(self) -> str | None:
        if self._fresh:
            return None
        self._cookie = self._client.login(self._password)
        self._fresh = True
        return self._cookie
