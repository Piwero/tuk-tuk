# tuk-voice-agent

Python [LiveKit Agents](https://docs.livekit.io/agents/) worker for the Voice Assistant
([ADR 0015](../docs/adr/0015-voice-assistant-cloud-agent-browser-relayed-writes.md)). It reads
the Agenda and relays bounded Task and Habit calls to the owner's open browser tab over RPC; it
never holds Tuk Tuk credentials or calls its API.

## Deploy

Follow the [setup guide](../docs/self-hosting/voice.md) to create a project, turn off
observability and configure Tuk Tuk. From `voice-agent/`:

```sh
lk cloud auth
lk agent create   # first time: registers, builds and deploys
lk agent deploy   # after each Tuk Tuk upgrade
lk agent status
```

The included Dockerfile starts `tuk_voice_agent.agent`. The agent name `tuktuk-voice` in
`src/tuk_voice_agent/config.py` must match `AGENT_NAME` in
`backend/oci/src/app/voice_livekit.py`: the backend dispatches by name.

`lk agent deploy` uploads this directory only. After editing `shared/voice-tool-roster.json`,
copy it to `src/tuk_voice_agent/voice-tool-roster.json`; the contract test checks they match.

## Develop

```sh
uv sync
uv run pytest
uv run ruff check .
uv run mypy src
```

## Hand-run simulations

Five scripted text conversations use LiveKit's [`AgentSession.run()` testing API](https://docs.livekit.io/testing/unit-tests/)
with the production prompt, tool definitions and LLM. A fake tab answers RPC calls and records
writes; no browser, LiveKit room, audio or Tuk Tuk data is involved. Cases cover milk tomorrow,
Water value 2, Spanish, a declined confirmation and a refused delete. The last two assert zero
write tool calls. Text and LLM judge checks assess read-back and refusal; model answers can vary.

These are **manual**, like [`backend/oci/evals`](../backend/oci/evals/README.md), not CI.
`pytest` defaults to `tests/`, so neither bare `uv run pytest` nor `mise run test` includes
`simulations/`. They use LiveKit Inference credit and may incur charges beyond your plan's
allowances. Check [current pricing and limits](https://livekit.io/pricing) first. Unlike
LiveKit's separate hosted Agent Simulations product, these local `AgentSession.run()` tests use
Inference; don't assume its hosted simulation turn allowance covers them.

Export your own project's credentials in a private shell, then run:

```sh
cd voice-agent
export LIVEKIT_URL='wss://your-project.livekit.cloud'
export LIVEKIT_API_KEY='your-key'
export LIVEKIT_API_SECRET='your-secret'
LIVEKIT_EVALS_VERBOSE=1 uv run pytest -s simulations
```

Run one case with, for example, `uv run pytest -s simulations -k delete`. Without key and secret,
the cases skip. Never commit credentials; unset the variables after use. Tests do not exercise
speech recognition, audio, real browser RPC or the deployed agent. Review verbose output only
in a safe environment, as it includes conversation text.

### Real LiveKit audio check (#397)

Not run in implementation environment: no LiveKit credentials or browser audio device.
With a deployed agent and configured app, use a browser with a working microphone and speaker:

1. Open `/assistant` Voice. Confirm no microphone indicator and no greeting.
2. Select Start conversation. Confirm microphone indicator, brief greeting, and audible reply
   after speaking and pausing. Interrupt a long reply by speaking; ask a follow-up that depends
   on earlier context and confirm it answers in context.
3. Select Switch to hold-to-talk. Confirm the microphone indicator turns off and captions remain.
   Hold to speak, release, and confirm the reply completes. Hold while it speaks and confirm
   interruption. Slide off a held control and confirm no reply to the canceled turn.
4. Select Start conversation again. Confirm no second greeting. End session and confirm browser
   microphone indicator turns off. Repeat with tab closure and confirm microphone release.

Record browser, agent version, date, and results for each step; fake transports cannot verify audio.
