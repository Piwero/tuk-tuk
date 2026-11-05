/** The one voice session of the app (ADR 0015). It lives above every view, so the Voice view now
 * and the floating overlay later read the same session and neither owns a transport. Starting is
 * always an explicit call: mounting the provider, opening a view or navigating never connects. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createVoiceSession, type VoiceState, type VoiceTransportFactory } from "./session";

export interface Voice {
  state: VoiceState;
  /** Whether a session is connecting or connected. */
  active: boolean;
  /** Whether the owner's microphone is open for a held push-to-talk turn. */
  capturing: boolean;
  /** The agent's words so far; cleared when the session ends. */
  captions: string;
  error: string;
  /** Start a session. Never opens the microphone. */
  connect(): void;
  /** Open the microphone for a turn; ignored unless the session is connected. */
  hold(): void;
  /** Close the microphone and submit the turn. */
  release(): void;
  /** Close the microphone and discard the turn. */
  cancel(): void;
  /** End the session: disconnects, releases the microphone, clears captions. */
  end(): void;
}

const VoiceContext = createContext<Voice | null>(null);

export function useVoice(): Voice {
  const voice = useContext(VoiceContext);
  if (voice === null) throw new Error("useVoice must be used inside a VoiceProvider");
  return voice;
}

/** `refresh` runs after each voice write is applied, so the views on screen show it live. */
export function VoiceProvider({
  createTransport,
  refresh,
  available,
  children,
}: {
  createTransport: VoiceTransportFactory;
  refresh?: () => void;
  /** Voice being switched off (config removed, credit used up) ends a live session. */
  available: boolean | null;
  children: ReactNode;
}): JSX.Element {
  const [state, setState] = useState<VoiceState>("idle");
  const [captions, setCaptions] = useState("");
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const session = useRef<ReturnType<typeof createVoiceSession>>();
  const generation = useRef(0);
  const latest = useRef({ createTransport, refresh });
  latest.current = { createTransport, refresh };
  useEffect(() => () => session.current?.dispose(), []);
  useEffect(() => {
    if (available === false) void session.current?.stop();
  }, [available]);

  const active =
    state === "connecting" || state === "listening" || state === "thinking" || state === "speaking";
  const connect = useCallback(() => {
    if (session.current && !session.current.ended) return;
    // A replaced session's late events must not touch the new one.
    const id = ++generation.current;
    const current =
      <T,>(set: (value: T) => void) =>
      (value: T) => {
        if (id === generation.current) set(value);
      };
    setError("");
    setCaptions("");
    session.current = createVoiceSession({
      createTransport: (context) => latest.current.createTransport(context),
      refresh: () => latest.current.refresh?.(),
      onState: current(setState),
      onCaption: current(setCaptions),
      onError: current(setError),
      onCapturing: current(setCapturing),
    });
    void session.current.start();
  }, []);

  const voice = useMemo<Voice>(
    () => ({
      state,
      active,
      capturing,
      captions,
      error,
      connect,
      hold: () => void session.current?.startTurn(),
      release: () => session.current?.endTurn(),
      cancel: () => session.current?.cancelTurn(),
      end: () => void session.current?.stop(),
    }),
    [state, active, capturing, captions, error, connect],
  );
  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>;
}
