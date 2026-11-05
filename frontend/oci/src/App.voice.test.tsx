import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";
import { FakeRoom } from "./test/fakeRoom";
import { createVoiceSession } from "./voice/session";

const rooms: FakeRoom[] = [];
const createRoom = () => {
  const room = new FakeRoom();
  rooms.push(room);
  return room;
};
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  rooms.length = 0;
});

describe("Voice Assistant session", () => {
  it("requests mic only on start, sets local clock, registers reads, and disconnects", async () => {
    installFakeApi({
      voiceLivekitUrl: "wss://test.livekit.cloud",
      voiceLivekitApiKey: "key",
      voiceSecretSet: true,
    });
    render(<App voiceRoomFactory={createRoom as never} />);
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Start voice assistant" }));
    await waitFor(() => expect(rooms[0]?.connected).toBe(true));
    expect(rooms[0]?.methods.size).toBe(3);
    expect(screen.getByRole("button", { name: "End voice assistant" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "End voice assistant" }));
    await waitFor(() => expect(rooms[0]?.connected).toBe(false));
  });

  it("ends when agent contract differs", async () => {
    const states: string[] = [];
    const errors: string[] = [];
    const room = new FakeRoom();
    vi.spyOn(await import("./api"), "postVoiceSession").mockResolvedValue({
      url: "wss://test",
      token: "token",
      room: "room",
    });
    const session = createVoiceSession({
      createRoom: () => room as never,
      onState: (state) => states.push(state),
      onCaption: () => undefined,
      onError: (error) => errors.push(error),
    });
    await session.start();
    room.remoteParticipants.set("agent", { attributes: { contract_version: "2" } });
    room.handlers.get("participantConnected")?.();
    expect(states).toContain("ended");
    expect(errors).toContain("Voice agent out of date — redeploy");
  });
});
