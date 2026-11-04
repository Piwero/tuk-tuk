import ast
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN = {
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


def imported_roots(source: str) -> set[str]:
    roots: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots |= {alias.name.split(".", 1)[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split(".", 1)[0])
    return roots


def test_shared_package_runtime_boundary() -> None:
    manifest = tomllib.loads((ROOT / "pyproject.toml").read_text())
    assert manifest["project"]["dependencies"] == ["httpx>=0.27.0"]
    assert (ROOT / "src/tuk_core/py.typed").exists()


def test_shared_source_never_imports_the_server_stack() -> None:
    offenders = {
        str(path.relative_to(ROOT)): sorted(imported_roots(path.read_text()) & FORBIDDEN)
        for path in sorted((ROOT / "src").rglob("*.py"))
        if imported_roots(path.read_text()) & FORBIDDEN
    }
    assert offenders == {}
