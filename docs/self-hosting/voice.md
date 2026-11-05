# Set up the Voice Assistant

⏱ 20 min, one time · Needs: a running Tuk Tuk, a free [LiveKit Cloud](https://cloud.livekit.io) account, a terminal on the machine with the `tuk-tuk` folder

**Do this first:** read [what leaves your network](#what-leaves-your-network). Voice is the one
feature that sends audio and Agenda data to a cloud service. It stays off, and invisible,
until you finish step 4.

## How it fits together

- **The agent** is a small Python program in `voice-agent/`. You deploy it once to *your own*
  free LiveKit Cloud project. It listens, thinks and speaks.
- **Your browser tab** does the real work. When the agent wants to read or change a Task, it
  asks the open tab, and the tab calls your Tuk Tuk API with your normal login. Nothing at
  LiveKit ever holds a Tuk Tuk password or token, and Tuk Tuk doesn't need to be reachable from
  the internet. `http://localhost:8080` works.
- **Your Tuk Tuk backend** only hands the tab a short-lived room ticket (about 10 minutes),
  signed with the LiveKit secret you save in Settings.

Design record: [ADR 0015](../adr/0015-voice-assistant-cloud-agent-browser-relayed-writes.md).

## 1. Create a free LiveKit project (5 min)

1. Sign up at [cloud.livekit.io](https://cloud.livekit.io). No credit card is needed for the
   free **Build** plan.
2. Create a project. Pick the **data region** now (United States is the default, or the
   European Union): it can't be changed later.
3. Open **Settings → Keys** and create an API key. Keep this page open. You need three values:
   - **URL**, like `wss://your-project.livekit.cloud`
   - **API key**
   - **API secret** (shown once)

## 2. Check recording and observability are off (2 min)

Tuk Tuk stores no transcripts or recordings. Make sure LiveKit doesn't either:

1. In the project, open **Settings → Observability** and turn **Agent observability** off.
   While it is on, LiveKit keeps session transcripts, traces, logs and audio recordings for
   30 days.
2. Don't configure **Egress** or any session recording for the project. Nothing in Tuk Tuk
   starts one.
3. Don't add log drains.

Recheck this page after any change to the project. The setting lives at LiveKit and Tuk Tuk
can't see it.

## 3. Deploy the agent (10 min)

Install the [LiveKit CLI](https://docs.livekit.io/reference/developer-tools/livekit-cli/) (`lk`),
then from the `tuk-tuk` folder:

```sh
cd voice-agent
lk cloud auth      # opens a browser; pick the project from step 1
lk agent create    # first time only: registers the agent and builds it
```

When it finishes, `lk agent status` shows the agent running, and `lk agent logs` tails its
output. The CLI writes `voice-agent/livekit.toml` (your project and agent ID); keep it for redeploys and do not commit project-specific configuration.

The agent registers as **`tuktuk-voice`**. The backend asks LiveKit for exactly that name, so
the two must match. Don't rename it. If you ever fork the agent, change `AGENT_NAME` in
`voice-agent/src/tuk_voice_agent/config.py` **and** `AGENT_NAME` in
`backend/oci/src/app/voice_token.py` together. There is no shared code between the two sides
on purpose. The symptom is a session that connects and
then sits in silence.

The free plan allows one agent deployment per project.

## 4. Enter the credentials in Tuk Tuk (1 min)

1. Open **Settings → AI helpers → Voice**.
2. Paste the **LiveKit URL**, **API key** and **API secret**. Save.
3. The status changes to **Connected** and a microphone button appears. No restart is needed.

The secret is stored encrypted with your master key and never shown again. The panel says
"already saved" instead. To turn voice off, use the clear button in the same panel: the
microphone disappears everywhere.

## 5. Try it

Tap the microphone, allow the browser's microphone prompt, and say "what's on today?". See
[Voice Assistant](../guide/features/voice.md) for what to say.

**The first session after a quiet spell is slow.** On the free plan LiveKit stops an idle agent,
and starting it again takes 10–20 seconds before it greets you. Later sessions are quick.

## After you upgrade Tuk Tuk

Redeploy the agent every time you upgrade, since the app and the agent must agree on the tool
list:

```sh
cd voice-agent
lk agent deploy
```

LiveKit rolls it out without dropping a running session. If you forget, the microphone shows
**Voice agent out of date — redeploy** and ends the session before anything changes. The two
sides compare a `contract_version` number to catch this.

The agent reads its own copy of the tool list, `voice-agent/src/tuk_voice_agent/voice-tool-roster.json`,
because `lk agent deploy` uploads only the `voice-agent/` folder. A test fails if the copy
differs from `shared/voice-tool-roster.json`. If you edit the shared file, copy it over.

## What it can and can't do

- It reads your Agenda and searches Tasks.
- It creates Tasks, schedules, completes, sets priority, moves Tasks to a List, adds Tags and
  Check Items, and checks in Habits.
- It reads back the whole batch in one sentence and acts only after you say yes.
- It has **no delete** and touches nothing outside Tasks and Habits. This is built into which
  calls the browser accepts, not just a prompt rule.

## What leaves your network

While a session is open, these pass through LiveKit and the model providers it runs
(speech-to-text, language model, text-to-speech):

- your voice
- the transcript
- the Agenda data the agent reads: Task titles and descriptions, Habit names, today's Events,
  List and Tag names

LiveKit states that the models it runs for you retain no data and train on none (zero data
retention). Tuk Tuk stores no transcripts or recordings. Captions shown on screen disappear
when the session ends. Saving the credentials is the opt-in. Clearing them is the opt-out.

## When something goes wrong

| What you see or hear | Why | What to do |
| --- | --- | --- |
| No microphone button | Credentials not saved, or the free minutes ran out this month | Check **Settings → AI helpers → Voice**. See the last row |
| **Voice agent out of date — redeploy** | You upgraded Tuk Tuk and not the agent | `cd voice-agent && lk agent deploy` |
| Connects, then silence | Agent not running, or its name doesn't match | `lk agent status`; see step 3 about `tuktuk-voice` |
| Message about LiveKit being unreachable | LiveKit is down or your network blocks it | Retry later. Setup is fine |
| Message about bad credentials | URL, key or secret is wrong | Re-enter them from LiveKit **Settings → Keys** |
| Agent says "I couldn't reach your app" | The tab didn't answer in about 5 seconds | Say it again. The agent never retries on its own |
| Agent says you need to log in again | Your Tuk Tuk session expired | Log in, then restart the voice session |
| Agent says free voice minutes are used up | The free plan's monthly credit ran out | The microphone hides until next month, using your browser's local clock |
| The session ends by itself | 20 seconds of silence after the agent stopped talking, or you closed the tab | Tap the microphone again |

## Cost

The free Build plan includes 1,000 agent-session minutes and $2.50 a month of LiveKit
Inference credit. The credit is the real limit: roughly 200 minutes of talking a month with the
default models. The plan has no balance meter, so Tuk Tuk learns the credit is gone only when
a session fails, and then hides the microphone for the rest of the month.

## Testing changes to the agent

Changed a model or the prompt? `voice-agent/simulations/` has five text conversations that
check tool choice without spending voice minutes. See
[`voice-agent/README.md`](../../voice-agent/README.md#hand-run-simulations).

## Next

→ [Voice Assistant guide](../guide/features/voice.md) · [Security](security.md)
