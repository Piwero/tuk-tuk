import { ConnectionError, RoomEvent, RpcError } from "livekit-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";

import { FakeRoom } from "../test/fakeRoom";
import { livekitProvider, livekitTransport } from "./livekit";
import { createVoiceTools } from "./tools";
import type { VoiceAgent, VoiceTransportEvents } from "./session";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const clock = { timeZone: "UTC", date: "2026-07-03" };

function setup(configure?: (room: FakeRoom) => void) {
  vi.spyOn(api, "postVoiceSession").mockResolvedValue({ url: "wss://x", token: "t", room: "r" });
  const room = new FakeRoom();
  configure?.(room);
  const agents: (VoiceAgent | undefined)[] = [];
  const utterances: AsyncIterable<string>[] = [];
  let disconnected = 0;
  const events: VoiceTransportEvents = {
    onAgent: (a) => agents.push(a),
    onUtterance: (u) => utterances.push(u),
    onDisconnected: () => disconnected++,
  };
  const transport = livekitTransport(() => room as never)({
    tools: createVoiceTools(),
    events,
  });
  return { room, transport, agents, utterances, disconnected: () => disconnected };
}

describe("LiveKit transport", () => {
  it("joins with the minted token, publishes the clock, leaves the mic off, exposes tools as RPC", async () => {
    const attributes = vi.fn(async () => undefined);
    const mic = vi.fn(async () => undefined);
    const connect = vi.fn(async () => undefined);
    const { room, transport } = setup((r) => {
      r.localParticipant.setAttributes = attributes;
      r.localParticipant.setMicrophoneEnabled = mic;
      r.connect = connect;
    });
    await transport.connect(clock);
    expect(connect).toHaveBeenCalledWith("wss://x", "t");
    expect(attributes).toHaveBeenCalledWith({ tz: "UTC", date: "2026-07-03" });
    expect(mic).not.toHaveBeenCalled();
    expect(room.methods.size).toBe(12);
    await transport.disconnect();
    expect(room.methods.size).toBe(0);
    expect(room.connected).toBe(false);
  });

  it("opens the mic only while a turn is held, telling the agent when it starts and ends", async () => {
    const calls: string[] = [];
    const { room, transport } = setup((r) => {
      r.localParticipant.setMicrophoneEnabled = async (on?: boolean) =>
        void calls.push(`mic:${on}`);
      r.localParticipant.performRpc = async (request) => {
        calls.push(`rpc:${request?.destinationIdentity}:${request?.method}`);
        return "";
      };
    });
    await transport.connect(clock);
    room.remoteParticipants.set("agent-1", { attributes: {} });
    await transport.startTurn();
    await transport.endTurn();
    await transport.startTurn();
    await transport.cancelTurn();
    expect(calls).toEqual([
      "rpc:agent-1:start_turn",
      "mic:true",
      "mic:false",
      "rpc:agent-1:end_turn",
      "rpc:agent-1:start_turn",
      "mic:true",
      "mic:false",
      "rpc:agent-1:cancel_turn",
    ]);
  });

  it("starts and stops continuous conversation using the same room", async () => {
    const { transport, room } = setup();
    const mic = vi.spyOn(room.localParticipant, "setMicrophoneEnabled");
    const rpc = vi.spyOn(room.localParticipant, "performRpc");
    await transport.connect(clock);
    room.remoteParticipants.set("agent", { attributes: {} });
    await transport.startConversation();
    await transport.stopConversation();
    expect(mic.mock.calls.map(([enabled]) => enabled)).toEqual([true, false]);
    expect(rpc.mock.calls.map(([request]) => request.method)).toEqual([
      "start_conversation",
      "stop_conversation",
    ]);
  });

  it("refuses a turn while no agent has joined, leaving the mic off", async () => {
    const mic = vi.fn(async () => undefined);
    const { transport } = setup((r) => (r.localParticipant.setMicrophoneEnabled = mic));
    await transport.connect(clock);
    await expect(transport.startTurn()).rejects.toThrow(/still joining/i);
    expect(mic).not.toHaveBeenCalled();
  });

  it("mutes again and reports an out-of-date agent that lacks turn control", async () => {
    const calls: string[] = [];
    const { room, transport } = setup((r) => {
      r.localParticipant.setMicrophoneEnabled = async (on?: boolean) =>
        void calls.push(`mic:${on}`);
      r.localParticipant.performRpc = async () => {
        throw new RpcError(RpcError.ErrorCode.UNSUPPORTED_METHOD, "nope");
      };
    });
    await transport.connect(clock);
    room.remoteParticipants.set("agent", { attributes: {} });
    await expect(transport.startTurn()).rejects.toThrow("Voice agent out of date — redeploy");
    expect(calls).toEqual(["mic:false"]);
  });

  it("translates participant attributes into agent state", async () => {
    const { room, transport, agents } = setup();
    await transport.connect(clock);
    expect(agents.at(-1)).toBeUndefined();
    room.remoteParticipants.set("agent", {
      attributes: {
        contract_version: "1",
        "lk.agent.state": "speaking",
        voice_end_reason: "quota_exhausted",
      },
    });
    room.handlers.get(RoomEvent.ParticipantAttributesChanged)?.();
    room.handlers.get(RoomEvent.ParticipantConnected)?.();
    expect(agents.at(-1)).toEqual({
      speaking: true,
      thinking: false,
      contractVersion: "1",
      endReason: "unavailable",
    });
    expect(localStorage.getItem("tuktuk.voice.exhaustedMonth")).toMatch(/^\d{4}-\d{2}$/);
    expect(livekitProvider.unavailableUntil()).toBeInstanceOf(Date);
    room.remoteParticipants.set("agent", { attributes: { "lk.agent.state": "thinking" } });
    room.handlers.get(RoomEvent.ParticipantAttributesChanged)?.();
    expect(agents.at(-1)).toMatchObject({ speaking: false, thinking: true });
    room.remoteParticipants.set("agent", { attributes: {} });
    room.handlers.get(RoomEvent.ParticipantAttributesChanged)?.();
    expect(agents.at(-1)).toEqual({
      speaking: false,
      thinking: false,
      contractVersion: undefined,
      endReason: undefined,
    });
  });

  it("passes the transcription stream through and reports room disconnects", async () => {
    const { room, transport, utterances, disconnected } = setup();
    await transport.connect(clock);
    const stream = (async function* () {})();
    room.handlers.get("lk.transcription")?.(stream as never);
    expect(utterances).toEqual([stream]);
    room.handlers.get(RoomEvent.Disconnected)?.();
    expect(disconnected()).toBe(1);
  });

  it("plays agent audio and detaches it on disconnect", async () => {
    const { room, transport } = setup();
    await transport.connect(clock);
    const audio = document.createElement("audio");
    const track = { kind: "audio", attach: () => audio, detach: () => [audio] };
    room.handlers.get(RoomEvent.TrackSubscribed)?.(track as never);
    expect(document.body.contains(audio)).toBe(true);
    await transport.disconnect();
    expect(document.body.contains(audio)).toBe(false);
  });

  it("ignores non-audio tracks", async () => {
    const { room, transport } = setup();
    await transport.connect(clock);
    const attach = vi.fn();
    room.handlers.get(RoomEvent.TrackSubscribed)?.({ kind: "video", attach } as never);
    expect(attach).not.toHaveBeenCalled();
  });

  it.each([
    [
      ConnectionError.notAllowed("unauthorized", 401),
      "LiveKit credentials are invalid. Check voice settings.",
    ],
    [
      ConnectionError.serverUnreachable("network"),
      "LiveKit is unreachable. Check your connection and try again.",
    ],
  ])("translates connection errors", async (error, message) => {
    const { transport } = setup((r) => {
      r.connect = async () => {
        throw error;
      };
    });
    await expect(transport.connect(clock)).rejects.toThrow(message);
  });

  it("lets a microphone refusal through when the owner first holds to talk", async () => {
    const { room, transport } = setup((r) => {
      r.localParticipant.setMicrophoneEnabled = async () => {
        throw new Error("Permission denied");
      };
    });
    await transport.connect(clock);
    room.remoteParticipants.set("agent", { attributes: {} });
    await expect(transport.startTurn()).rejects.toThrow("Permission denied");
  });

  it("disconnects the room when stopped while connect is pending", async () => {
    let finish!: () => void;
    const { room, transport } = setup((r) => {
      r.connect = () =>
        new Promise<void>((resolve) => {
          finish = () => {
            r.connected = true;
            resolve();
          };
        });
    });
    const connecting = transport.connect(clock);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await transport.disconnect();
    finish();
    await connecting;
    expect(room.connected).toBe(false);
  });

  it("disconnects the room when stopped during delayed attribute setup", async () => {
    let finish!: () => void;
    const { room, transport } = setup((r) => {
      r.localParticipant.setAttributes = () =>
        new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        });
    });
    const connecting = transport.connect(clock);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await transport.disconnect();
    finish();
    await connecting;
    expect(room.connected).toBe(false);
  });

  it("never joins a room if stopped while the session token is pending", async () => {
    const { room, transport } = setup();
    vi.spyOn(api, "postVoiceSession").mockImplementation(async () => {
      await transport.disconnect();
      return { url: "wss://x", token: "t", room: "r" };
    });
    await transport.connect(clock);
    expect(room.connected).toBe(false);
    expect(room.methods.size).toBe(0);
  });
});

describe("LiveKit quota marker", () => {
  it("is unavailable until the first of next month and forgets stale months", () => {
    expect(livekitProvider.unavailableUntil()).toBeUndefined();
    localStorage.setItem("tuktuk.voice.exhaustedMonth", "2000-01");
    expect(livekitProvider.unavailableUntil()).toBeUndefined();
    expect(localStorage.getItem("tuktuk.voice.exhaustedMonth")).toBeNull();
    const now = new Date();
    localStorage.setItem(
      "tuktuk.voice.exhaustedMonth",
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    );
    expect(livekitProvider.unavailableUntil()).toEqual(
      new Date(now.getFullYear(), now.getMonth() + 1, 1),
    );
  });
});
