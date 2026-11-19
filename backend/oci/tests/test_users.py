"""Creating a User (ADR 0018): each starts with their own Inbox, and every
row they create, children included, is theirs (issue #411)."""

from fastapi.testclient import TestClient

from tests.conftest import create_user_row, log_in, make_task, run_sql


class TestCreatingAUser:
    def test_each_user_gets_their_own_inbox(
        self, unauthenticated_client: TestClient, database_url: str
    ) -> None:
        bea = create_user_row(unauthenticated_client, "bea", "bea@example.com")

        assert run_sql(
            database_url, "SELECT owner_id, name FROM lists WHERE is_inbox ORDER BY owner_id"
        ) == [(1, "Inbox"), (bea.id, "Inbox")]


class TestNewRowsBelongToTheSignedInUser:
    def test_a_created_task_and_its_check_item_belong_to_whoever_created_them(
        self, unauthenticated_client: TestClient, database_url: str
    ) -> None:
        bea = create_user_row(unauthenticated_client, "bea", "bea@example.com")
        log_in(unauthenticated_client, "bea")

        task = make_task(unauthenticated_client, "Write code")
        response = unauthenticated_client.post(
            f"/api/v1/tasks/{task['id']}/check-items", json={"title": "Tests"}
        )
        assert response.status_code == 201, response.text

        assert run_sql(database_url, "SELECT owner_id FROM tasks") == [(bea.id,)]
        assert run_sql(database_url, "SELECT owner_id FROM check_items") == [(bea.id,)]
