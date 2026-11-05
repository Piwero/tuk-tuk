# Voice Assistant (optional)

⏱ 3 min read · Off until you set it up: Settings → AI helpers → Voice

**Do this first:** the setup takes about 20 minutes and uses a free cloud service. Follow
[Set up the Voice Assistant](../../self-hosting/voice.md). Until you do, there is no
Voice view in the Assistant.

## What it's for

Plan and tidy your day by talking, with no keyboard. Ask what's on today, add a Task, move
something to tomorrow, check in a Habit. Works in English and Spanish.

## How a conversation goes

1. Open **Assistant**, choose **Voice**, and press **Hold to talk** once. Allow the browser's microphone prompt. The first press only connects.
2. Press and hold the button (or Space/Enter), speak, then release. Slide off the button to cancel. Captions show on screen.
3. Ask for what you want. It collects your requests, then reads the whole batch back:
   *"I'll add one task and check in Water twice, ok?"*
4. Say **yes** and the changes happen. They appear on screen as it does them.
   Say **no**, or change your mind, and nothing is changed.
5. Choose **End session** when done. There is no silence timeout, so a connected session keeps
   using your free minutes until you end it or close the tab.

For hands-free conversation, choose **Start conversation**. The microphone stays on and the
assistant greets you once per session. Speak to interrupt a reply. Choose **Switch to
hold-to-talk** to mute the microphone and keep the same session and captions.

## Things to try

| Say | What happens |
| --- | --- |
| "What's on today?" | Spoken summary of Tasks, Habits and Events |
| "Add buy milk tomorrow" | Reads back the new Task, creates it after your yes |
| "Check in water, 2" | Records 2 on your Water Habit after your yes |
| "Añade llamar al dentista para el viernes" | Replies in Spanish, same read-back |
| "Move the report to Friday" | Reschedules it after your yes |
| "Find my tasks about taxes" | Searches and reads out the matches |

## The promise: bounded, and never destructive

- It acts only after a spoken yes to a read-back, in the same turn.
- It **can't delete anything**. Ask it to and it says no. The browser only accepts a fixed
  list of calls, and none of them delete.
- It touches only Tasks and Habits. Events, Lists, Goals and settings are out of reach.
- It can only change Tasks and Habits it has read in this session. It won't create a List or
  Tag from something you said; it uses ones you already have.
- A recurring Task you complete moves to its next date. The assistant tells you that instead
  of saying it's done.

## Good to know

- **Privacy:** this is the only feature where your voice, the transcript and Agenda data
  (Task titles, Habit names, today's Events) leave your network. They pass through LiveKit (the
  current provider) and its model providers, which LiveKit says keep nothing. Tuk Tuk saves no transcripts or
  recordings, and captions vanish when you end the session. The Settings panel says the same.
- **Keep the tab open.** The assistant works through your open Tuk Tuk tab. Close it and the
  session ends. If your login lapses, it tells you to log in again.
- **First session is slow.** After a quiet spell, allow 10–20 seconds for the agent to start.
- **Cost:** free. The free plan covers roughly 200 minutes of talking a month. When it runs
  out, the Voice view is unavailable until next month.
- **After an upgrade,** redeploy the agent or the Voice view says **Voice agent out of
  date — redeploy**. See [the setup guide](../../self-hosting/voice.md#after-you-upgrade-tuk-tuk).
- **Failures are spoken, not hidden.** If the app can't be reached, it says so and doesn't
  retry on its own.

## Next

→ [AI Assist](ai-assist.md) · [FAQ](../faq.md)
