"""The caller's IANA timezone, parsed once for every read that takes `tz`.

A `tz` query parameter is the User's zone, used to read UTC instants as
their local calendar day. Every bad value is the same 422, never a 500.
"""

from datetime import UTC, tzinfo
from zoneinfo import ZoneInfo

from app.errors import APIError


def caller_zone(tz: str) -> tzinfo:
    """Parses `tz` as an IANA zone, or raises a 422 `validation_error`.

    `ZoneInfo` raises `ZoneInfoNotFoundError` (a `KeyError`) for an unknown
    key and `ValueError` for a malformed one; some builds raise
    `IsADirectoryError` (an `OSError`) for a directory name such as
    `America`, so that is caught too.
    """
    try:
        return ZoneInfo(tz)
    except (KeyError, ValueError, OSError):
        raise APIError(
            status_code=422,
            code="validation_error",
            message=f"Unknown IANA timezone {tz!r}",
        ) from None


def caller_zone_or_utc(tz: str | None) -> tzinfo:
    """`caller_zone`, or UTC when the caller sent no `tz`."""
    return UTC if tz is None else caller_zone(tz)
