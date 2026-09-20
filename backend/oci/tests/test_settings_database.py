"""The Database status + test-connection endpoints (issue #256).

Read-only probe: neither endpoint can switch the app's own database, and
the submitted URL is never logged, stored, or echoed back. The success
path (real PostgreSQL, reporting version and emptiness) is deliberately
not covered here — it's exercised by the opt-in PostgreSQL job from #254,
which has a real server to talk to.
"""

import socket

from fastapi.testclient import TestClient

from tests.conftest import app_settings_row


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


class TestDatabaseStatus:
    def test_requires_a_session(self, unauthenticated_client: TestClient) -> None:
        response = unauthenticated_client.get("/api/v1/settings/database")

        assert response.status_code == 401

    def test_reports_sqlite_for_the_default_test_setup(self, client: TestClient) -> None:
        response = client.get("/api/v1/settings/database")

        assert response.status_code == 200
        body = response.json()
        assert body["engine"] == "sqlite"
        assert body["host"] is None
        assert body["database"] is None


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
