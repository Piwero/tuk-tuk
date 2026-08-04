"""CalendarSource — the single boundary to Google (issue #105).

Injected through the application factory alongside the clock collaborator
already injected there (see app.main.create_app), so every backend test can
run against a fake and never touch the network. Issue #105 exercises only
credential exchange and refresh; later tickets add calendar and event reads
to the same port.
"""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ExchangedCredential:
    """What a completed OAuth authorization-code exchange yields."""

    google_account_id: str
    email: str
    refresh_token: str


@dataclass(frozen=True)
class RefreshedAccessToken:
    access_token: str


class CalendarSourceError(Exception):
    """Google rejected a code exchange or credential refresh outright (an
    invalid/expired code, or a revoked refresh token)."""


class CalendarSource(Protocol):
    async def exchange_code(self, code: str, redirect_uri: str) -> ExchangedCredential:
        """Exchange a one-time authorization code for a refresh credential
        and the identity (Google account id, email) it belongs to."""
        ...

    async def refresh(self, refresh_token: str) -> RefreshedAccessToken:
        """Mint a fresh access token from a stored refresh credential."""
        ...
