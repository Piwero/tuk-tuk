# syntax=docker/dockerfile:1
# Build from the repository root (tuk-core lives in shared/oci):
#   docker build -f mcp/oci/Dockerfile .

# ---- Build: install tuk-mcp + tuk-core (non-editable) into /opt/venv ----
FROM python:3.15-slim AS build

COPY --from=ghcr.io/astral-sh/uv:0.11.26 /uv /uvx /bin/

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app/mcp/oci

COPY shared/oci /app/shared/oci
COPY mcp/oci/pyproject.toml mcp/oci/uv.lock ./
COPY mcp/oci/src ./src
# --frozen, not --locked: the dev group points at backend/oci (the
# integration test boots the real app), which is not in this build, and
# --locked would need it to check the lockfile. mcp-ci runs
# `uv sync --locked` on the full checkout, so a stale lockfile still fails CI.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

# ---- Runtime: venv only, non-root ----
FROM python:3.15-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:${PATH}"

COPY --from=build /opt/venv /opt/venv

RUN useradd --create-home appuser
USER appuser

EXPOSE 8901

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8901/health', timeout=2)"]

# Needs MCP_SERVICE_KEY (>=32 chars) and no User credential; TUK_BASE_URL points at the API.
CMD ["tuk-mcp", "--http", "--host", "0.0.0.0"]
