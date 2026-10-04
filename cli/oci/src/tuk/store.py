"""Config and session files under the user's XDG config directory."""

import json
import os
from pathlib import Path

APP_DIR_NAME = "tuk"
CONFIG_FILE_NAME = "config.json"
SESSION_FILE_NAME = "session.json"
SESSION_COOKIE_NAME = "tuktuk_session"
DEFAULT_BASE_URL = "http://localhost:8900"


def app_dir() -> Path:
    override = os.environ.get("TUK_CONFIG_DIR")
    if override:
        base = Path(override)
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME")
        base = Path(xdg) if xdg and Path(xdg).is_absolute() else Path.home() / ".config"
    target = base / APP_DIR_NAME
    target.mkdir(parents=True, exist_ok=True)
    return target


def _read_json(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return data if isinstance(data, dict) else {}


def read_config() -> dict[str, object]:
    return _read_json(app_dir() / CONFIG_FILE_NAME)


def write_config(base_url: str) -> None:
    (app_dir() / CONFIG_FILE_NAME).write_text(json.dumps({"base_url": base_url}))


def resolve_base_url(cli_value: str | None) -> str:
    if cli_value:
        return cli_value
    return str(read_config().get("base_url", DEFAULT_BASE_URL))


def read_session_cookie() -> str | None:
    data = _read_json(app_dir() / SESSION_FILE_NAME)
    cookie = data.get("session_cookie")
    return cookie if isinstance(cookie, str) else None


def write_session_cookie(cookie: str) -> None:
    path = app_dir() / SESSION_FILE_NAME
    path.write_text(json.dumps({"session_cookie": cookie}))
    os.chmod(path, 0o600)
