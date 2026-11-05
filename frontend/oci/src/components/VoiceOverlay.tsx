import { useEffect, useRef, useState } from "react";

import { isTypingContext } from "../shortcuts";
import { useVoice } from "../voice/VoiceProvider";
import { VoiceView } from "./VoiceView";

// ponytail: fixed shortcut until #399 adds browser-local preferences.
const OVERLAY_SHORTCUT = { key: "v", code: "KeyV", label: "Alt+Shift+V" };

export function VoiceOverlay({
  available,
  navigation,
}: {
  available: boolean;
  navigation: unknown;
}): JSX.Element | null {
  const voice = useVoice();
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
  const latest = useRef({ open, available, close, show });
  latest.current = { open, available, close, show };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!latest.current.available || event.repeat || isTypingContext(event, true)) return;
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() !== OVERLAY_SHORTCUT.key && event.code !== OVERLAY_SHORTCUT.code)
        return;
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
        title={`Voice (${OVERLAY_SHORTCUT.label})`}
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
