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
  removeGoogleIntegration,
  saveGoogleCredentials,
  updateGoogleCalendar,
  type GoogleAccount,
  type GoogleCalendar,
  type GoogleStatus,
} from "../api";
import { ACCENT_PALETTE } from "../theme";

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

interface GoogleCredentialsFormProps {
  status: GoogleStatus;
  onSaved: (status: GoogleStatus) => void;
}

/** The "Google API credentials" form (issue #117): client ID + a write-only
 * client secret. Shown whenever no credentials are configured yet, and
 * remains available afterward to edit them — the secret field never shows
 * the real value, only a masked placeholder when one is already stored, with
 * an explicit choice to overwrite it. Saving flips every connected account
 * to "needs_reconnect" server-side (a refresh token belongs to the OAuth
 * client that minted it), so `onSaved` re-fetches the account list too. */
function GoogleCredentialsForm({ status, onSaved }: GoogleCredentialsFormProps): JSX.Element {
  const [clientId, setClientId] = useState(status.client_id ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [overwriteSecret, setOverwriteSecret] = useState(!status.client_secret_set);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-syncs the form with the saved state after a save or a "Remove Google
  // integration" — both replace `status` from outside this form (the parent
  // owns the source of truth so the account list can react to it too).
  useEffect(() => {
    setClientId(status.client_id ?? "");
    setOverwriteSecret(!status.client_secret_set);
  }, [status.client_id, status.client_secret_set]);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    saveGoogleCredentials(clientId, overwriteSecret ? clientSecret : null)
      .then((saved) => {
        setClientSecret("");
        setOverwriteSecret(false);
        setPending(false);
        onSaved(saved);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
        setPending(false);
      });
  }

  async function handleRemove(): Promise<void> {
    await removeGoogleIntegration();
    onSaved({ configured: false, client_id: null, client_secret_set: false });
  }

  return (
    <form className="google-credentials-form" onSubmit={handleSubmit}>
      <label htmlFor="settings-google-client-id">Client ID</label>
      <input
        id="settings-google-client-id"
        name="google-client-id"
        type="text"
        value={clientId}
        disabled={pending}
        onChange={(event) => setClientId(event.target.value)}
      />
      <label htmlFor="settings-google-client-secret">Client secret</label>
      {status.client_secret_set && !overwriteSecret ? (
        <p>
          A client secret is already saved.{" "}
          <button type="button" onClick={() => setOverwriteSecret(true)} disabled={pending}>
            Replace it
          </button>
        </p>
      ) : (
        <input
          id="settings-google-client-secret"
          name="google-client-secret"
          type="password"
          autoComplete="off"
          value={clientSecret}
          disabled={pending}
          onChange={(event) => setClientSecret(event.target.value)}
        />
      )}
      {error !== null && <p role="alert">{error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save Google credentials"}
      </button>
      {status.configured && (
        <button type="button" onClick={() => void handleRemove()} disabled={pending}>
          Remove Google integration
        </button>
      )}
    </form>
  );
}

/** The Settings screen. Asks the Google status endpoint once on mount. The
 * Google Calendar section itself is always shown once that answer is in —
 * unlike before issue #117, its credentials form is how an operator gets
 * from unconfigured to configured in the first place — but the account list
 * and Connect button inside it stay invisible, not greyed-out, until the
 * backend reports credentials are actually set. See CONTEXT.md's Assist
 * glossary entry. */
export function SettingsView({ googleOAuthError = false }: SettingsViewProps): JSX.Element {
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchGoogleStatus()
      .then((status) => {
        if (cancelled) {
          return;
        }
        setGoogleStatus(status);
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
          setGoogleStatus({ configured: false, client_id: null, client_secret_set: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleCredentialsSaved(status: GoogleStatus): void {
    setGoogleStatus(status);
    if (status.configured) {
      void fetchGoogleAccounts().then(setAccounts);
    } else {
      setAccounts([]);
    }
  }

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
      {googleStatus !== null && (
        <section aria-label="Google Calendar" className="settings-section">
          <h2>Google Calendar</h2>
          <h3>Google API credentials</h3>
          <GoogleCredentialsForm status={googleStatus} onSaved={handleCredentialsSaved} />
          {googleStatus.configured && (
            <>
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
                          This account needs to be reconnected — its Events and calendars can't be
                          read until then.{" "}
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
            </>
          )}
        </section>
      )}
    </div>
  );
}
