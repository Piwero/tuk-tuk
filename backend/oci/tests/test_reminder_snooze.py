"""Snoozing a delivered Reminder (issue #566): an occurrence-specific
delivery override in the ledger (ADR 0019), never a Task date change.

`POST /reminder-deliveries/{id}/snooze {minutes}` moves that one ledger
row's effective fire time to now + minutes. The Reminder is then claimed
once more at the new time, under the same lease, retry and stale rules as
a first delivery. The Task's start, due date, Reminder offsets and
recurrence are untouched.
"""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from tests.conftest import FakeClock
from tests.test_admin_users import signed_in_member
from tests.test_reminder_delivery import (
    LEDGER,
    claim,
    enable_delivery,
    iso,
    ledger,
    make_task,
    report,
)


def snooze(client: TestClient, item: dict, minutes: int) -> dict:
    response = client.post(f"{LEDGER}/{item['id']}/snooze", json={"minutes": minutes})
    assert response.status_code == 200, response.text
    return response.json()


def delivered(client: TestClient) -> dict:
    """Claims the one Reminder due now and reports it shown."""
    [item] = claim(client)
    report(client, item, "shown")
    return item


class TestSnoozedRedelivery:
    def test_a_snoozed_reminder_is_delivered_again_at_the_new_time(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        item = delivered(client)
        snoozed_at = fake_clock.now

        entry = snooze(client, item, 10)

        assert entry["state"] == "snoozed"
        assert datetime.fromisoformat(entry["snoozed_until"]) == snoozed_at + timedelta(minutes=10)
        fake_clock.advance(timedelta(minutes=9, seconds=59))
        assert claim(client) == []
        fake_clock.advance(timedelta(seconds=1))
        [again] = claim(client)
        assert again["id"] == item["id"]
        assert again["state"] == "claimed"
        assert again["attempt"] == 1
        assert again["lease_token"] != item["lease_token"]


class TestTaskDatesNeverChange:
    def test_snoozing_leaves_the_task_byte_identical(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        """Start, due date, Reminder offsets and recurrence: the Task reads
        back exactly as before the snooze, and after the snoozed alert."""
        enable_delivery(client)
        due = fake_clock.now = datetime(2026, 11, 25, 11, 0, tzinfo=UTC)  # 12:00 in Madrid
        task = make_task(
            client,
            due,
            ["PT0S", "-P1D"],
            start_date=iso(due - timedelta(hours=2)),
            recurrence="FREQ=WEEKLY",
            time_zone="Europe/Madrid",
        )
        before = client.get(f"/api/v1/tasks/{task['id']}").content

        item = delivered(client)
        snooze(client, item, 30)
        assert client.get(f"/api/v1/tasks/{task['id']}").content == before

        fake_clock.advance(timedelta(minutes=30))
        report(client, claim(client)[0], "shown")
        assert client.get(f"/api/v1/tasks/{task['id']}").content == before


class TestDeduplication:
    def test_a_snoozed_reminder_is_delivered_once(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        snooze(client, delivered(client), 10)
        fake_clock.advance(timedelta(minutes=10))

        [again] = claim(client)
        assert claim(client) == []
        report(client, again, "shown")
        fake_clock.advance(timedelta(minutes=2))
        assert claim(client) == []
        [entry] = ledger(client)
        assert entry["state"] == "shown"

    def test_an_unreported_snoozed_delivery_follows_the_retry_rules(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        """Lease expiry, three claims at most, and only within the window
        measured from the snoozed time."""
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        snooze(client, delivered(client), 10)
        fake_clock.advance(timedelta(minutes=10))

        attempts = []
        for _ in range(4):
            attempts += [item["attempt"] for item in claim(client)]
            fake_clock.advance(timedelta(seconds=61))

        assert attempts == [1, 2, 3]

    def test_a_snoozed_reminder_past_its_window_is_missed_not_replayed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        snooze(client, delivered(client), 10)

        fake_clock.advance(timedelta(minutes=15))

        assert claim(client) == []

    def test_snoozing_again_moves_the_time(self, client: TestClient, fake_clock: FakeClock) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        snooze(client, delivered(client), 10)
        fake_clock.advance(timedelta(minutes=10))
        [again] = claim(client)
        report(client, again, "shown")

        snooze(client, again, 60)
        fake_clock.advance(timedelta(minutes=59))
        assert claim(client) == []
        fake_clock.advance(timedelta(minutes=1))
        assert len(claim(client)) == 1

    def test_a_tab_holding_the_old_lease_can_no_longer_report(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)
        snooze(client, item, 10)

        response = client.post(
            f"{LEDGER}/{item['id']}/shown", json={"lease_token": item["lease_token"]}
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "lease_lost"


class TestStaleSnoozes:
    def test_completing_the_task_cancels_a_pending_snooze(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        task = make_task(client, fake_clock.now, ["PT0S"])
        snooze(client, delivered(client), 10)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})
        fake_clock.advance(timedelta(minutes=10))

        assert claim(client) == []

    def test_advancing_a_recurring_task_cancels_a_pending_snooze(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        due = fake_clock.now = fake_clock.now.replace(microsecond=0)
        task = make_task(client, due, ["PT0S"], recurrence="FREQ=DAILY")
        snooze(client, delivered(client), 10)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})
        fake_clock.advance(timedelta(minutes=10))

        assert claim(client) == []

    def test_removing_the_reminder_cancels_a_pending_snooze(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        task = make_task(client, fake_clock.now, ["PT0S"])
        snooze(client, delivered(client), 10)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": []})
        fake_clock.advance(timedelta(minutes=10))

        assert claim(client) == []

    def test_a_completed_tasks_reminder_cannot_be_snoozed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        task = make_task(client, fake_clock.now, ["PT0S"])
        item = delivered(client)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})

        response = client.post(f"{LEDGER}/{item['id']}/snooze", json={"minutes": 10})

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "reminder_stale"

    def test_a_redated_tasks_old_reminder_cannot_be_snoozed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        task = make_task(client, fake_clock.now, ["PT0S"])
        item = delivered(client)
        later = fake_clock.now + timedelta(days=1)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"due_date": iso(later)})

        response = client.post(f"{LEDGER}/{item['id']}/snooze", json={"minutes": 10})

        assert response.status_code == 409


class TestSnoozeRequests:
    def test_a_snooze_must_be_between_a_minute_and_a_day(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        item = delivered(client)

        for minutes in (0, -5, 24 * 60 + 1):
            response = client.post(f"{LEDGER}/{item['id']}/snooze", json={"minutes": minutes})
            assert response.status_code == 422, minutes
        assert snooze(client, item, 24 * 60)["state"] == "snoozed"

    def test_another_users_reminder_cannot_be_snoozed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        _, bea_client = signed_in_member(client)
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        item = delivered(client)

        response = bea_client.post(f"{LEDGER}/{item['id']}/snooze", json={"minutes": 10})

        assert response.status_code == 404
        assert ledger(client)[0]["state"] == "shown"
        assert ledger(client)[0]["snoozed_until"] is None
