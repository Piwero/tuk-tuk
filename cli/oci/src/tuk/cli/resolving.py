"""Resolving List/Tag names and date words into the ids/fields the API wants."""

import argparse
import sys
from dataclasses import dataclass

from tuk.client import Client
from tuk.dates import BadDateError, parse_date
from tuk.names import Kind, UnknownNameError, resolve_name
from tuk.store import write_session_cookie

from .session import require_today


@dataclass(frozen=True)
class Resolved:
    """The ids a resolution found, and the session cookie to carry forward.

    The cookie travels with the ids because a collection read may have
    reissued it, and the caller's next request must present the current one.
    """

    ids: list[int]
    cookie: str

    @property
    def only(self) -> int:
        """The single id, for a flag that takes one name."""
        (found,) = self.ids
        return found


def resolve_named(client: Client, cookie: str, *names: str, kind: Kind) -> Resolved | None:
    """The ids of the named Lists or Tags, and the cookie to carry forward.

    None when a name missed — the error already names every candidate that
    does exist, and nothing has been created. One collection read serves every
    name of the one kind, so `--tag a --tag b` is still a single round trip.
    """
    items, refreshed = (client.read_lists if kind == "list" else client.read_tags)(cookie)
    current = cookie
    if refreshed:
        current = refreshed
        write_session_cookie(current)
    ids = []
    for name in names:
        try:
            ids.append(resolve_name(name, items, kind))
        except UnknownNameError as exc:
            print(str(exc), file=sys.stderr)
            return None
    return Resolved(ids, current)


def resolve_ids(
    client: Client, cookie: str, args: argparse.Namespace, body: dict[str, object]
) -> str | None:
    """Fill body with the resolved list_id / tag_ids. Returns the current
    cookie, or None when a name missed (already reported) — nothing created."""
    current = cookie
    if args.list_name is not None:
        found = resolve_named(client, current, args.list_name, kind="list")
        if found is None:
            return None
        body["list_id"] = found.only
        current = found.cookie
    if args.tags:
        found = resolve_named(client, current, *args.tags, kind="tag")
        if found is None:
            return None
        body["tag_ids"] = found.ids
        current = found.cookie
    return current


def apply_dates(args: argparse.Namespace, body: dict[str, object]) -> bool:
    """Fill body with the parsed `--due` / `--start`, returning whether it
    worked — False after reporting a bad zone or an unrecognised date word,
    whose message enumerates the forms that are accepted.

    Parsing a date word needs the caller's day and zone; the zone travels
    with the Task so the API judges the right local day. Shared by `add` and
    `edit`, which otherwise write the same parse twice and drift apart.
    """
    if args.due is None and args.start is None:
        return True
    resolved = require_today()
    if resolved is None:
        return False
    today, zone, zone_key = resolved
    try:
        if args.due is not None:
            body["due_date"] = parse_date(args.due, today, zone).isoformat()
        if args.start is not None:
            body["start_date"] = parse_date(args.start, today, zone).isoformat()
    except BadDateError as exc:
        print(str(exc), file=sys.stderr)
        return False
    body["time_zone"] = zone_key
    return True
