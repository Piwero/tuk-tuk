"""The runtime dependency boundary, pinned as a test.

Installing the CLI must not drag in the server's installation — no backend
package, no SQLAlchemy, no Alembic, no Argon2. That is the whole reason
request bodies are declared as thin models here rather than imported from
the backend's schemas, and the reason the package talks HTTP only.

The boundary is otherwise invisible: it holds today because the runtime
dependency list happens to be short, and nothing would complain the day
somebody reached for a backend import and added the dependency to make it
work. The one integration test does need the backend, which is exactly why
it sits in the dev group and why the split needs enforcing rather than
describing. A boundary that lives only in prose is one somebody widens by
accident.

The manifest and the import graph are both public surfaces of the package,
so asserting on them is not reaching past the entrypoint — there is no
behaviour here to drive through it.
"""

import ast
import tomllib
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent

# The server's installation, named by what an import or a requirement would
# actually say. `app` is the backend package itself; the rest are what
# importing it would drag in.
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


def runtime_dependencies() -> list[str]:
    manifest = tomllib.loads((PACKAGE_ROOT / "pyproject.toml").read_text())
    return list(manifest["project"]["dependencies"])


def requirement_name(requirement: str) -> str:
    """The bare distribution name: version specifiers, extras and environment
    markers cut off, and `-`/`.` folded to `_` so a requirement and an import
    of the same distribution compare equal."""
    for separator in ("[", ">", "<", "=", "!", "~", ";", " "):
        requirement = requirement.split(separator, 1)[0]
    return requirement.strip().casefold().replace("-", "_").replace(".", "_")


def imported_roots(source: str) -> set[str]:
    """Every top-level package name the module imports, found by walking the
    syntax tree rather than scanning line prefixes — so an import nested in a
    function, a `try:` block or an `if TYPE_CHECKING:` guard is caught too.
    A lazy import inside a function is the likeliest way this boundary gets
    widened, and it is exactly what a prefix scan misses."""
    roots: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots |= {alias.name.split(".", 1)[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split(".", 1)[0])
    return {requirement_name(root) for root in roots}


def test_runtime_dependencies_stay_http_only() -> None:
    """Not merely "no server stack" but "nothing but an HTTP client". Stricter
    than the boundary strictly needs, and deliberately so: the list is short
    enough that any addition deserves a decision rather than a drive-by."""
    assert {requirement_name(entry) for entry in runtime_dependencies()} == {"httpx"}


def test_package_source_never_imports_the_server_stack() -> None:
    """The manifest is the declaration; this is the fact. A backend import
    works on a dev checkout — the dev group installs it for the integration
    test — and fails for anyone who installed the CLI alone, so the manifest
    test above cannot catch it on its own."""
    offenders = {
        str(path.relative_to(PACKAGE_ROOT)): sorted(forbidden)
        for path in sorted((PACKAGE_ROOT / "src").rglob("*.py"))
        if (forbidden := imported_roots(path.read_text()) & FORBIDDEN)
    }

    assert offenders == {}
