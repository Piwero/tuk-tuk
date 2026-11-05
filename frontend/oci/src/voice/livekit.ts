import {
  ConnectionError,
  ConnectionErrorReason,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from "livekit-client";

import { postVoiceSession } from "../api";
import { registerVoiceReads } from "./rpc";
import type { VoiceTransportFactory } from "./session";

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

/** The LiveKit transport (ADR 0015): the backend mints the room token, tools are RPC methods on
 * the room, captions arrive on `lk.transcription`, and the agent publishes its state, contract
 * version and end reason as participant attributes. */
export const livekitTransport =
  (createRoom: RoomFactory = () => new Room()): VoiceTransportFactory =>
  ({ tools, events }) => {
    let room: VoiceRoom | undefined;
    let closed = false;
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
      events.onAgent(
        participant && {
          speaking: participant.attributes["lk.agent.state"] === "speaking",
          contractVersion: participant.attributes.contract_version,
          endReason: participant.attributes.voice_end_reason,
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
    return {
      disconnect,
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
          await joined.localParticipant.setMicrophoneEnabled(true);
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
