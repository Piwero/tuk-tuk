"""Events render in the Calendar view (issue #107).

Every test drives the HTTP API, exactly as tests/test_google_calendars.py
does; a fake CalendarSource stands in for Google.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.calendar_source import (
    CalendarEventEntry,
    CalendarListEntry,
    EventAttendee,
    TerminalCalendarSourceError,
    TransientCalendarSourceError,
)
from tests.conftest import FakeCalendarSource, FakeClock
from tests.test_google_accounts import connect_and_authorize, make_client
from tests.test_google_calendars import connect_account


@pytest.fixture
def configured_client(
    database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
) -> Iterator[TestClient]:
    with make_client(
        database_url,
        fake_clock,
        fake_calendar_source,
        google_client_id="a-client-id",
        google_client_secret="a-client-secret",
        cors_origins=["http://localhost:5900"],
    ) as test_client:
        yield test_client


@pytest.fixture
def unconfigured_client(
    database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
) -> Iterator[TestClient]:
    with make_client(database_url, fake_clock, fake_calendar_source) as test_client:
        yield test_client


def seed_one_enabled_calendar(
    client: TestClient, fake_calendar_source: FakeCalendarSource, *, refresh_token: str = "rt-1"
) -> tuple[int, str]:
    """Connects an account with a single enabled calendar and returns
    (account_id, google_calendar_id)."""
    account_id = connect_account(client, fake_calendar_source, refresh_token=refresh_token)
    fake_calendar_source.register_calendars(
        refresh_token,
        [CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True)],
    )
    client.get(f"/api/v1/google/accounts/{account_id}/calendars")
    return account_id, "cal-1"


def read_events(client: TestClient, start: str, end: str, *, force: bool = False) -> dict:
    query = f"range_start={start}&range_end={end}"
    if force:
        query += "&force=true"
    response = client.get(f"/api/v1/events?{query}")
    assert response.status_code == 200, response.text
    return response.json()


def window(client: TestClient, start: str, end: str) -> list[dict]:
    return read_events(client, start, end)["events"]


class TestListEvents:
    def test_events_from_an_enabled_calendar_appear(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )

        events = window(configured_client, "2026-07-01", "2026-07-31")

        assert [event["title"] for event in events] == ["Standup"]
        assert events[0]["start_date"] == "2026-07-10T13:00:00Z"
        assert events[0]["due_date"] == "2026-07-10T13:30:00Z"
        assert events[0]["is_all_day"] is False

    def test_a_disabled_calendars_events_are_excluded(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        calendar_id = configured_client.get(
            f"/api/v1/google/accounts/{account_id}/calendars"
        ).json()[0]["id"]
        configured_client.patch(
            f"/api/v1/google/accounts/{account_id}/calendars/{calendar_id}",
            json={"enabled": False},
        )
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )

        assert window(configured_client, "2026-07-01", "2026-07-31") == []

    def test_events_from_every_connected_account_are_combined(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        seed_one_enabled_calendar(configured_client, fake_calendar_source, refresh_token="rt-1")
        connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="code-for-rt-2",
            google_account_id="google-2",
            email="second@example.com",
            refresh_token="rt-2",
        )
        second_account_id = next(
            account["id"]
            for account in configured_client.get("/api/v1/google/accounts").json()
            if account["email"] == "second@example.com"
        )
        fake_calendar_source.register_calendars(
            "rt-2",
            [CalendarListEntry(google_calendar_id="cal-2", summary="Personal", selected=True)],
        )
        configured_client.get(f"/api/v1/google/accounts/{second_account_id}/calendars")
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Work meeting",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )
        fake_calendar_source.register_events(
            "rt-2",
            "cal-2",
            [
                CalendarEventEntry(
                    google_event_id="evt-2",
                    summary="Dentist",
                    start="2026-07-11T13:00:00Z",
                    end="2026-07-11T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )

        events = window(configured_client, "2026-07-01", "2026-07-31")

        assert sorted(event["title"] for event in events) == ["Dentist", "Work meeting"]

    def test_events_from_two_calendars_get_distinct_ids(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        """Two calendars could, in principle, both contain an event with
        the same Google event id; the id shipped to the frontend must stay
        unique regardless, since it's a React list key."""
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1",
            [
                CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True),
                CalendarListEntry(google_calendar_id="cal-2", summary="Home", selected=True),
            ],
        )
        configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars")
        shared_event = CalendarEventEntry(
            google_event_id="evt-shared",
            summary="Same id, different calendar",
            start="2026-07-10T13:00:00Z",
            end="2026-07-10T13:30:00Z",
            is_all_day=False,
        )
        fake_calendar_source.register_events("rt-1", "cal-1", [shared_event])
        fake_calendar_source.register_events("rt-1", "cal-2", [shared_event])

        events = window(configured_client, "2026-07-01", "2026-07-31")

        assert len({event["id"] for event in events}) == 2

    def test_is_empty_when_google_is_unconfigured(self, unconfigured_client: TestClient) -> None:
        assert window(unconfigured_client, "2026-07-01", "2026-07-31") == []

    def test_is_empty_with_no_connected_accounts(self, configured_client: TestClient) -> None:
        assert window(configured_client, "2026-07-01", "2026-07-31") == []

    def test_half_a_range_is_rejected(self, configured_client: TestClient) -> None:
        response = configured_client.get("/api/v1/events?range_start=2026-07-01")

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    def test_a_backwards_range_is_rejected(self, configured_client: TestClient) -> None:
        response = configured_client.get(
            "/api/v1/events?range_start=2026-07-31&range_end=2026-07-01"
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    def test_each_event_carries_its_calendars_colour(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        calendar = configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars").json()[
            0
        ]
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )

        events = window(configured_client, "2026-07-01", "2026-07-31")

        assert events[0]["color"] == calendar["color"]

    def test_each_event_carries_the_account_email_and_calendar_name(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        calendar = configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars").json()[
            0
        ]
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )

        events = window(configured_client, "2026-07-01", "2026-07-31")

        assert events[0]["account_email"] == "me@example.com"
        assert events[0]["calendar_summary"] == calendar["summary"]

    def test_an_events_full_detail_passes_through_to_the_frontend(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                    location="Room 4B",
                    description="Daily sync",
                    attendees=[
                        EventAttendee(email="me@example.com", display_name="Me"),
                        EventAttendee(email="other@example.com", display_name=None),
                    ],
                    organizer=EventAttendee(email="boss@example.com", display_name="Boss"),
                    html_link="https://www.google.com/calendar/event?eid=abc",
                )
            ],
        )

        events = window(configured_client, "2026-07-01", "2026-07-31")

        assert events[0]["location"] == "Room 4B"
        assert events[0]["description"] == "Daily sync"
        assert events[0]["attendees"] == [
            {"email": "me@example.com", "display_name": "Me"},
            {"email": "other@example.com", "display_name": None},
        ]
        assert events[0]["organizer"] == {"email": "boss@example.com", "display_name": "Boss"}
        assert events[0]["html_link"] == "https://www.google.com/calendar/event?eid=abc"

    def test_an_events_optional_detail_defaults_to_empty(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )

        events = window(configured_client, "2026-07-01", "2026-07-31")

        assert events[0]["location"] is None
        assert events[0]["description"] is None
        assert events[0]["attendees"] == []
        assert events[0]["organizer"] is None
        assert events[0]["html_link"] == ""


def connect_second_account(
    client: TestClient,
    fake_calendar_source: FakeCalendarSource,
    *,
    refresh_token: str = "rt-2",
    email: str = "second@example.com",
) -> int:
    connect_and_authorize(
        client,
        fake_calendar_source,
        code=f"code-for-{refresh_token}",
        google_account_id=f"google-{refresh_token}",
        email=email,
        refresh_token=refresh_token,
    )
    return next(
        account["id"]
        for account in client.get("/api/v1/google/accounts").json()
        if account["email"] == email
    )


class TestPerAccountFailures:
    """Issue #109: one account's failure to read never blanks the Calendar
    view of every other account's Events, and the two kinds of failure —
    transient and terminal — are told apart and reported differently."""

    def test_a_transient_failure_on_one_account_still_renders_the_others(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        seed_one_enabled_calendar(configured_client, fake_calendar_source, refresh_token="rt-1")
        second_account_id = connect_second_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-2",
            [CalendarListEntry(google_calendar_id="cal-2", summary="Personal", selected=True)],
        )
        configured_client.get(f"/api/v1/google/accounts/{second_account_id}/calendars")
        fake_calendar_source.register_events(
            "rt-2",
            "cal-2",
            [
                CalendarEventEntry(
                    google_event_id="evt-2",
                    summary="Dentist",
                    start="2026-07-11T13:00:00Z",
                    end="2026-07-11T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )
        fake_calendar_source.register_refresh_error(
            "rt-1", TransientCalendarSourceError("server error")
        )

        body = read_events(configured_client, "2026-07-01", "2026-07-31")

        assert [event["title"] for event in body["events"]] == ["Dentist"]
        assert len(body["failures"]) == 1
        assert body["failures"][0]["kind"] == "transient"
        assert "email" in body["failures"][0]

    def test_a_transient_failure_names_the_failed_account_and_leaves_it_connected(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_refresh_error(
            "rt-1", TransientCalendarSourceError("rate limited")
        )

        body = read_events(configured_client, "2026-07-01", "2026-07-31")

        assert body["failures"] == [
            {
                "account_id": account_id,
                "email": "me@example.com",
                "kind": "transient",
                "message": "rate limited",
            }
        ]
        account = next(
            a
            for a in configured_client.get("/api/v1/google/accounts").json()
            if a["id"] == account_id
        )
        assert account["connection_state"] == "connected"

    def test_a_terminal_failure_marks_the_account_as_needing_reconnection(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_refresh_error(
            "rt-1", TerminalCalendarSourceError("invalid_grant")
        )

        body = read_events(configured_client, "2026-07-01", "2026-07-31")

        assert body["failures"][0]["kind"] == "terminal"
        account = next(
            a
            for a in configured_client.get("/api/v1/google/accounts").json()
            if a["id"] == account_id
        )
        assert account["connection_state"] == "needs_reconnect"

    def test_a_later_successful_read_clears_a_stale_reconnect_flag(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        """The underlying problem (e.g. a disabled Calendar API) can be
        fixed without a fresh OAuth consent — the next successful Events
        read must clear "needs_reconnect" on its own, or the banner would
        lie about the account being broken forever."""
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_refresh_error(
            "rt-1", TerminalCalendarSourceError("invalid_grant")
        )
        read_events(configured_client, "2026-07-01", "2026-07-31")

        fake_calendar_source.clear_refresh_error("rt-1")
        body = read_events(configured_client, "2026-07-01", "2026-07-31")

        assert body["failures"] == []
        account = next(
            a
            for a in configured_client.get("/api/v1/google/accounts").json()
            if a["id"] == account_id
        )
        assert account["connection_state"] == "connected"

    def test_a_failure_on_one_calendar_is_reported_against_its_account(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_list_events_error(
            "rt-1", "cal-1", TransientCalendarSourceError("server error")
        )

        body = read_events(configured_client, "2026-07-01", "2026-07-31")

        assert body["events"] == []
        assert body["failures"][0]["account_id"] == account_id
        assert body["failures"][0]["kind"] == "transient"


class TestEventCaching:
    """Issue #109: a short-lived cache at the CalendarSource boundary
    absorbs rapid navigation across the calendar window without re-reading
    Google on every request; `force=true` bypasses it."""

    def test_a_second_read_of_a_fully_cached_account_does_not_even_refresh_the_credential(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        """A credential refresh is itself a request to Google (the token
        endpoint) — rapid navigation within the cache window must not
        re-issue it either, not just skip the events read itself."""
        seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_events("rt-1", "cal-1", [])

        window(configured_client, "2026-07-01", "2026-07-31")
        refreshes_after_first_read = fake_calendar_source.refresh_calls.count("rt-1")

        window(configured_client, "2026-07-01", "2026-07-31")
        assert fake_calendar_source.refresh_calls.count("rt-1") == refreshes_after_first_read

    def test_a_second_read_of_the_same_window_does_not_refetch(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )
        assert [e["title"] for e in window(configured_client, "2026-07-01", "2026-07-31")] == [
            "Standup"
        ]

        # A stale registration would only be seen by the fake if the route
        # actually re-called list_events instead of serving the cache.
        fake_calendar_source.register_events("rt-1", "cal-1", [])

        assert [e["title"] for e in window(configured_client, "2026-07-01", "2026-07-31")] == [
            "Standup"
        ]

    def test_force_bypasses_the_cache(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )
        window(configured_client, "2026-07-01", "2026-07-31")
        fake_calendar_source.register_events("rt-1", "cal-1", [])

        body = read_events(configured_client, "2026-07-01", "2026-07-31", force=True)

        assert body["events"] == []

    def test_a_different_window_is_not_served_from_the_others_cache(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )
        window(configured_client, "2026-07-01", "2026-07-31")
        fake_calendar_source.register_events("rt-1", "cal-1", [])

        assert window(configured_client, "2026-08-01", "2026-08-31") == []


class TestConvertedEventsAreHidden:
    """Issue #111: an Event converted to a Task is remembered as provenance
    on the Task (no Event storage exists — ADR 0006), and filtered out of
    every subsequent read by matching that provenance against the live
    Google Event it would otherwise be reported as.
    """

    def test_an_events_id_and_calendar_id_are_exposed_for_conversion(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        calendar_id = configured_client.get(
            f"/api/v1/google/accounts/{account_id}/calendars"
        ).json()[0]["id"]
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )

        events = window(configured_client, "2026-07-01", "2026-07-31")

        assert events[0]["calendar_id"] == calendar_id
        assert events[0]["google_event_id"] == "evt-1"

    def test_converting_an_event_hides_it(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        calendar_id = configured_client.get(
            f"/api/v1/google/accounts/{account_id}/calendars"
        ).json()[0]["id"]
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )

        configured_client.post(
            "/api/v1/tasks",
            json={
                "title": "Standup",
                "source_google_calendar_id": calendar_id,
                "source_google_event_id": "evt-1",
            },
        )

        assert window(configured_client, "2026-07-01", "2026-07-31") == []

    def test_hiding_survives_rescheduling_the_task(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        calendar_id = configured_client.get(
            f"/api/v1/google/accounts/{account_id}/calendars"
        ).json()[0]["id"]
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )
        task_id = configured_client.post(
            "/api/v1/tasks",
            json={
                "title": "Standup",
                "source_google_calendar_id": calendar_id,
                "source_google_event_id": "evt-1",
            },
        ).json()["id"]

        configured_client.patch(
            f"/api/v1/tasks/{task_id}",
            json={"due_date": "2026-07-15T13:30:00Z"},
        )

        assert window(configured_client, "2026-07-01", "2026-07-31") == []

    def test_deleting_the_task_reveals_the_event_again(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        calendar_id = configured_client.get(
            f"/api/v1/google/accounts/{account_id}/calendars"
        ).json()[0]["id"]
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Standup",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                )
            ],
        )
        task_id = configured_client.post(
            "/api/v1/tasks",
            json={
                "title": "Standup",
                "source_google_calendar_id": calendar_id,
                "source_google_event_id": "evt-1",
            },
        ).json()["id"]
        assert window(configured_client, "2026-07-01", "2026-07-31") == []

        configured_client.delete(f"/api/v1/tasks/{task_id}")

        assert [e["title"] for e in window(configured_client, "2026-07-01", "2026-07-31")] == [
            "Standup"
        ]

    def test_converting_one_occurrence_of_a_series_leaves_the_others_showing(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id, _ = seed_one_enabled_calendar(configured_client, fake_calendar_source)
        calendar_id = configured_client.get(
            f"/api/v1/google/accounts/{account_id}/calendars"
        ).json()[0]["id"]
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Weekly sync",
                    start="2026-07-10T13:00:00Z",
                    end="2026-07-10T13:30:00Z",
                    is_all_day=False,
                ),
                CalendarEventEntry(
                    google_event_id="evt-2",
                    summary="Weekly sync",
                    start="2026-07-17T13:00:00Z",
                    end="2026-07-17T13:30:00Z",
                    is_all_day=False,
                ),
            ],
        )

        configured_client.post(
            "/api/v1/tasks",
            json={
                "title": "Weekly sync",
                "source_google_calendar_id": calendar_id,
                "source_google_event_id": "evt-1",
            },
        )

        events = window(configured_client, "2026-07-01", "2026-07-31")
        assert [e["google_event_id"] for e in events] == ["evt-2"]
