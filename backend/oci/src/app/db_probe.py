"""PostgreSQL connection probing for the Settings > Database "test
connection" affordance (issue #256). Pure read-only diagnostics: never
touches the `settings` table, never switches the app's own engine, and
never echoes the candidate URL back anywhere (not in the result, not in a
log line) — a copy-pasted connection string is exactly the kind of thing
that must not end up in a response body or on disk.
"""

import re
from typing import Literal

import psycopg
from pydantic import BaseModel

from app.db import Base, DatabaseUrl

# "already holds tuk-tuk data" means any of tuk-tuk's own tables carries a
# row — not just `settings`. A database with Lists and Tasks but no settings
# row is emphatically not ready to receive a copy, and the copy tool would
# refuse it, so the probe must not call it empty either.
_TUKTUK_TABLES: tuple[str, ...] = tuple(t.name for t in Base.metadata.sorted_tables)

# `SELECT version()` returns the full build banner ("PostgreSQL 16.4 on
# x86_64-pc-linux-gnu, compiled by gcc…"). The operator wants the server
# version, so keep the leading "PostgreSQL <version>" and drop the rest.
_VERSION_BANNER = re.compile(r"^(PostgreSQL\s+\S+)")


def is_valid_postgres_url(url: str) -> bool:
    """Schema/scheme check only — no network I/O. Called before any
    connection attempt so a malformed URL never reaches psycopg.
    """
    try:
        return DatabaseUrl(url).is_supported_postgres
    except ValueError:
        return False


def _short_version(banner: str) -> str:
    match = _VERSION_BANNER.match(banner.strip())
    return match.group(1) if match else banner.strip()


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


def _has_tuktuk_data(cur: psycopg.Cursor[tuple[object, ...]]) -> bool:
    cur.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = ANY(%s)",
        (list(_TUKTUK_TABLES),),
    )
    present = [str(row[0]) for row in cur.fetchall()]
    for table_name in present:
        # Identifiers come from Base.metadata, never from the request.
        cur.execute(f'SELECT EXISTS (SELECT 1 FROM "{table_name}")')  # noqa: S608
        row = cur.fetchone()
        if row and row[0]:
            return True
    return False


def probe_connection(url: str, *, connect_timeout: int = 5) -> ProbeResult:
    """Attempts a real connection with a short timeout. Read-only — issues
    only SELECTs, opens no transaction that writes, and always closes the
    connection itself. Blocking: callers on the event loop must hand this to
    a thread (see the settings router).
    """
    try:
        with (
            psycopg.connect(DatabaseUrl(url).psycopg_url, connect_timeout=connect_timeout) as conn,
            conn.cursor() as cur,
        ):
            cur.execute("SELECT version()")
            row = cur.fetchone()
            version = _short_version(str(row[0])) if row else ""
            has_data = _has_tuktuk_data(cur)

        return ProbeResult(ok=True, version=version, has_existing_data=has_data)
    except psycopg.OperationalError as error:
        reason, message = _classify_operational_error(error)
        return ProbeResult(ok=False, reason=reason, message=message)
    except Exception as error:  # noqa: BLE001 - catch-all per spec
        return ProbeResult(
            ok=False, reason="unknown", message=str(error).strip() or "Unknown error."
        )
