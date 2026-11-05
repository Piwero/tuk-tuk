import roster from "../../../../shared/voice-tool-roster.json";
import { localDayOf } from "../dates";
import { onUnauthorized } from "../api";
import { createVoiceTools } from "./tools";
import { notifyVoiceConfigChanged } from "../useVoiceAvailable";

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "ended";

/** What a transport reports about the remote agent. `contractVersion` is absent until the agent
 * has published one; `endReason` is set when the agent is ending the session: `unavailable` means
 * the provider can no longer serve voice (the provider records why and says until when). */
export interface VoiceAgent {
  speaking: boolean;
  contractVersion?: string;
  endReason?: string;
}

/** What a transport tells the session. A transport owns audio playback and the microphone. */
export interface VoiceTransportEvents {
  /** The agent started speaking a caption; its text arrives in chunks. */
  onUtterance(chunks: AsyncIterable<string>): void;
  /** The agent joined or changed; `undefined` while none has joined. */
  onAgent(agent: VoiceAgent | undefined): void;
  onDisconnected(): void;
}

export interface VoiceTransportContext {
  /** The browser-side tools the transport exposes to the agent. */
  tools: ReturnType<typeof createVoiceTools>;
  events: VoiceTransportEvents;
}

/** One provider's way to carry a voice session. `connect` resolves once the microphone is live
 * and the agent can be heard; `disconnect` is safe at any point, including while `connect` is
 * pending, and leaves nothing behind. Errors thrown by `connect` are shown to the owner as-is. */
export interface VoiceTransport {
  connect(clock: { timeZone: string; date: string }): Promise<void>;
  disconnect(): Promise<void>;
}
export type VoiceTransportFactory = (context: VoiceTransportContext) => VoiceTransport;

/** A voice provider: its transport, and when it is available again if it has reported itself
 * unavailable (`undefined` while available). Availability is the provider's own business. */
export interface VoiceProvider {
  transport: VoiceTransportFactory;
  unavailableUntil(): Date | undefined;
}

export interface VoiceSessionOptions {
  createTransport: VoiceTransportFactory;
  onState(state: VoiceState): void;
  onCaption(text: string): void;
  onError(message: string): void;
  refresh?: () => void;
}

export function createVoiceSession(options: VoiceSessionOptions) {
  let transport: VoiceTransport | undefined;
  let ended = false;
  let started = false;
  let state: VoiceState = "idle";
  let caption = "";
  const setState = (next: VoiceState) => {
    state = next;
    options.onState(next);
  };
  let lapsed = false;
  let lapsedTimer: number | undefined;
  let versionTimer: number | undefined;
  const stopWatchingAuth = onUnauthorized(() => {
    lapsed = true;
  });
  const end = (message?: string) => {
    if (ended) return;
    ended = true;
    stopWatchingAuth();
    window.clearTimeout(lapsedTimer);
    window.clearTimeout(versionTimer);
    window.removeEventListener("pagehide", leave);
    void transport?.disconnect();
    caption = "";
    options.onCaption("");
    setState("ended");
    if (message) options.onError(message);
  };
  const leave = () => end();
  const outOfDate = () => end("Voice agent out of date — redeploy");
  const events: VoiceTransportEvents = {
    onUtterance(chunks) {
      void (async () => {
        let text = "";
        const previous = caption;
        for await (const chunk of chunks) {
          if (ended) break;
          text += chunk;
          caption = previous ? `${previous} ${text}` : text;
          options.onCaption(caption);
        }
      })().catch(() => undefined);
    },
    onAgent(agent) {
      if (ended) return;
      if (agent && agent.contractVersion === undefined) {
        versionTimer ??= window.setTimeout(outOfDate, 5000);
      } else {
        window.clearTimeout(versionTimer);
        versionTimer = undefined;
      }
      if (agent?.endReason === "unavailable") {
        end();
        notifyVoiceConfigChanged();
      } else if (agent?.endReason === "session_lapsed") {
        end();
      } else if (
        agent?.contractVersion !== undefined &&
        agent.contractVersion !== String(roster.contract_version)
      ) {
        outOfDate();
      } else if (agent?.speaking) {
        setState("speaking");
      } else if (agent) {
        setState("listening");
      }
    },
    onDisconnected: () => end(),
  };
  return {
    async start() {
      if (started || ended) return;
      started = true;
      window.addEventListener("pagehide", leave);
      setState("connecting");
      try {
        transport = options.createTransport({ tools: createVoiceTools(options.refresh), events });
        await transport.connect({
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          date: localDayOf(new Date()),
        });
        if (!ended && state === "connecting") setState("listening");
      } catch (error) {
        end(
          error instanceof Error && /permission|denied|notallowed/i.test(error.message)
            ? "Microphone permission denied. Allow microphone access and try again."
            : error instanceof Error
              ? error.message
              : "Could not start voice session.",
        );
      }
    },
    async stop() {
      if (ended) return;
      end();
    },
    dispose() {
      if (!ended && lapsed && transport) {
        options.onState = () => undefined;
        options.onCaption = () => undefined;
        options.onError = () => undefined;
        lapsedTimer = window.setTimeout(() => end(), 10000);
        return;
      }
      end();
    },
  };
}
