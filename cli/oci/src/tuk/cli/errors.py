"""Shared error reporting for CLI commands."""

import sys

from tuk.client import ClientError

SETUP_MESSAGE = "No password set yet — finish first-run setup in the web app."

# "Setup has not been completed" reaches a client under two codes. Every gated
# route answers `setup_required` from the middleware; the login endpoint is a
# public path, so it never reaches that middleware and answers `not_found` for
# itself. Both mean the same thing to the owner — go and set a password in the
# web app, which is the one thing a client deliberately cannot do — so both are
# accepted here. Keyed off the envelope code, never the bare status: on the
# login path 404 and 401 both occur, and 401 is also a wrong password.
#
# Scoped to the login path deliberately. On a gated read `not_found` means
# "no such Task" and must keep saying so — see cmd_show.
LOGIN_SETUP_CODES = frozenset({"setup_required", "not_found"})


def report_client_error(exc: ClientError, action: str) -> None:
    """Any API failure in plain language — session, setup, validation alike.
    The message is always the API's own; never a raw HTTP dump."""
    if exc.code == "unauthorized":
        print("Session expired — run `tuk login` again.", file=sys.stderr)
    elif exc.code == "setup_required":
        print(SETUP_MESSAGE, file=sys.stderr)
    else:
        print(f"{action}: {exc.message}", file=sys.stderr)


def report_task_error(exc: ClientError, task_id: int, action: str) -> None:
    """A by-id failure. `not_found` names the id the owner typed — on a gated
    route it means "no such Task", never "finish setup" — and everything else
    falls through to the API's own message."""
    if exc.code == "not_found":
        print(f"Task {task_id} not found.", file=sys.stderr)
    else:
        report_client_error(exc, action)


def report_conflict(conflict: tuple[str, str] | None) -> bool:
    """Name a rejected flag pair, returning whether one was reported. A caller
    that typed two incompatible flags is told which two, locally — never
    handed a validation error from a round trip it did not need to make."""
    if conflict is None:
        return False
    first, second = conflict
    print(f"Cannot combine {first} with {second}.", file=sys.stderr)
    return True
