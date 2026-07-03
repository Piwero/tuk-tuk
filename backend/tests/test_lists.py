from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_first_boot_creates_the_inbox(client: TestClient) -> None:
    response = client.get("/api/v1/lists")

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    inbox = items[0]
    assert inbox["name"] == "Inbox"
    assert inbox["is_inbox"] is True


def test_restarting_does_not_duplicate_the_inbox(database_url: str) -> None:
    for _ in range(2):
        with TestClient(create_app(Settings(database_url=database_url))):
            pass

    with TestClient(create_app(Settings(database_url=database_url))) as client:
        items = client.get("/api/v1/lists").json()["items"]
        assert [item["name"] for item in items] == ["Inbox"]
