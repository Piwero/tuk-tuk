"""Assisted Capture's parse endpoint (ADR 0005; issue #43).

Assist only ever adds value, never subtracts it: every failure mode here —
unset/unreachable Ollama, a malformed extraction, an empty extraction, an
empty residual title, or an unresolvable date phrase — degrades to the text
exactly as typed, never a blocking error.
"""

import datetime as dt
import json
import socket
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.date_phrase import resolve_date_phrase
from app.main import create_app
from tests.conftest import TEST_PASSWORD, FakeClock


class _OllamaHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/api/tags":
            self.send_response(404)
            self.end_headers()
            return
        self._reply({"models": [{"name": "qwen3:14b"}]})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/generate":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        extraction = self.server.extraction  # type: ignore[attr-defined]
        if extraction is _RAISE:
            self.send_response(500)
            self.end_headers()
            return
        self._reply({"response": json.dumps(extraction)})

    def _reply(self, payload: object) -> None:
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


_RAISE = object()


class StubOllama:
    def __init__(self) -> None:
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _OllamaHandler)
        self._server.extraction = {"title": "dentist", "date_phrase": "tuesday 3pm"}  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def set_extraction(self, title: str, date_phrase: str | None) -> None:
        self._server.extraction = {"title": title, "date_phrase": date_phrase}  # type: ignore[attr-defined]

    def set_malformed_extraction(self) -> None:
        self._server.extraction = "not an object"  # type: ignore[attr-defined]

    def set_failing(self) -> None:
        self._server.extraction = _RAISE  # type: ignore[attr-defined]

    def stop(self) -> None:
        self._server.shutdown()
        self._thread.join()


@pytest.fixture
def stub_ollama() -> Iterator[StubOllama]:
    stub = StubOllama()
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


def _configure(client: TestClient, base_url: str, model: str = "qwen3:14b") -> None:
    response = client.put(
        "/api/v1/assist/config", json={"ollama_base_url": base_url, "model": model}
    )
    assert response.status_code == 200, response.text


class TestParseCapture:
    def test_falls_back_to_plain_capture_when_assist_is_unconfigured(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm",
                    "local_date": "2026-08-17",
                    "time_zone": "America/New_York",
                },
            )

        assert response.status_code == 200
        assert response.json() == {
            "title": "dentist tuesday 3pm",
            "due_date": None,
            "is_all_day": False,
            "time_zone": None,
        }

    def test_falls_back_when_ollama_is_unreachable(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(
            database_url,
            fake_clock,
            assist_ollama_base_url=_closed_port_url(),
            assist_model="qwen3:14b",
        ) as client:
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm",
                    "local_date": "2026-08-17",
                    "time_zone": "America/New_York",
                },
            )

        assert response.status_code == 200
        assert response.json()["due_date"] is None
        assert response.json()["title"] == "dentist tuesday 3pm"

    def test_falls_back_on_a_malformed_extraction(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_malformed_extraction()
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json() == {
            "title": "dentist tuesday 3pm",
            "due_date": None,
            "is_all_day": False,
            "time_zone": None,
        }

    def test_falls_back_when_ollama_errors(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_failing()
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json()["due_date"] is None

    def test_empty_extraction_degrades_to_plain_capture(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("call mom", None)
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={"text": "call mom", "local_date": "2026-08-17", "time_zone": "UTC"},
            )

        assert response.status_code == 200
        assert response.json() == {
            "title": "call mom",
            "due_date": None,
            "is_all_day": False,
            "time_zone": None,
        }

    def test_empty_residual_title_falls_back_to_the_full_typed_text(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("", None)
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={"text": "tomorrow", "local_date": "2026-08-17", "time_zone": "UTC"},
            )

        assert response.status_code == 200
        assert response.json()["title"] == "tomorrow"

    def test_an_unresolvable_date_phrase_still_saves_the_stripped_title_with_no_date(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("dentist", "sometime soon")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist sometime soon",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json() == {
            "title": "dentist",
            "due_date": None,
            "is_all_day": False,
            "time_zone": None,
        }

    def test_resolves_a_weekday_and_time_phrase_against_the_client_local_date(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        # 2026-08-17 is a Monday; "tuesday 3pm" should resolve to 2026-08-18.
        stub_ollama.set_extraction("dentist", "tuesday 3pm")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm",
                    "local_date": "2026-08-17",
                    "time_zone": "America/New_York",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "dentist"
        assert body["due_date"] == "2026-08-18T15:00:00-04:00"
        assert body["is_all_day"] is False
        assert body["time_zone"] == "America/New_York"

    def test_resolves_tomorrow_as_all_day(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("call mom", "tomorrow")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={"text": "call mom tomorrow", "local_date": "2026-08-17", "time_zone": "UTC"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["due_date"] == "2026-08-18T00:00:00Z"
        assert body["is_all_day"] is True

    def test_the_created_task_can_be_confirmed_through_the_existing_task_endpoint(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        """The confirmation beat's own write path — this endpoint returns a
        draft only; confirming a Suggestion always goes through the same
        POST /api/v1/tasks every other Task creation uses (ADR 0005: no
        Suggestion entity, no separate persistence path)."""
        stub_ollama.set_extraction("dentist", "tomorrow")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            draft = client.post(
                "/api/v1/assist/parse-capture",
                json={"text": "dentist tomorrow", "local_date": "2026-08-17", "time_zone": "UTC"},
            ).json()

            created = client.post(
                "/api/v1/tasks",
                json={
                    "title": draft["title"],
                    "due_date": draft["due_date"],
                    "is_all_day": draft["is_all_day"],
                    "time_zone": draft["time_zone"],
                },
            )

        assert created.status_code == 201, created.text
        assert created.json()["title"] == "dentist"
        assert created.json()["due_date"] == "2026-08-18T00:00:00Z"


class TestResolveDatePhrase:
    def test_tomorrow_is_all_day(self) -> None:
        result = resolve_date_phrase("tomorrow", dt.date(2026, 8, 17), "UTC")
        assert result is not None
        due_date, is_all_day = result
        assert is_all_day is True
        assert due_date.date().isoformat() == "2026-08-18"

    def test_next_weekday_skips_todays_occurrence(self) -> None:
        # 2026-08-18 is a Tuesday; "next tuesday" should be a week later.
        result = resolve_date_phrase("next tuesday", dt.date(2026, 8, 18), "UTC")
        assert result is not None
        assert result[0].date().isoformat() == "2026-08-25"

    def test_bare_weekday_can_resolve_to_today(self) -> None:
        result = resolve_date_phrase("tuesday", dt.date(2026, 8, 18), "UTC")
        assert result is not None
        assert result[0].date().isoformat() == "2026-08-18"

    def test_unrecognized_phrase_returns_none(self) -> None:
        assert resolve_date_phrase("sometime soon", dt.date(2026, 8, 17), "UTC") is None

    def test_unrecognized_time_returns_none(self) -> None:
        assert resolve_date_phrase("tomorrow 25:99", dt.date(2026, 8, 17), "UTC") is None

    def test_unknown_timezone_returns_none(self) -> None:
        assert resolve_date_phrase("tomorrow", dt.date(2026, 8, 17), "Not/AZone") is None
