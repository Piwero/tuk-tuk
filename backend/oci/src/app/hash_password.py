"""Generate an AUTH_PASSWORD_HASH value (ADR 0005).

Reads the password from an interactive prompt, never a command-line
argument, so it never lands in shell history. Run via
'mise run backend:hash-password'.
"""

import getpass
import sys

from app.auth import password_hasher


def main() -> None:
    password = getpass.getpass("Password: ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("error: passwords did not match", file=sys.stderr)
        raise SystemExit(1)
    if not password:
        print("error: password must not be empty", file=sys.stderr)
        raise SystemExit(1)

    print(password_hasher.hash(password))


if __name__ == "__main__":
    main()
