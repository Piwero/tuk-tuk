"""Daypart phrases for `resolve_date_phrase` (ADR 0005; issue #173).

A phrase that pairs a recognized date word with a daypart qualifier
("tomorrow afternoon", "mañana por la tarde", "tonight") must still resolve
to a concrete instant, at a reasonable default clock time for that daypart —
not silently degrade to "no date", which is what happened before this file
existed: PRD #41's own worked example ("mañana por la tarde") failed
end-to-end.
"""

import datetime as dt

from app.date_phrase import resolve_date_phrase

_LOCAL_DATE = dt.date(2026, 8, 20)  # a Thursday
_ZONE = "Europe/London"


class TestDaypartPhrases:
    def test_tomorrow_afternoon_resolves_to_a_default_afternoon_time(self) -> None:
        resolved = resolve_date_phrase("tomorrow afternoon", _LOCAL_DATE, _ZONE)
        assert resolved is not None
        due_date, is_all_day = resolved
        assert is_all_day is False
        assert due_date.astimezone(dt.UTC).date() == dt.date(2026, 8, 21)
        assert due_date.hour == 15

    def test_manana_por_la_tarde_resolves_the_same_as_its_english_equivalent(self) -> None:
        english = resolve_date_phrase("tomorrow afternoon", _LOCAL_DATE, _ZONE)
        spanish = resolve_date_phrase("mañana por la tarde", _LOCAL_DATE, _ZONE)
        assert spanish is not None
        assert spanish == english

    def test_next_friday_afternoon_combines_the_weekday_and_the_daypart(self) -> None:
        resolved = resolve_date_phrase("next friday afternoon", _LOCAL_DATE, _ZONE)
        assert resolved is not None
        due_date, is_all_day = resolved
        assert is_all_day is False
        assert due_date.astimezone(dt.UTC).date() == dt.date(2026, 8, 21)
        assert due_date.hour == 15

    def test_tonight_resolves_to_todays_date_at_a_default_evening_time(self) -> None:
        resolved = resolve_date_phrase("tonight", _LOCAL_DATE, _ZONE)
        assert resolved is not None
        due_date, is_all_day = resolved
        assert is_all_day is False
        assert due_date.astimezone(dt.UTC).date() == _LOCAL_DATE
        assert due_date.hour == 20

    def test_esta_noche_resolves_the_same_as_tonight(self) -> None:
        assert resolve_date_phrase("esta noche", _LOCAL_DATE, _ZONE) == resolve_date_phrase(
            "tonight", _LOCAL_DATE, _ZONE
        )

    def test_mananas_leading_meaning_of_tomorrow_is_unaffected(self) -> None:
        # "mañana" alone still means "tomorrow" (all-day) — the trailing
        # daypart sense ("por la mañana") must not shadow this.
        resolved = resolve_date_phrase("mañana", _LOCAL_DATE, _ZONE)
        assert resolved is not None
        due_date, is_all_day = resolved
        assert is_all_day is True
        assert due_date.date() == dt.date(2026, 8, 21)

    def test_por_la_manana_resolves_to_a_default_morning_time(self) -> None:
        resolved = resolve_date_phrase("mañana por la mañana", _LOCAL_DATE, _ZONE)
        assert resolved is not None
        due_date, is_all_day = resolved
        assert is_all_day is False
        assert due_date.astimezone(dt.UTC).date() == dt.date(2026, 8, 21)
        assert due_date.hour == 9

    def test_an_explicit_time_still_takes_precedence_over_no_daypart_word(self) -> None:
        # Regression guard: adding daypart support must not break the
        # existing explicit-time path.
        resolved = resolve_date_phrase("tuesday 3pm", _LOCAL_DATE, _ZONE)
        assert resolved is not None
        _, is_all_day = resolved
        assert is_all_day is False

    def test_an_unrecognized_trailing_word_still_fails_to_resolve(self) -> None:
        assert resolve_date_phrase("tomorrow whenever", _LOCAL_DATE, _ZONE) is None

    def test_a_dot_separated_clock_time_resolves(self) -> None:
        # "18.00" is the everyday written form in Spanish and much of
        # Europe — it must resolve exactly like "18:00", not degrade to
        # "no date".
        resolved = resolve_date_phrase("today at 18.00", _LOCAL_DATE, _ZONE)
        assert resolved is not None
        due_date, is_all_day = resolved
        assert is_all_day is False
        assert (due_date.hour, due_date.minute) == (18, 0)
        assert due_date.date() == _LOCAL_DATE
