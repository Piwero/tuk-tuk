"""Habits: Boolean & Numeric with Check-ins (issue #32).

A Habit is a recurring practice tracked by Check-ins rather than completion.
Check-ins are keyed by (habit, date) and upserted, so re-taps and corrections
are idempotent.
"""

from fastapi.testclient import TestClient


def make_habit(client: TestClient, name: str, **fields: object) -> dict:
    """Create a Habit over the API and return its JSON body."""
    response = client.post("/api/v1/habits", json={"name": name, **fields})
    assert response.status_code == 201, response.text
    return response.json()


class TestCreateHabit:
    def test_boolean_habit_by_default(self, client: TestClient) -> None:
        response = client.post("/api/v1/habits", json={"name": "Meditate"})

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Meditate"
        assert body["type"] == "boolean"
        assert body["target"] == 1
        assert body["step"] == 1
        assert body["unit"] is None
        assert body["icon"] is None
        assert body["color"] is None
        assert body["encouragement"] == ""
        assert body["frequency"] == "FREQ=DAILY"
        assert isinstance(body["id"], int)

    def test_numeric_habit_with_target_step_unit_and_looks(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/habits",
            json={
                "name": "Drink water",
                "type": "numeric",
                "target": 8,
                "step": 2,
                "unit": "glasses",
                "icon": "💧",
                "color": "#0AA",
                "encouragement": "Stay hydrated!",
                "frequency": "FREQ=WEEKLY;BYDAY=MO,TH",
            },
        )

        assert response.status_code == 201
        body = response.json()
        assert body["type"] == "numeric"
        assert body["target"] == 8
        assert body["step"] == 2
        assert body["unit"] == "glasses"
        assert body["icon"] == "💧"
        assert body["color"] == "#0AA"
        assert body["encouragement"] == "Stay hydrated!"
        assert body["frequency"] == "FREQ=WEEKLY;BYDAY=MO,TH"

    def test_numeric_step_defaults_to_one(self, client: TestClient) -> None:
        body = make_habit(client, "Read", type="numeric", target=30, unit="pages")

        assert body["step"] == 1

    def test_numeric_without_target_is_rejected(self, client: TestClient) -> None:
        response = client.post("/api/v1/habits", json={"name": "Read", "type": "numeric"})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_habit"

    def test_boolean_with_target_fields_is_rejected(self, client: TestClient) -> None:
        for fields in ({"target": 5}, {"step": 2}, {"unit": "times"}):
            response = client.post("/api/v1/habits", json={"name": "Meditate", **fields})

            assert response.status_code == 422, fields
            assert response.json()["error"]["code"] == "invalid_habit"

    def test_times_per_week_frequency_is_accepted(self, client: TestClient) -> None:
        body = make_habit(client, "Gym", frequency="FREQ=WEEKLY;TT_TIMES=3")

        assert body["frequency"] == "FREQ=WEEKLY;TT_TIMES=3"

    def test_broken_frequencies_are_rejected(self, client: TestClient) -> None:
        for frequency in (
            "FREQ=MONTHLY",
            "not a rule",
            "FREQ=DAILY;INTERVAL=2",
            "FREQ=WEEKLY",
            "FREQ=WEEKLY;BYDAY=XX",
            "FREQ=WEEKLY;BYDAY=MO;TT_TIMES=2",
            "FREQ=WEEKLY;TT_TIMES=8",
            "FREQ=DAILY;UNTIL=20270101",
        ):
            response = client.post("/api/v1/habits", json={"name": "Gym", "frequency": frequency})

            assert response.status_code == 422, frequency
            assert response.json()["error"]["code"] == "invalid_frequency", frequency


class TestTodaysHabits:
    def test_due_keeps_exactly_the_habits_scheduled_that_day(self, client: TestClient) -> None:
        make_habit(client, "Meditate")  # daily
        make_habit(client, "Review week", frequency="FREQ=WEEKLY;BYDAY=MO")
        make_habit(client, "Gym", frequency="FREQ=WEEKLY;TT_TIMES=3")

        friday = client.get("/api/v1/habits", params={"due": "2026-07-03"})
        assert friday.status_code == 200
        assert [habit["name"] for habit in friday.json()["items"]] == ["Meditate", "Gym"]

        monday = client.get("/api/v1/habits", params={"due": "2026-07-06"})
        assert [habit["name"] for habit in monday.json()["items"]] == [
            "Meditate",
            "Review week",
            "Gym",
        ]

    def test_without_due_lists_every_habit(self, client: TestClient) -> None:
        make_habit(client, "Meditate")
        make_habit(client, "Review week", frequency="FREQ=WEEKLY;BYDAY=MO")

        response = client.get("/api/v1/habits")

        assert response.status_code == 200
        assert response.json()["total"] == 2


class TestUpdateAndDeleteHabit:
    def test_patch_edits_fields_in_place(self, client: TestClient) -> None:
        habit = make_habit(client, "Gym")

        response = client.patch(
            f"/api/v1/habits/{habit['id']}",
            json={"name": "Lift", "color": "#F00", "frequency": "FREQ=WEEKLY;BYDAY=TU,SA"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Lift"
        assert body["color"] == "#F00"
        assert body["frequency"] == "FREQ=WEEKLY;BYDAY=TU,SA"

    def test_patch_rejects_broken_frequency(self, client: TestClient) -> None:
        habit = make_habit(client, "Gym")

        response = client.patch(f"/api/v1/habits/{habit['id']}", json={"frequency": "nope"})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_frequency"

    def test_becoming_numeric_requires_a_target(self, client: TestClient) -> None:
        habit = make_habit(client, "Read")

        rejected = client.patch(f"/api/v1/habits/{habit['id']}", json={"type": "numeric"})
        assert rejected.status_code == 422
        assert rejected.json()["error"]["code"] == "invalid_habit"

        accepted = client.patch(
            f"/api/v1/habits/{habit['id']}",
            json={"type": "numeric", "target": 30, "unit": "pages"},
        )
        assert accepted.status_code == 200
        assert accepted.json()["target"] == 30

    def test_becoming_boolean_sweeps_target_fields(self, client: TestClient) -> None:
        habit = make_habit(client, "Read", type="numeric", target=30, step=5, unit="pages")

        response = client.patch(f"/api/v1/habits/{habit['id']}", json={"type": "boolean"})

        assert response.status_code == 200
        body = response.json()
        assert body["target"] == 1
        assert body["step"] == 1
        assert body["unit"] is None

    def test_delete_removes_the_habit_and_its_check_ins(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        assert (
            client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03", json={}).status_code
            == 200
        )

        assert client.delete(f"/api/v1/habits/{habit['id']}").status_code == 204

        assert client.get("/api/v1/habits").json()["total"] == 0
        assert client.get("/api/v1/check-ins").json()["total"] == 0

    def test_unknown_habit_is_404(self, client: TestClient) -> None:
        assert client.patch("/api/v1/habits/999", json={"name": "X"}).status_code == 404
        assert client.delete("/api/v1/habits/999").status_code == 404


class TestCheckIns:
    def test_boolean_tap_writes_a_value_one_check_in(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        response = client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03", json={})

        assert response.status_code == 200
        body = response.json()
        assert body["habit_id"] == habit["id"]
        assert body["date"] == "2026-07-03"
        assert body["value"] == 1

    def test_re_taps_keep_one_row_per_habit_and_date(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        for _ in range(3):
            client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03", json={"value": 1})

        page = client.get("/api/v1/check-ins", params={"date": "2026-07-03"}).json()
        assert page["total"] == 1
        assert page["items"][0]["value"] == 1

    def test_boolean_undo_deletes_the_row(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03", json={})

        response = client.delete(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03")

        assert response.status_code == 204
        assert client.get("/api/v1/check-ins").json()["total"] == 0

    def test_boolean_check_in_must_be_value_one(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        response = client.put(
            f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03", json={"value": 5}
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_habit"

    def test_numeric_upsert_replaces_the_days_value(self, client: TestClient) -> None:
        habit = make_habit(client, "Drink water", type="numeric", target=8, unit="glasses")
        path = f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03"

        client.put(path, json={"value": 2})
        response = client.put(path, json={"value": 4})

        assert response.status_code == 200
        assert response.json()["value"] == 4
        page = client.get("/api/v1/check-ins", params={"date": "2026-07-03"}).json()
        assert page["total"] == 1
        assert page["items"][0]["value"] == 4

    def test_days_are_independent(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-02", json={})
        client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03", json={})

        assert client.get("/api/v1/check-ins").json()["total"] == 2
        friday = client.get("/api/v1/check-ins", params={"date": "2026-07-03"}).json()
        assert friday["total"] == 1

    def test_check_ins_filter_by_habit(self, client: TestClient) -> None:
        meditate = make_habit(client, "Meditate")
        gym = make_habit(client, "Gym")
        client.put(f"/api/v1/habits/{meditate['id']}/check-ins/2026-07-03", json={})
        client.put(f"/api/v1/habits/{gym['id']}/check-ins/2026-07-03", json={})

        page = client.get("/api/v1/check-ins", params={"habit_id": gym["id"]}).json()

        assert page["total"] == 1
        assert page["items"][0]["habit_id"] == gym["id"]

    def test_rejects_zero_and_negative_values(self, client: TestClient) -> None:
        habit = make_habit(client, "Drink water", type="numeric", target=8)
        path = f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03"

        for value in (0, -1):
            assert client.put(path, json={"value": value}).status_code == 422, value

    def test_unknown_habit_or_missing_check_in_is_404(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        assert client.put("/api/v1/habits/999/check-ins/2026-07-03", json={}).status_code == 404
        assert (
            client.delete(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03").status_code == 404
        )

    def test_malformed_day_is_422(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        response = client.put(f"/api/v1/habits/{habit['id']}/check-ins/not-a-day", json={})

        assert response.status_code == 422


class TestArchive:
    def test_habits_are_active_by_default(self, client: TestClient) -> None:
        assert make_habit(client, "Meditate")["is_archived"] is False

    def test_archived_habits_leave_the_today_screen(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        response = client.patch(f"/api/v1/habits/{habit['id']}", json={"is_archived": True})

        assert response.status_code == 200
        assert response.json()["is_archived"] is True
        due = client.get("/api/v1/habits", params={"due": "2026-07-03"}).json()
        assert due["total"] == 0

    def test_archiving_preserves_history_and_the_habit_itself(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-02", json={})

        client.patch(f"/api/v1/habits/{habit['id']}", json={"is_archived": True})

        everything = client.get("/api/v1/habits").json()
        assert [h["name"] for h in everything["items"]] == ["Meditate"]
        check_ins = client.get("/api/v1/check-ins", params={"habit_id": habit["id"]}).json()
        assert check_ins["total"] == 1

    def test_unarchive_restores_the_habit_to_today(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        client.patch(f"/api/v1/habits/{habit['id']}", json={"is_archived": True})

        client.patch(f"/api/v1/habits/{habit['id']}", json={"is_archived": False})

        due = client.get("/api/v1/habits", params={"due": "2026-07-03"}).json()
        assert [h["name"] for h in due["items"]] == ["Meditate"]


def test_a_single_habit_is_readable(client: TestClient) -> None:
    created = make_habit(client, "Meditate")

    response = client.get(f"/api/v1/habits/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_unknown_habit_is_404(client: TestClient) -> None:
    response = client.get("/api/v1/habits/999")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
