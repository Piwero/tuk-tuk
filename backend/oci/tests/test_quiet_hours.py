"""Quiet hours (issue #567): a per-User band of the day during which
Reminder notifications are held back. A Reminder falling due inside the band
is deferred to the band's end and then notifies once, deduplicated by the
delivery ledger (ADR 0019). A notification setting, separate from Active
hours, which only shapes the Calendar grid.

The band is wall-clock time in the claiming tab's zone, like an all-day
Task's anchor, and may wrap past midnight (22:00-07:00 is the usual night).
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.conftest import FakeClock
from tests.test_reminder_delivery import (
    CLAIM,
    LEDGER,
    claim,
    enable_delivery,
    ledger,
    make_task,
    report,
)

PATH = "/api/v1/settings/quiet-hours"


class TestQuietHoursSettings:
    def test_defaults_to_off_with_a_night_band(self, client: TestClient) -> None:
        response = client.get(PATH)

        assert response.status_code == 200
        assert response.json() == {"enabled": False, "start": "22:00", "end": "07:00"}

    def test_a_band_that_wraps_past_midnight_round_trips(self, client: TestClient) -> None:
        band = {"enabled": True, "start": "23:30", "end": "06:15"}

        put_response = client.put(PATH, json=band)

        assert put_response.status_code == 200, put_response.text
        assert put_response.json() == band
        assert client.get(PATH).json() == band

    @pytest.mark.parametrize(
        ("start", "end", "message"),
        [
            ("22:00", "22:00", "Quiet hours must start and end at different times"),
            ("7:00", "08:00", "'7:00' is not an HH:MM time"),
            ("24:00", "07:00", "'24:00' is not a time of day"),
            ("22:00", "07:60", "'07:60' is not a time of day"),
        ],
    )
    def test_an_invalid_band_is_rejected_with_a_reason_and_not_saved(
        self, client: TestClient, start: str, end: str, message: str
    ) -> None:
        response = client.put(PATH, json={"enabled": True, "start": start, "end": end})

        assert response.status_code == 422
        assert response.json()["error"] == {"code": "invalid_quiet_hours", "message": message}
        assert client.get(PATH).json()["enabled"] is False

    def test_saving_quiet_hours_leaves_active_hours_alone_and_back(
        self, client: TestClient
    ) -> None:
        active = {"enabled": True, "start": "09:00", "end": "17:00"}
        client.put("/api/v1/settings/active-hours", json=active)

        client.put(PATH, json={"enabled": True, "start": "13:00", "end": "14:00"})
        assert client.get("/api/v1/settings/active-hours").json() == active

        client.put("/api/v1/settings/active-hours", json={**active, "start": "08:00"})
        assert client.get(PATH).json() == {"enabled": True, "start": "13:00", "end": "14:00"}

    def test_requires_authentication(self, unauthenticated_client: TestClient) -> None:
        assert unauthenticated_client.get(PATH).status_code == 401


NIGHT = {"enabled": True, "start": "22:00", "end": "07:00"}


@pytest.fixture
def night(client: TestClient, fake_clock: FakeClock) -> FakeClock:
    """Notifications on, Quiet hours 22:00-07:00, and the clock at 21:00 UTC
    on an ordinary day (no DST change in UTC or Europe/Madrid nearby)."""
    enable_delivery(client)
    assert client.put(PATH, json=NIGHT).status_code == 200
    fake_clock.now = datetime(2026, 11, 10, 21, 0, tzinfo=UTC)
    return fake_clock


class TestHeldReminders:
    def test_a_reminder_due_inside_quiet_hours_is_held_until_they_end(
        self, client: TestClient, night: FakeClock
    ) -> None:
        make_task(client, datetime(2026, 11, 10, 23, 0, tzinfo=UTC), ["PT0S"])

        night.now = datetime(2026, 11, 10, 23, 0, tzinfo=UTC)
        assert claim(client, "?tz=UTC") == []

        night.now = datetime(2026, 11, 11, 6, 59, tzinfo=UTC)
        assert claim(client, "?tz=UTC") == []

        night.now = datetime(2026, 11, 11, 7, 0, 30, tzinfo=UTC)
        [item] = claim(client, "?tz=UTC")
        assert datetime.fromisoformat(item["fire_at"]) == datetime(2026, 11, 10, 23, 0, tzinfo=UTC)

    def test_a_held_reminder_is_delivered_once_after_quiet_hours(
        self, client: TestClient, night: FakeClock
    ) -> None:
        make_task(client, datetime(2026, 11, 11, 1, 0, tzinfo=UTC), ["-PT30M", "PT0S"])
        night.now = datetime(2026, 11, 11, 7, 0, tzinfo=UTC)

        items = claim(client, "?tz=UTC")
        assert sorted(item["offset"] for item in items) == ["-PT30M", "PT0S"]
        for item in items:
            report(client, item, "shown")

        night.now += timedelta(minutes=2)
        assert claim(client, "?tz=UTC") == []
        assert len(ledger(client)) == 2

    def test_two_tabs_share_a_held_reminder_and_it_notifies_once(
        self, client: TestClient, night: FakeClock
    ) -> None:
        make_task(client, datetime(2026, 11, 11, 3, 0, tzinfo=UTC), ["PT0S"])
        night.now = datetime(2026, 11, 11, 7, 0, 10, tzinfo=UTC)

        first_tab = claim(client, "?tz=UTC")
        second_tab = claim(client, "?tz=UTC")

        assert len(first_tab) == 1
        assert second_tab == []

    def test_a_held_reminder_is_missed_after_the_window_past_the_band_end(
        self, client: TestClient, night: FakeClock
    ) -> None:
        """The delivery window is measured from the band's end, not from
        the Reminder's own fire time; after it the Reminder is missed."""
        make_task(client, datetime(2026, 11, 11, 3, 0, tzinfo=UTC), ["PT0S"])

        night.now = datetime(2026, 11, 11, 7, 5, tzinfo=UTC)

        assert claim(client, "?tz=UTC") == []
        assert ledger(client) == []

    def test_a_reminder_due_outside_quiet_hours_is_not_held(
        self, client: TestClient, night: FakeClock
    ) -> None:
        make_task(client, datetime(2026, 11, 10, 21, 0, tzinfo=UTC), ["PT0S"])

        assert len(claim(client, "?tz=UTC")) == 1

    def test_the_band_end_is_outside_and_its_start_is_inside(
        self, client: TestClient, night: FakeClock
    ) -> None:
        make_task(client, datetime(2026, 11, 10, 22, 0, tzinfo=UTC), ["PT0S"], title="at start")
        make_task(client, datetime(2026, 11, 11, 7, 0, tzinfo=UTC), ["PT0S"], title="at end")

        night.now = datetime(2026, 11, 10, 22, 0, tzinfo=UTC)
        assert claim(client, "?tz=UTC") == []

        night.now = datetime(2026, 11, 11, 7, 0, tzinfo=UTC)
        assert sorted(item["task_title"] for item in claim(client, "?tz=UTC")) == [
            "at end",
            "at start",
        ]

    def test_turning_quiet_hours_off_releases_nothing_held_into_a_late_alert(
        self, client: TestClient, night: FakeClock
    ) -> None:
        """With the band gone, a Reminder that came due during it is past
        its own window: missed, never replayed."""
        make_task(client, datetime(2026, 11, 10, 23, 0, tzinfo=UTC), ["PT0S"])
        night.now = datetime(2026, 11, 11, 2, 0, tzinfo=UTC)

        client.put(PATH, json={**NIGHT, "enabled": False})

        assert claim(client, "?tz=UTC") == []

    def test_a_band_that_does_not_wrap_holds_until_the_same_day(
        self, client: TestClient, night: FakeClock
    ) -> None:
        client.put(PATH, json={"enabled": True, "start": "13:00", "end": "14:30"})
        make_task(client, datetime(2026, 11, 11, 13, 15, tzinfo=UTC), ["PT0S"])

        night.now = datetime(2026, 11, 11, 13, 15, tzinfo=UTC)
        assert claim(client, "?tz=UTC") == []
        night.now = datetime(2026, 11, 11, 14, 30, tzinfo=UTC)
        assert len(claim(client, "?tz=UTC")) == 1


def claim_page(client: TestClient, tz: str = "UTC") -> dict:
    response = client.post(f"{CLAIM}?tz={tz}")
    assert response.status_code == 200, response.text
    return response.json()


class TestHeldRemindersStayVisible:
    def test_the_claim_lists_held_reminders_and_when_quiet_hours_end(
        self, client: TestClient, night: FakeClock
    ) -> None:
        late = make_task(client, datetime(2026, 11, 11, 2, 0, tzinfo=UTC), ["PT0S"], title="Late")
        early = make_task(
            client, datetime(2026, 11, 10, 23, 0, tzinfo=UTC), ["PT0S"], title="Early"
        )
        make_task(client, datetime(2026, 11, 11, 5, 0, tzinfo=UTC), ["PT0S"], title="Not yet")
        night.now = datetime(2026, 11, 11, 3, 0, tzinfo=UTC)

        page = claim_page(client)

        assert page["items"] == []
        assert page["quiet_until"] == "2026-11-11T07:00:00Z"
        assert page["held"] == [
            {
                "task_id": early["id"],
                "task_title": "Early",
                "offset": "PT0S",
                "fire_at": "2026-11-10T23:00:00Z",
                "deliver_at": "2026-11-11T07:00:00Z",
            },
            {
                "task_id": late["id"],
                "task_title": "Late",
                "offset": "PT0S",
                "fire_at": "2026-11-11T02:00:00Z",
                "deliver_at": "2026-11-11T07:00:00Z",
            },
        ]

    def test_nothing_is_held_once_quiet_hours_end(
        self, client: TestClient, night: FakeClock
    ) -> None:
        make_task(client, datetime(2026, 11, 10, 23, 0, tzinfo=UTC), ["PT0S"])
        night.now = datetime(2026, 11, 11, 7, 0, tzinfo=UTC)

        page = claim_page(client)

        assert len(page["items"]) == 1
        assert page["held"] == []
        assert page["quiet_until"] is None

    def test_a_completed_task_is_no_longer_held(self, client: TestClient, night: FakeClock) -> None:
        task = make_task(client, datetime(2026, 11, 10, 23, 0, tzinfo=UTC), ["PT0S"])
        night.now = datetime(2026, 11, 11, 1, 0, tzinfo=UTC)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})

        assert claim_page(client)["held"] == []

    def test_without_quiet_hours_nothing_is_held(
        self, client: TestClient, night: FakeClock
    ) -> None:
        client.put(PATH, json={**NIGHT, "enabled": False})
        night.now = datetime(2026, 11, 11, 1, 0, tzinfo=UTC)
        make_task(client, night.now, ["PT0S"])

        page = claim_page(client)

        assert len(page["items"]) == 1
        assert page["held"] == []
        assert page["quiet_until"] is None


class TestSnoozeIntoQuietHours:
    def test_a_snooze_ending_inside_quiet_hours_is_held_until_they_end(
        self, client: TestClient, night: FakeClock
    ) -> None:
        """Snooze (#566) sets the effective fire time; Quiet hours then
        defer it: deliver_at(effective_fire_at(...), quiet, zone)."""
        task = make_task(client, datetime(2026, 11, 10, 21, 55, tzinfo=UTC), ["PT0S"])
        night.now = datetime(2026, 11, 10, 21, 55, tzinfo=UTC)
        [item] = claim(client, "?tz=UTC")
        report(client, item, "shown")
        snoozed = client.post(f"{LEDGER}/{item['id']}/snooze", json={"minutes": 10})
        assert snoozed.status_code == 200, snoozed.text

        night.now = datetime(2026, 11, 10, 22, 5, tzinfo=UTC)
        page = claim_page(client)
        assert page["items"] == []
        assert [
            (held["task_id"], held["fire_at"], held["deliver_at"]) for held in page["held"]
        ] == [(task["id"], "2026-11-10T21:55:00Z", "2026-11-11T07:00:00Z")]

        night.now = datetime(2026, 11, 11, 7, 0, tzinfo=UTC)
        [again] = claim(client, "?tz=UTC")
        assert again["id"] == item["id"]
        assert claim(client, "?tz=UTC") == []


class TestQuietHoursTimezone:
    def test_the_band_is_read_on_the_claiming_tabs_wall_clock(
        self, client: TestClient, night: FakeClock
    ) -> None:
        """22:30 UTC is 23:30 in Madrid (inside the band) but 07:30 in Tokyo
        (outside it)."""
        make_task(client, datetime(2026, 11, 10, 22, 30, tzinfo=UTC), ["PT0S"])
        night.now = datetime(2026, 11, 10, 22, 30, tzinfo=UTC)

        assert claim(client, "?tz=Europe/Madrid") == []
        assert len(claim(client, "?tz=Asia/Tokyo")) == 1

    def test_a_held_reminder_comes_out_at_the_local_band_end(
        self, client: TestClient, night: FakeClock
    ) -> None:
        """07:00 in Madrid (UTC+1 in November) is 06:00 UTC."""
        make_task(client, datetime(2026, 11, 11, 1, 0, tzinfo=UTC), ["PT0S"])

        night.now = datetime(2026, 11, 11, 5, 59, tzinfo=UTC)
        assert claim(client, "?tz=Europe/Madrid") == []
        night.now = datetime(2026, 11, 11, 6, 0, tzinfo=UTC)
        assert len(claim(client, "?tz=Europe/Madrid")) == 1

    def test_the_band_end_across_a_dst_change_is_local_07_00(
        self, client: TestClient, night: FakeClock
    ) -> None:
        """Madrid leaves summer time on 2026-10-25 at 03:00 local: a Reminder
        held from 02:00 UTC that night comes out at 07:00 CET, 06:00 UTC."""
        make_task(client, datetime(2026, 10, 24, 23, 0, tzinfo=UTC), ["PT0S"])

        night.now = datetime(2026, 10, 25, 5, 0, tzinfo=UTC)
        assert claim(client, "?tz=Europe/Madrid") == []
        night.now = datetime(2026, 10, 25, 6, 0, tzinfo=UTC)
        assert len(claim(client, "?tz=Europe/Madrid")) == 1


class TestActiveHoursNeverChangeDelivery:
    def test_active_hours_do_not_hold_reminders(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        client.put(
            "/api/v1/settings/active-hours",
            json={"enabled": True, "start": "09:00", "end": "17:00"},
        )
        fake_clock.now = datetime(2026, 11, 10, 3, 0, tzinfo=UTC)
        make_task(client, fake_clock.now, ["PT0S"])

        assert len(claim(client, "?tz=UTC")) == 1

    def test_changing_active_hours_does_not_move_a_held_reminder(
        self, client: TestClient, night: FakeClock
    ) -> None:
        make_task(client, datetime(2026, 11, 10, 23, 0, tzinfo=UTC), ["PT0S"])
        night.now = datetime(2026, 11, 10, 23, 0, tzinfo=UTC)
        for band in ({"start": "00:00", "end": "24:00"}, {"start": "22:00", "end": "23:30"}):
            client.put("/api/v1/settings/active-hours", json={"enabled": True, **band})
            assert claim(client, "?tz=UTC") == []

        night.now = datetime(2026, 11, 11, 7, 0, tzinfo=UTC)
        assert len(claim(client, "?tz=UTC")) == 1
