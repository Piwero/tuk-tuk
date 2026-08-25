"""The Assistant's configuration and availability gate (ADR 0009; issue
#185) — the foundation every later Assistant slice rides on.

Mirrors test_assist.py's shape: a real localhost HTTP server stands in for
an OpenAI-compatible provider (the seam this suite exercises rather than
mocking the transport), and the status probe must never error — an unset,
unreachable, or unauthenticated provider all collapse to `available: false`.
"""

import socket
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import TEST_PASSWORD, FakeClock


class _ModelsHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/models":
            self.send_response(404)
            self.end_headers()
            return
        expected = f"Bearer {self.server.expected_api_key}"  # type: ignore[attr-defined]
        if self.headers.get("Authorization") != expected:
            self.send_response(401)
            self.end_headers()
            return
        body = b'{"data": []}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


class StubProvider:
    """A real HTTP server standing in for an OpenAI-compatible provider's
    `GET /models` — the seam issue #185 asks for, mirroring StubOllama."""

    def __init__(self, api_key: str = "test-api-key") -> None:
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _ModelsHandler)
        self._server.expected_api_key = api_key  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    @property
    def api_key(self) -> str:
        return self._server.expected_api_key  # type: ignore[attr-defined,no-any-return]

    def stop(self) -> None:
        self._server.shutdown()
        self._thread.join()


@pytest.fixture
def stub_provider() -> Iterator[StubProvider]:
    stub = StubProvider()
    yield stub
    stub.stop()


def _closed_port_url() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return f"http://127.0.0.1:{port}"


@contextmanager
def make_client(
    database_url: str, fake_clock: FakeClock, **overrides: object
) -> Iterator[TestClient]:
    app = create_app(Settings(database_url=database_url, **overrides), clock=fake_clock)  # type: ignore[arg-type]
    with TestClient(app) as test_client:
        response = test_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
        assert response.status_code == 204, response.text
        yield test_client


class TestAssistantStatus:
    def test_unavailable_when_settings_are_unset(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.get("/api/v1/assistant/status")

        assert response.status_code == 200
        assert response.json() == {"available": False}

    def test_unavailable_when_provider_is_unreachable(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            client.put(
                "/api/v1/assistant/config",
                json={
                    "base_url": _closed_port_url(),
                    "model": "gpt-4o-mini",
                    "api_key": "sk-test",
                },
            )

            response = client.get("/api/v1/assistant/status")

        assert response.status_code == 200
        assert response.json() == {"available": False}

    def test_unavailable_when_the_api_key_is_wrong(
        self, database_url: str, fake_clock: FakeClock, stub_provider: StubProvider
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            client.put(
                "/api/v1/assistant/config",
                json={
                    "base_url": stub_provider.base_url,
                    "model": "gpt-4o-mini",
                    "api_key": "wrong-key",
                },
            )

            response = client.get("/api/v1/assistant/status")

        assert response.status_code == 200
        assert response.json() == {"available": False}

    def test_available_when_the_provider_is_reachable_and_authenticated(
        self, database_url: str, fake_clock: FakeClock, stub_provider: StubProvider
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            save = client.put(
                "/api/v1/assistant/config",
                json={
                    "base_url": stub_provider.base_url,
                    "model": "gpt-4o-mini",
                    "api_key": stub_provider.api_key,
                },
            )
            assert save.status_code == 200, save.text

            response = client.get("/api/v1/assistant/status")

        assert response.status_code == 200
        assert response.json() == {"available": True}


class TestAssistantConfig:
    def test_reads_unset_config_as_nulls(self, database_url: str, fake_clock: FakeClock) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.get("/api/v1/assistant/config")

        assert response.status_code == 200
        assert response.json() == {
            "base_url": None,
            "model": None,
            "api_key_set": False,
            "planning_preferences": None,
        }

    def test_saves_base_url_model_and_preferences_in_plain_text(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.put(
                "/api/v1/assistant/config",
                json={
                    "base_url": "https://api.openai.com/v1",
                    "model": "gpt-4o-mini",
                    "planning_preferences": "work 9-6, lunch 1-2",
                },
            )

        assert response.status_code == 200
        assert response.json() == {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
            "api_key_set": False,
            "planning_preferences": "work 9-6, lunch 1-2",
        }

    def test_the_api_key_is_write_only_and_never_echoed_back(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            save = client.put("/api/v1/assistant/config", json={"api_key": "sk-secret"})
            read = client.get("/api/v1/assistant/config")

        assert "sk-secret" not in save.text
        assert "sk-secret" not in read.text
        assert save.json()["api_key_set"] is True
        assert read.json()["api_key_set"] is True

    def test_the_api_key_is_encrypted_at_rest(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        from app.app_settings import get_app_settings
        from app.crypto import decrypt_credential

        with make_client(database_url, fake_clock) as client:
            client.put("/api/v1/assistant/config", json={"api_key": "sk-secret"})
            app = client.app

            async def _fetch() -> str | None:
                async with app.state.session_factory() as session:
                    row = await get_app_settings(session)
                    assert row is not None
                    return row.encrypted_assistant_api_key

            import asyncio

            encrypted = asyncio.run(_fetch())

        assert encrypted is not None
        assert encrypted != "sk-secret"
        assert decrypt_credential(encrypted, key="test-master-key") == "sk-secret"

    def test_a_field_omitted_from_the_update_is_left_unchanged(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            client.put(
                "/api/v1/assistant/config",
                json={
                    "base_url": "https://api.openai.com/v1",
                    "model": "gpt-4o-mini",
                    "api_key": "sk-secret",
                },
            )

            response = client.put("/api/v1/assistant/config", json={"model": "gpt-4.1-mini"})

        assert response.status_code == 200
        body = response.json()
        assert body["base_url"] == "https://api.openai.com/v1"
        assert body["model"] == "gpt-4.1-mini"
        assert body["api_key_set"] is True

    def test_an_explicit_null_is_rejected_rather_than_clearing_the_field(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.put("/api/v1/assistant/config", json={"base_url": None})

        assert response.status_code == 422

    def test_delete_clears_every_field(self, database_url: str, fake_clock: FakeClock) -> None:
        with make_client(database_url, fake_clock) as client:
            client.put(
                "/api/v1/assistant/config",
                json={
                    "base_url": "https://api.openai.com/v1",
                    "model": "gpt-4o-mini",
                    "api_key": "sk-secret",
                    "planning_preferences": "work 9-6",
                },
            )

            delete_response = client.delete("/api/v1/assistant/config")
            read_response = client.get("/api/v1/assistant/config")

        assert delete_response.status_code == 204
        assert read_response.json() == {
            "base_url": None,
            "model": None,
            "api_key_set": False,
            "planning_preferences": None,
        }


class TestAssistantIndependenceFromAssist:
    def test_the_assistant_never_reads_or_writes_assists_settings(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            client.put(
                "/api/v1/assist/config",
                json={"ollama_base_url": "http://localhost:11434", "model": "qwen3:14b"},
            )

            assistant_config = client.get("/api/v1/assistant/config")
            client.put(
                "/api/v1/assistant/config",
                json={
                    "base_url": "https://api.openai.com/v1",
                    "model": "gpt-4o-mini",
                    "api_key": "sk-secret",
                },
            )
            assist_config = client.get("/api/v1/assist/config")

        assert assistant_config.json() == {
            "base_url": None,
            "model": None,
            "api_key_set": False,
            "planning_preferences": None,
        }
        assert assist_config.json() == {
            "ollama_base_url": "http://localhost:11434",
            "model": "qwen3:14b",
        }
