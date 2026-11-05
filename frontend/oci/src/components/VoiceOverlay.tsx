import { useEffect, useRef, useState } from "react";

import { isTypingContext } from "../shortcuts";
import { loadOverlayShortcut, parseOverlayShortcut } from "../voice/overlayShortcut";
import { useVoice } from "../voice/VoiceProvider";
import { VoiceView } from "./VoiceView";

export function VoiceOverlay({
  available,
  navigation,
}: {
  available: boolean;
  navigation: unknown;
}): JSX.Element | null {
  const voice = useVoice();
  const [shortcut, setShortcut] = useState(loadOverlayShortcut);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previousNavigation = useRef(navigation);
  const close = () => {
    voice.cancel();
    setOpen(false);
    if (opener.current?.isConnected) opener.current.focus();
  };
  const show = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  };
  const latest = useRef({ open, available, close, show, shortcut });
  latest.current = { open, available, close, show, shortcut };

  useEffect(() => {
    const onPreferenceChange = () => setShortcut(loadOverlayShortcut());
    window.addEventListener("tuktuk:voice-overlay-shortcut-changed", onPreferenceChange);
    return () =>
      window.removeEventListener("tuktuk:voice-overlay-shortcut-changed", onPreferenceChange);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!latest.current.available || event.repeat || isTypingContext(event, true)) return;
      const chord = parseOverlayShortcut(latest.current.shortcut);
      if (
        !chord ||
        event.altKey !== chord.alt ||
        event.ctrlKey !== chord.ctrl ||
        event.metaKey !== chord.meta ||
        event.shiftKey !== chord.shift
      )
        return;
      if (event.key.toUpperCase() !== chord.key && event.code !== `Key${chord.key}`) return;
      event.preventDefault();
      if (latest.current.open) latest.current.close();
      else latest.current.show();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);
  useEffect(() => {
    if (previousNavigation.current !== navigation) {
      previousNavigation.current = navigation;
      if (latest.current.open) latest.current.close();
    }
  }, [navigation]);
  useEffect(() => {
    if (!available && latest.current.open) latest.current.close();
  }, [available]);

  if (!available && !voice.active) return null;
  return (
    <>
      <button
        type="button"
        className="voice-overlay-entry"
        aria-label="Open voice overlay"
        aria-expanded={open}
        title={`Voice (${shortcut})`}
        onClick={open ? close : show}
      >
        Voice
      </button>
      {open && (
        <aside
          className="voice-overlay"
          role="region"
          aria-label="Voice overlay"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <button ref={closeButton} type="button" className="voice-overlay-close" onClick={close}>
            Close voice overlay
          </button>
          <VoiceView />
        </aside>
      )}
      {!open && voice.capturing && (
        <div className="voice-live" role="status">
          Microphone live{" "}
          <button type="button" onClick={voice.end}>
            Stop voice
          </button>
        </div>
      )}
    </>
  );
}
