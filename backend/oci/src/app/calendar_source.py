"""CalendarSource — the single boundary to Google (issue #105).

Injected through the application factory alongside the clock collaborator
already injected there (see app.main.create_app), so every backend test can
run against a fake and never touch the network. Issue #105 exercised only
credential exchange and refresh; issue #106 adds calendar enumeration. Later
tickets add event reads to the same port.
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


@dataclass(frozen=True)
class CalendarListEntry:
    """One calendar from an account's Google calendar list. `selected` is
    Google's own per-calendar visibility flag on the *authenticated user's*
    calendar list — the seed for tuk-tuk's `enabled` flag on first connect,
    never consulted again afterwards."""

    google_calendar_id: str
    summary: str
    selected: bool


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

    async def list_calendars(self, access_token: str) -> list[CalendarListEntry]:
        """Enumerate the calendars the authenticated account exposes."""
        ...
