import { useEffect, useState } from "react";

import {
  ApiError,
  changePassword,
  disconnectGoogleAccount,
  fetchGoogleAccounts,
  fetchGoogleCalendars,
  fetchGoogleStatus,
  googleConnectUrl,
  refreshGoogleCalendars,
  updateGoogleCalendar,
  type GoogleAccount,
  type GoogleCalendar,
} from "../api";
import { ACCENT_PALETTE } from "../theme";

type GoogleStatusState = "checking" | "configured" | "unconfigured";

interface SettingsViewProps {
  /** Set when the browser just landed back from a Google consent round
   * trip that failed (backend redirected with ?googleError=1) — e.g. the
   * user declined consent, or the authorization code exchange failed. */
  googleOAuthError?: boolean;
}

interface GoogleAccountCalendarsProps {
  account: GoogleAccount;
  /** Re-fetches the account list — called after a failed calendar load so
   * a `google_reconnect_required` error (the backend flips the account to
   * "needs_reconnect" as part of raising it) shows up as the same
   * Reconnect banner the rest of Settings uses, rather than this
   * component inventing its own. */
  onReconnectRequired: () => void;
}

/** A connected account's calendar list — fetched (and seeded server-side
 * from Google's own per-calendar selection flag) the first time it's
 * expanded, never before. Toggling visibility or changing a calendar's
 * colour is a purely local write; nothing here ever reaches Google. */
function GoogleAccountCalendars({
  account,
  onReconnectRequired,
}: GoogleAccountCalendarsProps): JSX.Element {
  const [calendars, setCalendars] = useState<GoogleCalendar[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function handleOpen(): void {
    if (loaded) {
      return;
    }
    setLoaded(true);
    setError(null);
    fetchGoogleCalendars(account.id)
      .then(setCalendars)
      .catch((err: unknown) => {
        setLoaded(false);
        if (err instanceof ApiError && err.code === "google_reconnect_required") {
          onReconnectRequired();
        }
        setError(
          err instanceof ApiError
            ? err.message
            : "Couldn't load calendars for this account. Please try again.",
        );
      });
  }

  async function handleToggle(calendar: GoogleCalendar): Promise<void> {
    const updated = await updateGoogleCalendar(account.id, calendar.id, {
      enabled: !calendar.enabled,
    });
    setCalendars((current) => (current ?? []).map((c) => (c.id === updated.id ? updated : c)));
  }

  async function handleColor(calendar: GoogleCalendar, color: string): Promise<void> {
    const updated = await updateGoogleCalendar(account.id, calendar.id, { color });
    setCalendars((current) => (current ?? []).map((c) => (c.id === updated.id ? updated : c)));
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    try {
      setCalendars(await refreshGoogleCalendars(account.id));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <details onToggle={(event) => event.currentTarget.open && handleOpen()}>
      <summary>{account.email}</summary>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={handleOpen}>
            Retry
          </button>
        </p>
      ) : calendars === null ? (
        <p>Loading calendars…</p>
      ) : (
        <>
          {calendars.length === 0 ? (
            <p>No calendars found.</p>
          ) : (
            <ul>
              {calendars.map((calendar) => (
                <li key={calendar.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={calendar.enabled}
                      onChange={() => void handleToggle(calendar)}
                    />
                    {calendar.summary}
                  </label>
                  <fieldset className="color-palette">
                    <legend>Color for {calendar.summary}</legend>
                    {ACCENT_PALETTE.map((swatch) => (
                      <label
                        key={swatch.value}
                        className="color-swatch"
                        style={{ background: swatch.value }}
                      >
                        <input
                          type="radio"
                          name={`google-calendar-color-${calendar.id}`}
                          aria-label={swatch.name}
                          checked={calendar.color === swatch.value}
                          value={swatch.value}
                          onChange={() => void handleColor(calendar, swatch.value)}
                        />
                      </label>
                    ))}
                  </fieldset>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => void handleRefresh()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh calendars"}
          </button>
        </>
      )}
    </details>
  );
}

/** The change-password form (issue #116, ADR 0008): current + new password.
 * Saving rotates the session signing key server-side, invalidating every
 * other device's cookie while this device gets a fresh one in the response
 * — nothing to do here on success beyond clearing the form and confirming. */
function ChangePasswordForm(): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (pending) {
      return;
    }
    setSuccess(false);
    // Caught here, before any request: a mismatch is never worth spending
    // a throttled attempt on (a wrong current password shares one counter
    // with /login), and it isn't something the backend needs to know.
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setPending(true);
    setError(null);
    changePassword(currentPassword, newPassword)
      .then(() => {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setSuccess(true);
        setPending(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
        setPending(false);
      });
  }

  return (
    <form className="change-password-form" onSubmit={handleSubmit}>
      <label htmlFor="settings-current-password">Current password</label>
      <input
        id="settings-current-password"
        name="current-password"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        disabled={pending}
        onChange={(event) => setCurrentPassword(event.target.value)}
      />
      <label htmlFor="settings-new-password">New password</label>
      <input
        id="settings-new-password"
        name="new-password"
        type="password"
        autoComplete="new-password"
        value={newPassword}
        disabled={pending}
        onChange={(event) => setNewPassword(event.target.value)}
      />
      <label htmlFor="settings-confirm-password">Confirm new password</label>
      <input
        id="settings-confirm-password"
        name="confirm-password"
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        disabled={pending}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />
      {error !== null && <p role="alert">{error}</p>}
      {success && <p>Password changed. Other devices will need to log in again.</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
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

  async function refreshAccounts(): Promise<void> {
    setAccounts(await fetchGoogleAccounts());
  }

  return (
    <div className="settings-view">
      <section aria-label="Security" className="settings-section">
        <h2>Security</h2>
        <ChangePasswordForm />
      </section>
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
                  <GoogleAccountCalendars
                    account={account}
                    onReconnectRequired={() => void refreshAccounts()}
                  />
                  {account.connection_state === "needs_reconnect" && (
                    <p role="alert">
                      This account needs to be reconnected — its Events and calendars can't be read
                      until then.{" "}
                      <a href={googleConnectUrl()} className="button">
                        Reconnect
                      </a>
                    </p>
                  )}
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
