"""Events render in the Calendar view (issue #107).

Every test drives the HTTP API, exactly as tests/test_google_calendars.py
does; a fake CalendarSource stands in for Google.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.calendar_source import CalendarEventEntry, CalendarListEntry
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
        google_encryption_key="a-dedicated-key",
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


def window(client: TestClient, start: str, end: str) -> list[dict]:
    response = client.get(f"/api/v1/events?range_start={start}&range_end={end}")
    assert response.status_code == 200, response.text
    return response.json()


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
