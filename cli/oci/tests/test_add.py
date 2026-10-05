"""Unit tests drive the real entrypoint with a mock transport.

One handler serves the three routes `add` touches: the Lists and Tags
collections for name resolution, and the Task creation POST. Tests assert
the emitted request body, the resolution behaviour (hits, misses,
case-insensitivity), the date vocabulary mapping, and the rendered output.
"""

import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from tuk.cli import main

LISTS_BODY = {
    "items": [
        {"id": 1, "name": "Inbox"},
        {"id": 2, "name": "Groceries"},
    ],
    "total": 2,
    "limit": 200,
    "offset": 0,
}

TAGS_BODY = {
    "items": [
        {"id": 5, "name": "home"},
        {"id": 6, "name": "Urgent"},
    ],
    "total": 2,
    "limit": 200,
    "offset": 0,
}

CREATED_BODY = {"id": 42, "title": "Buy milk"}

ZONE = ZoneInfo("Europe/London")  # pinned by the logged_in fixture's TUK_TIMEZONE


def london_today() -> date:
    return datetime.now(ZONE).date()


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


def add_transport(
    created: object = CREATED_BODY,
    create_status: int = 201,
    lists: object = LISTS_BODY,
    tags: object = TAGS_BODY,
) -> tuple[httpx.MockTransport, dict[str, object]]:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["cookie"] = request.headers.get("cookie", "")
        seen["path"] = request.url.path
        if request.url.path == "/api/v1/tasks" and request.method == "POST":
            seen["body"] = json.loads(request.content.decode())
            return httpx.Response(create_status, json=created)
        if request.url.path == "/api/v1/lists":
            assert request.method == "GET", request.method
            seen["lists_hit"] = True
            return httpx.Response(200, json=lists)
        if request.url.path == "/api/v1/tags":
            assert request.method == "GET", request.method
            seen["tags_hit"] = True
            return httpx.Response(200, json=tags)
        raise AssertionError(f"unexpected {request.method} {request.url.path}")

    return httpx.MockTransport(handler), seen


def test_add_title_only_sends_minimal_body(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk"], transport=transport) == 0

    assert seen["body"] == {"title": "Buy milk"}
    assert "lists_hit" not in seen
    assert "42" in capsys.readouterr().out


def test_add_unknown_priority_surfaces_api_message(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    error = {"error": {"code": "invalid_priority", "message": "Unknown priority 'urgent-ish'"}}
    transport, seen = add_transport(created=error, create_status=422)

    assert main(["add", "Buy milk", "--priority", "urgent-ish"], transport=transport) == 1

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["priority"] == "urgent-ish"
    err = capsys.readouterr().err
    assert "Unknown priority" in err
    assert "422" not in err


def test_add_json_emits_created_body(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, _ = add_transport()

    assert main(["add", "--json", "Buy milk"], transport=transport) == 0

    assert json.loads(capsys.readouterr().out) == CREATED_BODY


def test_add_resolves_list_name_case_insensitively(logged_in: Path) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--list", "groceries"], transport=transport) == 0

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["list_id"] == 2
    assert seen["lists_hit"] is True


def test_add_unknown_list_names_candidates(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--list", "Nope"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "Nope" in err
    # Every candidate, not just one — the miss message exists so the typo can
    # be corrected without opening the app.
    assert "Groceries" in err
    assert "Inbox" in err
    assert "path" not in seen or seen.get("body") is None


def test_add_rejects_a_partial_list_name(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Matching is exact, never containment: `--list grocer` must not land in
    "Groceries". The backend's lenient phrase resolver is right for a model
    guessing from prose and wrong for an argument a human typed."""
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--list", "grocer"], transport=transport) == 1

    assert "Groceries" in capsys.readouterr().err
    assert "body" not in seen


def test_add_against_an_empty_collection_says_none(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    empty = {"items": [], "total": 0, "limit": 200, "offset": 0}
    transport, seen = add_transport(tags=empty)

    assert main(["add", "Buy milk", "--tag", "home"], transport=transport) == 1

    assert "(none)" in capsys.readouterr().err
    assert "body" not in seen


def test_add_resolves_tag_names(logged_in: Path) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--tag", "HOME", "--tag", "urgent"], transport=transport) == 0

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["tag_ids"] == [5, 6]


def test_add_unknown_tag_errors_without_creating(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--tag", "Nope"], transport=transport) == 1

    assert "Nope" in capsys.readouterr().err
    assert "body" not in seen


def test_add_maps_full_flag_set(logged_in: Path) -> None:
    transport, seen = add_transport()

    assert (
        main(
            [
                "add",
                "Buy milk",
                "--list",
                "Groceries",
                "--tag",
                "home",
                "--priority",
                "high",
                "--description",
                "Oat if they have it",
                "--due",
                "tomorrow",
                "--start",
                "today",
                "--all-day",
                "--recurrence",
                "RRULE:FREQ=DAILY",
                "--reminder",
                "-PT30M",
            ],
            transport=transport,
        )
        == 0
    )

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["list_id"] == 2
    assert body["tag_ids"] == [5]
    assert body["priority"] == "high"
    assert body["description"] == "Oat if they have it"
    assert body["is_all_day"] is True
    assert body["recurrence"] == "RRULE:FREQ=DAILY"
    assert body["reminders"] == ["-PT30M"]
    assert body["time_zone"] == "Europe/London"
    assert str(body["due_date"]).startswith((london_today() + timedelta(days=1)).isoformat())


def due_day(seen: dict[str, object]) -> date:
    """The calendar day of the `due_date` the client actually emitted."""
    body = seen["body"]
    assert isinstance(body, dict)
    return datetime.fromisoformat(str(body["due_date"])).date()


@pytest.mark.parametrize(
    ("word", "offset"),
    [("today", 0), ("tomorrow", 1), ("yesterday", -1)],
)
def test_add_maps_relative_words_to_days_either_side_of_today(
    logged_in: Path, word: str, offset: int
) -> None:
    transport, seen = add_transport()

    assert main(["add", "T", "--due", word], transport=transport) == 0

    assert due_day(seen) == london_today() + timedelta(days=offset)


def test_add_maps_an_iso_date_to_itself(logged_in: Path) -> None:
    """A fixed literal, independent of today — the one case where the expected
    value owes nothing to the clock."""
    transport, seen = add_transport()

    assert main(["add", "T", "--due", "2026-12-25"], transport=transport) == 0

    assert due_day(seen) == date(2026, 12, 25)


@pytest.mark.parametrize(
    ("word", "weekday"),
    [
        # All seven, so whatever day the suite runs, one case names *today* —
        # that is the case which pins "a weekday that is today means next
        # week's", and it would go unexercised under a shorter list.
        ("monday", 0),
        ("Tuesday", 1),
        ("WEDNESDAY", 2),
        ("thursday", 3),
        ("Friday", 4),
        ("saturday", 5),
        ("SUNDAY", 6),
    ],
)
def test_add_maps_a_weekday_name_to_the_next_such_day(
    logged_in: Path, word: str, weekday: int
) -> None:
    """Asserted by the properties that identify the day uniquely rather than
    by recomputing the parser's own arithmetic: it falls on the named weekday,
    it is strictly in the future, and it is the *first* such day — so it lands
    within the coming week. Those three pin exactly one date. The lower bound
    is strict because a weekday that is today means next week's, and the
    casing varies because matching is case-folded.
    """
    transport, seen = add_transport()

    assert main(["add", "T", "--due", word], transport=transport) == 0

    landed = due_day(seen)
    assert landed.weekday() == weekday
    assert 1 <= (landed - london_today()).days <= 7


def test_add_bare_date_word_is_midnight_utc(logged_in: Path) -> None:
    """A bare word is date-only by the API's convention — midnight UTC, not
    midnight local, so a negative-offset zone cannot shift the stored day."""
    transport, seen = add_transport()
    tomorrow = (london_today() + timedelta(days=1)).isoformat()

    assert main(["add", "T", "--due", "tomorrow"], transport=transport) == 0

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["due_date"] == f"{tomorrow}T00:00:00+00:00"


def test_add_timed_date_word_carries_the_local_zone(logged_in: Path) -> None:
    """09:30 means 09:30 where the owner is, so the emitted offset has to be
    London's for the day in question — not UTC's. Asserting the offset is the
    whole point: a wall-clock match alone would still pass if the zone were
    dropped, and the instant would be wrong by an hour each summer."""
    transport, seen = add_transport()
    tomorrow = london_today() + timedelta(days=1)

    assert main(["add", "Call", "--due", "tomorrow 09:30"], transport=transport) == 0

    body = seen["body"]
    assert isinstance(body, dict)
    moment = datetime.fromisoformat(str(body["due_date"]))
    assert (moment.date(), moment.hour, moment.minute) == (tomorrow, 9, 30)
    assert moment.utcoffset() == datetime.combine(tomorrow, time(9, 30), ZONE).utcoffset()
    assert body["time_zone"] == "Europe/London"


def test_add_unknown_date_word_errors(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """The error enumerates the accepted forms, so the vocabulary is
    discoverable from its own miss message."""
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--due", "someday"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "someday" in err
    for form in ("today", "tomorrow", "yesterday", "weekday", "ISO"):
        assert form in err, form
    assert "body" not in seen


@pytest.mark.parametrize("word", ["tomorrow 99:99", "2026-13-40"], ids=["bad-time", "bad-iso"])
def test_add_malformed_date_errors_without_creating(
    logged_in: Path, capsys: pytest.CaptureFixture[str], word: str
) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--due", word], transport=transport) == 1

    assert word in capsys.readouterr().err
    assert "body" not in seen


def test_add_surfaces_api_validation_plainly(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    error = {"error": {"code": "invalid_schedule", "message": "A start date requires a due date"}}
    transport, _ = add_transport(created=error, create_status=422)

    assert main(["add", "Buy milk", "--start", "today"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "A start date requires a due date" in err
    assert "422" not in err


def test_add_expired_session_points_at_login(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    error = {"error": {"code": "unauthorized", "message": "A valid session is required"}}
    transport, _ = add_transport(created=error, create_status=401)

    assert main(["add", "Buy milk"], transport=transport) == 1

    assert "tuk login" in capsys.readouterr().err


def test_add_without_login_points_at_login(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path / "empty"))
    transport, _ = add_transport()

    assert main(["add", "Buy milk"], transport=transport) == 1

    assert "tuk login" in capsys.readouterr().err
