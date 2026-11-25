"""Reminder notifications (issue #557): the User opts in to delivery of
Reminders. A per-User, server-backed flag, off by default so existing
Reminder offsets never start notifying after an upgrade. Browser permission
is per device and lives in the browser, not here."""

from fastapi.testclient import TestClient

PATH = "/api/v1/settings/reminder-notifications"


class TestReminderNotificationSettings:
    def test_defaults_to_off(self, client: TestClient) -> None:
        response = client.get(PATH)

        assert response.status_code == 200
        assert response.json() == {"enabled": False}

    def test_put_then_get_round_trips_and_is_reversible(self, client: TestClient) -> None:
        put_response = client.put(PATH, json={"enabled": True})
        assert put_response.status_code == 200
        assert put_response.json() == {"enabled": True}
        assert client.get(PATH).json() == {"enabled": True}

        client.put(PATH, json={"enabled": False})
        assert client.get(PATH).json() == {"enabled": False}

    def test_saving_it_leaves_other_settings_untouched(self, client: TestClient) -> None:
        client.put("/api/v1/settings/gentle-return", json={"enabled": True})

        client.put(PATH, json={"enabled": True})

        assert client.get("/api/v1/settings/gentle-return").json() == {"enabled": True}

    def test_other_settings_leave_it_untouched(self, client: TestClient) -> None:
        client.put(PATH, json={"enabled": True})

        client.put("/api/v1/settings/gentle-return", json={"enabled": False})

        assert client.get(PATH).json() == {"enabled": True}

    def test_rejects_a_malformed_payload(self, client: TestClient) -> None:
        assert client.put(PATH, json={}).status_code == 422

    def test_requires_authentication(self, unauthenticated_client: TestClient) -> None:
        assert unauthenticated_client.get(PATH).status_code == 401
