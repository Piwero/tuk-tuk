import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { App } from "./App";
import { livekitProvider } from "./voice/livekit";
import { installFakeApi } from "./test/fakeApi";
import { connectVoiceFromAssistant, fakeVoiceTransport } from "./test/fakeVoiceTransport";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

const configured = {
  voiceLivekitUrl: "wss://test.livekit.cloud",
  voiceLivekitApiKey: "key",
  voiceSecretSet: true,
};
const agent = { speaking: false, contractVersion: "1" };

it("hides exhausted LiveKit voice until the next local month without a reload", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 50));
  installFakeApi(configured);
  const fake = fakeVoiceTransport();
  render(
    <App
      voiceProvider={{ ...fake.provider, unavailableUntil: livekitProvider.unavailableUntil }}
    />,
  );
  await connectVoiceFromAssistant(userEvent.setup({ advanceTimers: vi.advanceTimersByTime }));
  await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
  localStorage.setItem("tuktuk.voice.exhaustedMonth", "2026-07");
  act(() => fake.transports[0]!.events.onAgent({ ...agent, endReason: "unavailable" }));
  // Voice is the only assistant here, so its nav item goes with it.
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "Assistant" })).not.toBeInTheDocument(),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10001);
  });
  expect(await screen.findByRole("link", { name: "Assistant" })).toBeInTheDocument();
});

it("shows a connection failure to the owner", async () => {
  installFakeApi(configured);
  const fake = fakeVoiceTransport((t) => {
    t.connect = async () => {
      throw new Error("Provider is unreachable.");
    };
  });
  render(<App voiceProvider={fake.provider} />);
  await connectVoiceFromAssistant(userEvent.setup());
  expect(await screen.findByRole("alert")).toHaveTextContent("Provider is unreachable.");
});

it("shows a microphone refusal distinctly", async () => {
  installFakeApi(configured);
  const fake = fakeVoiceTransport((t) => {
    t.connect = async () => {
      throw new Error("Permission denied");
    };
  });
  render(<App voiceProvider={fake.provider} />);
  await connectVoiceFromAssistant(userEvent.setup());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Microphone permission denied. Allow microphone access and try again.",
  );
});

it("maps API 401 to an auth-expired tool failure", async () => {
  const api = installFakeApi(configured);
  const fake = fakeVoiceTransport();
  render(<App voiceProvider={fake.provider} />);
  await connectVoiceFromAssistant(userEvent.setup());
  await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
  api.loggedIn = false;
  await expect(fake.transports[0]!.call("search_tasks", { query: "milk" })).rejects.toMatchObject({
    authExpired: true,
  });
});

it("locks immediately on a lapsed session but keeps the session until the agent finishes speaking", async () => {
  const { AuthGate } = await import("./AuthGate");
  const api = installFakeApi(configured);
  const fake = fakeVoiceTransport();
  render(<AuthGate voiceProvider={fake.provider} />);
  await connectVoiceFromAssistant(userEvent.setup());
  await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
  api.loggedIn = false;
  await act(async () => {
    await expect(fake.transports[0]!.call("search_tasks", { query: "milk" })).rejects.toMatchObject(
      { authExpired: true },
    );
  });
  expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  expect(fake.transports[0]!.connected).toBe(true);
  act(() => fake.transports[0]!.events.onAgent({ ...agent, endReason: "session_lapsed" }));
  await waitFor(() => expect(fake.transports[0]!.connected).toBe(false));
});

it("reconnects explicitly without capture and keeps captions despite stale events", async () => {
  installFakeApi(configured);
  const fake = fakeVoiceTransport();
  const user = userEvent.setup();
  render(<App voiceProvider={fake.provider} />);
  await connectVoiceFromAssistant(user);
  const old = fake.transports[0]!;
  await act(async () => {
    old.events.onAgent(agent);
    old.events.onUtterance(
      (async function* () {
        yield "Hello";
      })(),
    );
  });
  expect(screen.getByLabelText("Captions")).toHaveTextContent("Hello");
  act(() => old.events.onDisconnected());
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  await waitFor(() => expect(fake.transports).toHaveLength(2));
  expect(fake.transports[1]!.turns).toEqual([]);
  act(() => old.events.onAgent({ ...agent, speaking: true }));
  expect(screen.getByLabelText("Captions")).toHaveTextContent("Hello");
  expect(screen.queryByText("Speaking")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "End session" }));
  expect(screen.queryByLabelText("Captions")).not.toBeInTheDocument();
});

it("retries microphone permission from the overlay without resuming capture", async () => {
  installFakeApi({ ...configured, assistantAvailable: true });
  const fake = fakeVoiceTransport((t) => {
    t.startTurn = async () => {
      throw new Error("Permission denied");
    };
  });
  const user = userEvent.setup();
  render(<App voiceProvider={fake.provider} />);
  await user.click(await screen.findByRole("button", { name: "Open voice overlay" }));
  await user.click(screen.getByRole("button", { name: "Press to connect" }));
  await screen.findByRole("button", { name: "Hold to talk" });
  await user.keyboard("{Tab}");
  const hold = screen.getByRole("button", { name: "Hold to talk" });
  hold.focus();
  await user.keyboard("{Enter>}");
  expect(await screen.findByRole("alert")).toHaveTextContent("Microphone permission denied");
  await user.keyboard("{/Enter}");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(fake.transports).toHaveLength(2));
  expect(fake.transports[1]!.turns).toEqual([]);
});
