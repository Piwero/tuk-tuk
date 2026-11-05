import { useState } from "react";

import { AssistantView } from "./AssistantView";
import { VoiceView } from "./VoiceView";

type Mode = "text" | "voice";

/** /assistant: the text Assistant and the Voice assistant side by side. Each mode is available
 * on its own; one that isn't says why instead of hiding the other. Voice sessions live in the
 * app-level provider, so switching to Text keeps the session, and the text chat stays mounted
 * so its transcript survives a trip to Voice. */
export function AssistantPage({
  textAvailable,
  voiceAvailable,
}: {
  textAvailable: boolean;
  voiceAvailable: boolean;
}): JSX.Element {
  const [chosen, setChosen] = useState<Mode | null>(null);
  const mode: Mode = chosen ?? (!textAvailable && voiceAvailable ? "voice" : "text");
  const tab = (id: Mode, name: string) => (
    <button
      type="button"
      role="tab"
      id={`assistant-tab-${id}`}
      aria-selected={mode === id}
      aria-controls={`assistant-panel-${id}`}
      tabIndex={mode === id ? 0 : -1}
      className="assistant-tab"
      onClick={() => setChosen(id)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const next = id === "text" ? "voice" : "text";
          setChosen(next);
          document.getElementById(`assistant-tab-${next}`)?.focus();
        }
      }}
    >
      {name}
    </button>
  );
  return (
    <div className="assistant-page">
      <div role="tablist" aria-label="Assistant mode" className="assistant-tabs">
        {tab("text", "Text")}
        {tab("voice", "Voice")}
      </div>
      <div
        role="tabpanel"
        id="assistant-panel-text"
        aria-labelledby="assistant-tab-text"
        hidden={mode !== "text"}
      >
        {textAvailable ? (
          <AssistantView />
        ) : (
          <p className="assistant-unavailable">
            The text Assistant isn't available. Set it up in Settings, under Assistant.
          </p>
        )}
      </div>
      <div
        role="tabpanel"
        id="assistant-panel-voice"
        aria-labelledby="assistant-tab-voice"
        hidden={mode !== "voice"}
      >
        {mode !== "voice" ? null : voiceAvailable ? (
          <VoiceView />
        ) : (
          <p className="assistant-unavailable">
            The Voice assistant isn't available. Set it up in Settings, under Voice.
          </p>
        )}
      </div>
    </div>
  );
}
