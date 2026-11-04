"""Name resolution: turn a List or Tag name a human typed into its id.

Matching is exact and case-insensitive, and a miss raises an error listing
the names that do exist. This deliberately does not reuse the backend's
phrase resolver: that resolver falls back to whole-word containment, which
is right for a language model guessing from prose and wrong for an argument
a human typed, where a loose match silently writes to the wrong List.

Nothing is ever created here — a typo cannot bring a List or Tag into being.
"""

from typing import Literal

Kind = Literal["list", "tag"]


class UnknownNameError(Exception):
    pass


def resolve_name(name: str, items: list[dict[str, object]], kind: Kind) -> int:
    """The id of the entry named `name`, matched exactly and case-insensitively.

    `kind` is "list" or "tag" and only feeds the miss message. Raises
    UnknownNameError naming every candidate when nothing matches.
    """
    want = name.casefold()
    for item in items:
        candidate = item.get("name")
        if isinstance(candidate, str) and candidate.casefold() == want:
            found = item.get("id")
            if isinstance(found, int):
                return found
    available = sorted(str(item.get("name")) for item in items if isinstance(item.get("name"), str))
    known = ", ".join(available) if available else "(none)"
    raise UnknownNameError(f"Unknown {kind} {name!r} — available {kind}s: {known}")
