import { useEffect, useState } from "react";

import {
  disconnectGoogleAccount,
  fetchGoogleAccounts,
  fetchGoogleStatus,
  googleConnectUrl,
  type GoogleAccount,
} from "../api";

type GoogleStatusState = "checking" | "configured" | "unconfigured";

interface SettingsViewProps {
  /** Set when the browser just landed back from a Google consent round
   * trip that failed (backend redirected with ?googleError=1) — e.g. the
   * user declined consent, or the authorization code exchange failed. */
  googleOAuthError?: boolean;
}

/** The Settings screen. Asks the Google status endpoint once on mount and
 * only ever shows the Google Calendar section — or any Google wording at
 * all — when the backend reports it configured. Mirrors the Assist
 * principle: absent prerequisites make a feature invisible, not
 * greyed-out. See CONTEXT.md's Assist glossary entry. */
export function SettingsView({ googleOAuthError = false }: SettingsViewProps): JSX.Element {
  const [googleStatus, setGoogleStatus] = useState<GoogleStatusState>("checking");
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchGoogleStatus()
      .then((status) => {
        if (cancelled) {
          return;
        }
        setGoogleStatus(status.configured ? "configured" : "unconfigured");
        if (status.configured) {
          return fetchGoogleAccounts().then((fetched) => {
            if (!cancelled) {
              setAccounts(fetched);
            }
          });
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

  async function handleDisconnect(accountId: number): Promise<void> {
    await disconnectGoogleAccount(accountId);
    setAccounts((current) => current.filter((account) => account.id !== accountId));
  }

  return (
    <div className="settings-view">
      {googleStatus === "configured" && (
        <section aria-label="Google Calendar" className="settings-section">
          <h2>Google Calendar</h2>
          {googleOAuthError && (
            <p role="alert">Connecting to Google didn't complete. Please try again.</p>
          )}
          {accounts.length === 0 ? (
            <p>No accounts connected.</p>
          ) : (
            <ul>
              {accounts.map((account) => (
                <li key={account.id}>
                  <span>{account.email}</span>
                  <button type="button" onClick={() => void handleDisconnect(account.id)}>
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* A full-page navigation, not a fetch: the consent flow is a
           * browser round trip through Google that only the backend can
           * broker. */}
          <a href={googleConnectUrl()} className="button">
            Connect
          </a>
        </section>
      )}
    </div>
  );
}
