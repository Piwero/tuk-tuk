"""Creating a User (ADR 0018): each starts with their own Inbox, and new
rows still default to user #1 until the global owner filter (issue #411)
fills `owner_id` from the signed-in User."""

from fastapi.testclient import TestClient

from tests.conftest import create_user_row, make_task, run_sql


class TestCreatingAUser:
    def test_each_user_gets_their_own_inbox(
        self, unauthenticated_client: TestClient, database_url: str
    ) -> None:
        bea = create_user_row(unauthenticated_client, "bea", "bea@example.com")

        assert run_sql(
            database_url, "SELECT owner_id, name FROM lists WHERE is_inbox ORDER BY owner_id"
        ) == [(1, "Inbox"), (bea.id, "Inbox")]


class TestUser1OwnsNewRowsForNow:
    def test_a_created_task_and_its_check_item_belong_to_user_1(
        self, client: TestClient, database_url: str
    ) -> None:
        task = make_task(client, "Write code")
        response = client.post(f"/api/v1/tasks/{task['id']}/check-items", json={"title": "Tests"})
        assert response.status_code == 201, response.text

        assert run_sql(database_url, "SELECT owner_id FROM tasks") == [(1,)]
        assert run_sql(database_url, "SELECT owner_id FROM check_items") == [(1,)]
