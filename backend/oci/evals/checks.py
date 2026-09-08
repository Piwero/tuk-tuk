"""Behavioural predicates the eval suite asserts with (issue #190).

Deliberately phrasing-tolerant. A plan is prose, and prose written by a
model changes wording between runs and between models — which is the whole
point of the suite, since it is the *judgement* being shopped for, not the
sentences. So nothing here matches a string the model authored. Every
predicate reads the structured Suggestions, or asks a coarse question of
the prose ("which language is this in?") that survives rewording.

Pure functions with no provider, no database, and no network — so they are
tested for free in `tests/test_eval_checks.py` on every push, even though
the suite they serve never runs in CI.
"""

import unicodedata
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

# A point-in-time Suggestion ("the report, tomorrow at 3pm") names no end, so
# an overlap test has nothing to overlap with. Treating it as one hour of
# work is what makes "don't schedule on top of my 3pm" checkable at all —
# and one hour is the smallest span that catches the failure honestly
# without inventing a long block the model never proposed.
_ASSUMED_TASK_HOURS = 1

# Function words, not vocabulary: they appear in any sentence of the
# language regardless of what it is about, so a rewritten plan still
# classifies. Scoring by count (rather than any single hit) keeps a loan
# word or a task title in the other language from flipping the verdict.
_ENGLISH_MARKERS = frozenset(
    {
        "the",
        "your",
        "you",
        "and",
        "for",
        "with",
        "have",
        "here",
        "this",
        "that",
        "morning",
        "afternoon",
        "day",
        "task",
        "put",
        "left",
        "plan",
        "before",
        "after",
        "at",
        "is",
        "to",
        "of",
        "in",
        "on",
        "i",
    }
)
_SPANISH_MARKERS = frozenset(
    {
        "el",
        "la",
        "los",
        "las",
        "tu",
        "tus",
        "para",
        "con",
        "he",
        "este",
        "esta",
        "mañana",
        "tarde",
        "día",
        "tarea",
        "puesto",
        "dejado",
        "plan",
        "antes",
        "después",
        "es",
        "de",
        "en",
        "y",
        "por",
        "un",
        "una",
        "que",
    }
)


def parse_instant(value: object) -> datetime | None:
    """A wire date value as an aware UTC instant, or None when it is absent
    or unparseable. Mirrors `app.assistant_chat._coerce_datetime` rather
    than importing it: an eval suite that shares the code under test would
    agree with it about a bug."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def suggestion_interval(suggestion: dict[str, object]) -> tuple[datetime, datetime] | None:
    """The span of wall-clock time a Suggestion claims, or None when it
    claims none — undated, or all-day (an all-day task is a claim on a day,
    not on a slot, so it cannot collide with a meeting)."""
    if suggestion.get("is_all_day"):
        return None
    due = parse_instant(suggestion.get("due_date"))
    if due is None:
        return None
    start = parse_instant(suggestion.get("start_date"))
    if start is None or start >= due:
        return due, due + timedelta(hours=_ASSUMED_TASK_HOURS)
    return start, due


def event_interval(event: dict[str, object]) -> tuple[datetime, datetime] | None:
    """The span an Event occupies. All-day Events are not walls: they block
    no hours, and treating them as ones would fail every scenario that
    happens to contain a birthday."""
    if event.get("is_all_day"):
        return None
    start = parse_instant(event.get("start"))
    end = parse_instant(event.get("end"))
    if start is None or end is None or end <= start:
        return None
    return start, end


def conflicts_with_any(suggestion: dict[str, object], events: list[dict[str, object]]) -> bool:
    """Whether a Suggestion's slot overlaps a timed Event's. Touching edges
    (a task at 16:00 after a meeting ending at 16:00) do not overlap — that
    is the model planning *into the gap*, which is the behaviour wanted."""
    claimed = suggestion_interval(suggestion)
    if claimed is None:
        return False
    claim_start, claim_end = claimed
    for event in events:
        span = event_interval(event)
        if span is None:
            continue
        event_start, event_end = span
        if claim_start < event_end and event_start < claim_end:
            return True
    return False


def local_hour_spans(
    suggestions: list[dict[str, object]], time_zone: str
) -> list[tuple[float, float]]:
    """Each Suggestion's claimed slot as (start hour, end hour) in the
    owner's own timezone — the numbers every working-hours preference is
    judged against ("not before 9", "not after 19", "keep 13:30-14:30
    free"). Untimed Suggestions claim nothing and are absent."""
    zone = ZoneInfo(time_zone)
    spans = []
    for suggestion in suggestions:
        claimed = suggestion_interval(suggestion)
        if claimed is None:
            continue
        start = claimed[0].astimezone(zone)
        end = claimed[1].astimezone(zone)
        start_hour = start.hour + start.minute / 60
        end_hour = end.hour + end.minute / 60
        # A slot running past midnight reads as an hour smaller than its
        # own start; clamped to the end of the day so a comparison against
        # "not after 19h" stays true instead of wrapping to 0.
        if end_hour <= start_hour:
            end_hour = 24.0
        spans.append((start_hour, end_hour))
    return spans


def earliest_local_hour(suggestions: list[dict[str, object]], time_zone: str) -> float | None:
    """The earliest hour-of-day any Suggestion proposes starting work, in
    the owner's own timezone — the number a "nothing before 9am" planning
    preference is judged against. None when nothing timed was proposed."""
    spans = local_hour_spans(suggestions, time_zone)
    return min(start for start, _ in spans) if spans else None


def scheduled_local_dates(suggestion: dict[str, object], time_zone: str) -> set[date]:
    """Every local calendar day a Suggestion touches — for asserting that
    an overloaded day's work was spread across the week rather than piled
    onto one date."""
    due = parse_instant(suggestion.get("due_date"))
    if due is None:
        return set()
    zone = ZoneInfo(time_zone)
    start = parse_instant(suggestion.get("start_date")) or due
    first = min(start, due).astimezone(zone).date()
    last = max(start, due).astimezone(zone).date()
    days = set()
    cursor = first
    while cursor <= last:
        days.add(cursor)
        cursor += timedelta(days=1)
    return days


def parse_model_arg(value: str, default_in: float, default_out: float) -> tuple[str, float, float]:
    """A `--model` argument as (name, price-in, price-out).

    Two models are rarely the same price, and pricing both at one rate
    would make the cost column wrong in exactly the two-model comparison
    the suite exists for — so a model may carry its own, as
    `name:price_in:price_out`. Only a *trailing pair of numbers* counts,
    because Ollama model names contain colons of their own ("qwen2.5:14b")
    and eating one as a price would silently rename the model.
    """
    parts = value.rsplit(":", 2)
    if len(parts) == 3:
        try:
            return parts[0], float(parts[1]), float(parts[2])
        except ValueError:
            pass
    return value, default_in, default_out


def proposed_types(suggestions: list[dict[str, object]]) -> dict[str, int]:
    """How many Suggestions of each type came back — the shape of an
    assertion like "it proposed at least one new task" or, crucially,
    "it proposed nothing that deletes" (there is no delete type in the
    schema at all, so a delete here would mean the schema had drifted)."""
    counts: dict[str, int] = {}
    for suggestion in suggestions:
        kind = suggestion.get("type")
        if isinstance(kind, str):
            counts[kind] = counts.get(kind, 0) + 1
    return counts


def mentions(message: str, phrase: str) -> bool:
    """Whether the prose refers to something, ignoring case and accents.

    The most tolerant check in the file, and deliberately so: it is only
    ever used to confirm the model *addressed* a thing the scenario put in
    front of it. Anything stricter would fail on synonyms the model is
    entitled to choose, which is the phrasing-brittleness this suite is
    written to avoid."""
    return _fold(phrase) in _fold(message)


def _fold(text: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFD", text.casefold())
        if unicodedata.category(char) != "Mn"
    )


def language_of(message: str) -> str:
    """A coarse "en" / "es" / "unknown" verdict on the assistant's prose.

    Deliberately crude: the assertion this serves is only ever "it answered
    in the language it was asked in" (ADR 0005 — both are first-class), and
    a model that replies to Spanish in English fails that by a mile, not by
    a margin. Anything finer would be a language-detection dependency
    bought to make a binary check marginally prettier.
    """
    words = [word.strip(".,;:!¡?¿()\"'").lower() for word in message.split()]
    english = sum(1 for word in words if word in _ENGLISH_MARKERS)
    spanish = sum(1 for word in words if word in _SPANISH_MARKERS)
    if english == spanish:
        return "unknown"
    return "en" if english > spanish else "es"
