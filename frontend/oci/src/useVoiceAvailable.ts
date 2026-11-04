/** The Voice Assistant's availability (ADR 0015; issue #366): the backend
 * reports LiveKit URL/key/secret all saved, and this month's free minutes
 * are not marked used up. Checked on mount, on window refocus, and when
 * Settings saves or clears the config (`notifyVoiceConfigChanged`) so the
 * mic appears/vanishes without a reload. `false` until the first answer
 * and on any error, so nothing voice-related renders speculatively. */
import { useEffect, useState } from "react";

import { fetchVoiceConfig } from "./api";

const CHANGED_EVENT = "tuktuk:voice-config-changed";

/** localStorage key holding the `YYYY-MM` in which LiveKit's free minutes
 * ran out (written by the session code, T8). */
export const VOICE_EXHAUSTED_KEY = "tuktuk.voice.exhaustedMonth";

export function notifyVoiceConfigChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ponytail: a per-browser localStorage marker — the free-tier quota is
// account-wide, so another browser only learns on its own first failure.
// Upgrade path: have the backend relay LiveKit usage.
function exhaustedThisMonth(): boolean {
  try {
    return localStorage.getItem(VOICE_EXHAUSTED_KEY) === currentMonth();
  } catch {
    return false;
  }
}

export function useVoiceAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function check(): void {
      fetchVoiceConfig()
        .then((config) => {
          if (!cancelled) {
            setAvailable(config.configured && !exhaustedThisMonth());
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAvailable(false);
          }
        });
    }

    check();
    window.addEventListener("focus", check);
    window.addEventListener(CHANGED_EVENT, check);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
      window.removeEventListener(CHANGED_EVENT, check);
    };
  }, []);

  return available;
}
