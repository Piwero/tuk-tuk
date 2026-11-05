import { useEffect, useRef, useState } from "react";

import { IconButton } from "./IconButton";
import { livekitProvider } from "../voice/livekit";
import { createVoiceSession, type VoiceState, type VoiceTransportFactory } from "../voice/session";

/** `refresh` runs after each voice write is applied, so the views on screen show it live. */
export function VoiceButton({
  createTransport = livekitProvider.transport,
  refresh,
}: { createTransport?: VoiceTransportFactory; refresh?: () => void } = {}): JSX.Element {
  const [state, setState] = useState<VoiceState>("idle");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const session = useRef<ReturnType<typeof createVoiceSession>>();
  useEffect(() => () => session.current?.dispose(), []);
  const active = state === "connecting" || state === "listening" || state === "speaking";
  async function toggle(): Promise<void> {
    if (active) {
      await session.current?.stop();
      return;
    }
    setError("");
    session.current = createVoiceSession({
      createTransport,
      refresh,
      onState: setState,
      onCaption: setCaption,
      onError: setError,
    });
    await session.current.start();
  }
  return (
    <span className="voice-control">
      <IconButton
        icon="mic"
        size={20}
        label={active ? "End voice assistant" : "Start voice assistant"}
        aria-pressed={active}
        onClick={() => void toggle()}
      />
      <span aria-live="polite" className="sr-only">
        {state === "speaking" ? "Agent speaking" : state}
      </span>
      {caption && (
        <span className="voice-caption" aria-live="polite">
          {caption}
        </span>
      )}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
