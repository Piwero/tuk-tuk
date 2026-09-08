"""The eval suite's pure predicates (issue #190).

The suite itself never runs in CI — it costs money and needs a real
provider (`backend/oci/evals`, which pytest's `testpaths` deliberately
excludes). Its *judgement* is a different thing: whether a proposed 15:00
task collides with a 15:00 meeting, or whether a reply came back in the
language it was asked in, is ordinary offline logic, and a suite whose
verdicts are wrong is worse than no suite. So the predicates live apart
from the harness and are tested here, at no cost, on every push.
"""

from datetime import UTC, date, datetime

from evals.checks import (
    conflicts_with_any,
    earliest_local_hour,
    language_of,
    local_hour_spans,
    mentions,
    parse_instant,
    parse_model_arg,
    proposed_types,
    scheduled_local_dates,
    suggestion_interval,
)


def _at(hour: int, minute: int = 0) -> str:
    return datetime(2026, 3, 2, hour, minute, tzinfo=UTC).isoformat()


class TestParseModelArg:
    def test_a_bare_name_falls_back_to_the_shared_prices(self) -> None:
        assert parse_model_arg("gpt-4o-mini", 0.15, 0.60) == ("gpt-4o-mini", 0.15, 0.60)

    def test_a_model_can_carry_its_own_prices(self) -> None:
        # The whole point of the suite is comparing two models, and two
        # models rarely cost the same — one shared price would make the
        # cost column wrong in exactly the case it exists for.
        assert parse_model_arg("gpt-5-nano:0.05:0.40", 0.15, 0.60) == ("gpt-5-nano", 0.05, 0.40)

    def test_a_free_local_model_prices_at_zero(self) -> None:
        assert parse_model_arg("qwen2.5:14b:0:0", 0.15, 0.60) == ("qwen2.5:14b", 0.0, 0.0)

    def test_an_ollama_style_tag_is_not_mistaken_for_a_price(self) -> None:
        # "qwen2.5:14b" is a model name with a colon in it, not a name and
        # a price — only a trailing pair of numbers is a price.
        assert parse_model_arg("qwen2.5:14b", 0.15, 0.60) == ("qwen2.5:14b", 0.15, 0.60)


class TestParseInstant:
    def test_reads_an_offset_datetime(self) -> None:
        assert parse_instant("2026-03-02T09:00:00+01:00") == datetime(2026, 3, 2, 8, 0, tzinfo=UTC)

    def test_reads_a_z_suffixed_datetime(self) -> None:
        assert parse_instant("2026-03-02T09:00:00Z") == datetime(2026, 3, 2, 9, 0, tzinfo=UTC)

    def test_a_date_only_value_is_midnight_utc(self) -> None:
        assert parse_instant("2026-03-02") == datetime(2026, 3, 2, 0, 0, tzinfo=UTC)

    def test_none_and_nonsense_are_none(self) -> None:
        assert parse_instant(None) is None
        assert parse_instant("next tuesday") is None


class TestSuggestionInterval:
    def test_a_point_in_time_suggestion_occupies_the_hour_after_it(self) -> None:
        # Otherwise "schedule it at 15:00" would pass a zero-width overlap
        # test against a 15:00-16:00 meeting, which is exactly the failure
        # this suite exists to catch.
        interval = suggestion_interval({"due_date": _at(15), "is_all_day": False})
        assert interval == (
            datetime(2026, 3, 2, 15, 0, tzinfo=UTC),
            datetime(2026, 3, 2, 16, 0, tzinfo=UTC),
        )

    def test_a_range_suggestion_uses_its_own_span(self) -> None:
        interval = suggestion_interval(
            {"start_date": _at(9), "due_date": _at(11), "is_all_day": False}
        )
        assert interval == (
            datetime(2026, 3, 2, 9, 0, tzinfo=UTC),
            datetime(2026, 3, 2, 11, 0, tzinfo=UTC),
        )

    def test_an_all_day_suggestion_claims_no_hours(self) -> None:
        # An all-day task is not a claim on a slot, so it cannot collide
        # with a meeting.
        assert suggestion_interval({"due_date": _at(15), "is_all_day": True}) is None

    def test_an_undated_suggestion_claims_no_hours(self) -> None:
        assert suggestion_interval({"title": "Buy milk"}) is None


class TestConflictsWithAny:
    def _event(self, start_hour: int, end_hour: int) -> dict:
        return {"start": _at(start_hour), "end": _at(end_hour), "is_all_day": False}

    def test_a_task_inside_a_meeting_conflicts(self) -> None:
        suggestion = {"due_date": _at(15, 30), "is_all_day": False}
        assert conflicts_with_any(suggestion, [self._event(15, 16)])

    def test_a_task_in_the_gap_between_meetings_does_not(self) -> None:
        suggestion = {"start_date": _at(11), "due_date": _at(12), "is_all_day": False}
        assert not conflicts_with_any(suggestion, [self._event(9, 10), self._event(15, 16)])

    def test_touching_edges_do_not_conflict(self) -> None:
        suggestion = {"start_date": _at(16), "due_date": _at(17), "is_all_day": False}
        assert not conflicts_with_any(suggestion, [self._event(15, 16)])

    def test_an_all_day_event_is_not_a_wall(self) -> None:
        # An all-day event ("Marta's birthday") blocks no hours; treating it
        # as one would fail every scenario that has one.
        event = {"start": "2026-03-02", "end": "2026-03-03", "is_all_day": True}
        assert not conflicts_with_any({"due_date": _at(15), "is_all_day": False}, [event])


class TestEarliestLocalHour:
    def test_reports_the_earliest_proposed_start_in_local_time(self) -> None:
        suggestions = [
            {"due_date": "2026-03-02T14:00:00Z", "is_all_day": False},
            {"due_date": "2026-03-02T07:30:00Z", "is_all_day": False},
        ]
        # 07:30Z is 08:30 in Madrid on 2026-03-02 (CET, +01:00).
        assert earliest_local_hour(suggestions, "Europe/Madrid") == 8.5

    def test_all_day_and_undated_suggestions_are_ignored(self) -> None:
        suggestions = [{"due_date": "2026-03-02T07:30:00Z", "is_all_day": True}, {"title": "x"}]
        assert earliest_local_hour(suggestions, "Europe/Madrid") is None

    def test_no_suggestions_is_none_rather_than_a_failure(self) -> None:
        assert earliest_local_hour([], "Europe/Madrid") is None


class TestScheduledLocalDates:
    def test_a_single_day_suggestion_touches_one_local_day(self) -> None:
        suggestion = {"due_date": "2026-03-02T10:00:00Z", "is_all_day": False}
        assert scheduled_local_dates(suggestion, "Europe/Madrid") == {date(2026, 3, 2)}

    def test_the_owners_timezone_decides_the_day_not_utc(self) -> None:
        # 23:30Z on the 2nd is already the 3rd in Madrid — an overloaded-day
        # check that judged in UTC would credit the model with spreading
        # work it actually piled on one local day, or vice versa.
        suggestion = {"due_date": "2026-03-02T23:30:00Z", "is_all_day": False}
        assert scheduled_local_dates(suggestion, "Europe/Madrid") == {date(2026, 3, 3)}

    def test_a_span_touches_every_day_it_covers(self) -> None:
        suggestion = {
            "start_date": "2026-03-02T09:00:00Z",
            "due_date": "2026-03-04T09:00:00Z",
            "is_all_day": True,
        }
        assert scheduled_local_dates(suggestion, "UTC") == {
            date(2026, 3, 2),
            date(2026, 3, 3),
            date(2026, 3, 4),
        }

    def test_an_undated_suggestion_touches_no_day(self) -> None:
        assert scheduled_local_dates({"title": "Someday"}, "UTC") == set()


class TestProposedTypes:
    def test_counts_each_suggestion_type(self) -> None:
        suggestions = [
            {"type": "create_task"},
            {"type": "create_task"},
            {"type": "reschedule_task"},
        ]
        assert proposed_types(suggestions) == {"create_task": 2, "reschedule_task": 1}


class TestMentions:
    def test_matches_regardless_of_case_and_accents(self) -> None:
        # The model echoes a task's title back in its own prose; the suite
        # must not care whether it wrote "Dentista" or "dentista", nor fail
        # a Spanish reply over an accent the title carried.
        assert mentions("Te he puesto la cita del Dentista el martes", "dentista")
        assert mentions("Reunión con el cliente", "reunion")

    def test_reports_an_absent_phrase(self) -> None:
        assert not mentions("Here is your plan for the day", "dentist")


class TestLocalHourSpans:
    def test_reports_each_suggestion_as_a_local_start_and_end_hour(self) -> None:
        # 07:30Z is 08:30 in Madrid on 2026-03-02 (CET, +01:00).
        spans = local_hour_spans(
            [{"due_date": "2026-03-02T07:30:00Z", "is_all_day": False}], "Europe/Madrid"
        )
        assert spans == [(8.5, 9.5)]

    def test_untimed_suggestions_claim_no_span(self) -> None:
        assert local_hour_spans([{"title": "Someday"}], "Europe/Madrid") == []

    def test_a_span_running_past_the_end_of_the_day_is_clamped(self) -> None:
        # 23:00 local + the assumed hour would read as 24.0, which would
        # then compare as "after 19h" correctly but as a nonsense hour.
        spans = local_hour_spans(
            [{"due_date": "2026-03-02T22:30:00Z", "is_all_day": False}], "Europe/Madrid"
        )
        assert spans == [(23.5, 24.0)]


class TestLanguageOf:
    def test_recognises_an_english_plan(self) -> None:
        message = (
            "Here is the plan for your day: I have put the report in the "
            "morning gap and left the afternoon for the client meeting."
        )
        assert language_of(message) == "en"

    def test_recognises_a_spanish_plan(self) -> None:
        message = (
            "Este es el plan para tu día: he puesto el informe por la mañana "
            "y he dejado la tarde libre para la reunión con el cliente."
        )
        assert language_of(message) == "es"

    def test_an_empty_or_markerless_message_is_unknown(self) -> None:
        assert language_of("") == "unknown"
        assert language_of("OK 👍") == "unknown"
