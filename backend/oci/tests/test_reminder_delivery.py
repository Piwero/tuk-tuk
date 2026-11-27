"""Foreground Reminder delivery (issue #561, ADR 0019): an open app tab
claims the Reminders that have come due and shows them, and a durable
per-User delivery ledger keeps one occurrence from notifying twice.

A tab polls `POST /reminder-deliveries/claim`. Each item it gets back is a
lease on one Reminder of one Task occurrence: the tab shows it, then reports
`shown` or `failed`. A tab that never reports (it crashed or closed) lets
the lease expire, and the next claim retries it, a bounded number of times
and only while the Reminder is still fresh.
"""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import FakeCalendarSource, FakeClock, create_user_row, log_in
from tests.test_admin_users import signed_in_member

CLAIM = "/api/v1/reminder-deliveries/claim"
LEDGER = "/api/v1/reminder-deliveries"


def iso(instant: datetime) -> str:
    return instant.astimezone(UTC).isoformat().replace("+00:00", "Z")


def enable_delivery(client: TestClient) -> None:
    response = client.put("/api/v1/settings/reminder-notifications", json={"enabled": True})
    assert response.status_code == 200, response.text


def make_task(
    client: TestClient,
    due: datetime,
    reminders: list[str],
    title: str = "Call the dentist",
    **fields: object,
) -> dict:
    response = client.post(
        "/api/v1/tasks",
        json={"title": title, "due_date": iso(due), "reminders": reminders, **fields},
    )
    assert response.status_code == 201, response.text
    return response.json()


def claim(client: TestClient, query: str = "") -> list[dict]:
    response = client.post(CLAIM + query)
    assert response.status_code == 200, response.text
    return response.json()["items"]


class TestClaimingDueReminders:
    def test_a_reminder_that_has_come_due_is_claimed_with_its_task(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        due = fake_clock.now + timedelta(minutes=30)
        task = make_task(client, due, ["-PT30M"])

        [item] = claim(client)

        assert item["task_id"] == task["id"]
        assert item["task_title"] == "Call the dentist"
        assert item["offset"] == "-PT30M"
        assert datetime.fromisoformat(item["occurrence_due"]) == due
        assert datetime.fromisoformat(item["fire_at"]) == due - timedelta(minutes=30)
        assert item["state"] == "claimed"
        assert item["attempt"] == 1
        assert item["lease_token"]

    def test_a_second_claim_gets_nothing_while_the_first_holds_it(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        claim(client)

        assert claim(client) == []

    def test_a_shown_reminder_is_never_claimed_again(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)
        report(client, item, "shown")

        fake_clock.advance(timedelta(minutes=2))

        assert claim(client) == []
        [entry] = ledger(client)
        assert entry["state"] == "shown"
        assert entry["attempt"] == 1

    def test_each_reminder_of_a_task_is_claimed_on_its_own(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        due = fake_clock.now + timedelta(hours=1)
        make_task(client, due, ["-PT1H", "PT0S"])

        assert [item["offset"] for item in claim(client)] == ["-PT1H"]
        fake_clock.advance(timedelta(hours=1))
        assert [item["offset"] for item in claim(client)] == ["PT0S"]

    def test_nothing_is_claimed_before_the_reminder_comes_due(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now + timedelta(minutes=31), ["-PT30M"])

        assert claim(client) == []

    def test_a_reminder_past_its_delivery_window_is_missed_not_replayed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        """Reopening the app after a Reminder came due shows no late alert
        (missed reminders are listed in-app instead, issue #565)."""
        enable_delivery(client)
        make_task(client, fake_clock.now - timedelta(minutes=5), ["PT0S"])

        assert claim(client) == []
        assert ledger(client) == []

    def test_nothing_is_claimed_while_reminder_notifications_are_off(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        make_task(client, fake_clock.now, ["PT0S"])

        assert claim(client) == []

        enable_delivery(client)
        client.put("/api/v1/settings/reminder-notifications", json={"enabled": False})
        assert claim(client) == []
        assert ledger(client) == []

    def test_an_all_day_task_is_anchored_at_the_start_of_its_day_in_the_tabs_zone(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        fake_clock.now = datetime(2026, 7, 9, 22, 0, tzinfo=UTC)  # 00:00 on the 10th in Madrid
        response = client.post(
            "/api/v1/tasks",
            json={
                "title": "Pay rent",
                "due_date": "2026-07-10T00:00:00Z",
                "is_all_day": True,
                "reminders": ["PT0S"],
            },
        )
        assert response.status_code == 201, response.text

        assert claim(client, "?tz=UTC") == []
        [item] = claim(client, "?tz=Europe/Madrid")
        assert datetime.fromisoformat(item["fire_at"]) == fake_clock.now

    def test_whole_days_before_keep_the_wall_clock_time_across_dst(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        """Madrid moves to summer time on 2026-03-29: "1 day before" a
        09:00 Task on the 29th is 09:00 on the 28th, 23 hours earlier."""
        enable_delivery(client)
        fake_clock.now = datetime(2026, 3, 28, 8, 0, tzinfo=UTC)  # 09:00 CET
        make_task(
            client,
            datetime(2026, 3, 29, 7, 0, tzinfo=UTC),  # 09:00 CEST
            ["-P1D"],
            time_zone="Europe/Madrid",
        )

        [item] = claim(client)
        assert datetime.fromisoformat(item["fire_at"]) == fake_clock.now

    def test_an_unknown_timezone_is_refused(self, client: TestClient) -> None:
        response = client.post(CLAIM + "?tz=Mars/Olympus")

        assert response.status_code == 422


class TestLeaseExpiryAndRetry:
    """A tab that claims and never reports (closed, crashed) holds the lease
    for 60 seconds; then any tab's claim retries it, up to three claims in
    all and only inside the five-minute delivery window."""

    def test_an_unreported_lease_is_retried_once_it_expires(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        [first] = claim(client)

        fake_clock.advance(timedelta(seconds=59))
        assert claim(client) == []
        fake_clock.advance(timedelta(seconds=1))
        [retry] = claim(client)

        assert retry["id"] == first["id"]
        assert retry["attempt"] == 2
        assert retry["lease_token"] != first["lease_token"]

    def test_retries_stop_after_three_claims(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        attempts = []
        for _ in range(4):
            attempts += [item["attempt"] for item in claim(client)]
            fake_clock.advance(timedelta(seconds=61))

        assert attempts == [1, 2, 3]

    def test_no_retry_once_the_delivery_window_has_passed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now - timedelta(minutes=4, seconds=30), ["PT0S"])
        claim(client)

        fake_clock.advance(timedelta(seconds=61))

        assert claim(client) == []

    def test_a_failed_display_is_final(self, client: TestClient, fake_clock: FakeClock) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)

        assert report(client, item, "failed")["state"] == "failed"
        fake_clock.advance(timedelta(seconds=61))
        assert claim(client) == []

    def test_a_late_report_from_a_tab_whose_lease_was_retried_is_refused(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        [first] = claim(client)
        fake_clock.advance(timedelta(seconds=61))
        [retry] = claim(client)

        response = client.post(
            f"{LEDGER}/{first['id']}/shown", json={"lease_token": first["lease_token"]}
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "lease_lost"
        assert report(client, retry, "shown")["state"] == "shown"

    def test_a_late_report_is_still_accepted_when_nobody_retried(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)
        fake_clock.advance(timedelta(seconds=90))

        assert report(client, item, "shown")["state"] == "shown"

    def test_repeating_a_report_changes_nothing(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)
        report(client, item, "shown")

        assert report(client, item, "failed")["state"] == "shown"


class TestStaleOccurrences:
    """Each claim reloads the Task: stale work never notifies, even when a
    tab claimed it before the Task changed."""

    def test_a_completed_task_never_notifies(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        task = make_task(client, fake_clock.now, ["PT0S"])
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})

        assert claim(client) == []

    def test_completing_a_task_cancels_the_retry_of_an_unreported_claim(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        task = make_task(client, fake_clock.now, ["PT0S"])
        claim(client)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})
        fake_clock.advance(timedelta(seconds=61))

        assert claim(client) == []

    def test_a_deleted_task_never_notifies_and_leaves_no_ledger(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        task = make_task(client, fake_clock.now, ["PT0S"])
        claim(client)
        assert client.delete(f"/api/v1/tasks/{task['id']}").status_code == 204
        fake_clock.advance(timedelta(seconds=61))

        assert claim(client) == []
        assert ledger(client) == []

    def test_a_removed_reminder_never_notifies(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        task = make_task(client, fake_clock.now, ["PT0S"])
        claim(client)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": []})
        fake_clock.advance(timedelta(seconds=61))

        assert claim(client) == []

    def test_a_recurring_task_advanced_past_the_occurrence_never_notifies_for_it(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        """Completing a recurring Task advances it in place (ADR 0003): the
        occurrence that was due is gone, and the next one notifies only
        when it comes due."""
        enable_delivery(client)
        due = fake_clock.now = fake_clock.now.replace(microsecond=0)  # RRULE has whole seconds
        task = make_task(client, due, ["PT0S"], recurrence="FREQ=DAILY")
        claim(client)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})
        fake_clock.advance(timedelta(seconds=61))

        assert claim(client) == []

        fake_clock.now = due + timedelta(days=1)
        [next_day] = claim(client)
        assert datetime.fromisoformat(next_day["occurrence_due"]) == due + timedelta(days=1)

    def test_moving_a_task_later_waits_for_the_new_date(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        task = make_task(client, fake_clock.now, ["PT0S"])
        later = fake_clock.now + timedelta(hours=2)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"due_date": iso(later)})

        assert claim(client) == []
        fake_clock.now = later
        assert len(claim(client)) == 1


class TestTwoTabsAtOnce:
    def test_concurrent_claims_from_two_tabs_hand_each_reminder_to_one(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        """Two tabs claim at the same instant, each through its own app (and
        so its own connection pool) over the same PostgreSQL database: each
        Reminder lands in exactly one tab, however the race falls."""
        apps = [
            create_app(
                Settings(database_url=database_url),
                clock=fake_clock,
                calendar_source=fake_calendar_source,
            )
            for _ in range(2)
        ]
        with TestClient(apps[0]) as tab_a, TestClient(apps[1]) as tab_b:
            create_user_row(apps[0], first_admin=True)
            log_in(tab_a)
            log_in(tab_b)
            enable_delivery(tab_a)
            for n in range(5):
                make_task(tab_a, fake_clock.now, ["PT0S", "-PT1M"], title=f"Task {n}")

            barrier = threading.Barrier(2)

            def race(tab: TestClient) -> list[dict]:
                barrier.wait()
                return claim(tab, "?tz=UTC")

            with ThreadPoolExecutor(max_workers=2) as pool:
                claimed_a, claimed_b = pool.map(race, [tab_a, tab_b])

            keys = [(item["task_id"], item["offset"]) for item in claimed_a + claimed_b]
            assert len(keys) == 10
            assert len(set(keys)) == 10
            assert claim(tab_a) == []
            assert claim(tab_b) == []


class TestSignedOutOrDisabled:
    """Delivery needs a live session: logging out, an expired session or a
    disabled account stops claims, and reports too."""

    def test_logging_out_stops_claims(self, client: TestClient, fake_clock: FakeClock) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        client.post("/api/v1/auth/logout")

        assert client.post(CLAIM).status_code == 401

    def test_an_expired_session_stops_claims(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        lifetime = client.app.state.settings.auth_session_lifetime_days  # type: ignore[attr-defined]
        make_task(client, fake_clock.now + timedelta(days=lifetime + 1), ["PT0S"])
        fake_clock.advance(timedelta(days=lifetime + 1))

        assert client.post(CLAIM).status_code == 401

    def test_a_disabled_user_can_neither_claim_nor_report(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        bea, bea_client = signed_in_member(client)
        enable_delivery(bea_client)
        make_task(bea_client, fake_clock.now, ["PT0S", "-PT1M"])
        [item, _] = claim(bea_client)

        client.patch(f"/api/v1/admin/users/{bea.id}", json={"is_active": False})

        refused = bea_client.post(CLAIM)
        assert refused.status_code == 401
        assert refused.json()["error"]["code"] == "account_disabled"
        report_refused = bea_client.post(
            f"{LEDGER}/{item['id']}/shown", json={"lease_token": item["lease_token"]}
        )
        assert report_refused.status_code == 401


class TestOwnership:
    """Every ledger read and write is the User's own (ADR 0018); the full
    probe matrix is in test_isolation.py."""

    def test_users_claim_only_their_own_reminders(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        _, bea_client = signed_in_member(client)
        enable_delivery(client)
        enable_delivery(bea_client)
        make_task(client, fake_clock.now, ["PT0S"], title="Admin's task")
        make_task(bea_client, fake_clock.now, ["PT0S"], title="Bea's task")

        assert [item["task_title"] for item in claim(bea_client)] == ["Bea's task"]
        assert [item["task_title"] for item in claim(client)] == ["Admin's task"]
        assert [entry["task_title"] for entry in ledger(bea_client)] == ["Bea's task"]

    def test_another_users_delivery_is_not_found_even_with_its_lease(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        _, bea_client = signed_in_member(client)
        enable_delivery(client)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)

        for outcome in ("shown", "failed"):
            response = bea_client.post(
                f"{LEDGER}/{item['id']}/{outcome}", json={"lease_token": item["lease_token"]}
            )
            assert response.status_code == 404
            assert response.json()["error"]["code"] == "not_found"
        assert ledger(client)[0]["state"] == "claimed"

    def test_one_users_opt_in_does_not_deliver_another_users_reminders(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        _, bea_client = signed_in_member(client)
        enable_delivery(client)
        make_task(bea_client, fake_clock.now, ["PT0S"])

        assert claim(bea_client) == []
        assert claim(client) == []


def report(client: TestClient, item: dict, outcome: str, lease_token: str | None = None) -> dict:
    response = client.post(
        f"{LEDGER}/{item['id']}/{outcome}",
        json={"lease_token": lease_token or item["lease_token"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def ledger(client: TestClient) -> list[dict]:
    response = client.get(LEDGER)
    assert response.status_code == 200, response.text
    return response.json()["items"]
