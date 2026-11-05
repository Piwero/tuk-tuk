import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { RoomEvent } from "livekit-client";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";
import { FakeRoom } from "./test/fakeRoom";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("hides exhausted voice until the next local month without a reload", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 50));
  installFakeApi({
    voiceLivekitUrl: "wss://test.livekit.cloud",
    voiceLivekitApiKey: "key",
    voiceSecretSet: true,
  });
  const room = new FakeRoom();
  render(<App voiceRoomFactory={(() => room) as never} />);
  await userEvent
    .setup({ advanceTimers: vi.advanceTimersByTime })
    .click(await screen.findByRole("button", { name: "Start voice assistant" }));
  await waitFor(() => expect(room.connected).toBe(true));
  room.remoteParticipants.set("agent", {
    attributes: { contract_version: "1", voice_end_reason: "quota_exhausted" },
  });
  act(() => room.handlers.get(RoomEvent.ParticipantAttributesChanged)?.());
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /voice assistant/i })).not.toBeInTheDocument(),
  );
  expect(localStorage.getItem("tuktuk.voice.exhaustedMonth")).toBe("2026-07");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10001);
  });
  expect(await screen.findByRole("button", { name: "Start voice assistant" })).toBeInTheDocument();
});
