# syntax=docker/dockerfile:1
# Built by LiveKit Cloud on `lk agent create` / `lk agent deploy` (see docs/self-hosting/voice.md).
# Own file because the generated template runs `agent.py`, and ours is a src-layout package.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1

ARG UID=10001
RUN adduser --disabled-password --gecos "" --home /app --shell /sbin/nologin --uid "${UID}" appuser
WORKDIR /app
COPY --chown=appuser:appuser pyproject.toml uv.lock ./
COPY --chown=appuser:appuser src ./src
USER appuser

# The project itself is installed here, so the source must already be in place.
RUN uv sync --locked --no-dev

# `start` connects to LiveKit Cloud and waits for dispatch jobs.
CMD ["uv", "run", "--no-sync", "python", "-m", "tuk_voice_agent.agent", "start"]
