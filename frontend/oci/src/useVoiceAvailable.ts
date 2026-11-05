/** The Voice Assistant's availability (ADR 0015; issue #366): the backend
 * reports the provider's credentials all saved, and the provider has not
 * reported itself unavailable (`VoiceProvider.unavailableUntil`, e.g. LiveKit's
 * free credit used up this month). Checked on mount, on window refocus, when
 * Settings saves or clears the config (`notifyVoiceConfigChanged`) and when an
 * unavailability period ends, so the mic appears/vanishes without a reload.
 * `false` until the first answer and on any error, so nothing voice-related
 * renders speculatively. */
import { useEffect, useState } from "react";

import { fetchVoiceConfig } from "./api";
import type { VoiceProvider } from "./voice/session";

const CHANGED_EVENT = "tuktuk:voice-config-changed";

export function notifyVoiceConfigChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useVoiceAvailable(provider: VoiceProvider): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    function check(): void {
      window.clearTimeout(timer);
      fetchVoiceConfig()
        .then((config) => {
          if (cancelled) return;
          const until = provider.unavailableUntil();
          setAvailable(config.configured && !until);
          if (until) {
            // Browser timers cap delays at 2^31-1 ms; recheck after that ceiling.
            timer = window.setTimeout(check, Math.min(until.getTime() - Date.now(), 2147483647));
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
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener(CHANGED_EVENT, check);
    };
  }, [provider]);

  return available;
}
