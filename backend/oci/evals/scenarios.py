"""The seeded weeks and what a competent planner does with them (#190).

Every scenario exists twice, in English and in Spanish (ADR 0005: both are
first-class). The Spanish pair is not a translation of the English prompt
with an English world behind it — the seeded tasks, Lists and Events are in
Spanish too, because a model that plans well over English task titles and
badly over Spanish ones is exactly the failed candidate this suite exists
to catch, and a half-translated fixture would hide it.

Assertions are behavioural: they read the structured Suggestions and ask
whether the *plan* is right, never whether a sentence was phrased a
particular way. Each returns a list of failure strings — empty means pass —
so a near-miss reports what was wrong rather than just going red.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from evals.checks import (
    conflicts_with_any,
    language_of,
    local_hour_spans,
    mentions,
    proposed_types,
    scheduled_local_dates,
    suggestion_interval,
)

# A fixed week, so two models are judged against the same world and a run
# in December means the same thing as a run in March. Monday.
MONDAY = date(2026, 3, 2)
TIME_ZONE = "Europe/Madrid"

# The seeded planning preference, as numbers the checks can read. Kept
# beside the prose it mirrors (`_PREFERENCES_EN`/`_ES` below) so the two
# cannot drift apart without it being obvious.
DAY_STARTS_AT = 9.0
DAY_ENDS_AT = 19.0
LUNCH_STARTS_AT = 13.5
LUNCH_ENDS_AT = 14.5

# Suggestion types that would mean the schema had drifted into letting the
# model destroy something (ADR 0009: there is no delete of any kind).
_FORBIDDEN_TYPES = frozenset({"delete_task", "delete_list", "delete_tag", "remove_task"})


def at(day_offset: int, hour: int, minute: int = 0) -> str:
    """The UTC instant of `hour:minute` **local time** on
    `MONDAY + day_offset`.

    Seeds say what they mean in the owner's own hours ("the meeting is at
    3pm") and this converts, rather than every seed carrying a hand-applied
    offset — which would also be silently wrong for a scenario landing on
    the other side of a DST change."""
    local_day = MONDAY + timedelta(days=day_offset)
    local = datetime(
        local_day.year, local_day.month, local_day.day, hour, minute, tzinfo=ZoneInfo(TIME_ZONE)
    )
    return local.astimezone(UTC).isoformat()


@dataclass
class SeedTask:
    title: str
    due_date: str | None = None
    start_date: str | None = None
    is_all_day: bool = False
    priority: str = "none"
    list_name: str | None = None
    tag_names: list[str] = field(default_factory=list)
    completed: bool = False


@dataclass
class SeedEvent:
    title: str
    start: str
    end: str
    is_all_day: bool = False


@dataclass
class World:
    """What the database holds before the turn."""

    lists: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    # Seeded but never asserted on: a real week has habits in it, and the
    # snapshot carries their names, so a scenario without one is a tidier
    # world than any owner actually has. What they buy is the chance to
    # catch a model that mistakes a habit for a task and proposes work on
    # it — which `only_targets_known_tasks` would then fail.
    habits: list[str] = field(default_factory=list)
    tasks: list[SeedTask] = field(default_factory=list)
    events: list[SeedEvent] = field(default_factory=list)


@dataclass
class Result:
    """One turn's outcome, as the assertions see it."""

    message: str
    suggestions: list[dict[str, object]]
    discarded_count: int
    world: World
    # The id the app assigned each seeded task, keyed by its title — so an
    # assertion can say "the dentist task", not "task 7".
    task_ids: dict[str, int]


Check = Callable[[Result], list[str]]


@dataclass
class Scenario:
    key: str
    language: str
    prompt: str
    world: World
    preferences: str
    checks: list[tuple[str, Check]]


# ---------------------------------------------------------------------------
# Checks shared by every scenario — the core guarantees of ADR 0009.
# ---------------------------------------------------------------------------


def no_event_collision(result: Result) -> list[str]:
    events = [
        {"start": event.start, "end": event.end, "is_all_day": event.is_all_day}
        for event in result.world.events
    ]
    failures = []
    for suggestion in result.suggestions:
        if conflicts_with_any(suggestion, events):
            claimed = suggestion_interval(suggestion)
            failures.append(
                f"{suggestion.get('type')} {suggestion.get('title') or suggestion.get('task_id')} "
                f"at {claimed[0].isoformat() if claimed else '?'} overlaps an Event"
            )
    return failures


def no_invented_names(result: Result) -> list[str]:
    """The app drops a Suggestion naming a List or Tag that doesn't exist,
    so a violation reaches us as a discard rather than as a bad Suggestion.
    Either way it is a planning failure worth reporting: the model tried."""
    known_lists = set(result.world.lists) | {"Inbox"}
    known_tags = set(result.world.tags)
    failures = []
    for suggestion in result.suggestions:
        list_name = suggestion.get("list_name")
        if list_name and list_name not in known_lists:
            failures.append(f"invented List {list_name!r}")
        tag_names = suggestion.get("tag_names")
        for tag in tag_names if isinstance(tag_names, list) else []:
            if tag not in known_tags:
                failures.append(f"invented Tag {tag!r}")
    return failures


def no_deletes(result: Result) -> list[str]:
    """A tripwire on the schema, not a test of the model.

    ADR 0009's "there is no delete of any kind" is already structural — the
    Suggestion union has no delete member, so a delete the model proposes
    is dropped as an unknown type long before it reaches here, and this
    can never fire against any model. It fires if someone ever adds a
    destructive Suggestion type, which is exactly when a suite nobody has
    read in six months ought to start failing."""
    return [
        f"proposed {kind}"
        for kind in proposed_types(result.suggestions)
        if kind in _FORBIDDEN_TYPES
    ]


def answered_in_kind(language: str) -> Check:
    def check(result: Result) -> list[str]:
        found = language_of(result.message)
        if found == "unknown":
            return [f"could not tell what language the reply was in: {result.message[:80]!r}"]
        return [] if found == language else [f"replied in {found}, was asked in {language}"]

    return check


def nothing_discarded(result: Result) -> list[str]:
    """A discard is the app rejecting the model, and this suite is judging
    the model — so unlike the UI (which only shows a count), a discard here
    is a failure with the reason waiting in the server log."""
    if result.discarded_count:
        return [f"{result.discarded_count} suggestion(s) discarded as invalid"]
    return []


def proposed_at_least(count: int) -> Check:
    def check(result: Result) -> list[str]:
        if len(result.suggestions) < count:
            return [f"proposed {len(result.suggestions)} suggestion(s), expected at least {count}"]
        return []

    return check


def honours_working_hours(result: Result) -> list[str]:
    """Every clause of the seeded planning preference, not just the first:
    nothing before 9, nothing after 19, and 13:30-14:30 kept free. A model
    that respects the opening hour and works through lunch has still
    ignored the preferences text, and a check that only read the earliest
    hour would call that a pass."""
    failures = []
    for start, end in local_hour_spans(result.suggestions, TIME_ZONE):
        if start < DAY_STARTS_AT:
            failures.append(f"scheduled {start:.2f}-{end:.2f} local, preference says not before 9")
        if end > DAY_ENDS_AT:
            failures.append(f"scheduled {start:.2f}-{end:.2f} local, preference says not after 19")
        if start < LUNCH_ENDS_AT and end > LUNCH_STARTS_AT:
            failures.append(f"scheduled {start:.2f}-{end:.2f} local, over the 13:30-14:30 lunch")
    return failures


def addresses(phrase: str) -> Check:
    """The model engaged with the thing the scenario put in front of it —
    either in prose or by proposing something about the matching task."""

    def check(result: Result) -> list[str]:
        if mentions(result.message, phrase):
            return []
        titles = {
            task_id: title for title, task_id in result.task_ids.items() if mentions(title, phrase)
        }
        for suggestion in result.suggestions:
            if suggestion.get("task_id") in titles:
                return []
            if mentions(str(suggestion.get("title") or ""), phrase):
                return []
        return [f"never addressed {phrase!r}"]

    return check


def claims_no_slot_today(result: Result) -> list[str]:
    """For the packed day: today has no gap at all, so any Suggestion that
    claims hours *today* is a slot the model invented.

    Necessary because the collision check alone cannot catch this — a
    model that dodges the walls by proposing an all-day or undated task
    claims no hours and so collides with nothing, and would score full
    marks on the one scenario seeded to catch exactly that evasion. The
    honest answers are "there is no room today, here is another day" or
    "no room, nothing proposed"; both pass."""
    failures = []
    for suggestion in result.suggestions:
        if MONDAY in scheduled_local_dates(suggestion, TIME_ZONE):
            label = suggestion.get("title") or suggestion.get("task_id")
            failures.append(f"{suggestion.get('type')} {label} claims time on a day with no gaps")
    return failures


def spreads_across_days(minimum: int) -> Check:
    def check(result: Result) -> list[str]:
        days: set[date] = set()
        for suggestion in result.suggestions:
            days |= scheduled_local_dates(suggestion, TIME_ZONE)
        if len(days) < minimum:
            return [f"put everything on {len(days)} day(s), expected at least {minimum}"]
        return []

    return check


def only_targets_known_tasks(result: Result) -> list[str]:
    known = set(result.task_ids.values())
    return [
        f"{suggestion.get('type')} targets unknown task id {suggestion.get('task_id')}"
        for suggestion in result.suggestions
        if suggestion.get("task_id") is not None and suggestion.get("task_id") not in known
    ]


# ---------------------------------------------------------------------------
# The scenarios: four planning situations, each in English and Spanish.
# ---------------------------------------------------------------------------

_PREFERENCES_EN = (
    "I don't work before 9am or after 7pm. I do focused work in the morning "
    "and admin in the afternoon. Leave 13:30-14:30 free for lunch."
)
_PREFERENCES_ES = (
    "No trabajo antes de las 9 de la mañana ni después de las 19h. Hago el "
    "trabajo de concentración por la mañana y la gestión por la tarde. Deja "
    "libre de 13:30 a 14:30 para comer."
)


def _meetings_world(language: str) -> World:
    if language == "en":
        return World(
            lists=["Work", "Personal"],
            tags=["deep-work", "errand"],
            habits=["Read 20 pages"],
            tasks=[
                SeedTask("Write the quarterly report", due_date=at(0, 18), list_name="Work"),
                SeedTask("Book the dentist", due_date=at(2, 18), list_name="Personal"),
            ],
            events=[
                SeedEvent("Standup", at(0, 9, 30), at(0, 10)),
                SeedEvent("Client review", at(0, 15), at(0, 16, 30)),
            ],
        )
    return World(
        lists=["Trabajo", "Personal"],
        tags=["concentración", "recado"],
        habits=["Leer 20 páginas"],
        tasks=[
            SeedTask("Escribir el informe trimestral", due_date=at(0, 18), list_name="Trabajo"),
            SeedTask("Pedir cita con el dentista", due_date=at(2, 18), list_name="Personal"),
        ],
        events=[
            SeedEvent("Reunión diaria", at(0, 9, 30), at(0, 10)),
            SeedEvent("Revisión con el cliente", at(0, 15), at(0, 16, 30)),
        ],
    )


def _overloaded_world(language: str) -> World:
    titles_en = [
        "Finish the migration plan",
        "Review Ana's pull request",
        "Draft the budget",
        "Answer the compliance questionnaire",
        "Prepare Thursday's demo",
        "Update the onboarding docs",
    ]
    titles_es = [
        "Terminar el plan de migración",
        "Revisar el pull request de Ana",
        "Redactar el presupuesto",
        "Responder el cuestionario de cumplimiento",
        "Preparar la demo del jueves",
        "Actualizar la documentación de bienvenida",
    ]
    titles = titles_en if language == "en" else titles_es
    list_name = "Work" if language == "en" else "Trabajo"
    return World(
        lists=[list_name],
        tags=["deep-work"] if language == "en" else ["concentración"],
        tasks=[
            SeedTask(title, due_date=at(0, 18), list_name=list_name, priority="high")
            for title in titles
        ],
        events=[
            SeedEvent("All-hands" if language == "en" else "Reunión general", at(0, 11), at(0, 12)),
        ],
    )


def _overdue_world(language: str) -> World:
    """The only scenario the snapshot alone cannot answer: `in_smart_view`
    excludes tasks whose window closed before today, so the two overdue
    tasks are *absent* from what the model is handed. Answering "what did I
    let slip?" therefore requires the `find_tasks` tool (issue #189), which
    makes this the one scenario that scores the read-tool loop rather than
    the snapshot — and the one that would notice if a cheap model never
    reaches for a tool at all."""
    if language == "en":
        return World(
            lists=["Work"],
            tags=["overdue"],
            tasks=[
                SeedTask("File the expenses", due_date=at(-4, 12), list_name="Work"),
                SeedTask("Send the invoice", due_date=at(-2, 12), list_name="Work"),
                SeedTask("Plan the offsite", due_date=at(3, 12), list_name="Work"),
            ],
        )
    return World(
        lists=["Trabajo"],
        tags=["atrasado"],
        tasks=[
            SeedTask("Presentar los gastos", due_date=at(-4, 12), list_name="Trabajo"),
            SeedTask("Enviar la factura", due_date=at(-2, 12), list_name="Trabajo"),
            SeedTask("Planificar la reunión anual", due_date=at(3, 12), list_name="Trabajo"),
        ],
    )


def _packed_world(language: str) -> World:
    """A day with genuinely no free time — the scenario a model fails by
    inventing a gap that isn't there rather than saying so."""
    if language == "en":
        return World(
            lists=["Work"],
            tags=["deep-work"],
            tasks=[SeedTask("Rewrite the launch post", due_date=at(0, 18), list_name="Work")],
            events=[
                SeedEvent("Interviews", at(0, 9), at(0, 13, 30)),
                SeedEvent("Lunch with the board", at(0, 13, 30), at(0, 14, 30)),
                SeedEvent("Planning workshop", at(0, 14, 30), at(0, 19)),
            ],
        )
    return World(
        lists=["Trabajo"],
        tags=["concentración"],
        tasks=[
            SeedTask(
                "Reescribir el anuncio del lanzamiento", due_date=at(0, 18), list_name="Trabajo"
            )
        ],
        events=[
            SeedEvent("Entrevistas", at(0, 9), at(0, 13, 30)),
            SeedEvent("Comida con el consejo", at(0, 13, 30), at(0, 14, 30)),
            SeedEvent("Taller de planificación", at(0, 14, 30), at(0, 19)),
        ],
    )


# One row per planning situation: the prompt in each language, the world
# builder, and what a competent plan looks like. Folded into a single table
# because three parallel dicts keyed the same way meant adding a scenario
# was three edits in three places, with nothing to catch a missed one.
@dataclass
class ScenarioSpec:
    key: str
    prompts: dict[str, str]
    world: Callable[[str], World]
    extra_checks: Callable[[str], list[tuple[str, Check]]]


def _meetings_checks(language: str) -> list[tuple[str, Check]]:
    return [
        ("proposed at least one change", proposed_at_least(1)),
        (
            "addressed the dentist appointment",
            addresses("dentist" if language == "en" else "dentista"),
        ),
    ]


def _overloaded_checks(language: str) -> list[tuple[str, Check]]:
    return [
        ("proposed at least three changes", proposed_at_least(3)),
        ("spread the work over at least two days", spreads_across_days(2)),
    ]


def _overdue_checks(language: str) -> list[tuple[str, Check]]:
    return [
        ("proposed at least one change", proposed_at_least(1)),
        (
            "addressed the overdue invoice",
            addresses("invoice" if language == "en" else "factura"),
        ),
    ]


def _packed_checks(language: str) -> list[tuple[str, Check]]:
    # The only honest plan may be no plan, so nothing is *required* — what
    # is forbidden is inventing a slot on a day that has none.
    return [("claimed no slot on the packed day", claims_no_slot_today)]


_SPECS = [
    ScenarioSpec(
        key="meetings",
        prompts={
            "en": "Plan my day. I've got two meetings today — fit my work around them.",
            "es": (
                "Organiza mi día. Hoy tengo dos reuniones; encaja mi trabajo alrededor de ellas."
            ),
        },
        world=_meetings_world,
        extra_checks=_meetings_checks,
    ),
    ScenarioSpec(
        key="overloaded",
        prompts={
            "en": (
                "Everything is due today and there's no way I finish it all. "
                "Spread it across the week for me."
            ),
            "es": (
                "Todo vence hoy y no hay manera de que lo termine. Repártelo a "
                "lo largo de la semana."
            ),
        },
        world=_overloaded_world,
        extra_checks=_overloaded_checks,
    ),
    ScenarioSpec(
        key="overdue",
        prompts={
            "en": "What did I let slip? Get the overdue things back on the calendar.",
            "es": ("¿Qué se me ha pasado? Vuelve a poner en el calendario lo que está atrasado."),
        },
        world=_overdue_world,
        extra_checks=_overdue_checks,
    ),
    ScenarioSpec(
        key="packed",
        prompts={
            "en": "Can I get the launch post written today?",
            "es": "¿Puedo escribir hoy el anuncio del lanzamiento?",
        },
        world=_packed_world,
        extra_checks=_packed_checks,
    ),
]


def _shared_checks(language: str) -> list[tuple[str, Check]]:
    """The guarantees of ADR 0009, asserted on every scenario in both
    languages — a model that plans beautifully but invents a Tag, or
    answers Spanish in English, has failed regardless of the plan."""
    return [
        ("no suggestion overlaps an Event", no_event_collision),
        ("no invented List or Tag", no_invented_names),
        ("no delete proposed", no_deletes),
        ("targets only known task ids", only_targets_known_tasks),
        ("nothing discarded as invalid", nothing_discarded),
        ("honours the stated working hours", honours_working_hours),
        (f"answered in {language}", answered_in_kind(language)),
    ]


def all_scenarios() -> list[Scenario]:
    return [
        Scenario(
            key=spec.key,
            language=language,
            prompt=spec.prompts[language],
            world=spec.world(language),
            preferences=_PREFERENCES_EN if language == "en" else _PREFERENCES_ES,
            checks=[*_shared_checks(language), *spec.extra_checks(language)],
        )
        for spec in _SPECS
        for language in ("en", "es")
    ]
