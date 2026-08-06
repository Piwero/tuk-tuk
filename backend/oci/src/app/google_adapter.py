"""The concrete CalendarSource adapter — the only module that knows
Google's OAuth and Calendar wire format (issue #105, events issue #107).
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx

from app.calendar_source import (
    CalendarEventEntry,
    CalendarListEntry,
    EventAttendee,
    ExchangedCredential,
    RefreshedAccessToken,
    TerminalCalendarSourceError,
    TransientCalendarSourceError,
)

TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList"


def _events_url(google_calendar_id: str) -> str:
    return (
        "https://www.googleapis.com/calendar/v3/calendars/"
        f"{quote(google_calendar_id, safe='')}/events"
    )


def _is_declined(item: dict[str, Any]) -> bool:
    """True when the authenticated user's own attendee entry declined. An
    Event with no attendees array (only the organiser, no invitees) is
    never declined — there is no RSVP to decline."""
    for attendee in item.get("attendees", []):
        if attendee.get("self") and attendee.get("responseStatus") == "declined":
            return True
    return False


def _as_utc_instant(value: str) -> str:
    """An RFC3339 dateTime with any offset, rendered as a UTC "Z" instant."""
    return datetime.fromisoformat(value).astimezone(UTC).isoformat().replace("+00:00", "Z")


def _is_invalid_grant(response: httpx.Response) -> bool:
    """Google's shape for a revoked or expired refresh token / authorization
    code: a 400 with an `invalid_grant` error code in the body."""
    if response.status_code != 400:
        return False
    try:
        return bool(response.json().get("error") == "invalid_grant")
    except ValueError:
        return False


def _raise_for_error_response(response: httpx.Response, message: str) -> None:
    """Classifies a non-200 Google response (issue #109): terminal when the
    credential itself is no good (a revoked/expired grant, or Google no
    longer honouring the access token at all), transient for everything
    else — a server error, rate limiting, or any other rejection that isn't
    about the grant."""
    if _is_invalid_grant(response) or response.status_code in (401, 403):
        raise TerminalCalendarSourceError(f"{message}: {response.text}")
    raise TransientCalendarSourceError(f"{message}: {response.text}")


def _parse_attendee(item: dict[str, Any]) -> EventAttendee:
    return EventAttendee(email=item["email"], display_name=item.get("displayName"))


def _parse_event(item: dict[str, Any]) -> CalendarEventEntry:
    start, end = item["start"], item["end"]
    is_all_day = "date" in start
    if is_all_day:
        # Google's all-day end date is exclusive; the day before it is the
        # inclusive last day this Event covers.
        exclusive_end = date.fromisoformat(end["date"])
        start_instant = f"{start['date']}T00:00:00Z"
        end_instant = f"{(exclusive_end - timedelta(days=1)).isoformat()}T00:00:00Z"
    else:
        start_instant = _as_utc_instant(start["dateTime"])
        end_instant = _as_utc_instant(end["dateTime"])
    organizer = item.get("organizer")
    return CalendarEventEntry(
        google_event_id=item["id"],
        summary=item.get("summary", "(No title)"),
        start=start_instant,
        end=end_instant,
        is_all_day=is_all_day,
        location=item.get("location"),
        description=item.get("description"),
        attendees=[_parse_attendee(attendee) for attendee in item.get("attendees", [])],
        organizer=None if organizer is None else _parse_attendee(organizer),
        html_link=item.get("htmlLink", ""),
    )


class GoogleCalendarSource:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        # `transport` is a test-only seam (httpx.MockTransport); production
        # code never passes one and gets httpx's real network transport.
        self._transport = transport

    def configure(self, client_id: str, client_secret: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret

    @asynccontextmanager
    async def _client(self, action: str) -> AsyncIterator[httpx.AsyncClient]:
        """Every request below shares this: a network-level failure (as
        opposed to a non-200 response, which each caller classifies itself
        via `_raise_for_error_response`) is always transient — the
        credential is fine, only the request didn't land."""
        try:
            async with httpx.AsyncClient(transport=self._transport) as client:
                yield client
        except httpx.HTTPError as exc:
            raise TransientCalendarSourceError(f"Network error {action}: {exc}") from exc

    async def exchange_code(self, code: str, redirect_uri: str) -> ExchangedCredential:
        async with self._client("exchanging the authorization code") as client:
            token_response = await client.post(
                TOKEN_URL,
                data={
                    "code": code,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            if token_response.status_code != 200:
                _raise_for_error_response(token_response, "Google rejected the authorization code")
            token_body = token_response.json()
            refresh_token = token_body.get("refresh_token")
            if not refresh_token:
                raise TerminalCalendarSourceError(
                    "Google granted no refresh token; reconnect to force re-consent"
                )
            access_token = token_body["access_token"]

            userinfo_response = await client.get(
                USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
            )
            if userinfo_response.status_code != 200:
                _raise_for_error_response(
                    userinfo_response, "Failed to fetch the connected account's identity"
                )
            userinfo = userinfo_response.json()

        return ExchangedCredential(
            google_account_id=userinfo["id"],
            email=userinfo["email"],
            refresh_token=refresh_token,
        )

    async def refresh(self, refresh_token: str) -> RefreshedAccessToken:
        async with self._client("refreshing the access token") as client:
            response = await client.post(
                TOKEN_URL,
                data={
                    "refresh_token": refresh_token,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "grant_type": "refresh_token",
                },
            )
            if response.status_code != 200:
                _raise_for_error_response(response, "Failed to refresh the access token")
            return RefreshedAccessToken(access_token=response.json()["access_token"])

    async def list_calendars(self, access_token: str) -> list[CalendarListEntry]:
        entries: list[CalendarListEntry] = []
        page_token: str | None = None
        async with self._client("listing calendars") as client:
            while True:
                params = {"pageToken": page_token} if page_token else {}
                response = await client.get(
                    CALENDAR_LIST_URL,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params=params,
                )
                if response.status_code != 200:
                    _raise_for_error_response(response, "Failed to list calendars")
                body = response.json()
                for item in body.get("items", []):
                    entries.append(
                        CalendarListEntry(
                            google_calendar_id=item["id"],
                            summary=item.get("summary", item["id"]),
                            selected=item.get("selected", False),
                        )
                    )
                page_token = body.get("nextPageToken")
                if not page_token:
                    break
        return entries

    async def list_events(
        self, access_token: str, google_calendar_id: str, time_min: str, time_max: str
    ) -> list[CalendarEventEntry]:
        entries: list[CalendarEventEntry] = []
        page_token: str | None = None
        async with self._client("listing events") as client:
            while True:
                params = {
                    # Recurring series expanded into concrete occurrences,
                    # never a rule for tuk-tuk to interpret itself.
                    "singleEvents": "true",
                    "timeMin": time_min,
                    "timeMax": time_max,
                }
                if page_token:
                    params["pageToken"] = page_token
                response = await client.get(
                    _events_url(google_calendar_id),
                    headers={"Authorization": f"Bearer {access_token}"},
                    params=params,
                )
                if response.status_code != 200:
                    _raise_for_error_response(response, "Failed to list events")
                body = response.json()
                for item in body.get("items", []):
                    if item.get("status") == "cancelled" or _is_declined(item):
                        continue
                    entries.append(_parse_event(item))
                page_token = body.get("nextPageToken")
                if not page_token:
                    break
        return entries
