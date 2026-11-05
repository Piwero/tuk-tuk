import { Room, RoomEvent } from "livekit-client";

import { localDayOf } from "../dates";
import { postVoiceSession } from "../api";
import { registerVoiceReads } from "./rpc";

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "ended";
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
export interface VoiceSessionOptions {
  createRoom?: RoomFactory;
  onState(state: VoiceState): void;
  onCaption(text: string): void;
  onError(message: string): void;
  refresh?: () => void;
}

export function createVoiceSession(options: VoiceSessionOptions) {
  let room: VoiceRoom | undefined;
  let ended = false;
  let started = false;
  let caption = "";
  const factory = options.createRoom ?? (() => new Room());
  const end = (message?: string) => {
    if (ended) return;
    ended = true;
    window.removeEventListener("pagehide", leave);
    if (room) {
      room.unregisterTextStreamHandler("lk.transcription");
      for (const name of ["get_agenda", "search_tasks", "get_task"]) room.unregisterRpcMethod(name);
      room.off(RoomEvent.Disconnected, disconnected);
      void room.disconnect();
    }
    caption = "";
    options.onCaption("");
    options.onState("ended");
    if (message) options.onError(message);
  };
  const leave = () => end();
  const disconnected = () => end();
  return {
    async start() {
      if (started || ended) return;
      started = true;
      options.onState("connecting");
      try {
        const { url, token } = await postVoiceSession();
        if (ended) return;
        room = factory();
        room.on(RoomEvent.Disconnected, disconnected);
        room.registerTextStreamHandler("lk.transcription", (reader) => {
          void reader
            .readAll()
            .then((text) => {
              if (ended) return;
              caption = caption ? `${caption} ${text}` : text;
              options.onCaption(caption);
            })
            .catch(() => undefined);
        });
        registerVoiceReads(room, options.refresh);
        await room.connect(url, token);
        if (ended) return;
        await room.localParticipant.setAttributes({
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          date: localDayOf(new Date()),
        });
        await room.localParticipant.setMicrophoneEnabled(true);
        window.addEventListener("pagehide", leave);
        options.onState("listening");
        const checkVersion = () => {
          const participant = [...room!.remoteParticipants.values()].find(
            (p) => p.attributes.contract_version !== undefined,
          );
          if (participant && participant.attributes.contract_version !== "1") {
            end("Voice agent out of date — redeploy");
          } else if (participant?.attributes["lk.agent.state"] === "speaking") {
            options.onState("speaking");
          } else if (participant && !ended) {
            options.onState("listening");
          }
        };
        room.on(RoomEvent.ParticipantConnected, checkVersion);
        room.on(RoomEvent.ParticipantAttributesChanged, checkVersion);
        checkVersion();
      } catch (error) {
        const message =
          error instanceof Error && /permission|denied|notallowed/i.test(error.message)
            ? "Microphone permission denied. Allow microphone access and try again."
            : error instanceof Error
              ? error.message
              : "Could not start voice session.";
        end(message);
      }
    },
    async stop() {
      if (ended) return;
      if (room) await room.disconnect();
      end();
    },
    dispose() {
      if (!ended) {
        if (room) void room.disconnect();
        end();
      }
    },
  };
}
