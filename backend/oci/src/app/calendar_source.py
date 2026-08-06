"""CalendarSource — the single boundary to Google (issue #105).

Injected through the application factory alongside the clock collaborator
already injected there (see app.main.create_app), so every backend test can
run against a fake and never touch the network. Issue #105 exercised only
credential exchange and refresh; issue #106 adds calendar enumeration;
issue #107 adds event reads.
"""

from dataclasses import dataclass, field
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
class EventAttendee:
    """One person on an Event — an attendee, or its organiser (issue #110).
    `display_name` is Google's optional friendly name; a caller falls back
    to `email` when it's absent."""

    email: str
    display_name: str | None


@dataclass(frozen=True)
class CalendarEventEntry:
    """One expanded Event occurrence read from a single Google Calendar.
    `start`/`end` are UTC instants on the wire, already normalised by the
    adapter: for an all-day/multi-day Event, Google's exclusive end date has
    been converted to the inclusive last day this Event covers, mirroring
    how a Task's own all-day `due_date` is read. Declined and cancelled
    Events never reach this dataclass — the adapter drops them itself, since
    only it knows Google's attendee/status wire shape.

    `location`, `description`, `attendees`, `organizer` and `html_link`
    (issue #110) exist only for the read-only Event detail popover — nothing
    else in tuk-tuk reads them, so they default to empty/absent for every
    caller that doesn't care."""

    google_event_id: str
    summary: str
    start: str
    end: str
    is_all_day: bool
    location: str | None = None
    description: str | None = None
    attendees: list[EventAttendee] = field(default_factory=list)
    organizer: EventAttendee | None = None
    html_link: str = ""


class CalendarSourceError(Exception):
    """Base for any failure reading from or authenticating against Google.
    Never raised directly — callers catch one of the two subclasses below,
    which is deliberately exhaustive (issue #109): every failure this port
    can raise is either retry-safe or isn't, and a caller needs to know
    which before it can decide what to show the user."""


class TransientCalendarSourceError(CalendarSourceError):
    """Network trouble, a server error, or rate limiting — Google (or the
    path to it) is temporarily unavailable, but the stored credential is
    still good. Safe to retry; the account stays connected."""


class TerminalCalendarSourceError(CalendarSourceError):
    """The stored credential itself is no good any more: a revoked or
    expired refresh token, or a code/grant Google rejects outright. Retrying
    can never succeed on its own — the account needs to be reconnected
    through a fresh consent flow."""


class CalendarSource(Protocol):
    def configure(self, client_id: str, client_secret: str) -> None:
        """Replaces the OAuth client credentials in use, without
        reconstructing the source (issue #117) — Settings can save new
        Google credentials mid-process and have the very next request use
        them, rather than requiring a restart."""
        ...

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
