# Voice Assistant: a cloud-hosted agent whose bounded writes are relayed through the browser

## Status

Accepted. Supersedes one clause of
[0005 (Assist)](0005-assist-local-suggest-only-ephemeral.md) and
[0009](0009-assistant-cloud-chat-suggest-only.md) — "Assist only ever
proposes; it never changes data on its own" — for one new member only,
the Voice Assistant. The in-app Assistant, Assisted Capture and Overdue
Triage stay suggest-only. Reuses the write principle of
[0014](0014-non-browser-clients-credential-write-boundary.md) unchanged.
ADRs 0005, 0009 and 0014 are left unedited.

## Context

The owner wants to talk to tuk-tuk: organise Tasks, the day, and Habits
by voice, hands-free. The target is LiveKit Cloud's free Build plan,
which includes 1,000 agent-session minutes, 5,000 WebRTC minutes, one
agent deployment and $2.50/month of LiveKit Inference credit, with no
credit card required.

Three constraints shape everything below:

- **Voice without writes is pointless.** A spoken plan that still has to
  be clicked through on screen is the in-app Assistant with extra steps.
- **tuk-tuk is self-hosted, often on Docker at `localhost`.** Anything
  that needs a publicly reachable backend excludes most installs.
- **Inference credit is the binding limit, not session minutes.** At
  ~$0.0125/min for the chosen STT + LLM + TTS, the credit covers about
  200 minutes a month, far below the 1,000 session minutes. Self-hosting
  the agent would add no free minutes, so it is not worth adding a
  container for.

## Decision: the Voice Assistant is its own Assist member

It is not a voice mode on the Assistant. Its write rule, runtime (a
long-lived agent rather than request/response) and provider (LiveKit
Inference) all differ. It shares the Agenda composition with the CLI and
MCP server, not the Assistant's identity or snapshot.

## Decision: the agent runs on LiveKit Cloud, one deployment per install

The agent lives in `voice-agent/`: Python, `livekit-agents`, its own
`pyproject.toml`, and no dependency on `backend/`. Each self-hoster
creates their own free LiveKit project and runs `lk agent deploy` once.
Docker users get no extra container.

Rejected: a self-hosted worker inside the owner's cluster or Compose
stack. It keeps settings in one place and avoids cold starts, but it
adds a service every install has to run. It also gains no free minutes,
and loses free cloud turn detection.

## Decision: tools run in the browser, over LiveKit RPC

The agent defines the tools, but each call goes over the room to the
owner's open tab (`registerRpcMethod`). The tab runs it against the
existing API with its own session cookie and returns the result.

- No backend has to be public, so `localhost` installs work.
- No tuk-tuk credential is ever stored at LiveKit.
- Writes show up live, because the tab doing the write is the tab on
  screen.

The enforcement boundary is the set of RPC methods the frontend
registers. The agent cannot call what the tab does not expose. As in
ADR 0014, this is structural with respect to the model and not with
respect to a compromised frontend.

Rejected: the agent calling the backend directly. That needs a public
backend plus a long-lived credential in LiveKit secrets. It reopens
ADR 0014's credential decision and excludes most Docker installs.

## Decision: ADR 0014's write principle, mirrored, not shared

The tool set follows the MCP server's write principle exactly:
idempotent, non-destructive, scoped to Tasks and Habits, with no delete
tool of any kind. Tool names and scope match the MCP server's.

The implementation is TypeScript in the frontend, not the MCP server's
Python, because that is where the tools run. Two implementations can
drift, so one contract test pins the agent's tool list, the frontend's
registered methods and a `contract_version` integer together. A tool
added to one must be added to the other.

## Decision: one spoken confirmation per turn

The agent reads back the batch of writes it intends for the turn ("I'll
add three tasks and move two, ok?") and acts only on a spoken yes.
Confirming each write separately is tedious by voice. Since nothing is
destructive, a wrong batch costs seconds to undo by hand. This keeps
ADR 0014's invariant, *no model-initiated destruction*, and drops only
the click.

## Decision: all inference goes through LiveKit Inference

STT, LLM and TTS all use LiveKit Inference, so there is one credit pool
and no provider key to copy into LiveKit secrets. The Assistant's
provider configuration (ADR 0009) is not reused: a cloud agent would
need a second copy of the key that the settings UI could not update.

Models are set in `voice-agent/` config, not in the settings UI.
Changing one needs a redeploy anyway, so a settings field would only
look like it works. Starting choices, for English and Spanish:

- STT: AssemblyAI Universal-Streaming-Multilingual
- LLM: Gemini 3.1 Flash Lite (tool-call quality is the risk; swap the
  model name if it misfires)
- TTS: Inworld Realtime TTS 2.0 Flash

## Decision: the backend mints room tokens; credentials live in settings

The LiveKit URL, API key and API secret are UI-managed settings
(ADR 0008), with the secret encrypted at rest like the Google refresh
credential. While unset, the feature is invisible.

`POST /voice/session`, behind the session gate, creates a fresh room
per session, dispatches the agent, and returns a join token valid for
about ten minutes. The token is an HS256 JWT signed with stdlib `hmac`,
not the `livekit-api` package. The browser never holds the API secret.

## Decision: session shape

- Web only. Telephony (the free US number) is out: caller ID is
  spoofable and needs its own authentication design.
- Push-to-talk by default (amended, see below). The first press
  connects without recording; a fresh hold after that captures; release
  submits. Continuous (open-mic) mode is an explicit opt-in, not the
  default.
- No silence timeout (amended, see below). The session ends on End
  session, on the tab closing, or on a tab-driven failure.
- On start, the agent pulls the Agenda in one RPC. The tab sends its
  IANA timezone and local date as participant attributes, so relative
  dates resolve in the owner's day, not UTC.
- Captions are shown live and stored nowhere. LiveKit session recording
  and observability are off for this project.

## Decision: failures are spoken, never retried

- **Tab leaves:** the session ends immediately.
- **RPC timeout (~5 s):** the agent says it couldn't reach the app and
  does not retry. Writes are idempotent, but a silent retry after an
  unclear failure is still the wrong default.
- **Credits exhausted:** on a quota error the agent says the free voice
  minutes are used up and ends. The tab hides the mic until the next
  calendar month (browser-local). The Build plan has no balance API, so
  this is the closest thing to a hard stop available.
  The monthly marker belongs to the LiveKit adapter (`voice/livekit.ts`,
  which maps the `quota_exhausted` attribute to a generic `unavailable`
  end reason); generic availability only asks the provider when it is
  next available, so another provider is never gated by LiveKit credit.
- **Version skew:** the agent publishes `contract_version` as a
  participant attribute. On a mismatch the tab ends the session with
  "Voice agent out of date — redeploy".

## Decision: egress is disclosed

This is the first Assist member whose audio and Agenda data leave the
network once enabled. The settings panel says plainly that audio,
transcripts and Agenda data pass through LiveKit and its model
providers, and notes LiveKit's zero-data-retention stance. Entering
credentials is the opt-in.

## Testing

- One contract test: agent tool list, frontend RPC methods and
  `contract_version` agree.
- A handful of LiveKit text simulations (free tier: 350 turns/month).
  Cases: "add milk tomorrow", "check in water 2", a Spanish request, a
  declined confirmation.
- No audio simulations until STT is the suspected problem.

## Accepted trade-offs

- The tool boundary is implemented twice (Python MCP, TypeScript voice).
  The contract test is the price of that, and the only thing keeping
  the two honest.
- The voice session only works while a tuk-tuk tab is open and
  foregrounded enough to keep its WebRTC connection.
- Build plan cold starts: the first session after idle may take a few
  seconds to connect.
- Self-hosted agents would get free turn detection only up to a
  development allowance. Cloud-hosted agents get it free, which is part
  of why the agent is cloud-hosted.
- Credit exhaustion is detected after the fact, from a failed inference
  call, not predicted.

## Amendment: provider adapter seams (issue #388)

LiveKit stays the only provider, and every decision above stands. This
amendment records where LiveKit is isolated so that replacing it later is
adapter work, not a rewrite. Nothing user-visible, no HTTP shape and no
stored column changed.

- **Browser:** the session (`voice/session.ts`) talks to a
  `VoiceTransport` and a `VoiceProvider` (transport factory plus
  `unavailableUntil()`). It never sees rooms, tracks, attributes or RPC.
  `voice/livekit.ts` is the adapter: token fetch, room events, audio,
  captions, attribute-to-`VoiceAgent` translation and the monthly credit
  marker. Tools (`voice/tools.ts`) are transport-neutral; `voice/rpc.ts`
  is only the LiveKit RPC binding and error codes (2001 login expired,
  1500 tool failed).
- **Backend:** `app/voice_livekit.py` owns the `voice_livekit_*` columns,
  token minting, agent dispatch and `AGENT_NAME`. The router calls its
  five functions and exposes the same `/voice/config` and `/voice/session`
  as before. Columns are not renamed; no migration.
- **Agent:** `tools.py`, `prompt.py` and `roster.py` hold behavior and
  tool semantics with no LiveKit import (a test enforces it).
  `livekit_tools.py` and `agent.py` bind them to LiveKit Agents, RPC and
  the lifecycle and quota handling.
- **Unchanged and still authoritative:** the shared roster and
  `contract_version`; browser-relayed tools; the write allowlist; no
  retry; one spoken confirmation per turn, which remains an instruction to
  the model and is not deterministically enforced; the egress disclosure.
- **Availability** is now the provider's call. The "free minutes used up"
  marker is a LiveKit-adapter rule, so another provider is never hidden
  by LiveKit credit.

The remaining provider-specific work is listed in
[Replacing LiveKit](../self-hosting/voice.md#replacing-livekit-whats-still-provider-specific).
Not decided here: a second provider, a plugin registry, or a custom voice
LLM. Any of those is its own record, and it must say how its egress, data
path and credentials compare with the decisions above.

## Amendment: push-to-talk default, no silence timeout (issue #395)

The original shape was open mic with a 20 s silence auto-end. It is
replaced:

- **Push-to-talk is the default.** The browser keeps the microphone muted
  and the agent's audio input disabled until a hold begins. The agent
  uses manual turn detection, so a turn is exactly one hold. Opening the
  page or the Voice view starts no session and no microphone. The agent
  does not greet on connect.
- **Turn control is browser to agent over RPC** (`start_turn`, `end_turn`,
  `cancel_turn`), owner-only. These are not roster tools, so
  `contract_version` is unchanged. An agent that lacks them reports
  "Voice agent out of date — redeploy".
- **The 20 s silence timeout is removed.** It was a budget guard that
  fit open mic. Under push-to-talk silence is normal.
- **Budget impact, stated plainly:** an idle connected session keeps
  burning free session minutes. End session or closing the tab are the
  only terminators. The ~200 min/month figure is easier to exhaust.
- Continuous mode, and the spoken greeting, return in #397.

## What would justify revisiting this

- LiveKit exposing a usage or balance API: check before starting a
  session instead of failing into the cap.
- A paid plan, or a need for more than ~200 min/month: revisit the model
  choices or self-hosted STT/TTS.
- Telephony or a mobile client: there is no browser tab to relay
  through, so the data-path decision and ADR 0014's credential decision
  reopen together and need their own record.
- A proposed delete tool, or anything outside Task-or-Habit scope: judge
  it by ADR 0014's principle, which this record does not relax.
