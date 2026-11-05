import { useEffect, useState } from "react";

import { AgentAudioVisualizerAura } from "./agents-ui/agent-audio-visualizer-aura";
import type { AgentState } from "./agents-ui/use-agent-audio-visualizer-aura";
import type { VoiceState } from "../voice/session";

/** Tuk-Tuk blue (`DEFAULT_ACCENT` in theme.ts), passed literally: Aura takes a hex string. */
const AURA_COLOR = "#4772fa";
const AURA_COLOR_SHIFT = 1.04;

/** What the owner reads next to the animation, so state never depends on seeing it. */
export const VOICE_STATE_LABEL: Record<VoiceState, string> = {
  idle: "Disconnected",
  ended: "Disconnected",
  disconnected: "Disconnected",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

const AURA_STATE: Record<VoiceState, AgentState> = {
  idle: "disconnected",
  ended: "disconnected",
  disconnected: "disconnected",
  connecting: "connecting",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
};

function usePrefersReducedMotion(): boolean {
  const query = () =>
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const list = query();
    if (!list) return;
    const update = () => setReduced(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** The page theme, which `applyThemePreference` writes as `data-theme` on <html>. */
function useThemeMode(): "dark" | "light" {
  const read = (): "dark" | "light" =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    setMode(read());
    return () => observer.disconnect();
  }, []);
  return mode;
}

/** The Aura visualizer (LiveKit Agents UI), driven by the session's state. Decorative: the state
 * is always stated in text beside it. With reduced motion it is a still disc, not a shader. */
export function VoiceVisualizer({
  state,
  size = "lg",
}: {
  state: VoiceState;
  size?: "sm" | "md" | "lg";
}): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const themeMode = useThemeMode();
  if (reduced) {
    return (
      <div
        className="voice-visualizer voice-visualizer-still"
        data-size={size}
        data-state={state}
        aria-hidden="true"
      />
    );
  }
  return (
    <div className="voice-visualizer" data-size={size} aria-hidden="true">
      <AgentAudioVisualizerAura
        size={size}
        state={AURA_STATE[state]}
        color={AURA_COLOR}
        colorShift={AURA_COLOR_SHIFT}
        themeMode={themeMode}
      />
    </div>
  );
}
