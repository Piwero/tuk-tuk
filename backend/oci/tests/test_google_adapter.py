"""The Google-wire-format adapter (issue #105) — the only module in the
suite that speaks Google's OAuth wire format. Exercised against a stubbed
HTTP transport; no test in the suite ever contacts Google for real.
"""

import httpx
import pytest

from app.calendar_source import TerminalCalendarSourceError, TransientCalendarSourceError
from app.google_adapter import GoogleCalendarSource

TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


def adapter(handler: httpx.MockTransport) -> GoogleCalendarSource:
    return GoogleCalendarSource(
        client_id="a-client-id", client_secret="a-client-secret", transport=handler
    )


class TestExchangeCode:
    async def test_returns_the_identity_and_refresh_token_on_success(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            if request.url == TOKEN_URL:
                assert "client_secret=a-client-secret" in request.content.decode()
                return httpx.Response(200, json={"access_token": "at-1", "refresh_token": "rt-1"})
            assert request.url == USERINFO_URL
            assert request.headers["Authorization"] == "Bearer at-1"
            return httpx.Response(200, json={"id": "google-123", "email": "a@example.com"})

        credential = await adapter(httpx.MockTransport(handle)).exchange_code(
            "auth-code", redirect_uri="https://tuk-tuk.example/api/v1/google/callback"
        )

        assert credential.google_account_id == "google-123"
        assert credential.email == "a@example.com"
        assert credential.refresh_token == "rt-1"

    async def test_raises_terminal_when_google_rejects_the_code(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": "invalid_grant"})

        with pytest.raises(TerminalCalendarSourceError):
            await adapter(httpx.MockTransport(handle)).exchange_code(
                "bad-code", redirect_uri="https://tuk-tuk.example/api/v1/google/callback"
            )

    async def test_raises_when_google_grants_no_refresh_token(self) -> None:
        """Google omits refresh_token on a repeat consent without
        prompt=consent; treated as a hard failure rather than silently
        losing the ability to stay connected."""

        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"access_token": "at-1"})

        with pytest.raises(TerminalCalendarSourceError):
            await adapter(httpx.MockTransport(handle)).exchange_code(
                "auth-code", redirect_uri="https://tuk-tuk.example/api/v1/google/callback"
            )

    async def test_raises_transient_when_userinfo_lookup_fails(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            if request.url == TOKEN_URL:
                return httpx.Response(200, json={"access_token": "at-1", "refresh_token": "rt-1"})
            return httpx.Response(500, text="server error")

        with pytest.raises(TransientCalendarSourceError):
            await adapter(httpx.MockTransport(handle)).exchange_code(
                "auth-code", redirect_uri="https://tuk-tuk.example/api/v1/google/callback"
            )


class TestRefresh:
    async def test_returns_a_fresh_access_token(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            assert request.url == TOKEN_URL
            assert "refresh_token=rt-1" in request.content.decode()
            return httpx.Response(200, json={"access_token": "at-2"})

        token = await adapter(httpx.MockTransport(handle)).refresh("rt-1")

        assert token.access_token == "at-2"

    async def test_raises_terminal_when_the_refresh_token_is_revoked(self) -> None:
        """Adapter-level coverage (issue #109): a revoked grant maps to
        TerminalCalendarSourceError, never the retry-safe transient kind —
        retrying a revoked refresh token can never succeed."""

        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": "invalid_grant"})

        with pytest.raises(TerminalCalendarSourceError):
            await adapter(httpx.MockTransport(handle)).refresh("revoked-token")

    async def test_raises_transient_when_google_returns_a_server_error(self) -> None:
        """Adapter-level coverage (issue #109): a 5xx maps to
        TransientCalendarSourceError — the credential is fine, only the
        request failed."""

        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, text="server error")

        with pytest.raises(TransientCalendarSourceError):
            await adapter(httpx.MockTransport(handle)).refresh("rt-1")

    async def test_a_credential_refreshed_mid_request_is_not_served_stale(self) -> None:
        """Adapter-level coverage (issue #109): the adapter caches nothing
        across calls, so two refreshes in sequence — as events.py issues
        when re-checking a credential mid-request — each return whatever
        Google answers with at that moment, never a token minted earlier."""
        tokens = iter(["at-first", "at-second"])

        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"access_token": next(tokens)})

        source = adapter(httpx.MockTransport(handle))
        first = await source.refresh("rt-1")
        second = await source.refresh("rt-1")

        assert first.access_token == "at-first"
        assert second.access_token == "at-second"


class TestListEvents:
    async def test_returns_a_timed_event_converted_to_utc(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/calendar/v3/calendars/cal-1/events"
            assert request.headers["Authorization"] == "Bearer at-1"
            assert request.url.params["singleEvents"] == "true"
            assert request.url.params["timeMin"] == "2026-07-01T00:00:00Z"
            assert request.url.params["timeMax"] == "2026-07-02T00:00:00Z"
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-1",
                            "status": "confirmed",
                            "summary": "Standup",
                            "start": {
                                "dateTime": "2026-07-01T09:00:00-04:00",
                                "timeZone": "America/New_York",
                            },
                            "end": {
                                "dateTime": "2026-07-01T09:30:00-04:00",
                                "timeZone": "America/New_York",
                            },
                        }
                    ]
                },
            )

        events = await adapter(httpx.MockTransport(handle)).list_events(
            "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-02T00:00:00Z"
        )

        assert len(events) == 1
        assert events[0].google_event_id == "evt-1"
        assert events[0].summary == "Standup"
        assert events[0].is_all_day is False
        assert events[0].start == "2026-07-01T13:00:00Z"
        assert events[0].end == "2026-07-01T13:30:00Z"

    async def test_returns_a_midnight_crossing_event_with_start_and_end_on_different_days(
        self,
    ) -> None:
        """A flight departing 23:00 and landing 01:00 the next day — the
        adapter passes the crossing through untouched; splitting it into a
        per-day segment is a Calendar-view rendering concern (issue #108),
        not something this normalisation layer does."""

        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-flight",
                            "status": "confirmed",
                            "summary": "Flight",
                            "start": {"dateTime": "2026-07-01T23:00:00Z"},
                            "end": {"dateTime": "2026-07-02T01:00:00Z"},
                        }
                    ]
                },
            )

        events = await adapter(httpx.MockTransport(handle)).list_events(
            "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-03T00:00:00Z"
        )

        assert len(events) == 1
        assert events[0].is_all_day is False
        assert events[0].start == "2026-07-01T23:00:00Z"
        assert events[0].end == "2026-07-02T01:00:00Z"

    async def test_url_encodes_a_calendar_id_containing_special_characters(self) -> None:
        seen_paths = []

        def handle(request: httpx.Request) -> httpx.Response:
            seen_paths.append(request.url.path)
            return httpx.Response(200, json={"items": []})

        await adapter(httpx.MockTransport(handle)).list_events(
            "at-1",
            "someone@example.com",
            time_min="2026-07-01T00:00:00Z",
            time_max="2026-07-02T00:00:00Z",
        )

        assert seen_paths == ["/calendar/v3/calendars/someone@example.com/events"]

    async def test_normalises_googles_exclusive_all_day_end_date(self) -> None:
        """A 3-day all-day trip Jul 10-12 comes back from Google as
        start=2026-07-10, end=2026-07-13 (exclusive); without normalising,
        it would read as spanning 4 days instead of 3."""

        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-trip",
                            "status": "confirmed",
                            "summary": "Trip",
                            "start": {"date": "2026-07-10"},
                            "end": {"date": "2026-07-13"},
                        }
                    ]
                },
            )

        events = await adapter(httpx.MockTransport(handle)).list_events(
            "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-31T00:00:00Z"
        )

        assert events[0].is_all_day is True
        assert events[0].start == "2026-07-10T00:00:00Z"
        assert events[0].end == "2026-07-12T00:00:00Z"

    async def test_follows_pagination_across_multiple_pages(self) -> None:
        pages = {
            None: httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-1",
                            "status": "confirmed",
                            "summary": "First",
                            "start": {"date": "2026-07-01"},
                            "end": {"date": "2026-07-02"},
                        }
                    ],
                    "nextPageToken": "page-2",
                },
            ),
            "page-2": httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-2",
                            "status": "confirmed",
                            "summary": "Second",
                            "start": {"date": "2026-07-05"},
                            "end": {"date": "2026-07-06"},
                        }
                    ]
                },
            ),
        }

        def handle(request: httpx.Request) -> httpx.Response:
            token = request.url.params.get("pageToken")
            return pages[token]

        events = await adapter(httpx.MockTransport(handle)).list_events(
            "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-31T00:00:00Z"
        )

        assert [event.google_event_id for event in events] == ["evt-1", "evt-2"]

    async def test_drops_a_cancelled_event(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-cancelled",
                            "status": "cancelled",
                            "summary": "Cancelled",
                            "start": {"date": "2026-07-01"},
                            "end": {"date": "2026-07-02"},
                        }
                    ]
                },
            )

        events = await adapter(httpx.MockTransport(handle)).list_events(
            "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-02T00:00:00Z"
        )

        assert events == []

    async def test_drops_an_event_declined_by_the_authenticated_attendee(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-declined",
                            "status": "confirmed",
                            "summary": "Declined",
                            "start": {"date": "2026-07-01"},
                            "end": {"date": "2026-07-02"},
                            "attendees": [
                                {
                                    "email": "me@example.com",
                                    "self": True,
                                    "responseStatus": "declined",
                                }
                            ],
                        }
                    ]
                },
            )

        events = await adapter(httpx.MockTransport(handle)).list_events(
            "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-02T00:00:00Z"
        )

        assert events == []

    async def test_keeps_a_needs_action_event_visible(self) -> None:
        """A pending invitation must not be invisible."""

        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-pending",
                            "status": "confirmed",
                            "summary": "Pending",
                            "start": {"date": "2026-07-01"},
                            "end": {"date": "2026-07-02"},
                            "attendees": [
                                {
                                    "email": "me@example.com",
                                    "self": True,
                                    "responseStatus": "needsAction",
                                }
                            ],
                        }
                    ]
                },
            )

        events = await adapter(httpx.MockTransport(handle)).list_events(
            "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-02T00:00:00Z"
        )

        assert len(events) == 1

    async def test_parses_location_description_and_html_link(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-1",
                            "status": "confirmed",
                            "summary": "Standup",
                            "location": "Room 4B",
                            "description": "Daily sync",
                            "htmlLink": "https://www.google.com/calendar/event?eid=abc",
                            "start": {"dateTime": "2026-07-01T09:00:00Z"},
                            "end": {"dateTime": "2026-07-01T09:30:00Z"},
                        }
                    ]
                },
            )

        events = await adapter(httpx.MockTransport(handle)).list_events(
            "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-02T00:00:00Z"
        )

        assert events[0].location == "Room 4B"
        assert events[0].description == "Daily sync"
        assert events[0].html_link == "https://www.google.com/calendar/event?eid=abc"

    async def test_parses_attendees_and_organizer(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-1",
                            "status": "confirmed",
                            "summary": "Standup",
                            "organizer": {"email": "boss@example.com", "displayName": "Boss"},
                            "attendees": [
                                {
                                    "email": "me@example.com",
                                    "displayName": "Me",
                                    "self": True,
                                    "responseStatus": "accepted",
                                },
                                {"email": "other@example.com", "responseStatus": "needsAction"},
                            ],
                            "start": {"dateTime": "2026-07-01T09:00:00Z"},
                            "end": {"dateTime": "2026-07-01T09:30:00Z"},
                        }
                    ]
                },
            )

        events = await adapter(httpx.MockTransport(handle)).list_events(
            "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-02T00:00:00Z"
        )

        assert events[0].organizer is not None
        assert events[0].organizer.email == "boss@example.com"
        assert events[0].organizer.display_name == "Boss"
        assert [a.email for a in events[0].attendees] == ["me@example.com", "other@example.com"]
        assert events[0].attendees[1].display_name is None

    async def test_leaves_optional_fields_at_their_defaults_when_absent(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "evt-1",
                            "status": "confirmed",
                            "summary": "Standup",
                            "start": {"dateTime": "2026-07-01T09:00:00Z"},
                            "end": {"dateTime": "2026-07-01T09:30:00Z"},
                        }
                    ]
                },
            )

        events = await adapter(httpx.MockTransport(handle)).list_events(
            "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-02T00:00:00Z"
        )

        assert events[0].location is None
        assert events[0].description is None
        assert events[0].organizer is None
        assert events[0].attendees == []
        assert events[0].html_link == ""

    async def test_raises_transient_when_google_rejects_the_events_request(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, text="server error")

        with pytest.raises(TransientCalendarSourceError):
            await adapter(httpx.MockTransport(handle)).list_events(
                "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-02T00:00:00Z"
            )

    async def test_raises_terminal_when_the_access_token_is_rejected(self) -> None:
        """A 401 on the events call itself (as opposed to on refresh) still
        means the credential is no good — e.g. the grant was revoked after
        the access token was minted but before this call landed."""

        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"error": "invalid_credentials"})

        with pytest.raises(TerminalCalendarSourceError):
            await adapter(httpx.MockTransport(handle)).list_events(
                "at-1", "cal-1", time_min="2026-07-01T00:00:00Z", time_max="2026-07-02T00:00:00Z"
            )
