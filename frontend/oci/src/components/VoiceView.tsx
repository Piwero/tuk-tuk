import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

import { useVoice } from "../voice/VoiceProvider";
import { VOICE_STATE_LABEL, VoiceVisualizer } from "./VoiceVisualizer";

const isHoldKey = (event: KeyboardEvent) => event.key === " " || event.key === "Enter";

/** Whether a pointer event landed on the control; a finger that slid off still reports the
 * control as its target, so the position decides. */
function onControl(event: PointerEvent<HTMLElement>): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX >= box.left &&
    event.clientX <= box.right &&
    event.clientY >= box.top &&
    event.clientY <= box.bottom
  );
}

/** The Voice view of /assistant: push-to-talk over the app's one voice session. Opening it never
 * starts anything; the first press connects (and records nothing), later holds capture a turn. */
export function VoiceView(): JSX.Element {
  const voice = useVoice();
  const { state, active, capturing } = voice;
  const live = useRef(voice);
  live.current = voice;

  // Anything that takes the owner away from the control abandons the turn instead of leaving
  // the microphone open: another tab or window, leaving this view.
  useEffect(() => {
    const abandon = () => live.current.cancel();
    const hidden = () => document.visibilityState === "hidden" && abandon();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", abandon);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", abandon);
      abandon();
    };
  }, []);

  // A press while not ready connects; it is never remembered, so a slow connection can't start
  // recording when it finally completes. The next press captures.
  const press = () => (active ? voice.hold() : voice.connect());
  const label = capturing
    ? "Release to send"
    : !active
      ? "Press to connect"
      : state === "connecting"
        ? "Connecting…"
        : "Hold to talk";

  return (
    <section className="voice-view" aria-label="Voice assistant">
      <VoiceVisualizer state={state} />
      <p className="voice-state" role="status">
        {VOICE_STATE_LABEL[state]}
      </p>
      <button
        type="button"
        className="voice-talk"
        data-capturing={capturing}
        aria-disabled={state === "connecting"}
        onPointerDown={(event) => {
          if (event.button === 0 || event.pointerType !== "mouse") press();
        }}
        onPointerUp={(event) => (onControl(event) ? voice.release() : voice.cancel())}
        onPointerMove={(event) => capturing && !onControl(event) && voice.cancel()}
        onPointerLeave={() => voice.cancel()}
        onPointerCancel={() => voice.cancel()}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (!isHoldKey(event)) return;
          event.preventDefault();
          if (!event.repeat) press();
        }}
        onKeyUp={(event) => {
          if (!isHoldKey(event)) return;
          event.preventDefault();
          voice.release();
        }}
        onBlur={() => voice.cancel()}
        onClick={() => !active && voice.connect()}
      >
        {label}
      </button>
      <p className="voice-hint">
        {!active
          ? "Press once to connect. Then hold to talk and let go to send."
          : state === "connecting"
            ? "The first connection can take 10–20 seconds. Nothing is recorded until you hold again."
            : "Hold to talk, let go to send. Slide off the button to cancel."}
      </p>
      {active && (
        <button type="button" className="voice-end" onClick={voice.end}>
          End session
        </button>
      )}
      {voice.error && <p role="alert">{voice.error}</p>}
      {voice.captions && (
        <p className="voice-captions" aria-label="Captions" aria-live="polite">
          {voice.captions}
        </p>
      )}
    </section>
  );
}
