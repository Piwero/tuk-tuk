"""The session / local-day guards every authenticated command repeats."""

import sys
from datetime import date
from zoneinfo import ZoneInfo

from tuk.store import read_session_cookie
from tuk.tz import TzError, local_today


def require_session() -> str | None:
    """The cached session cookie, or None after reporting the login
    instruction — the one guard every authenticated command repeats."""
    cookie = read_session_cookie()
    if cookie is None:
        print("Not logged in — run `tuk login` first.", file=sys.stderr)
    return cookie


def require_today() -> tuple[date, ZoneInfo, str] | None:
    """The caller's local day and zone, or None after reporting a bad
    TUK_TIMEZONE — the one guard every day-aware command repeats."""
    try:
        return local_today()
    except TzError as exc:
        print(str(exc), file=sys.stderr)
        return None
