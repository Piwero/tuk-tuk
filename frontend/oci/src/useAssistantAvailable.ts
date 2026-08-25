/** The Assistant's availability (ADR 0009; issue #185): checked once on
 * mount and re-checked on every window refocus, mirroring
 * useAssistAvailable — cheap enough to poll that way, and refocus is when a
 * provider is most likely to have just been fixed (or broken) and switched
 * back to. Defaults to `false` so no Assistant affordance renders during
 * the initial check or if it fails; a network error is indistinguishable
 * from "not available" here, same as the backend probe itself. */
import { useEffect, useState } from "react";

import { fetchAssistantStatus } from "./api";

export function useAssistantAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function check(): void {
      fetchAssistantStatus()
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
