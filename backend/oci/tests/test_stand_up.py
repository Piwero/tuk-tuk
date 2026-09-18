"""Stand-up: one Entry per calendar date, lazily persisted by its first Bullet."""

from fastapi.testclient import TestClient

from tests.conftest import make_task

DAY = "2026-08-10"


def add_bullet(client: TestClient, day: str, section: str, text: str) -> dict:
    response = client.post(
        f"/api/v1/stand-up/entries/{day}/bullets", json={"section": section, "text": text}
    )
    assert response.status_code == 201, response.text
    return response.json()


class TestLazyCreation:
    def test_a_date_with_no_entry_is_not_found(self, client: TestClient) -> None:
        response = client.get(f"/api/v1/stand-up/entries/{DAY}")

        assert response.status_code == 404

    def test_saving_the_first_bullet_persists_the_entry(self, client: TestClient) -> None:
        body = add_bullet(client, DAY, "today", "Ship the stand-up feature")

        assert body["date"] == DAY
        assert body["sprint_goal_snapshot"] == ""
        assert [b["text"] for b in body["bullets"]] == ["Ship the stand-up feature"]

        read_back = client.get(f"/api/v1/stand-up/entries/{DAY}")
        assert read_back.status_code == 200
        assert [b["text"] for b in read_back.json()["bullets"]] == ["Ship the stand-up feature"]

    def test_only_persisted_dates_appear_in_the_history_list(self, client: TestClient) -> None:
        add_bullet(client, DAY, "today", "Ship the stand-up feature")

        history = client.get("/api/v1/stand-up/entries")

        assert history.status_code == 200
        body = history.json()
        assert [item["date"] for item in body["items"]] == [DAY]
        assert body["total"] == 1

    def test_upsert_creates_an_empty_entry_directly(self, client: TestClient) -> None:
        response = client.put(f"/api/v1/stand-up/entries/{DAY}")

        assert response.status_code == 200
        body = response.json()
        assert body["date"] == DAY
        assert body["bullets"] == []
        assert client.get(f"/api/v1/stand-up/entries/{DAY}").status_code == 200


class TestOneEntryPerDate:
    def test_bullets_on_the_same_date_share_one_entry(self, client: TestClient) -> None:
        first = add_bullet(client, DAY, "yesterday", "Reviewed PRs")
        second = add_bullet(client, DAY, "today", "Ship the stand-up feature")

        assert first["id"] == second["id"]
        assert len(second["bullets"]) == 2

    def test_different_dates_get_different_entries(self, client: TestClient) -> None:
        first = add_bullet(client, "2026-08-10", "today", "A")
        second = add_bullet(client, "2026-08-11", "today", "B")

        assert first["id"] != second["id"]


class TestBulletCrud:
    def test_bullets_are_grouped_and_ordered_within_their_section(self, client: TestClient) -> None:
        add_bullet(client, DAY, "today", "First today item")
        add_bullet(client, DAY, "yesterday", "First yesterday item")
        body = add_bullet(client, DAY, "today", "Second today item")

        by_section: dict[str, list[str]] = {"yesterday": [], "today": [], "blockers": []}
        for bullet in body["bullets"]:
            by_section[bullet["section"]].append(bullet["text"])
        assert by_section["today"] == ["First today item", "Second today item"]
        assert by_section["yesterday"] == ["First yesterday item"]
        assert by_section["blockers"] == []

    def test_bullet_can_be_renamed(self, client: TestClient) -> None:
        body = add_bullet(client, DAY, "blockers", "Waiting on design")
        bullet_id = body["bullets"][0]["id"]

        response = client.patch(
            f"/api/v1/stand-up/entries/{DAY}/bullets/{bullet_id}",
            json={"text": "Waiting on design review"},
        )

        assert response.status_code == 200
        assert response.json()["bullets"][0]["text"] == "Waiting on design review"

    def test_bullets_within_a_section_can_be_reordered(self, client: TestClient) -> None:
        add_bullet(client, DAY, "today", "First")
        body = add_bullet(client, DAY, "today", "Second")
        first, second = body["bullets"]

        response = client.patch(
            f"/api/v1/stand-up/entries/{DAY}/bullets/{second['id']}",
            json={"sort_order": first["sort_order"] - 512},
        )

        assert response.status_code == 200
        assert [b["text"] for b in response.json()["bullets"]] == ["Second", "First"]

    def test_bullet_can_be_deleted(self, client: TestClient) -> None:
        body = add_bullet(client, DAY, "today", "Oops")
        bullet_id = body["bullets"][0]["id"]

        response = client.delete(f"/api/v1/stand-up/entries/{DAY}/bullets/{bullet_id}")

        assert response.status_code == 204
        read_back = client.get(f"/api/v1/stand-up/entries/{DAY}")
        assert read_back.json()["bullets"] == []

    def test_bullet_operations_404_on_a_date_with_no_entry(self, client: TestClient) -> None:
        response = client.patch(f"/api/v1/stand-up/entries/{DAY}/bullets/1", json={"text": "x"})

        assert response.status_code == 404


class TestEntryDeletion:
    def test_deleting_an_entry_removes_it_and_its_bullets(self, client: TestClient) -> None:
        add_bullet(client, DAY, "today", "Ship the stand-up feature")

        response = client.delete(f"/api/v1/stand-up/entries/{DAY}")

        assert response.status_code == 204
        assert client.get(f"/api/v1/stand-up/entries/{DAY}").status_code == 404
        history = client.get("/api/v1/stand-up/entries").json()
        assert history["items"] == []

    def test_deleting_a_date_with_no_entry_is_not_found(self, client: TestClient) -> None:
        response = client.delete(f"/api/v1/stand-up/entries/{DAY}")

        assert response.status_code == 404


class TestPastDatesAreEditable:
    def test_a_far_past_date_can_be_edited_freely(self, client: TestClient) -> None:
        body = add_bullet(client, "2020-01-01", "today", "Old entry")

        response = client.patch(
            f"/api/v1/stand-up/entries/2020-01-01/bullets/{body['bullets'][0]['id']}",
            json={"text": "Edited old entry"},
        )

        assert response.status_code == 200
        assert response.json()["bullets"][0]["text"] == "Edited old entry"


class TestTodaySuggestions:
    def test_a_task_due_today_is_suggested(self, client: TestClient) -> None:
        make_task(client, "Ship the release", due_date="2026-08-10T00:00:00Z", is_all_day=True)

        response = client.get("/api/v1/stand-up/suggestions/today", params={"date": DAY})

        assert response.status_code == 200
        assert response.json() == [{"task_id": 1, "title": "Ship the release"}]

    def test_a_task_due_on_another_day_is_not_suggested(self, client: TestClient) -> None:
        make_task(client, "Due tomorrow", due_date="2026-08-11T00:00:00Z", is_all_day=True)

        response = client.get("/api/v1/stand-up/suggestions/today", params={"date": DAY})

        assert response.status_code == 200
        assert response.json() == []

    def test_a_completed_task_due_today_is_not_suggested(self, client: TestClient) -> None:
        task = make_task(client, "Already done", due_date="2026-08-10T00:00:00Z", is_all_day=True)
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})

        response = client.get("/api/v1/stand-up/suggestions/today", params={"date": DAY})

        assert response.status_code == 200
        assert response.json() == []

    def test_an_overdue_open_task_is_suggested_like_the_today_smart_view(
        self, client: TestClient
    ) -> None:
        make_task(client, "Overdue", due_date="2026-08-01T00:00:00Z", is_all_day=True)
        make_task(client, "Undated")

        response = client.get("/api/v1/stand-up/suggestions/today", params={"date": DAY})

        assert response.status_code == 200
        assert [item["title"] for item in response.json()] == ["Overdue"]

    def test_suggestions_match_the_today_smart_views_own_results(self, client: TestClient) -> None:
        make_task(client, "Due today", due_date="2026-08-10T00:00:00Z", is_all_day=True)
        make_task(client, "Overdue", due_date="2026-08-01T00:00:00Z", is_all_day=True)
        make_task(client, "Tomorrow", due_date="2026-08-11T00:00:00Z", is_all_day=True)
        make_task(client, "Undated")

        suggestions = client.get("/api/v1/stand-up/suggestions/today", params={"date": DAY}).json()
        smart_view = client.get("/api/v1/tasks", params={"view": "today", "today": DAY}).json()

        assert sorted(item["title"] for item in suggestions) == sorted(
            item["title"] for item in smart_view["items"]
        )

    def test_suggestions_are_a_pure_read_with_no_side_effects(self, client: TestClient) -> None:
        make_task(client, "Ship the release", due_date="2026-08-10T00:00:00Z", is_all_day=True)

        first = client.get("/api/v1/stand-up/suggestions/today", params={"date": DAY})
        second = client.get("/api/v1/stand-up/suggestions/today", params={"date": DAY})

        assert first.json() == second.json()

    def test_the_date_parameter_is_required(self, client: TestClient) -> None:
        response = client.get("/api/v1/stand-up/suggestions/today")

        assert response.status_code == 422


class TestSprintGoal:
    def test_the_goal_defaults_to_empty(self, client: TestClient) -> None:
        response = client.get("/api/v1/stand-up/sprint-goal")

        assert response.status_code == 200
        assert response.json() == {"text": ""}

    def test_the_goal_round_trips_through_a_write_and_read(self, client: TestClient) -> None:
        write = client.put("/api/v1/stand-up/sprint-goal", json={"text": "Ship v1"})
        assert write.status_code == 200
        assert write.json() == {"text": "Ship v1"}

        read_back = client.get("/api/v1/stand-up/sprint-goal")
        assert read_back.json() == {"text": "Ship v1"}

    def test_a_new_entry_no_longer_snapshots_the_sprint_goal(self, client: TestClient) -> None:
        """Superseded by the focused Goal (ADR 0012, issue #238): Stand-up
        no longer reads or writes SprintGoal at Entry-creation time, even
        though the sprint-goal endpoints above still exist."""
        client.put("/api/v1/stand-up/sprint-goal", json={"text": "Ship v1"})

        body = add_bullet(client, DAY, "today", "Ship the stand-up feature")

        assert body["sprint_goal_snapshot"] == ""


class TestFocusedGoal:
    """Stand-up reads the focused Goal in place of the Sprint Goal input
    (ADR 0012, issue #238)."""

    def test_no_focused_goal_returns_null(self, client: TestClient) -> None:
        response = client.get("/api/v1/stand-up/focused-goal")

        assert response.status_code == 200
        assert response.json() is None

    def test_the_focused_goal_is_returned_with_key_result_progress(
        self, client: TestClient
    ) -> None:
        goal = client.post("/api/v1/goals", json={"title": "Ship v2"}).json()
        client.post(
            f"/api/v1/goals/{goal['id']}/key-results",
            json={"name": "Lines shipped", "target_value": 100, "current_value": 40},
        )
        client.patch(f"/api/v1/goals/{goal['id']}", json={"is_focused": True})

        response = client.get("/api/v1/stand-up/focused-goal")

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "Ship v2"
        assert body["is_focused"] is True
        assert body["key_results"][0]["ratio"] == 0.4
        assert body["score"] == 0.4

    def test_only_the_focused_goal_is_returned_not_every_active_one(
        self, client: TestClient
    ) -> None:
        client.post("/api/v1/goals", json={"title": "Not focused"})
        focused = client.post("/api/v1/goals", json={"title": "Focused"}).json()
        client.patch(f"/api/v1/goals/{focused['id']}", json={"is_focused": True})

        body = client.get("/api/v1/stand-up/focused-goal").json()

        assert body["title"] == "Focused"

    def test_viewing_a_past_entry_does_not_change_the_focused_goal(
        self, client: TestClient
    ) -> None:
        """Regression: reading Stand-up history (or the current day) is a
        pure read and must never mutate which Goal is focused."""
        goal = client.post("/api/v1/goals", json={"title": "Ship v2"}).json()
        client.patch(f"/api/v1/goals/{goal['id']}", json={"is_focused": True})
        add_bullet(client, DAY, "today", "Something")

        client.get(f"/api/v1/stand-up/entries/{DAY}")
        client.get("/api/v1/stand-up/entries/1999-01-01")

        still_focused = client.get("/api/v1/stand-up/focused-goal").json()
        assert still_focused["title"] == "Ship v2"
