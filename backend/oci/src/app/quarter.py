"""The calendar quarter containing a given date — stdlib only.

A new Goal defaults to the current quarter's window (ADR 0012), so "grade
the quarter" is the path of least resistance without hard-coding it: the
dates are still per-Goal and arbitrary once created.
"""

from calendar import monthrange
from datetime import date


def current_quarter(today: date) -> tuple[date, date]:
    """Returns (start, end) of the calendar quarter containing `today`."""
    start_month = (today.month - 1) // 3 * 3 + 1
    end_month = start_month + 2
    start = date(today.year, start_month, 1)
    end = date(today.year, end_month, monthrange(today.year, end_month)[1])
    return start, end
