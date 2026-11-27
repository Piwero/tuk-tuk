"""Wall-clock "HH:MM" labels, the one way a band setting stores a time of
day: Active hours (issue #210), the planning window (#563) and Quiet hours
(#567). Each band then has its own rules for which labels it accepts.
"""

import re

HH_MM = re.compile(r"^\d{2}:\d{2}$")


def is_hh_mm(label: str) -> bool:
    """Whether `label` has the "HH:MM" shape (two digits each side)."""
    return HH_MM.match(label) is not None


def minutes_of(label: str) -> int:
    """Minutes since midnight of an "HH:MM" label; only for labels that
    `is_hh_mm` accepts. "24:00" reads as 1440, the end of the day."""
    hours, minutes = label.split(":")
    return int(hours) * 60 + int(minutes)
