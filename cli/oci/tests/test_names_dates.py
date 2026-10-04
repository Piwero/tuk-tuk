"""Unit tests for the name resolver and the date vocabulary.

Pure modules — no transport, no I/O. The entrypoint tests that drive these
through the mock transport seam live in test_add.py.
"""

from datetime import date
from zoneinfo import ZoneInfo

import pytest

from tuk.dates import BadDateError, parse_date
from tuk.names import UnknownNameError, resolve_name

LISTS = [
    {"id": 1, "name": "Inbox"},
    {"id": 2, "name": "Groceries"},
    {"id": 3, "name": "Work Projects"},
]

ZONE = ZoneInfo("Europe/London")
TODAY = date(2026, 10, 4)  # a Sunday


def test_resolve_name_hits_exact() -> None:
    assert resolve_name("Groceries", LISTS, "list") == 2


def test_resolve_name_ignores_case() -> None:
    assert resolve_name("groceries", LISTS, "list") == 2
    assert resolve_name("GROCERIES", LISTS, "list") == 2
    assert resolve_name("work projects", LISTS, "list") == 3


def test_resolve_name_rejects_partial_match() -> None:
    with pytest.raises(UnknownNameError) as caught:
        resolve_name("Grocer", LISTS, "list")
    assert "Groceries" in str(caught.value)


def test_resolve_name_miss_lists_candidates() -> None:
    with pytest.raises(UnknownNameError) as caught:
        resolve_name("Nope", LISTS, "list")
    message = str(caught.value)
    assert "Nope" in message
    assert "Groceries" in message
    assert "Inbox" in message


def test_resolve_name_empty_collection_says_none() -> None:
    with pytest.raises(UnknownNameError) as caught:
        resolve_name("x", [], "tag")
    assert "(none)" in str(caught.value)


def test_parse_relative_words() -> None:
    assert parse_date("today", TODAY, ZONE).date().isoformat() == "2026-10-04"
    assert parse_date("tomorrow", TODAY, ZONE).date().isoformat() == "2026-10-05"
    assert parse_date("yesterday", TODAY, ZONE).date().isoformat() == "2026-10-03"


def test_parse_weekday_names_go_forward() -> None:
    assert parse_date("monday", TODAY, ZONE).date().isoformat() == "2026-10-05"
    assert parse_date("Sunday", TODAY, ZONE).date().isoformat() == "2026-10-11"


def test_parse_iso_date() -> None:
    assert parse_date("2026-12-25", TODAY, ZONE).date().isoformat() == "2026-12-25"


def test_parse_timed_word_carries_zone() -> None:
    moment = parse_date("tomorrow 09:30", TODAY, ZONE)
    assert (moment.date().isoformat(), moment.hour, moment.minute) == ("2026-10-05", 9, 30)
    assert str(moment.tzinfo) == "Europe/London"


def test_parse_bare_word_is_midnight_utc() -> None:
    moment = parse_date("tomorrow", TODAY, ZONE)
    assert moment.isoformat() == "2026-10-05T00:00:00+00:00"


def test_parse_unknown_word_enumerates_forms() -> None:
    with pytest.raises(BadDateError) as caught:
        parse_date("someday", TODAY, ZONE)
    message = str(caught.value)
    assert "someday" in message
    assert "today" in message
    assert "tomorrow" in message
    assert "weekday" in message
    assert "ISO" in message


def test_parse_bad_time_errors() -> None:
    with pytest.raises(BadDateError):
        parse_date("tomorrow 99:99", TODAY, ZONE)


def test_parse_bad_iso_errors() -> None:
    with pytest.raises(BadDateError):
        parse_date("2026-13-40", TODAY, ZONE)
