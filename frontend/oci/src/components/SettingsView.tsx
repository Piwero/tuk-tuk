import { useEffect, useState } from "react";

import { fetchGoogleStatus } from "../api";

type GoogleStatusState = "checking" | "configured" | "unconfigured";

/** The Settings screen. Asks the Google status endpoint once on mount and
 * only ever shows the Google Calendar section — or any Google wording at
 * all — when the backend reports it configured. Mirrors the Assist
 * principle: absent prerequisites make a feature invisible, not
 * greyed-out. See CONTEXT.md's Assist glossary entry. */
export function SettingsView(): JSX.Element {
  const [googleStatus, setGoogleStatus] = useState<GoogleStatusState>("checking");

  useEffect(() => {
    let cancelled = false;
    fetchGoogleStatus()
      .then((status) => {
        if (!cancelled) {
          setGoogleStatus(status.configured ? "configured" : "unconfigured");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGoogleStatus("unconfigured");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="settings-view">
      {googleStatus === "configured" && (
        <section aria-label="Google Calendar" className="settings-section">
          <h2>Google Calendar</h2>
          <p>No accounts connected.</p>
        </section>
      )}
    </div>
  );
}
