"""CalendarSource — the single boundary to Google (issue #105).

Injected through the application factory alongside the clock collaborator
already injected there (see app.main.create_app), so every backend test can
run against a fake and never touch the network. Issue #105 exercised only
credential exchange and refresh; issue #106 adds calendar enumeration;
issue #107 adds event reads.
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


@dataclass(frozen=True)
class CalendarEventEntry:
    """One expanded Event occurrence read from a single Google Calendar.
    `start`/`end` are UTC instants on the wire, already normalised by the
    adapter: for an all-day/multi-day Event, Google's exclusive end date has
    been converted to the inclusive last day this Event covers, mirroring
    how a Task's own all-day `due_date` is read. Declined and cancelled
    Events never reach this dataclass — the adapter drops them itself, since
    only it knows Google's attendee/status wire shape."""

    google_event_id: str
    summary: str
    start: str
    end: str
    is_all_day: bool


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

    async def list_events(
        self, access_token: str, google_calendar_id: str, time_min: str, time_max: str
    ) -> list[CalendarEventEntry]:
        """Expanded concrete Event occurrences on one calendar overlapping
        the [time_min, time_max) UTC instant window (RFC3339). Recurring
        series arrive already expanded into instances, never as a rule to
        interpret."""
        ...
