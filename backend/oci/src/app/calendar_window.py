"""Shared calendar day-window validation: `range_start`/`range_end` always
come together and never run backwards. Used by both the Task range query
(routers/v1/tasks.py) and the Events endpoint (routers/v1/events.py) — the
two callers of this same inclusive day-window contract.
"""

from datetime import date

from app.errors import APIError


def validate_range_pair(range_start: date | None, range_end: date | None) -> None:
    if (range_start is None) != (range_end is None):
        raise APIError(
            status_code=422,
            code="validation_error",
            message="range_start and range_end come together",
        )
    if range_start is not None and range_end is not None and range_start > range_end:
        raise APIError(
            status_code=422,
            code="validation_error",
            message="range_start must not be after range_end",
        )
