import {
  ConnectionError,
  ConnectionErrorReason,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from "livekit-client";

import { localDayOf } from "../dates";
import { onUnauthorized, postVoiceSession } from "../api";
import { registerVoiceReads } from "./rpc";
import { currentMonth, notifyVoiceConfigChanged, VOICE_EXHAUSTED_KEY } from "../useVoiceAvailable";

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
  let lapsed = false;
  let lapsedTimer: number | undefined;
  const stopWatchingAuth = onUnauthorized(() => {
    lapsed = true;
  });
  const factory = options.createRoom ?? (() => new Room());
  const end = (message?: string) => {
    if (ended) return;
    ended = true;
    stopWatchingAuth();
    window.clearTimeout(lapsedTimer);
    window.removeEventListener("pagehide", leave);
    if (room) {
      room.unregisterTextStreamHandler("lk.transcription");
      for (const name of methods) room.unregisterRpcMethod(name);
      room.off(RoomEvent.Disconnected, disconnected);
      room.off(RoomEvent.TrackSubscribed, subscribed);
      room.off(RoomEvent.TrackUnsubscribed, unsubscribed);
      for (const track of audioTracks) unsubscribed(track);
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
      window.addEventListener("pagehide", leave);
      options.onState("connecting");
      try {
        const { url, token } = await postVoiceSession();
        if (ended) return;
        room = factory();
        room.on(RoomEvent.Disconnected, disconnected);
        room.on(RoomEvent.TrackSubscribed, subscribed);
        room.on(RoomEvent.TrackUnsubscribed, unsubscribed);
        room.registerTextStreamHandler("lk.transcription", (reader) => {
          void (async () => {
            let text = "";
            const previous = caption;
            for await (const chunk of reader) {
              if (ended) break;
              text += chunk;
              caption = previous ? `${previous} ${text}` : text;
              options.onCaption(caption);
            }
          })().catch(() => undefined);
        });
        methods = registerVoiceReads(room, options.refresh);
        await room.connect(url, token);
        if (ended) {
          await room.disconnect();
          return;
        }
        await room.localParticipant.setAttributes({
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          date: localDayOf(new Date()),
        });
        await room.localParticipant.setMicrophoneEnabled(true);
        if (ended) return;
        options.onState("listening");
        const checkVersion = () => {
          const participant = [...room!.remoteParticipants.values()].find(
            (p) => p.attributes.contract_version !== undefined,
          );
          if (participant?.attributes.voice_end_reason === "quota_exhausted") {
            try {
              localStorage.setItem(VOICE_EXHAUSTED_KEY, currentMonth());
            } catch {
              /* storage may be unavailable */
            }
            end();
            notifyVoiceConfigChanged();
          } else if (participant?.attributes.voice_end_reason === "session_lapsed") {
            end();
          } else if (participant && participant.attributes.contract_version !== "1") {
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
          error instanceof ConnectionError && error.reason === ConnectionErrorReason.NotAllowed
            ? "LiveKit credentials are invalid. Check voice settings."
            : error instanceof ConnectionError
              ? "LiveKit is unreachable. Check your connection and try again."
              : error instanceof Error && /permission|denied|notallowed/i.test(error.message)
                ? "Microphone permission denied. Allow microphone access and try again."
                : error instanceof Error
                  ? error.message
                  : "Could not start voice session.";
        end(message);
      }
    },
    async stop() {
      if (ended) return;
      end();
    },
    dispose() {
      if (!ended && lapsed && room) {
        options.onState = () => undefined;
        options.onCaption = () => undefined;
        options.onError = () => undefined;
        lapsedTimer = window.setTimeout(() => end(), 10000);
        return;
      }
      if (!ended) {
        if (room) void room.disconnect();
        end();
      }
    },
  };
}
