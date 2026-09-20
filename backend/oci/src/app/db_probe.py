"""PostgreSQL connection probing for the Settings > Database "test
connection" affordance (issue #256). Pure read-only diagnostics: never
touches the `settings` table, never switches the app's own engine, and
never echoes the candidate URL back anywhere (not in the result, not in a
log line) — a copy-pasted connection string is exactly the kind of thing
that must not end up in a response body or on disk.
"""

import re
from typing import Literal
from urllib.parse import urlsplit

import psycopg
from pydantic import BaseModel

# A table that only exists once tuk-tuk's own migrations have run — good
# enough to tell "empty/fresh Postgres" from "already holds tuk-tuk data"
# without needing every table name kept in sync here.
_MARKER_TABLE = "settings"

_SUPPORTED_SCHEMES = {"postgresql", "postgresql+psycopg"}


def is_valid_postgres_url(url: str) -> bool:
    """Schema/scheme check only — no network I/O. Called before any
    connection attempt so a malformed URL never reaches psycopg.
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme in _SUPPORTED_SCHEMES and bool(parts.hostname)


def _psycopg_url(url: str) -> str:
    # psycopg doesn't understand SQLAlchemy's "+psycopg" driver suffix.
    return re.sub(r"^postgresql\+psycopg://", "postgresql://", url)


ProbeReason = Literal["unreachable", "auth_rejected", "database_not_found", "unknown"]


class ProbeResult(BaseModel):
    """Discriminated on `ok`. Success carries `version`/`has_existing_data`;
    failure carries `reason`/`message`. Never carries the submitted URL.
    """

    ok: bool
    version: str | None = None
    has_existing_data: bool | None = None
    reason: ProbeReason | None = None
    message: str | None = None


def _classify_operational_error(error: psycopg.OperationalError) -> tuple[ProbeReason, str]:
    text = str(error).lower()
    if "password" in text or "authentication" in text:
        return "auth_rejected", "The server rejected the username or password."
    if "does not exist" in text and "database" in text:
        return "database_not_found", "That database does not exist on the server."
    if (
        "connection refused" in text
        or "timeout" in text
        or "timed out" in text
        or "could not translate host" in text
        or "could not connect" in text
        or "network is unreachable" in text
    ):
        return "unreachable", "The host did not respond within the timeout."
    return "unknown", str(error).strip() or "The connection attempt failed."


def probe_connection(url: str, *, connect_timeout: int = 5) -> ProbeResult:
    """Attempts a real connection with a short timeout. Read-only — issues
    only SELECTs, opens no transaction that writes, and always closes the
    connection itself.
    """
    try:
        with (
            psycopg.connect(_psycopg_url(url), connect_timeout=connect_timeout) as conn,
            conn.cursor() as cur,
        ):
            cur.execute("SELECT version()")
            row = cur.fetchone()
            version = str(row[0]) if row else ""

            cur.execute(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = %s)",
                (_MARKER_TABLE,),
            )
            marker_row = cur.fetchone()
            table_exists = bool(marker_row and marker_row[0])

            has_data = False
            if table_exists:
                cur.execute(f"SELECT EXISTS (SELECT 1 FROM {_MARKER_TABLE})")  # noqa: S608
                data_row = cur.fetchone()
                has_data = bool(data_row and data_row[0])

        return ProbeResult(ok=True, version=version, has_existing_data=has_data)
    except psycopg.OperationalError as error:
        reason, message = _classify_operational_error(error)
        return ProbeResult(ok=False, reason=reason, message=message)
    except Exception as error:  # noqa: BLE001 - catch-all per spec
        return ProbeResult(
            ok=False, reason="unknown", message=str(error).strip() or "Unknown error."
        )
