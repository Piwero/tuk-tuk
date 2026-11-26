# AI Assist (optional)

⏱ 4 min read · Off until you set it up: Settings → AI helpers

**Do this first:** decide whether you want AI at all. Tuk Tuk works fully
without it. If you don't, skip to the [FAQ](../faq.md).

## What it's for

Saves typing and planning time. AI turns rough notes into tidy tasks and
proposes a plan for your day.

## The promise: it suggests, you decide

Every AI output is a **suggestion**. Nothing is saved or changed until you
click to accept it. The AI has no way to change your data on its own.

## Two features

| Feature | What it does | Runs on |
| --- | --- | --- |
| **Assist** (smart Quick-Add) | Type "dentist next Friday 3pm every 6 months" and get a draft task with date, repeat and reminder filled in. Press Enter to accept or Escape to discard. Works in English and Spanish. | [Ollama](https://ollama.com) on your own computer (free, private) |
| **Assistant** (day planner) | Chat about your day. It reads your week and suggests tasks, time blocks and priorities, fitted around your meetings. You accept each suggestion one by one. | Any OpenAI-compatible service: OpenAI, Gemini, Ollama, etc. |

## Set up Assist (10 min)

1. Install [Ollama](https://ollama.com) and download a small model, for example `ollama pull llama3.2`.
2. In Tuk Tuk: **Settings → AI helpers → Assist**.
3. Enter the **Ollama base URL**. If Tuk Tuk runs in Docker on the same
   computer, that's `http://host.docker.internal:11434`.
4. Pick the **Model** and save. The status changes to **Connected**.

## Set up Assistant (5 min)

1. Get an API key from your provider (for example OpenAI).
2. **Settings → AI helpers → Assistant**.
3. Enter the **Base URL** (OpenAI: `https://api.openai.com/v1`), your **API key**
   and the **Assistant model** name (for example `gpt-4o-mini`). Save.
4. **Assistant** appears in the sidebar.

## Good to know

- **Privacy:** the Assistant sends your week's task titles, today's events,
  list and tag names, and habits to the provider you choose. Point it at
  Ollama to keep everything on your computer.
- **Chats aren't saved.** Refreshing the page clears the conversation.
- **Assist never slows you down.** It waits at most 4 seconds. If Ollama is
  slow or off, the task is saved as typed.
- **Cost:** Ollama is free. Cloud providers charge per use, usually a few cents a day of planning.
- API keys are stored encrypted and never shown again after saving.

## Next

→ [Terminal app](cli.md)
