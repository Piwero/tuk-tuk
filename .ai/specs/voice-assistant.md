# Voice Assistant (LiveKit Cloud free tier)

Issue: https://github.com/Piwero/tuk-tuk/issues/364 — branch `feat/364-voice-assistant`. Design: [ADR 0015](../../docs/adr/0015-voice-assistant-cloud-agent-browser-relayed-writes.md) (already Accepted). Glossary: **Voice Assistant** in `CONTEXT.md`. Large epic: if a task balloons, split it into its own spec.

## Status

InProgress

## Why

Capturing and rearranging Tasks/Habits needs hands on a keyboard. Owner wants to talk to tuk-tuk and have bounded changes applied, at zero cost, with or without a public domain.

## What

A mic button in the web app starts a LiveKit voice session with an agent (`voice-agent/`, deployed by owner to own free LiveKit Cloud project). Agent reads Agenda, proposes a batch of writes, applies after spoken yes. All tool calls relay over LiveKit RPC to the open tab, which calls the existing API with the session cookie. Invisible until LiveKit URL/key/secret saved in Settings. Done = all 69 user stories in the issue hold; Done checklist below passes.

## Context

**Relevant files:**

- `shared/voice-tool-roster.json` — roster + `contract_version` (exists; `clients` contains `voice` for the 9 writes + 3 reads). Source of truth for both sides.
- `mcp/oci/tests/test_mcp.py` — `test_shared_tool_roster_contract`: MCP side of the contract test. Copy shape for agent side.
- `mcp/oci/src/tuk_mcp/tools.py` — reference semantics for each tool (arg handling, `get_agenda` composition, id allowlist, name resolution, `due` parsing). Frontend RPC handlers mirror these.
- `backend/oci/src/app/routers/v1/assistant.py` — pattern for `GET/PUT/DELETE /config`, write-only encrypted secret, `reject_explicit_null`.
- `backend/oci/src/app/models.py` (`AppSettings`), `app/app_settings.py` (`assistant_configured`), `app/crypto.py`, `app/main.py` (router include) — settings columns, configured check, encrypt/decrypt, wiring.
- `backend/oci/migrations/versions/0033_login_lockout_settings.py` — latest migration; new one is `0034`.
- `backend/oci/tests/test_google_credentials.py`, `test_assistant.py` — prior art for credential tests (raw-DB ciphertext check).
- `frontend/oci/src/api.ts` — API client (`fetchAssistantConfig`, `putCheckIn`, `updateTask`, `createTask`, `createCheckItem`, `fetchTasks`, `fetchHabits`, `fetchLists`, `fetchTags`, events fetch).
- `frontend/oci/src/components/SettingsView.tsx` (`AssistantConfigForm`) — settings form pattern.
- `frontend/oci/src/useAssistantAvailable.ts` — availability hook pattern.
- `frontend/oci/src/App.tsx` — `loadTasks`, `calendarRefresh`; where the session refetch hook-up and mic button mount.
- `frontend/oci/src/test/fakeApi.ts`, `App.assistantSettings.test.tsx`, `App.assistantView.test.tsx` — fake API + test prior art.
- `shared/quick-add-date-vectors.json` — precedent for a shared fixture consumed by several implementations.
- `.github/workflows/{backend,frontend,mcp}-ci.yml` — path filters; add `shared/voice-tool-roster.json` to frontend; new `voice-agent-ci.yml`.
- `mise.toml`, `CONTRIBUTING.md` (stack + layout), `docs/self-hosting/` — add voice-agent tasks and setup doc.

**Patterns to follow:**

- Credential field: `routers/v1/assistant.py` + `encrypted_assistant_api_key` (encrypted with `APP_MASTER_KEY`, never echoed, omitted = keep, DELETE clears).
- Python packages: own `pyproject.toml`, ruff (line 100), strict mypy, pytest — copy `mcp/oci/pyproject.toml`. Layout `voice-agent/` (package dir at top level per issue/ADR; no `oci/` since it is not an image).
- Frontend tests: render `App`, `installFakeApi`, no mocking of internal modules.
- Comment style: long "why" comments referencing issue/ADR numbers, as in surrounding code.

**Key decisions already made:**

- New backend router `app/routers/v1/voice.py`, prefix `/api/v1/voice` (repo API is `/api/v1/*`): `GET/PUT/DELETE /config` (fields `livekit_url`, `livekit_api_key`, `livekit_api_secret_set`, `configured`) and `POST /session`. Mirrors the Assistant router rather than widening an existing shape; deviation from the issue's wording ("settings read gains `voice_*`") is deliberate. Revisit only if the owner objects.
- Token: HS256 JWT via stdlib `hmac`/`hashlib`/`base64`; claims `iss`=api key, `sub`=identity, `exp`≈10 min, `video: {room, roomJoin, canPublish, canSubscribe, canPublishData}`, agent dispatch via `roomConfig.agents[{agentName}]` in the token. No `livekit-api`. Mark `ponytail:` naming `livekit-api` as upgrade path. Verify claim names against LiveKit docs before coding.
- Room name: `tuktuk-<random urlsafe>`, unique per call.
- Frontend adds only `livekit-client`. Room injected (factory prop/context) so tests use a fake room.
- Agent: `livekit-agents`; STT/LLM/TTS model strings in one config module; agent name constant shared by agent and backend (plain string in both; covered by a docs note, not a test).
- Exhaustion marker: `localStorage` key holding `YYYY-MM`; mic hidden while it equals current local month. `ponytail:` comment.
- Tool names/args exactly from the roster; `check_in_habit` default `day`=today, `value` default 1.
- Agent session reasons are strings in a small enum shared by convention: `quota_exhausted`, `session_lapsed`, `silence`, `version_mismatch`.

## Constraints

**Must:**

- Every new Python file passes ruff + strict mypy; follow existing import/comment style.
- Backend secret only ever stored encrypted; never in any response or log.
- Writes in the browser limited to ids returned by this session's reads (allowlist), except create.
- List/Tag names resolve only against existing ones; never create from a spoken name.
- Conventional commits, small: `type(scope): subject`, scopes `voice`, `backend`, `frontend`, `docs`, `ci`. No `T1:` prefixes in git (overrides generic spec guideline; matches repo history).

**Must not:**

- No new backend dependency (stdlib HMAC). One new frontend dep (`livekit-client`). `voice-agent/` must not depend on `backend/`.
- No delete tool, no write outside Tasks/Habits (ADR 0014).
- Don't modify unrelated code; don't refactor existing code (only add the minimal mount points in `App.tsx`/`SettingsView.tsx`).
- No stored transcripts/recordings.

**Out of scope:**

- Telephony, native clients, self-hosted agent worker, Focus Session control, other languages, model picker in UI, usage dashboard, paid-plan features (see issue "Out of Scope").

## Tasks

### T1: Roster contract on the voice side

**Do:** Add `voice-agent/` skeleton (`pyproject.toml`, `src/tuk_voice_agent/{__init__,roster}.py`, `tests/test_contract.py`). `roster.py` loads `shared/voice-tool-roster.json` filtered to `clients ∋ voice`. Test asserts: tool names/kinds/args equal roster, `contract_version` equal, no tool name implies delete. Add a frontend-side test later in T6 reusing the same file. Add `voice-agent:{install,test,lint}` tasks to `mise.toml`, `voice-agent-ci.yml`, add `shared/voice-tool-roster.json` to `frontend-ci.yml` paths, add to `.pre-commit-config.yaml` ruff/mypy file filters.

**Files:** `voice-agent/pyproject.toml`, `voice-agent/src/tuk_voice_agent/roster.py`, `voice-agent/tests/test_contract.py`, `mise.toml`, `.github/workflows/voice-agent-ci.yml`, `.github/workflows/frontend-ci.yml`, `.pre-commit-config.yaml`

**Verify:** `cd voice-agent && uv run pytest && uv run ruff check . && uv run mypy src`

### T2: Backend voice settings

**Do:** Migration `0034` adds `voice_livekit_url` (String 255), `voice_livekit_api_key` (String 255), `encrypted_voice_livekit_api_secret` (Text) to `settings`. Model columns; `voice_configured()` in `app_settings.py`. Router `voice.py` with `GET/PUT/DELETE /config` per Key decisions (PUT: omitted secret keeps stored; first save requires a secret → 422 `livekit_secret_required` like Google). Include router in `main.py`. Tests: round-trip, configured flips, ciphertext-only in raw DB, secret never in response, omitted secret kept, DELETE returns to unconfigured, takes effect with no restart, 401 without session.

**Files:** `backend/oci/migrations/versions/0034_voice_settings.py`, `backend/oci/src/app/models.py`, `backend/oci/src/app/app_settings.py`, `backend/oci/src/app/routers/v1/voice.py`, `backend/oci/src/app/main.py`, `backend/oci/tests/test_voice_settings.py`

**Verify:** `cd backend/oci && uv run pytest tests/test_voice_settings.py tests/test_migrations.py && uv run ruff check . && uv run mypy src`

### T3: Backend voice session endpoint

**Do:** `POST /api/v1/voice/session` in `voice.py` (token minting in `app/voice_token.py`, stdlib only, `ponytail:` comment). Unconfigured → 404 `voice_unavailable` (match how other unconfigured Assist features report; check `assist.py`). Returns `{url, token, room}`. Tests: 401 without session, unconfigured error, JWT verifies with HS256 under stored secret, grants only returned room, `exp - iat` ≈ 600s, includes agent dispatch, two calls → different rooms.

**Files:** `backend/oci/src/app/voice_token.py`, `backend/oci/src/app/routers/v1/voice.py`, `backend/oci/tests/test_voice_session.py`

**Verify:** `cd backend/oci && uv run pytest tests/test_voice_session.py && uv run ruff check . && uv run mypy src`

### T4: Voice agent with reads only

**Do:** `agent.py` (livekit-agents `AgentServer`/entrypoint with explicit agent name), `config.py` (STT/LLM/TTS model strings, 20 s silence, 5 s RPC timeout), `prompt.py` (system prompt: Agenda first, EN/ES, batch-confirm rule placeholder, refuse delete/out-of-scope), `tools.py` (reads only: `get_agenda`, `search_tasks`, `get_task`, each `perform_rpc` to the browser participant, JSON args/result). Publish `contract_version` participant attribute on join. Read `tz`/`date` attributes into the prompt. Unit-test tool wiring with a fake room/participant (RPC method name + payload per roster).

**Files:** `voice-agent/src/tuk_voice_agent/{agent,config,prompt,tools}.py`, `voice-agent/tests/test_tools.py`, `voice-agent/README.md` (deploy stub)

**Verify:** `cd voice-agent && uv run pytest && uv run ruff check . && uv run mypy src`

### T5: Frontend settings panel and availability

**Do:** `api.ts` functions + types for voice config; `VoiceConfigForm` in `SettingsView.tsx` (URL, key, masked secret "already saved", clear, egress disclosure text incl. LiveKit zero-data-retention); `useVoiceAvailable` hook (reads config `configured` + exhaustion marker); extend `fakeApi.ts`. Tests: panel renders/saves/masks/clears; no mic yet.

**Files:** `frontend/oci/src/api.ts`, `frontend/oci/src/components/SettingsView.tsx`, `frontend/oci/src/useVoiceAvailable.ts`, `frontend/oci/src/test/fakeApi.ts`, `frontend/oci/src/App.voiceSettings.test.tsx`

**Verify:** `cd frontend/oci && npm test -- App.voiceSettings && npm run lint && npm run typecheck && npm run format:check`

### T6: Frontend voice session, reads and captions

**Do:** `npm i livekit-client`. `voice/session.ts` (fetch token, join via injected room factory, publish mic on first start only, set `tz`/`date` attributes, state machine connecting/listening/speaking/ended, leave on `pagehide`/unmount, captions from transcription stream, cleared on end), `voice/rpc.ts` (register exactly the roster's `voice` methods; reads only now, plus Agenda composed client-side like `get_agenda` with calendar-failure isolation, writable-id allowlist set filled by reads), `components/VoiceButton.tsx` (button, accessible name, `aria-live` state, mic-denied message), mount in `App.tsx`. Frontend roster test: registered method names equal roster `voice` tools; `contract_version` mismatch ends session with "Voice agent out of date — redeploy". Fake room in `src/test/fakeRoom.ts`.

**Files:** `frontend/oci/package.json`, `frontend/oci/package-lock.json`, `frontend/oci/src/voice/{session,rpc}.ts`, `frontend/oci/src/components/VoiceButton.tsx`, `frontend/oci/src/App.tsx`, `frontend/oci/src/test/fakeRoom.ts`, `frontend/oci/src/App.voice.test.tsx`, `frontend/oci/src/voice/contract.test.ts`

**Verify:** `cd frontend/oci && npm test && npm run lint && npm run typecheck && npm run build`

### T7: Write tools and batch confirmation

**Do:** Agent: add the 9 write tools + batch-confirm prompt rule (writes only after spoken yes in same turn; decline/correction → no writes; refuse delete). Frontend `rpc.ts`: implement each write against existing API (`createTask`, `updateTask` for schedule/reschedule/complete/priority/list/tags, `createCheckItem`, `putCheckIn`), allowlist enforced, List/Tag resolve-only, due parsing equals MCP semantics, trigger the same refetch/invalidation as in-app writes. Tests per RPC → right API call + visible view updates; id outside allowlist refused; unknown list/tag refused. Agent test: write tools have kind `write`, RPC payload shape.

**Files:** `voice-agent/src/tuk_voice_agent/{tools,prompt}.py`, `voice-agent/tests/test_tools.py`, `frontend/oci/src/voice/rpc.ts`, `frontend/oci/src/App.tsx`, `frontend/oci/src/App.voiceWrites.test.tsx`

**Verify:** `cd voice-agent && uv run pytest && cd ../frontend/oci && npm test -- App.voice`

### T8: Failure paths

**Do:** Agent: RPC timeout → speak "I couldn't reach your app", no retry; distinct session-lapsed error → speak "you need to log in again" and end; quota/credit error → speak "free voice minutes used up for this month", end with reason `quota_exhausted`; 20 s silence timer (from agent speech end, reset on user speech); end on browser participant leave. Frontend: RPC maps 401 to lapsed error; `quota_exhausted` disconnect reason writes `localStorage` month marker (`ponytail:` comment) and hides mic; marker clears on next month; map LiveKit connect errors to clear messages (unreachable vs bad credentials); failed batch reports landed vs failed. Tests for each, with fake clock for the month rollover and silence.

**Files:** `voice-agent/src/tuk_voice_agent/{agent,tools}.py`, `voice-agent/tests/test_failures.py`, `frontend/oci/src/voice/{session,rpc}.ts`, `frontend/oci/src/useVoiceAvailable.ts`, `frontend/oci/src/App.voiceFailures.test.tsx`

**Verify:** `cd voice-agent && uv run pytest && cd ../frontend/oci && npm test -- App.voice`

### T9: Docs and simulations

**Do:** `docs/self-hosting/voice.md` (create free project, confirm recording/egress/observability off, `lk agent deploy` from `voice-agent/`, enter creds in Settings, redeploy after upgrade, privacy). Link from `docs/self-hosting/install.md`, `docs/guide/features/` (new `voice.md`), `README.md`/`CONTRIBUTING.md` stack + layout. `voice-agent/simulations/` hand-run LiveKit text sims: add milk tomorrow; check in water 2; one Spanish request; declined confirmation → zero writes; delete request → refused. Not in CI.

**Files:** `docs/self-hosting/voice.md`, `docs/self-hosting/install.md`, `docs/guide/features/voice.md`, `CONTRIBUTING.md`, `voice-agent/README.md`, `voice-agent/simulations/*`

**Verify:** `mise run lint && mise run test`; Manual: follow `voice.md` from scratch against a free LiveKit project.

## Done

- [ ] `mise run lint` and `mise run test` pass (backend, frontend, mcp, shared, voice-agent)
- [ ] `cd frontend/oci && npm run build` passes
- [ ] Manual: with no LiveKit settings, no mic button and no voice UI anywhere; Settings shows panel with disclosure
- [ ] Manual: save URL/key/secret → mic appears without restart; reload Settings shows "already saved", not the secret
- [ ] Manual: tap mic, say "what's on today?" → spoken summary, captions shown, captions gone after end
- [ ] Manual: "add buy milk tomorrow" → batch read-back; "no" → nothing created; "yes" → Task appears live in Inbox
- [ ] Manual: "delete X" → spoken refusal; nothing changes
- [ ] Manual: stay silent 20 s after agent stops → session ends; close tab → session ends
- [ ] Manual: deny mic permission → clear message
- [ ] No regressions in Assistant, Settings, Quick-Add, Habits check-in, MCP roster test
- [ ] Simulations in `voice-agent/simulations/` run by hand and behave per T9
