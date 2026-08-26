/** The Assistant's availability (ADR 0009; issue #185): checked once on
 * mount and re-checked on every window refocus, mirroring
 * useAssistAvailable — cheap enough to poll that way, and refocus is when a
 * provider is most likely to have just been fixed (or broken) and switched
 * back to. Starts at `null` — *not yet known* — so no Assistant affordance
 * renders during the initial check while a caller can still tell "still
 * checking" apart from a settled `false`: a hard load of /assistant must
 * not be bounced to another view before the probe has answered. A network
 * error settles to `false`, indistinguishable from "not available", same
 * as the backend probe itself. */
import { useEffect, useState } from "react";

import { fetchAssistantStatus } from "./api";

export function useAssistantAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

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
