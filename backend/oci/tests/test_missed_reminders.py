"""Missed reminders (issue #565, ADR 0019): a Reminder whose delivery
window passed without the browser showing it is never replayed as a late
system notification. The app lists it in-app instead, until the User
dismisses it or the occurrence stops being current.

`GET /reminder-deliveries/missed` lists them; `POST .../missed/dismiss`
records a dismissal in the delivery ledger so the entry never comes back.
"""

from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from tests.conftest import FakeClock
from tests.test_admin_users import signed_in_member
from tests.test_reminder_delivery import claim, enable_delivery, ledger, make_task, report

MISSED = "/api/v1/reminder-deliveries/missed"
DISMISS = MISSED + "/dismiss"
SNOOZE = MISSED + "/snooze"


def missed(client: TestClient, query: str = "") -> list[dict]:
    response = client.get(MISSED + query)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def dismiss(client: TestClient, entry: dict, query: str = "") -> dict:
    response = client.post(DISMISS + query, json=dismissal(entry))
    assert response.status_code == 200, response.text
    return response.json()


def opted_in_days_ago(client: TestClient, clock: FakeClock) -> None:
    """Reminder notifications on since well before the test's Reminders
    came due, so the opt-in bound (TestBoundedByTheOptIn) never hides them."""
    clock.advance(-timedelta(days=2))
    enable_delivery(client)
    clock.advance(timedelta(days=2))


def disable_delivery(client: TestClient) -> None:
    response = client.put("/api/v1/settings/reminder-notifications", json={"enabled": False})
    assert response.status_code == 200, response.text


def dismissal(entry: dict) -> dict:
    return {
        "task_id": entry["task_id"],
        "offset": entry["offset"],
        "occurrence_due": entry["occurrence_due"],
    }


class TestMissedOrDeliverable:
    def test_a_reminder_whose_window_passed_unseen_is_missed_with_its_occurrence(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        due = fake_clock.now - timedelta(hours=1)
        task = make_task(client, due, ["-PT30M"], time_zone="Europe/Madrid")

        [entry] = missed(client)

        assert entry["task_id"] == task["id"]
        assert entry["task_title"] == "Call the dentist"
        assert entry["offset"] == "-PT30M"
        assert datetime.fromisoformat(entry["occurrence_due"]) == due
        assert datetime.fromisoformat(entry["fire_at"]) == due - timedelta(minutes=30)
        # Enough to say when the occurrence was due the way the Task shows it.
        assert entry["is_all_day"] is False
        assert entry["time_zone"] == "Europe/Madrid"

    def test_a_reminder_still_inside_its_window_is_deliverable_not_missed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now - timedelta(minutes=4, seconds=59), ["PT0S"])

        assert missed(client) == []
        assert len(claim(client)) == 1

    def test_the_window_closing_turns_a_deliverable_reminder_into_a_missed_one(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now, ["PT0S"])
        fake_clock.advance(timedelta(minutes=5))

        assert claim(client) == []
        assert [entry["offset"] for entry in missed(client)] == ["PT0S"]

    def test_a_reminder_not_yet_due_is_not_missed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now + timedelta(hours=1), ["-PT30M"])

        assert missed(client) == []

    def test_a_shown_reminder_is_not_missed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)
        report(client, item, "shown")
        fake_clock.advance(timedelta(hours=1))

        assert missed(client) == []

    def test_a_reminder_the_browser_refused_to_show_is_missed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)
        report(client, item, "failed")
        fake_clock.advance(timedelta(minutes=5))

        assert [entry["offset"] for entry in missed(client)] == ["PT0S"]

    def test_a_claim_whose_tab_never_reported_is_missed_once_its_lease_ends(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now, ["PT0S"])
        claim(client)
        fake_clock.advance(timedelta(minutes=5))

        assert [entry["offset"] for entry in missed(client)] == ["PT0S"]

    def test_a_claim_still_leased_after_the_window_waits_for_its_report(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        """Claimed in the window's last second: the tab may still say it
        showed it, so it is not missed yet."""
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now - timedelta(minutes=4, seconds=59), ["PT0S"])
        claim(client)
        fake_clock.advance(timedelta(seconds=30))

        assert missed(client) == []

    def test_each_reminder_of_an_occurrence_is_its_own_entry_newest_first(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now - timedelta(hours=1), ["-P1D", "PT0S"])

        assert [entry["offset"] for entry in missed(client)] == ["PT0S", "-P1D"]

    def test_an_all_day_task_is_missed_from_the_start_of_its_day_in_the_tabs_zone(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        fake_clock.now = datetime.fromisoformat("2026-03-10T08:00:00+00:00")
        opted_in_days_ago(client, fake_clock)
        make_task(
            client,
            datetime.fromisoformat("2026-03-10T00:00:00+00:00"),
            ["PT0S"],
            is_all_day=True,
        )

        # Midnight of 10 March in Tokyo was 15:00 UTC on the 9th: long gone.
        [entry] = missed(client, "?tz=Asia/Tokyo")
        assert entry["is_all_day"] is True
        # In Los Angeles it is 10 March 01:00: local midnight was 07:00 UTC.
        assert len(missed(client, "?tz=America/Los_Angeles")) == 1
        # In Honolulu it is still 9 March, 22:00: not yet due.
        assert missed(client, "?tz=Pacific/Honolulu") == []

    def test_an_unknown_timezone_is_refused(self, client: TestClient) -> None:
        response = client.get(MISSED + "?tz=Not/AZone")

        assert response.status_code == 422

    def test_nothing_is_missed_while_reminder_notifications_are_off(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        """Without the opt-in nothing was ever going to notify, so there is
        nothing to have missed."""
        make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])

        assert missed(client) == []


class TestBoundedByTheOptIn:
    """Existing Reminder offsets must not suddenly surface after the User
    opts in (#535): only a Reminder whose delivery time falls after the
    User last turned Reminder notifications on can have been missed."""

    def test_a_reminder_that_came_due_before_the_opt_in_is_not_missed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        enable_delivery(client)
        fake_clock.advance(timedelta(hours=1))

        assert missed(client) == []

    def test_a_reminder_that_came_due_after_the_opt_in_is_missed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        make_task(client, fake_clock.now + timedelta(minutes=10), ["PT0S", "-PT1H"])
        enable_delivery(client)
        fake_clock.advance(timedelta(hours=1))

        assert [entry["offset"] for entry in missed(client)] == ["PT0S"]

    def test_turning_notifications_off_and_on_again_restarts_the_bound(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now + timedelta(minutes=10), ["PT0S"])
        fake_clock.advance(timedelta(hours=1))
        assert len(missed(client)) == 1

        disable_delivery(client)
        enable_delivery(client)

        assert missed(client) == []

    def test_saving_the_opt_in_again_while_on_keeps_the_bound(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        enable_delivery(client)
        make_task(client, fake_clock.now + timedelta(minutes=10), ["PT0S"])
        fake_clock.advance(timedelta(hours=1))

        enable_delivery(client)

        assert len(missed(client)) == 1

    def test_a_reminder_from_before_the_opt_in_cannot_be_dismissed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        task = make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        enable_delivery(client)

        response = client.post(
            DISMISS,
            json={"task_id": task["id"], "offset": "PT0S", "occurrence_due": task["due_date"]},
        )

        assert response.status_code == 404


class TestStaleOccurrences:
    """The delivery rule's stale-occurrence suppression applies to the
    list: only the Task's current, open occurrence can be missed."""

    def test_a_completed_task_is_not_missed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        task = make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})

        assert missed(client) == []

    def test_a_deleted_task_is_not_missed(self, client: TestClient, fake_clock: FakeClock) -> None:
        opted_in_days_ago(client, fake_clock)
        task = make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        client.delete(f"/api/v1/tasks/{task['id']}")

        assert missed(client) == []

    def test_a_removed_reminder_is_not_missed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        task = make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S", "-PT30M"])
        client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": ["-PT30M"]})

        assert [entry["offset"] for entry in missed(client)] == ["-PT30M"]

    def test_a_missed_recurring_occurrence_that_has_since_advanced_is_not_listed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        fake_clock.now = fake_clock.now.replace(microsecond=0)  # RRULE has whole seconds
        due = fake_clock.now - timedelta(hours=1)
        task = make_task(client, due, ["PT0S"], recurrence="FREQ=DAILY")
        assert len(missed(client)) == 1

        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})

        assert missed(client) == []

    def test_moving_a_task_later_takes_its_reminder_off_the_list(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        task = make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        client.patch(
            f"/api/v1/tasks/{task['id']}",
            json={"due_date": (fake_clock.now + timedelta(days=1)).isoformat()},
        )

        assert missed(client) == []


class TestDismissal:
    def test_a_dismissed_entry_does_not_reappear(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S", "-PT30M"])
        first, second = missed(client)

        dismissed = dismiss(client, first)

        assert dismissed["state"] == "dismissed"
        assert dismissed["offset"] == first["offset"]
        assert missed(client) == [second]
        fake_clock.advance(timedelta(days=1))
        assert missed(client) == [second]

    def test_a_dismissal_is_recorded_in_the_ledger_and_never_notifies(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        task = make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        [entry] = missed(client)

        dismiss(client, entry)

        [row] = ledger(client)
        assert row["task_id"] == task["id"]
        assert row["state"] == "dismissed"
        assert claim(client) == []

    def test_dismissing_a_reminder_the_browser_refused_updates_its_ledger_row(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)
        report(client, item, "failed")
        fake_clock.advance(timedelta(minutes=5))
        [entry] = missed(client)

        dismissed = dismiss(client, entry)

        assert dismissed["id"] == item["id"]
        assert [row["state"] for row in ledger(client)] == ["dismissed"]

    def test_dismissing_an_abandoned_claim_refuses_its_late_report(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)
        fake_clock.advance(timedelta(minutes=5))
        dismiss(client, missed(client)[0])

        response = client.post(
            f"/api/v1/reminder-deliveries/{item['id']}/shown",
            json={"lease_token": item["lease_token"]},
        )

        assert response.status_code == 409
        assert ledger(client)[0]["state"] == "dismissed"

    def test_dismissing_twice_changes_nothing(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        [entry] = missed(client)
        first = dismiss(client, entry)

        assert dismiss(client, entry) == first
        assert len(ledger(client)) == 1

    def test_the_next_occurrence_of_a_recurring_task_can_be_missed_again(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        fake_clock.now = fake_clock.now.replace(microsecond=0)
        due = fake_clock.now - timedelta(hours=1)
        task = make_task(client, due, ["PT0S"], recurrence="FREQ=DAILY")
        dismiss(client, missed(client)[0])
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})

        fake_clock.advance(timedelta(days=1))

        [entry] = missed(client)
        assert datetime.fromisoformat(entry["occurrence_due"]) == due + timedelta(days=1)

    def test_an_entry_that_is_not_missed_cannot_be_dismissed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        """Not yet due, still deliverable, already shown, or a stale
        occurrence: nothing on the list to dismiss."""
        opted_in_days_ago(client, fake_clock)
        task = make_task(client, fake_clock.now, ["PT0S"])
        entry = {"task_id": task["id"], "offset": "PT0S", "occurrence_due": task["due_date"]}

        for body in (
            entry,
            {**entry, "offset": "-PT1H"},
            {**entry, "occurrence_due": (fake_clock.now - timedelta(days=1)).isoformat()},
        ):
            response = client.post(DISMISS, json=body)
            assert response.status_code == 404, body
            assert response.json()["error"]["code"] == "not_found"
        assert ledger(client) == []


class TestSnoozeFromTheList:
    """Snooze is offered from the missed list too (#566). An entry with a
    ledger row names it (`delivery_id`) and is snoozed like any delivered
    Reminder; a never-claimed miss gets its row created already snoozed,
    under the same ledger key."""

    def test_a_never_claimed_miss_has_no_ledger_row_to_name(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])

        [entry] = missed(client)

        assert entry["delivery_id"] is None

    def test_a_miss_with_a_ledger_row_names_it_for_the_ordinary_snooze(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now, ["PT0S"])
        [item] = claim(client)
        report(client, item, "failed")
        fake_clock.advance(timedelta(minutes=5))
        [entry] = missed(client)
        assert entry["delivery_id"] == item["id"]

        response = client.post(
            f"/api/v1/reminder-deliveries/{entry['delivery_id']}/snooze", json={"minutes": 10}
        )

        assert response.status_code == 200, response.text
        assert missed(client) == []

    def test_snoozing_a_never_claimed_miss_delivers_it_once_at_the_new_time(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        task = make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        [entry] = missed(client)
        snoozed_at = fake_clock.now

        response = client.post(SNOOZE, json={**dismissal(entry), "minutes": 10})

        assert response.status_code == 200, response.text
        row = response.json()
        assert row["state"] == "snoozed"
        assert datetime.fromisoformat(row["snoozed_until"]) == snoozed_at + timedelta(minutes=10)
        assert [r["id"] for r in ledger(client)] == [row["id"]]
        assert missed(client) == []
        fake_clock.advance(timedelta(minutes=10))
        [again] = claim(client)
        assert again["id"] == row["id"]
        assert again["task_id"] == task["id"]
        assert claim(client) == []

    def test_snoozing_a_miss_leaves_the_task_unchanged(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        task = make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        before = client.get(f"/api/v1/tasks/{task['id']}").content
        [entry] = missed(client)

        client.post(SNOOZE, json={**dismissal(entry), "minutes": 60})

        assert client.get(f"/api/v1/tasks/{task['id']}").content == before

    def test_snoozing_a_miss_from_the_list_again_moves_its_time(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        [entry] = missed(client)
        first = client.post(SNOOZE, json={**dismissal(entry), "minutes": 10}).json()
        fake_clock.advance(timedelta(minutes=20))
        [again] = missed(client)
        assert again["delivery_id"] == first["id"]

        second = client.post(SNOOZE, json={**dismissal(again), "minutes": 10})

        assert second.status_code == 200, second.text
        assert second.json()["id"] == first["id"]
        assert len(ledger(client)) == 1

    def test_an_entry_that_is_not_missed_cannot_be_snoozed_from_the_list(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        opted_in_days_ago(client, fake_clock)
        task = make_task(client, fake_clock.now, ["PT0S"])
        body = {"task_id": task["id"], "offset": "PT0S", "occurrence_due": task["due_date"]}

        response = client.post(SNOOZE, json={**body, "minutes": 10})

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"
        assert ledger(client) == []

    def test_the_snooze_length_is_bounded(self, client: TestClient, fake_clock: FakeClock) -> None:
        opted_in_days_ago(client, fake_clock)
        make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        [entry] = missed(client)

        for minutes in (0, 24 * 60 + 1):
            response = client.post(SNOOZE, json={**dismissal(entry), "minutes": minutes})
            assert response.status_code == 422, minutes
        assert ledger(client) == []


class TestOwnership:
    """Missed reminders are the User's own (ADR 0018); the full probe
    matrix is in test_isolation.py."""

    def test_users_see_only_their_own_missed_reminders(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        _, bea_client = signed_in_member(client)
        opted_in_days_ago(client, fake_clock)
        opted_in_days_ago(bea_client, fake_clock)
        past = fake_clock.now - timedelta(hours=1)
        make_task(client, past, ["PT0S"], title="Admin's task")
        make_task(bea_client, past, ["PT0S"], title="Bea's task")

        assert [entry["task_title"] for entry in missed(bea_client)] == ["Bea's task"]
        assert [entry["task_title"] for entry in missed(client)] == ["Admin's task"]

    def test_another_users_missed_reminder_cannot_be_dismissed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        _, bea_client = signed_in_member(client)
        opted_in_days_ago(client, fake_clock)
        opted_in_days_ago(bea_client, fake_clock)
        make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        [entry] = missed(client)

        response = bea_client.post(DISMISS, json=dismissal(entry))

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"
        assert missed(client) == [entry]
        assert ledger(client) == []
        assert ledger(bea_client) == []

    def test_another_users_missed_reminder_cannot_be_snoozed(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        _, bea_client = signed_in_member(client)
        opted_in_days_ago(client, fake_clock)
        opted_in_days_ago(bea_client, fake_clock)
        make_task(client, fake_clock.now - timedelta(hours=1), ["PT0S"])
        [entry] = missed(client)

        response = bea_client.post(SNOOZE, json={**dismissal(entry), "minutes": 10})

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"
        assert missed(client) == [entry]
        assert ledger(client) == []
        assert ledger(bea_client) == []

    def test_one_users_opt_in_does_not_list_another_users_reminders(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        _, bea_client = signed_in_member(client)
        opted_in_days_ago(client, fake_clock)
        make_task(bea_client, fake_clock.now - timedelta(hours=1), ["PT0S"])

        assert missed(client) == []
        assert missed(bea_client) == []
