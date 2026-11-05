import {
  ConnectionError,
  ConnectionErrorReason,
  Room,
  RoomEvent,
  RpcError,
  Track,
  type RemoteTrack,
} from "livekit-client";

import { postVoiceSession } from "../api";
import { registerVoiceReads } from "./rpc";
import {
  OUT_OF_DATE,
  type VoiceEndReason,
  type VoiceProvider,
  type VoiceTransportFactory,
} from "./session";

export type VoiceRoom = Pick<
  Room,
  | "connect"
  | "disconnect"
  | "localParticipant"
  | "remoteParticipants"
  | "on"
  | "off"
  | "registerTextStreamHandler"
  | "unregisterTextStreamHandler"
  | "registerRpcMethod"
  | "unregisterRpcMethod"
>;
export type RoomFactory = () => VoiceRoom;

/** localStorage key holding the `YYYY-MM` in which LiveKit's free inference credit ran out. */
const EXHAUSTED_KEY = "tuktuk.voice.exhaustedMonth";

const monthOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

// ponytail: Build plan has no balance API; switch to a pre-check if one appears.
// The per-browser marker only learns about the account-wide quota on failure.
function markExhausted(): void {
  try {
    localStorage.setItem(EXHAUSTED_KEY, monthOf(new Date()));
  } catch {
    /* storage may be unavailable */
  }
}

/** The first of next month while this month's marker is set; a stale marker is forgotten. */
function exhaustedUntil(): Date | undefined {
  try {
    const now = new Date();
    if (localStorage.getItem(EXHAUSTED_KEY) === monthOf(now)) {
      return new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }
    localStorage.removeItem(EXHAUSTED_KEY);
  } catch {
    /* storage may be unavailable */
  }
  return undefined;
}

/** The LiveKit transport (ADR 0015): the backend mints the room token, tools are RPC methods on
 * the room, captions arrive on `lk.transcription`, and the agent publishes its state, contract
 * version and end reason as participant attributes. */
export const livekitTransport =
  (createRoom: RoomFactory = () => new Room()): VoiceTransportFactory =>
  ({ tools, events }) => {
    let room: VoiceRoom | undefined;
    let closed = false;
    let continuous = false;
    let methods: string[] = [];
    const audioTracks = new Set<RemoteTrack>();
    const unsubscribed = (track: RemoteTrack) => {
      if (!audioTracks.delete(track)) return;
      for (const element of track.detach()) element.remove();
    };
    const subscribed = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      audioTracks.add(track);
      document.body.appendChild(track.attach());
    };
    const agentChanged = () => {
      const participant = [...room!.remoteParticipants.values()][0];
      const reason = participant?.attributes.voice_end_reason;
      if (reason === "quota_exhausted") markExhausted();
      events.onAgent(
        participant && {
          speaking: participant.attributes["lk.agent.state"] === "speaking",
          thinking: participant.attributes["lk.agent.state"] === "thinking",
          contractVersion: participant.attributes.contract_version,
          endReason:
            reason === "quota_exhausted" ? "unavailable" : (reason as VoiceEndReason | undefined),
        },
      );
    };
    const disconnected = () => events.onDisconnected();
    const disconnect = async () => {
      if (closed) return;
      closed = true;
      if (!room) return;
      room.unregisterTextStreamHandler("lk.transcription");
      for (const name of methods) room.unregisterRpcMethod(name);
      room.off(RoomEvent.Disconnected, disconnected);
      room.off(RoomEvent.TrackSubscribed, subscribed);
      room.off(RoomEvent.TrackUnsubscribed, unsubscribed);
      room.off(RoomEvent.ParticipantConnected, agentChanged);
      room.off(RoomEvent.ParticipantAttributesChanged, agentChanged);
      for (const track of audioTracks) unsubscribed(track);
      await room.disconnect();
    };
    // Turn control is the browser telling the agent when the owner starts, ends or abandons a
    // spoken turn (ADR 0015 amendment, issue #395). These RPCs are not roster tools.
    const turn = async (method: "start_turn" | "end_turn" | "cancel_turn") => {
      const identity = room && [...room.remoteParticipants.keys()][0];
      if (!room || closed) return;
      if (!identity) throw new Error("Voice agent is still joining. Try again in a moment.");
      const local = room.localParticipant;
      const starting = method === "start_turn";
      // Speech must be flushed before the agent hears the turn end, so the mic closes first.
      if (!starting) await local.setMicrophoneEnabled(false);
      if (closed) return;
      let ready = false;
      try {
        await local.performRpc({ destinationIdentity: identity, method, payload: "" });
        ready = starting;
        if (starting && !closed) {
          await local.setMicrophoneEnabled(true);
          if (closed) await local.setMicrophoneEnabled(false);
        }
      } catch (error) {
        if (starting) {
          await local.setMicrophoneEnabled(false);
          if (ready && !closed) {
            await local
              .performRpc({ destinationIdentity: identity, method: "cancel_turn", payload: "" })
              .catch(() => undefined);
          }
        }
        throw error instanceof RpcError && error.code === RpcError.ErrorCode.UNSUPPORTED_METHOD
          ? new Error(OUT_OF_DATE)
          : error;
      }
    };
    const conversation = async (starting: boolean) => {
      const identity = room && [...room.remoteParticipants.keys()][0];
      if (!room || closed) return;
      if (!identity) throw new Error("Voice agent is still joining. Try again in a moment.");
      const local = room.localParticipant;
      continuous = starting;
      if (!starting) await local.setMicrophoneEnabled(false);
      try {
        await local.performRpc({
          destinationIdentity: identity,
          method: starting ? "start_conversation" : "stop_conversation",
          payload: "",
        });
        if (starting && continuous && !closed) {
          await local.setMicrophoneEnabled(true);
          if (!continuous || closed) await local.setMicrophoneEnabled(false);
        }
      } catch (error) {
        if (starting) await local.setMicrophoneEnabled(false);
        throw error instanceof RpcError && error.code === RpcError.ErrorCode.UNSUPPORTED_METHOD
          ? new Error(OUT_OF_DATE)
          : error;
      }
    };
    return {
      disconnect,
      startConversation: () => conversation(true),
      stopConversation: () => conversation(false),
      startTurn: () => turn("start_turn"),
      endTurn: () => turn("end_turn"),
      cancelTurn: () => turn("cancel_turn"),
      async connect(clock) {
        try {
          const { url, token } = await postVoiceSession();
          if (closed) return;
          const joined = (room = createRoom());
          joined.on(RoomEvent.Disconnected, disconnected);
          joined.on(RoomEvent.TrackSubscribed, subscribed);
          joined.on(RoomEvent.TrackUnsubscribed, unsubscribed);
          joined.registerTextStreamHandler("lk.transcription", (reader) =>
            events.onUtterance(reader),
          );
          methods = registerVoiceReads(joined, tools);
          await joined.connect(url, token);
          if (closed) return void (await joined.disconnect());
          await joined.localParticipant.setAttributes({ tz: clock.timeZone, date: clock.date });
          if (closed) return;
          if (closed) return void (await joined.disconnect());
          joined.on(RoomEvent.ParticipantConnected, agentChanged);
          joined.on(RoomEvent.ParticipantAttributesChanged, agentChanged);
          agentChanged();
        } catch (error) {
          throw error instanceof ConnectionError
            ? new Error(
                error.reason === ConnectionErrorReason.NotAllowed
                  ? "LiveKit credentials are invalid. Check voice settings."
                  : "LiveKit is unreachable. Check your connection and try again.",
              )
            : error;
        }
      },
    };
  };

export const livekitProvider: VoiceProvider = {
  transport: livekitTransport(),
  unavailableUntil: exhaustedUntil,
};
