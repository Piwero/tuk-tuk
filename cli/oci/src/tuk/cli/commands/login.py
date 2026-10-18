"""Login command."""

import getpass
import sys

from tuk.client import Client, ClientError
from tuk.store import write_config, write_session_cookie

from ..errors import LOGIN_SETUP_CODES, SETUP_MESSAGE, lockout_message


def cmd_login(client: Client, resolved_base_url: str) -> int:
    password = getpass.getpass("Password: ")
    try:
        cookie = client.login(password)
    except ClientError as exc:
        if exc.code in LOGIN_SETUP_CODES:
            print(SETUP_MESSAGE, file=sys.stderr)
        elif exc.code == "too_many_attempts":
            print(lockout_message(exc.retry_after), file=sys.stderr)
        else:
            print(f"Login failed: {exc.message}", file=sys.stderr)
        return 1
    write_config(resolved_base_url)
    write_session_cookie(cookie)
    print("Logged in.")
    return 0
