"""The Assist availability probe (ADR 0005; issue #42).

Assist is invisible when absent: the status endpoint is how the frontend
asks, on load and on every window refocus, whether it's safe to render any
AI affordance. It must never error — an unset, unreachable, or
model-missing Ollama all collapse to the same `available: false`.
"""

import json
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


class _TagsHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/api/tags":
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(self.server.tags_response).encode()  # type: ignore[attr-defined]
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


class StubOllama:
    """A real HTTP server on localhost standing in for Ollama's `/api/tags`
    — the seam issue #42 asks for: point `assist_ollama_base_url` at this
    instead of mocking the transport, so the test exercises the real
    outbound httpx call.
    """

    def __init__(self) -> None:
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _TagsHandler)
        self._server.tags_response = {"models": []}  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def set_installed_models(self, names: list[str]) -> None:
        self._server.tags_response = {"models": [{"name": n} for n in names]}  # type: ignore[attr-defined]

    def stop(self) -> None:
        self._server.shutdown()
        self._thread.join()


@pytest.fixture
def stub_ollama() -> Iterator[StubOllama]:
    stub = StubOllama()
    yield stub
    stub.stop()


def _closed_port_url() -> str:
    """A `http://127.0.0.1:<port>` nothing is listening on, so a connection
    to it is refused immediately — simulates Ollama simply not running."""
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


class TestAssistStatus:
    def test_unavailable_when_settings_are_unset(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.get("/api/v1/assist/status")

        assert response.status_code == 200
        assert response.json() == {"available": False}

    def test_unavailable_when_ollama_is_unreachable(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(
            database_url,
            fake_clock,
            assist_ollama_base_url=_closed_port_url(),
            assist_model="qwen3:14b",
        ) as client:
            response = client.get("/api/v1/assist/status")

        assert response.status_code == 200
        assert response.json() == {"available": False}

    def test_unavailable_when_model_is_not_installed(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_installed_models(["llama3:8b"])
        with make_client(
            database_url,
            fake_clock,
            assist_ollama_base_url=stub_ollama.base_url,
            assist_model="qwen3:14b",
        ) as client:
            response = client.get("/api/v1/assist/status")

        assert response.status_code == 200
        assert response.json() == {"available": False}

    def test_available_when_ollama_is_reachable_and_model_is_installed(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_installed_models(["llama3:8b", "qwen3:14b"])
        with make_client(
            database_url,
            fake_clock,
            assist_ollama_base_url=stub_ollama.base_url,
            assist_model="qwen3:14b",
        ) as client:
            response = client.get("/api/v1/assist/status")

        assert response.status_code == 200
        assert response.json() == {"available": True}

    def test_reflects_config_saved_through_the_settings_endpoint(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        """The Settings UI's Test button is just this endpoint, called
        after Save — proving a saved config (not an env var) is what
        status now answers against."""
        stub_ollama.set_installed_models(["qwen3:14b"])
        with make_client(database_url, fake_clock) as client:
            save = client.put(
                "/api/v1/assist/config",
                json={"ollama_base_url": stub_ollama.base_url, "model": "qwen3:14b"},
            )
            assert save.status_code == 200, save.text

            response = client.get("/api/v1/assist/status")

        assert response.status_code == 200
        assert response.json() == {"available": True}


class TestAssistConfig:
    def test_reads_unset_config_as_nulls(self, database_url: str, fake_clock: FakeClock) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.get("/api/v1/assist/config")

        assert response.status_code == 200
        assert response.json() == {"ollama_base_url": None, "model": None}

    def test_saves_both_fields(self, database_url: str, fake_clock: FakeClock) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.put(
                "/api/v1/assist/config",
                json={"ollama_base_url": "http://localhost:11434", "model": "qwen3:14b"},
            )

        assert response.status_code == 200
        assert response.json() == {
            "ollama_base_url": "http://localhost:11434",
            "model": "qwen3:14b",
        }

    def test_a_field_omitted_from_the_update_is_left_unchanged(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            client.put(
                "/api/v1/assist/config",
                json={"ollama_base_url": "http://localhost:11434", "model": "qwen3:14b"},
            )

            response = client.put("/api/v1/assist/config", json={"model": "llama3:8b"})

        assert response.status_code == 200
        assert response.json() == {
            "ollama_base_url": "http://localhost:11434",
            "model": "llama3:8b",
        }

    def test_an_explicit_null_is_rejected_rather_than_clearing_the_field(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.put("/api/v1/assist/config", json={"ollama_base_url": None})

        assert response.status_code == 422

    def test_delete_clears_both_fields(self, database_url: str, fake_clock: FakeClock) -> None:
        with make_client(database_url, fake_clock) as client:
            client.put(
                "/api/v1/assist/config",
                json={"ollama_base_url": "http://localhost:11434", "model": "qwen3:14b"},
            )

            delete_response = client.delete("/api/v1/assist/config")
            read_response = client.get("/api/v1/assist/config")

        assert delete_response.status_code == 204
        assert read_response.json() == {"ollama_base_url": None, "model": None}
