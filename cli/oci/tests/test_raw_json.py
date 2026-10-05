"""`--json` is a transparent window onto the API, not a second schema.

These tests pin the one property the per-command `--json` tests cannot: the
bytes. Those assert `json.loads(out) == BODY`, which is semantic equality and
passes just as happily for a re-serialised dict — so it would never notice
`ensure_ascii` mangling a Tag name, key order being rewritten, or a number
being re-formatted. Here the transport answers with chosen bytes and the test
asserts stdout carries exactly those bytes back.

Captured with `capsysbinary` rather than `capsys`, because the point is the
bytes and a text capture would decode them before the assertion ran.
"""

import json
from pathlib import Path

import httpx
import pytest

from tuk.cli import main

# Non-ASCII that `json.dumps` would escape to \uXXXX, keys in an order no
# sorted re-serialisation would reproduce, and a float whose repr differs
# from its source text.
RAW_TASK = (
    b'{"title":"Caf\xc3\xa9 r\xc3\xa9sum\xc3\xa9 \xe2\x80\x94 \xf0\x9f\x8e\x89",'
    b'"id":7,"completed":false,"estimate":0.30000000000000004,'
    b'"check_items":[],"zz_last":"\xc3\xa9"}'
)

RAW_PAGE = (
    b'{"items":[{"title":"\xc3\xa9t\xc3\xa9","id":7,"is_all_day":true,'
    b'"due_date":"2026-10-04T00:00:00Z"}],"total":1,"limit":50,"offset":0}'
)


@pytest.fixture
def logged_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "config"
    monkeypatch.setenv("TUK_CONFIG_DIR", str(target))
    monkeypatch.setenv("TUK_TIMEZONE", "Europe/London")
    target.mkdir(parents=True, exist_ok=True)
    (target / "tuk").mkdir(exist_ok=True)
    (target / "tuk" / "config.json").write_text(json.dumps({"base_url": "http://x"}))
    (target / "tuk" / "session.json").write_text(json.dumps({"session_cookie": "sess"}))
    return target


def raw_transport(content: bytes) -> httpx.MockTransport:
    """Every route answers the same bytes. Creation answers 201 and
    everything else 200 — the status each command's client call expects."""

    def handler(request: httpx.Request) -> httpx.Response:
        status = 201 if request.method == "POST" else 200
        return httpx.Response(status, content=content, headers={"content-type": "application/json"})

    return httpx.MockTransport(handler)


def run_capturing_bytes(
    argv: list[str],
    transport: httpx.MockTransport,
    capsysbinary: pytest.CaptureFixture[bytes],
) -> bytes:
    """`main` run to a zero exit, returning every byte it wrote to stdout."""
    assert main(argv, transport=transport) == 0
    return capsysbinary.readouterr().out


@pytest.mark.parametrize(
    ("argv", "content"),
    [
        (["show", "--json", "7"], RAW_TASK),
        (["done", "--json", "7"], RAW_TASK),
        (["reopen", "--json", "7"], RAW_TASK),
        (["edit", "--json", "7", "--title", "x"], RAW_TASK),
        (["check", "--json", "add", "7", "Socks"], RAW_TASK),
        (["check", "--json", "tick", "7", "1"], RAW_TASK),
        (["check", "--json", "untick", "7", "1"], RAW_TASK),
        (["ls", "--json"], RAW_PAGE),
        (["habits", "--json"], RAW_PAGE),
    ],
    ids=["show", "done", "reopen", "edit", "check-add", "tick", "untick", "ls", "habits"],
)
def test_json_emits_the_response_bytes_verbatim(
    logged_in: Path,
    capsysbinary: pytest.CaptureFixture[bytes],
    argv: list[str],
    content: bytes,
) -> None:
    written = run_capturing_bytes(argv, raw_transport(content), capsysbinary)

    assert written == content + b"\n"


def test_json_add_emits_the_response_bytes_verbatim(
    logged_in: Path, capsysbinary: pytest.CaptureFixture[bytes]
) -> None:
    written = run_capturing_bytes(["add", "--json", "Café"], raw_transport(RAW_TASK), capsysbinary)

    assert written == RAW_TASK + b"\n"


def test_json_does_not_escape_non_ascii(
    logged_in: Path, capsysbinary: pytest.CaptureFixture[bytes]
) -> None:
    """The failure mode `json.loads(out) == BODY` cannot see: a re-serialised
    body is semantically equal but has `\\u00e9` where the API sent `é`."""
    written = run_capturing_bytes(["show", "--json", "7"], raw_transport(RAW_TASK), capsysbinary)

    assert "é".encode() in written
    assert rb"\u00e9" not in written


def test_json_preserves_the_api_key_order(
    logged_in: Path, capsysbinary: pytest.CaptureFixture[bytes]
) -> None:
    written = run_capturing_bytes(["show", "--json", "7"], raw_transport(RAW_TASK), capsysbinary)

    assert written.index(b'"title"') < written.index(b'"id"')
