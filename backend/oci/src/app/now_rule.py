"""Whether a saved Now pick still names the same unfinished occurrence
(issue #549). Shared by the Now selection and the shortlist (#551).

A pick is current only when its Task still exists for the acting User
(callers load it through the owner-scoped session, so another User's Task
reads as missing), is not completed, and still has the schedule saved with
the pick. Completing a recurring Task advances the same row in place
(ADR 0003), so the schedule comparison is what tells today's occurrence
from tomorrow's, whichever client completed it.
"""

from datetime import datetime

from app.models import Task


def occurrence_of(task: Task) -> tuple[datetime | None, datetime | None]:
    """The schedule to save alongside a pick of `task`."""
    return task.start_date, task.due_date


def is_current(task: Task | None, saved: tuple[datetime | None, datetime | None]) -> bool:
    return task is not None and not task.completed and occurrence_of(task) == saved
