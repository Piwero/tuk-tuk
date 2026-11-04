# tuk-voice-agent

LiveKit Cloud agent for the Voice Assistant ([ADR 0015](../docs/adr/0015-voice-assistant-cloud-agent-browser-relayed-writes.md), issue #364). Reads the Agenda and searches Tasks by relaying RPC calls to the owner's open browser tab; it never touches the API itself.

Agent name: `tuktuk-voice` (must equal `AGENT_NAME` in `backend/oci/src/app/voice_token.py`).

## Deploy (stub; full guide lands in `docs/self-hosting/voice.md`)

```sh
cd voice-agent
lk cloud auth
lk agent create   # first time, registers and deploys
lk agent deploy   # after every upgrade of tuk-tuk
```

After editing `shared/voice-tool-roster.json`, copy it to `src/tuk_voice_agent/voice-tool-roster.json` (a test fails if they differ).

## Develop

```sh
uv run pytest && uv run ruff check . && uv run mypy src
lk agent dev      # run against your LiveKit project
```
