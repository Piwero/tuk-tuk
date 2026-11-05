import roster from "../../../../shared/voice-tool-roster.json";
import { localDayOf } from "../dates";
import { onUnauthorized } from "../api";
import { createVoiceTools } from "./tools";
import { notifyVoiceConfigChanged } from "../useVoiceAvailable";

export type VoiceState =
  "idle" | "connecting" | "listening" | "thinking" | "speaking" | "disconnected" | "ended";

export const OUT_OF_DATE = "Voice agent out of date — redeploy";

/** What a transport reports about the remote agent. `contractVersion` is absent until the agent
 * has published one; `endReason` is set when the agent is ending the session: `unavailable` means
 * the provider can no longer serve voice (the provider records why and says until when). */
export type VoiceEndReason = "unavailable" | "session_lapsed";

export interface VoiceAgent {
  speaking: boolean;
  thinking?: boolean;
  contractVersion?: string;
  endReason?: VoiceEndReason;
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

/** One provider's way to carry a voice session. `connect` resolves once the agent can be reached;
 * it never opens the microphone. `disconnect` is safe at any point, including while `connect` is
 * pending, and leaves nothing behind. Errors thrown by `connect` are shown to the owner as-is.
 *
 * Push-to-talk (ADR 0015): `startTurn` opens the microphone and tells the agent the owner is
 * speaking (which interrupts the agent); `endTurn` closes the microphone and submits the turn;
 * `cancelTurn` closes it and discards what was said. All three are no-ops after `disconnect`. */
export interface VoiceTransport {
  connect(clock: { timeZone: string; date: string }): Promise<void>;
  disconnect(): Promise<void>;
  startTurn(): Promise<void>;
  endTurn(): Promise<void>;
  cancelTurn(): Promise<void>;
  startConversation(): Promise<void>;
  stopConversation(): Promise<void>;
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
  /** Whether the owner's microphone is open for a held push-to-talk turn. */
  onCapturing(capturing: boolean): void;
  refresh?: () => void;
}

const MIC_REFUSED = /permission|denied|notallowed/i;
const MIC_REFUSED_MESSAGE = "Microphone permission denied. Allow microphone access and try again.";

export function createVoiceSession(options: VoiceSessionOptions) {
  let transport: VoiceTransport | undefined;
  let ended = false;
  let started = false;
  let state: VoiceState = "idle";
  let caption = "";
  let capturing = false;
  let turns: Promise<void> = Promise.resolve();
  let agentReady = false;
  let pendingConversation = false;
  let continuous = false;
  const setCapturing = (next: boolean) => {
    if (capturing === next) return;
    capturing = next;
    options.onCapturing(next);
  };
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
    setCapturing(false);
    setState("ended");
    if (message) options.onError(message);
  };
  const recover = (message?: string) => {
    if (ended || state === "disconnected") return;
    window.clearTimeout(versionTimer);
    pendingConversation = false;
    continuous = false;
    setCapturing(false);
    setState("disconnected");
    if (message) options.onError(message);
    void transport?.disconnect();
  };
  const leave = () => end();
  const outOfDate = () => end(OUT_OF_DATE);
  const events: VoiceTransportEvents = {
    onUtterance(chunks) {
      void (async () => {
        let text = "";
        const previous = caption;
        for await (const chunk of chunks) {
          if (ended || state === "disconnected") break;
          text += chunk;
          caption = previous ? `${previous} ${text}` : text;
          options.onCaption(caption);
        }
      })().catch(() => undefined);
    },
    onAgent(agent) {
      if (ended || state === "disconnected") return;
      if (agent?.contractVersion === String(roster.contract_version)) {
        agentReady = true;
        if (pendingConversation) {
          pendingConversation = false;
          void queueTurn(() => transport!.startConversation(), true);
        }
      }
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
      } else if (agent?.thinking) {
        setState("thinking");
      } else if (agent) {
        setState("listening");
      }
    },
    onDisconnected: () => recover(),
  };
  // Turn calls run one at a time so a quick release can never overtake its press.
  const queueTurn = (call: () => Promise<void>, opening = false) =>
    (turns = turns
      .then(() => {
        if (!ended && state !== "disconnected") return call();
      })
      .catch((error: unknown) => {
        if (ended || state === "disconnected") return;
        if (opening) {
          setCapturing(false);
          if (continuous) {
            const message = error instanceof Error ? error.message : "Voice mode switch failed.";
            recover(MIC_REFUSED.test(message) ? MIC_REFUSED_MESSAGE : message);
            return;
          }
        }
        const message = error instanceof Error ? error.message : "Voice turn failed.";
        if (message === OUT_OF_DATE || MIC_REFUSED.test(message)) {
          if (message === OUT_OF_DATE) end(message);
          else recover(MIC_REFUSED_MESSAGE);
        } else {
          options.onError(message);
        }
      }));
  return {
    /** Whether the session is over: a new one is needed to talk again. */
    get ended() {
      return ended;
    },
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
        recover(
          error instanceof Error && MIC_REFUSED.test(error.message)
            ? MIC_REFUSED_MESSAGE
            : error instanceof Error
              ? error.message
              : "Could not start voice session.",
        );
      }
    },
    startConversation() {
      if (ended || !started) return;
      continuous = true;
      setCapturing(true);
      if (agentReady) void queueTurn(() => transport!.startConversation(), true);
      else pendingConversation = true;
    },
    stopConversation() {
      if (ended || !started) return;
      continuous = false;
      setCapturing(false);
      if (pendingConversation) pendingConversation = false;
      else void queueTurn(() => transport!.stopConversation());
    },
    /** The owner pressed and holds the push-to-talk control. Only once the session is connected:
     * a press during connection is never remembered, so speech is not captured early. */
    async startTurn() {
      if (ended || !started || state === "connecting" || state === "disconnected" || capturing)
        return;
      setCapturing(true);
      await queueTurn(() => transport!.startTurn(), true);
    },
    /** The owner released the control: submit what was said. */
    endTurn() {
      if (!capturing) return;
      setCapturing(false);
      void queueTurn(() => transport!.endTurn());
    },
    /** The owner slid off, lost focus or left: discard what was said. */
    cancelTurn() {
      if (!capturing) return;
      setCapturing(false);
      void queueTurn(() => transport!.cancelTurn());
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
        options.onCapturing = () => undefined;
        lapsedTimer = window.setTimeout(() => end(), 10000);
        return;
      }
      end();
    },
  };
}
