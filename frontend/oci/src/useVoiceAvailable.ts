/** The Voice Assistant's availability (ADR 0015; issue #366): the backend
 * reports the provider's credentials all saved, and the provider has not
 * reported itself unavailable (`VoiceProvider.unavailableUntil`, e.g. LiveKit's
 * free credit used up this month). Checked on mount, on window refocus, when
 * Settings saves or clears the config (`notifyVoiceConfigChanged`) and when an
 * unavailability period ends, so the mic appears/vanishes without a reload.
 * `null` until the first answer (so a hard load of /assistant is not bounced
 * before the probe has answered), `false` on any error: nothing voice-related
 * renders speculatively. */
import { useEffect, useState } from "react";

import { fetchVoiceConfig } from "./api";
import type { VoiceProvider } from "./voice/session";

const CHANGED_EVENT = "tuktuk:voice-config-changed";

export function notifyVoiceConfigChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useVoiceAvailable(provider: VoiceProvider): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

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
            // Browser timers cap delays at 2^31-1 ms; recheck after that ceiling. The floor stops
            // a tight loop when `until` is already past but the provider still reports it.
            const delay = Math.min(until.getTime() - Date.now(), 2147483647);
            timer = window.setTimeout(check, Math.max(delay, 1000));
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
