"""The Database status + test-connection endpoints (issue #256).

Read-only probe: neither endpoint can switch the app's own database, and
the submitted URL is never logged, stored, or echoed back.
"""

import socket

import pytest
from fastapi.testclient import TestClient

from app.db_probe import probe_connection
from tests.conftest import TEST_PASSWORD, app_settings_row, create_user_row, log_in, run_sql


def _closed_port_url() -> str:
    """A `postgresql://` URL pointing at a local port nothing is
    listening on — bind-then-close gives an instant "connection refused"
    with no server needed. Same pattern as tests/test_assist.py's helper
    of the same name.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return f"postgresql://postgres:postgres@127.0.0.1:{port}/tuktuk"


class TestAdminOnly:
    """The instance's own database is an Admin's concern (ADR 0018), and
    the probe makes the server connect wherever it is told: a member is
    refused both, before anything is probed."""

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("GET", "/api/v1/settings/database", None),
            (
                "POST",
                "/api/v1/settings/database/test-connection",
                {"connection_url": "postgresql://x/y"},
            ),
        ],
    )
    def test_a_member_gets_403_admin_required(
        self, client: TestClient, method: str, path: str, body: dict[str, str] | None
    ) -> None:
        create_user_row(client, "bea", "bea@example.com")
        client.cookies.clear()
        log_in(client, "bea", TEST_PASSWORD)

        response = client.request(method, path, json=body)

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "admin_required"


class TestDatabaseStatus:
    def test_requires_a_session(self, unauthenticated_client: TestClient) -> None:
        response = unauthenticated_client.get("/api/v1/settings/database")

        assert response.status_code == 401

    def test_reports_the_postgres_server_the_app_is_connected_to(
        self, client: TestClient, database_url: str
    ) -> None:
        response = client.get("/api/v1/settings/database")

        assert response.status_code == 200
        body = response.json()
        assert body["engine"] == "postgresql"
        assert body["host"] is not None
        assert body["database"] == database_url.rsplit("/", 1)[1]


class TestConnectionProbe:
    def test_requires_a_session(self, unauthenticated_client: TestClient) -> None:
        response = unauthenticated_client.post(
            "/api/v1/settings/database/test-connection",
            json={"connection_url": "postgresql://x/y"},
        )

        assert response.status_code == 401

    def test_rejects_a_malformed_url_without_connecting(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/settings/database/test-connection",
            json={"connection_url": "not-a-url"},
        )

        assert response.status_code == 422

    def test_rejects_an_unsupported_scheme(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/settings/database/test-connection",
            json={"connection_url": "mysql://user:pass@localhost/db"},
        )

        assert response.status_code == 422

    def test_refused_connection_reports_unreachable(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/settings/database/test-connection",
            json={"connection_url": _closed_port_url()},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is False
        assert body["reason"] == "unreachable"
        assert body["message"]

    def test_response_never_echoes_the_submitted_url(self, client: TestClient) -> None:
        url = _closed_port_url()

        response = client.post(
            "/api/v1/settings/database/test-connection",
            json={"connection_url": url},
        )

        assert url not in response.text

    def test_settings_row_is_unchanged_after_a_test(self, client: TestClient) -> None:
        def snapshot() -> dict[str, object]:
            return {
                k: v for k, v in vars(app_settings_row(client.app)).items() if not k.startswith("_")
            }

        before = snapshot()

        client.post(
            "/api/v1/settings/database/test-connection",
            json={"connection_url": _closed_port_url()},
        )

        assert snapshot() == before


class TestProbeSuccess:
    """The probe pointed straight at a real server — the half the endpoint
    tests above can't reach without one."""

    def test_reports_version_and_that_a_migrated_database_is_empty(self, database_url: str) -> None:
        result = probe_connection(database_url)

        assert result.ok, result.message
        assert result.version is not None
        assert result.version.startswith("PostgreSQL ")
        assert "compiled by" not in result.version  # the build banner, not the version
        assert result.has_existing_data is False

    def test_reports_existing_data_even_with_no_settings_row(self, database_url: str) -> None:
        """Any tuk-tuk table carrying a row means "already holds data", not
        just `settings`."""
        run_sql(
            database_url,
            "INSERT INTO users (id, username, must_complete_profile) VALUES (1, 'admin', true)",
        )
        run_sql(
            database_url,
            "INSERT INTO lists (id, name, is_inbox, sort_order, owner_id, created_at) "
            "VALUES (1, 'Pre-existing', false, 0, 1, now())",
        )

        result = probe_connection(database_url)

        assert result.ok, result.message
        assert result.has_existing_data is True
