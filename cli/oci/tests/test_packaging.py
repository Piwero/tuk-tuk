"""Keep the CLI runtime dependency and import boundaries explicit."""

import ast
import tomllib
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN = frozenset(
    {
        "app",
        "sqlalchemy",
        "alembic",
        "argon2",
        "argon2_cffi",
        "aiosqlite",
        "fastapi",
        "starlette",
        "pydantic",
        "pydantic_settings",
        "uvicorn",
        "itsdangerous",
        "cryptography",
        "psycopg",
    }
)


def imported_roots(source: str) -> set[str]:
    roots: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots |= {alias.name.split(".", 1)[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split(".", 1)[0])
    return roots


def requirement_name(requirement: str) -> str:
    for separator in ("[", ">", "<", "=", "!", "~", ";", " "):
        requirement = requirement.split(separator, 1)[0]
    return requirement.strip().casefold().replace("-", "_").replace(".", "_")


def test_runtime_dependencies_are_http_only() -> None:
    manifest = tomllib.loads((PACKAGE_ROOT / "pyproject.toml").read_text())
    assert {requirement_name(entry) for entry in manifest["project"]["dependencies"]} == {
        "httpx",
        "tuk_core",
    }


def test_package_source_never_imports_the_server_stack() -> None:
    offenders = {
        str(path.relative_to(PACKAGE_ROOT)): sorted(imported_roots(path.read_text()) & FORBIDDEN)
        for path in sorted((PACKAGE_ROOT / "src").rglob("*.py"))
        if imported_roots(path.read_text()) & FORBIDDEN
    }
    assert offenders == {}
