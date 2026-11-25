"""Gentle return (issue #548): an optional Today presentation that collapses
earlier overdue Tasks behind a counted disclosure. The User chooses it; it is
a per-User, server-backed flag, off by default and reversible."""

from fastapi.testclient import TestClient


class TestGentleReturnSettings:
    def test_defaults_to_off(self, client: TestClient) -> None:
        response = client.get("/api/v1/settings/gentle-return")

        assert response.status_code == 200
        assert response.json() == {"enabled": False}

    def test_put_then_get_round_trips_and_is_reversible(self, client: TestClient) -> None:
        put_response = client.put("/api/v1/settings/gentle-return", json={"enabled": True})
        assert put_response.status_code == 200
        assert put_response.json() == {"enabled": True}
        assert client.get("/api/v1/settings/gentle-return").json() == {"enabled": True}

        client.put("/api/v1/settings/gentle-return", json={"enabled": False})
        assert client.get("/api/v1/settings/gentle-return").json() == {"enabled": False}

    def test_saving_it_leaves_other_settings_untouched(self, client: TestClient) -> None:
        client.put("/api/v1/settings/stand-up", json={"enabled": False})
        client.put(
            "/api/v1/settings/active-hours",
            json={"enabled": True, "start": "07:30", "end": "22:00"},
        )
        sections = client.get("/api/v1/settings/sections").json()

        client.put("/api/v1/settings/gentle-return", json={"enabled": True})

        assert client.get("/api/v1/settings/stand-up").json() == {"enabled": False}
        assert client.get("/api/v1/settings/active-hours").json() == {
            "enabled": True,
            "start": "07:30",
            "end": "22:00",
        }
        assert client.get("/api/v1/settings/sections").json() == sections

    def test_other_settings_leave_it_untouched(self, client: TestClient) -> None:
        client.put("/api/v1/settings/gentle-return", json={"enabled": True})

        client.put("/api/v1/settings/stand-up", json={"enabled": False})

        assert client.get("/api/v1/settings/gentle-return").json() == {"enabled": True}

    def test_requires_authentication(self, unauthenticated_client: TestClient) -> None:
        assert unauthenticated_client.get("/api/v1/settings/gentle-return").status_code == 401
