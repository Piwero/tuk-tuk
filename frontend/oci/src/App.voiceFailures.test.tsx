import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";
import { fakeVoiceTransport } from "./test/fakeVoiceTransport";

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

it("hides exhausted voice until the next local month without a reload", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 50));
  installFakeApi(configured);
  const fake = fakeVoiceTransport();
  render(<App voiceTransport={fake.factory} />);
  await userEvent
    .setup({ advanceTimers: vi.advanceTimersByTime })
    .click(await screen.findByRole("button", { name: "Start voice assistant" }));
  await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
  act(() => fake.transports[0]!.events.onAgent({ ...agent, endReason: "quota_exhausted" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /voice assistant/i })).not.toBeInTheDocument(),
  );
  expect(localStorage.getItem("tuktuk.voice.exhaustedMonth")).toBe("2026-07");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10001);
  });
  expect(await screen.findByRole("button", { name: "Start voice assistant" })).toBeInTheDocument();
});

it("shows a connection failure to the owner", async () => {
  installFakeApi(configured);
  const fake = fakeVoiceTransport((t) => {
    t.connect = async () => {
      throw new Error("Provider is unreachable.");
    };
  });
  render(<App voiceTransport={fake.factory} />);
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Start voice assistant" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Provider is unreachable.");
});

it("shows a microphone refusal distinctly", async () => {
  installFakeApi(configured);
  const fake = fakeVoiceTransport((t) => {
    t.connect = async () => {
      throw new Error("Permission denied");
    };
  });
  render(<App voiceTransport={fake.factory} />);
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Start voice assistant" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Microphone permission denied. Allow microphone access and try again.",
  );
});

it("maps API 401 to an auth-expired tool failure", async () => {
  const api = installFakeApi(configured);
  const fake = fakeVoiceTransport();
  render(<App voiceTransport={fake.factory} />);
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Start voice assistant" }));
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
  render(<AuthGate voiceTransport={fake.factory} />);
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Start voice assistant" }));
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
