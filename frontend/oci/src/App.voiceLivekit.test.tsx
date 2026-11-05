import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoomEvent } from "livekit-client";
import { afterEach, expect, it, vi } from "vitest";

import { App } from "./App";
import { FakeRoom } from "./test/fakeRoom";
import { installFakeApi } from "./test/fakeApi";
import { livekitProvider, livekitTransport } from "./voice/livekit";

// End to end through App, the session and the real LiveKit adapter, with only the room faked:
// what the owner sees for each LiveKit-side event.
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const configured = {
  voiceLivekitUrl: "wss://test.livekit.cloud",
  voiceLivekitApiKey: "key",
  voiceSecretSet: true,
};

async function start(options: Parameters<typeof installFakeApi>[0] = configured) {
  const api = installFakeApi(options);
  const room = new FakeRoom();
  render(
    <App
      voiceProvider={{ ...livekitProvider, transport: livekitTransport(() => room as never) }}
    />,
  );
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Start voice assistant" }));
  await waitFor(() => expect(room.connected).toBe(true));
  const agent = (attributes: Record<string, string>) =>
    act(() => {
      room.remoteParticipants.set("agent", { attributes });
      room.handlers.get(RoomEvent.ParticipantAttributesChanged)?.();
    });
  const rpc = (name: string, payload: object) =>
    act(() => room.methods.get(name)!({ payload: JSON.stringify(payload) }) as Promise<unknown>);
  return { api, room, agent, rpc };
}

it("starts a configured session and relays an agent write through the tab's API", async () => {
  const { api, room, agent, rpc } = await start();
  expect(room.methods.size).toBe(12);
  await agent({ contract_version: "1" });
  await rpc("create_task", { title: "buy milk" });
  expect(api.tasks.map((t) => t.title)).toEqual(["buy milk"]);
  expect(await screen.findByRole("button", { name: "Open details for buy milk" })).toBeVisible();
});

it("answers an expired login with the LiveKit auth error code", async () => {
  const { api, rpc } = await start();
  api.loggedIn = false;
  await expect(rpc("search_tasks", { query: "milk" })).rejects.toMatchObject({ code: 2001 });
});

it("ends and hides the mic until next month when the agent reports exhausted credit", async () => {
  const { room, agent } = await start();
  await agent({ contract_version: "1", voice_end_reason: "quota_exhausted" });
  await waitFor(() => expect(room.connected).toBe(false));
  expect(screen.queryByRole("button", { name: /voice assistant/i })).not.toBeInTheDocument();
});

it("ends with a redeploy message when the agent contract differs", async () => {
  const { room, agent } = await start();
  await agent({ contract_version: "99" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Voice agent out of date — redeploy");
  await waitFor(() => expect(room.connected).toBe(false));
});

it("leaves the room and drops its tools when the app unmounts mid-session", async () => {
  installFakeApi(configured);
  const room = new FakeRoom();
  const view = render(
    <App
      voiceProvider={{ ...livekitProvider, transport: livekitTransport(() => room as never) }}
    />,
  );
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Start voice assistant" }));
  await waitFor(() => expect(room.connected).toBe(true));
  view.unmount();
  await waitFor(() => expect(room.connected).toBe(false));
  expect(room.methods.size).toBe(0);
});
