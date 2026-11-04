from pathlib import Path

import pytest

from tuk_core.store import DEFAULT_BASE_URL, resolve_base_url, write_config


@pytest.fixture(autouse=True)
def _config_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path))
    monkeypatch.delenv("TUK_BASE_URL", raising=False)


def test_default_when_nothing_set() -> None:
    assert resolve_base_url(None) == DEFAULT_BASE_URL


def test_config_file_beats_default() -> None:
    write_config("http://file")
    assert resolve_base_url(None) == "http://file"


def test_env_beats_config_file(monkeypatch: pytest.MonkeyPatch) -> None:
    write_config("http://file")
    monkeypatch.setenv("TUK_BASE_URL", "http://env")
    assert resolve_base_url(None) == "http://env"


def test_argument_beats_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TUK_BASE_URL", "http://env")
    assert resolve_base_url("http://arg") == "http://arg"


def test_empty_env_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    write_config("http://file")
    monkeypatch.setenv("TUK_BASE_URL", "")
    assert resolve_base_url(None) == "http://file"
