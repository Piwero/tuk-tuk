"""Stand-up: one Entry per calendar date, lazily persisted by its first Bullet."""

from fastapi.testclient import TestClient

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

    def test_a_new_entry_snapshots_the_current_goal(self, client: TestClient) -> None:
        client.put("/api/v1/stand-up/sprint-goal", json={"text": "Ship v1"})

        body = add_bullet(client, DAY, "today", "Ship the stand-up feature")

        assert body["sprint_goal_snapshot"] == "Ship v1"

    def test_editing_the_goal_later_does_not_change_an_existing_entrys_snapshot(
        self, client: TestClient
    ) -> None:
        client.put("/api/v1/stand-up/sprint-goal", json={"text": "Ship v1"})
        body = add_bullet(client, DAY, "today", "Ship the stand-up feature")
        assert body["sprint_goal_snapshot"] == "Ship v1"

        client.put("/api/v1/stand-up/sprint-goal", json={"text": "Ship v2"})

        read_back = client.get(f"/api/v1/stand-up/entries/{DAY}")
        assert read_back.json()["sprint_goal_snapshot"] == "Ship v1"
        assert client.get("/api/v1/stand-up/sprint-goal").json() == {"text": "Ship v2"}
