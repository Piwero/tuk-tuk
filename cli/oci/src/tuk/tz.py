"""Local timezone resolution: the operating system's IANA zone,
overridable by TUK_TIMEZONE. The Smart List views are judged against the
caller's local day, so the client supplies it — the server never guesses.
"""

import os
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class TzError(Exception):
    pass


def _zone(key: str, source: str) -> tuple[ZoneInfo, str]:
    try:
        return ZoneInfo(key), key
    except ZoneInfoNotFoundError:
        raise TzError(
            f"Unknown timezone {key!r} from {source} — use an IANA key like 'Europe/London'"
        ) from None


def _system_zone_key() -> str:
    link = Path("/etc/localtime")
    if link.is_symlink() and "zoneinfo/" in os.readlink(link):
        return os.readlink(link).split("zoneinfo/", 1)[1]
    tz_file = Path("/etc/timezone")
    if tz_file.exists():
        key = tz_file.read_text().strip()
        if key:
            return key
    raise TzError("Could not determine the system timezone — set TUK_TIMEZONE explicitly")


def resolve_zone() -> tuple[ZoneInfo, str]:
    """The caller's zone and its IANA key. An invalid TUK_TIMEZONE fails
    loudly rather than falling back — a silent fallback would shift day
    boundaries without anyone noticing."""
    override = os.environ.get("TUK_TIMEZONE")
    if override:
        return _zone(override, "TUK_TIMEZONE")
    return _zone(_system_zone_key(), "the operating system")


def local_today() -> tuple[date, ZoneInfo, str]:
    """The caller's local day plus the zone it was judged in."""
    zone, key = resolve_zone()
    return datetime.now(zone).date(), zone, key
