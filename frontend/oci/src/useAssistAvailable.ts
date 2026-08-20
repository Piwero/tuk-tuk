/** Assist availability (ADR 0005; issue #42): checked once on mount and
 * re-checked on every window refocus — cheap enough to poll that way, and
 * refocus is when a user is most likely to have just started (or stopped)
 * Ollama and switched back. Defaults to `false` so nothing AI-related
 * renders during the initial check or if it fails; a network error is
 * indistinguishable from "not available" here, same as the backend probe
 * itself never surfaces a distinct error state. */
import { useEffect, useState } from "react";

import { fetchAssistStatus } from "./api";

export function useAssistAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function check(): void {
      fetchAssistStatus()
        .then((status) => {
          if (!cancelled) {
            setAvailable(status.available);
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
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
    };
  }, []);

  return available;
}
