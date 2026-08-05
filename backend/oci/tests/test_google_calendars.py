"""Choosing which Google calendars are visible (issue #106).

Calendars are lazily seeded the first time an account's calendar list is
requested (no Google call happens on the OAuth callback path), and
thereafter live entirely in tuk-tuk until an explicit refresh re-reads
Google's list. Every test drives the HTTP API, exactly as
tests/test_google_accounts.py does.
"""

import sqlite3
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.calendar_source import (
    CalendarListEntry,
    TerminalCalendarSourceError,
    TransientCalendarSourceError,
)
from app.routers.v1.google import CALENDAR_COLOR_PALETTE
from tests.conftest import FakeCalendarSource, FakeClock
from tests.test_google_accounts import connect_and_authorize, make_client


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


def connect_account(
    client: TestClient,
    fake_calendar_source: FakeCalendarSource,
    *,
    refresh_token: str = "rt-1",
    google_account_id: str = "google-1",
    email: str = "me@example.com",
) -> int:
    connect_and_authorize(
        client,
        fake_calendar_source,
        code=f"code-for-{refresh_token}",
        google_account_id=google_account_id,
        email=email,
        refresh_token=refresh_token,
    )
    accounts = client.get("/api/v1/google/accounts").json()
    return next(account["id"] for account in accounts if account["email"] == email)


class TestListCalendars:
    def test_lists_calendars_by_name(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1",
            [
                CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True),
                CalendarListEntry(google_calendar_id="cal-2", summary="Holidays", selected=False),
            ],
        )

        response = configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars")

        assert response.status_code == 200
        assert sorted(c["summary"] for c in response.json()) == ["Holidays", "Work"]

    def test_seeds_visibility_from_googles_selected_flag(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1",
            [
                CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True),
                CalendarListEntry(google_calendar_id="cal-2", summary="Holidays", selected=False),
            ],
        )

        calendars = configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars").json()

        assert {c["summary"]: c["enabled"] for c in calendars} == {
            "Work": True,
            "Holidays": False,
        }

    def test_each_calendar_carries_a_colour_from_tuktuks_palette(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1", [CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True)]
        )

        calendars = configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars").json()

        assert calendars[0]["color"] in CALENDAR_COLOR_PALETTE

    def test_repeated_requests_do_not_duplicate_calendars(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1", [CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True)]
        )

        configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars")
        second = configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars")

        assert len(second.json()) == 1

    def test_is_not_found_when_unconfigured(self, unconfigured_client: TestClient) -> None:
        assert unconfigured_client.get("/api/v1/google/accounts/1/calendars").status_code == 404

    def test_is_not_found_for_an_unknown_account(self, configured_client: TestClient) -> None:
        response = configured_client.get("/api/v1/google/accounts/999/calendars")

        assert response.status_code == 404


class TestUpdateCalendar:
    def test_toggling_visibility_persists_across_reloads(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1", [CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True)]
        )
        calendar_id = configured_client.get(
            f"/api/v1/google/accounts/{account_id}/calendars"
        ).json()[0]["id"]

        patch_response = configured_client.patch(
            f"/api/v1/google/accounts/{account_id}/calendars/{calendar_id}",
            json={"enabled": False},
        )

        assert patch_response.status_code == 200
        assert patch_response.json()["enabled"] is False
        reloaded = configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars").json()
        assert reloaded[0]["enabled"] is False

    def test_colour_is_editable_from_the_palette(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1", [CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True)]
        )
        calendar_id = configured_client.get(
            f"/api/v1/google/accounts/{account_id}/calendars"
        ).json()[0]["id"]
        new_color = next(c for c in CALENDAR_COLOR_PALETTE if c != CALENDAR_COLOR_PALETTE[0])

        patch_response = configured_client.patch(
            f"/api/v1/google/accounts/{account_id}/calendars/{calendar_id}",
            json={"color": new_color},
        )

        assert patch_response.status_code == 200
        assert patch_response.json()["color"] == new_color

    def test_is_not_found_for_an_unknown_calendar(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        response = configured_client.patch(
            f"/api/v1/google/accounts/{account_id}/calendars/999", json={"enabled": False}
        )

        assert response.status_code == 404

    def test_a_colour_outside_tuktuks_palette_is_rejected(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1", [CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True)]
        )
        calendar_id = configured_client.get(
            f"/api/v1/google/accounts/{account_id}/calendars"
        ).json()[0]["id"]

        response = configured_client.patch(
            f"/api/v1/google/accounts/{account_id}/calendars/{calendar_id}",
            json={"color": "#123456"},
        )

        assert response.status_code == 422


class TestRefresh:
    def test_refresh_picks_up_a_calendar_created_since_connecting(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1", [CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True)]
        )
        configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars")
        fake_calendar_source.register_calendars(
            "rt-1",
            [
                CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True),
                CalendarListEntry(
                    google_calendar_id="cal-2", summary="New Calendar", selected=True
                ),
            ],
        )

        response = configured_client.post(f"/api/v1/google/accounts/{account_id}/calendars/refresh")

        assert response.status_code == 200
        assert sorted(c["summary"] for c in response.json()) == ["New Calendar", "Work"]

    def test_refresh_preserves_visibility_and_colour_already_chosen(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1", [CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True)]
        )
        calendar = configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars").json()[
            0
        ]
        chosen_color = next(c for c in CALENDAR_COLOR_PALETTE if c != calendar["color"])
        configured_client.patch(
            f"/api/v1/google/accounts/{account_id}/calendars/{calendar['id']}",
            json={"enabled": False, "color": chosen_color},
        )
        # Google's own selected flag flips back to True and the name
        # changes; neither should move the locally-chosen values.
        fake_calendar_source.register_calendars(
            "rt-1",
            [CalendarListEntry(google_calendar_id="cal-1", summary="Work Renamed", selected=True)],
        )

        response = configured_client.post(f"/api/v1/google/accounts/{account_id}/calendars/refresh")

        refreshed = response.json()[0]
        assert refreshed["enabled"] is False
        assert refreshed["color"] == chosen_color
        assert refreshed["summary"] == "Work Renamed"

    def test_is_not_found_when_unconfigured(self, unconfigured_client: TestClient) -> None:
        response = unconfigured_client.post("/api/v1/google/accounts/1/calendars/refresh")

        assert response.status_code == 404

    def test_is_not_found_for_an_unknown_account(self, configured_client: TestClient) -> None:
        response = configured_client.post("/api/v1/google/accounts/999/calendars/refresh")

        assert response.status_code == 404

    def test_a_terminal_failure_marks_the_account_as_needing_reconnection(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        """Issue #109: the same connection_state flip the Events endpoint
        performs on a revoked grant, exercised from the Settings-driven
        refresh path too."""
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_refresh_error(
            "rt-1", TerminalCalendarSourceError("invalid_grant")
        )

        response = configured_client.post(f"/api/v1/google/accounts/{account_id}/calendars/refresh")

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "google_reconnect_required"
        account = next(
            a
            for a in configured_client.get("/api/v1/google/accounts").json()
            if a["id"] == account_id
        )
        assert account["connection_state"] == "needs_reconnect"

    def test_a_transient_failure_leaves_the_account_connected(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_refresh_error(
            "rt-1", TransientCalendarSourceError("server error")
        )

        response = configured_client.post(f"/api/v1/google/accounts/{account_id}/calendars/refresh")

        assert response.status_code == 502
        assert response.json()["error"]["code"] == "google_unavailable"
        account = next(
            a
            for a in configured_client.get("/api/v1/google/accounts").json()
            if a["id"] == account_id
        )
        assert account["connection_state"] == "connected"


class TestDisconnectRemovesCalendars:
    def test_disconnecting_removes_its_calendars(
        self,
        configured_client: TestClient,
        fake_calendar_source: FakeCalendarSource,
        database_url: str,
    ) -> None:
        account_id = connect_account(configured_client, fake_calendar_source)
        fake_calendar_source.register_calendars(
            "rt-1", [CalendarListEntry(google_calendar_id="cal-1", summary="Work", selected=True)]
        )
        configured_client.get(f"/api/v1/google/accounts/{account_id}/calendars")

        configured_client.delete(f"/api/v1/google/accounts/{account_id}")

        db_path = database_url.removeprefix("sqlite+aiosqlite:///")
        rows = sqlite3.connect(db_path).execute("SELECT * FROM google_calendars").fetchall()
        assert rows == []
