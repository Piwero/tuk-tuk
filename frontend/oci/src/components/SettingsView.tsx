import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  changePassword,
  disconnectGoogleAccount,
  fetchActiveHoursSettings,
  updateActiveHoursSettings,
  fetchDatabaseStatus,
  testDatabaseConnection,
  fetchAssistConfig,
  fetchAssistModels,
  fetchAssistStatus,
  fetchAssistantConfig,
  fetchAssistantStatus,
  fetchGoogleAccounts,
  fetchGoogleCalendars,
  fetchGoogleStatus,
  googleConnectUrl,
  refreshGoogleCalendars,
  fetchStandupSettings,
  fetchSectionSettings,
  removeAssistConfig,
  removeAssistantConfig,
  removeGoogleIntegration,
  saveAssistConfig,
  saveAssistantConfig,
  saveGoogleCredentials,
  updateGoogleCalendar,
  updateStandupSettings,
  updateSectionSettings,
  type AssistConfig,
  type AssistantConfig,
  type ActiveHoursSettings,
  type DatabaseStatus,
  type DatabaseTestConnectionResult,
  type GoogleAccount,
  type GoogleCalendar,
  type GoogleStatus,
  type SectionSettings,
} from "../api";
import { timeMinutes } from "../calendar";
import { type ThemePreference } from "../layoutPrefs";
import { ACCENT_PALETTE } from "../theme";
import { APP_VERSION } from "../version";

interface SettingsViewProps {
  /** Set when the browser just landed back from a Google consent round
   * trip that failed (backend redirected with ?googleError=1) — e.g. the
   * user declined consent, or the authorization code exchange failed. */
  googleOAuthError?: boolean;
  /** The current Appearance choice (issue #193) and its setter. Owned by
   * App, which persists it to browser-local storage and applies the
   * resolved `data-theme`. */
  themePreference: ThemePreference;
  onThemeChange: (preference: ThemePreference) => void;
}

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Appearance (issue #193): Light / Dark / System, and nothing else — the
 * three are the whole scope. A plain radio group; App does the persisting
 * and the theme application. */
function AppearanceSettings({
  themePreference,
  onThemeChange,
}: Pick<SettingsViewProps, "themePreference" | "onThemeChange">): JSX.Element {
  return (
    <fieldset className="settings-appearance">
      <legend>Theme</legend>
      {THEME_OPTIONS.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name="appearance-theme"
            value={option.value}
            checked={themePreference === option.value}
            onChange={() => onThemeChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
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
    <details
      className="google-account-calendars"
      onToggle={(event) => event.currentTarget.open && handleOpen()}
    >
      <summary>{account.email}</summary>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={handleOpen}>
            Retry
          </button>
        </p>
      ) : calendars === null ? (
        <p className="settings-hint">Loading calendars…</p>
      ) : (
        <>
          {calendars.length === 0 ? (
            <p className="settings-hint">No calendars found.</p>
          ) : (
            <ul className="google-calendar-list">
              {calendars.map((calendar) => (
                <li key={calendar.id} className="google-calendar-row">
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
    <form className="change-password-form settings-form" onSubmit={handleSubmit}>
      <div className="settings-field">
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
      </div>
      <div className="settings-field">
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
      </div>
      <div className="settings-field">
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
      </div>
      {error !== null && <p role="alert">{error}</p>}
      {success && (
        <p className="settings-success">
          Password changed. Other devices will need to log in again.
        </p>
      )}
      <button type="submit" className="settings-primary-action" disabled={pending}>
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
    <form className="google-credentials-form settings-form" onSubmit={handleSubmit}>
      <div className="settings-field">
        <label htmlFor="settings-google-client-id">Client ID</label>
        <input
          id="settings-google-client-id"
          name="google-client-id"
          type="text"
          value={clientId}
          disabled={pending}
          onChange={(event) => setClientId(event.target.value)}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="settings-google-client-secret">Client secret</label>
        {status.client_secret_set && !overwriteSecret ? (
          <p className="settings-hint">
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
      </div>
      {error !== null && <p role="alert">{error}</p>}
      <div className="settings-form-actions">
        <button type="submit" className="settings-primary-action" disabled={pending}>
          {pending ? "Saving…" : "Save Google credentials"}
        </button>
        {status.configured && (
          <button type="button" onClick={() => void handleRemove()} disabled={pending}>
            Remove Google integration
          </button>
        )}
      </div>
    </form>
  );
}

interface AssistConfigFormProps {
  config: AssistConfig;
  onSaved: (config: AssistConfig) => void;
}

/** The Assist configuration form (ADR 0005): the Ollama base URL and model
 * name, both plain text — neither is a credential, so unlike the Google
 * client secret there's nothing to mask or keep write-only.
 *
 * "Test connection" re-runs the same availability check Quick-Add polls —
 * but only against what's actually saved, since that's what every other
 * part of the app (Quick-Add's own probe) will see too. Disabled whenever
 * the fields have unsaved edits, so it can never quietly report on stale
 * config the operator thinks they just tested.
 *
 * "Remove" clears both settings server-side (mirrors GoogleCredentialsForm's
 * "Remove Google integration") — the only way to turn Assist back off once
 * something is saved, since the backend rejects blank fields as a save (a
 * config value, once set, doesn't degrade to "unset" by typing nothing).
 *
 * The Model field is a dropdown of whatever Ollama reports installed at the
 * typed base URL, fetched on mount (against the saved URL) and on demand via
 * "Refresh models" (against whatever's currently typed, saved or not) — an
 * operator picks a real model instead of typing a name from memory. Falls
 * back to a free-text field whenever nothing's been fetched yet (no base URL
 * saved, or the list came back empty), so a blank Ollama never blocks typing
 * a model name ahead of getting it running. */
function AssistConfigForm({ config, onSaved }: AssistConfigFormProps): JSX.Element {
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(config.ollama_base_url ?? "");
  const [model, setModel] = useState(config.model ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testPending, setTestPending] = useState(false);
  // null until a test has actually run — distinct from a false result, so
  // the form doesn't claim "unavailable" before anyone asked.
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsPending, setModelsPending] = useState(false);
  // Tags each fetch so a response can tell whether it's still the most
  // recent request before applying itself — covers both the mount effect
  // re-firing on a changed base URL and a Refresh click racing either of
  // those, with one guard instead of a separate `cancelled` flag per call
  // site.
  const modelsRequestId = useRef(0);

  const isDirty =
    ollamaBaseUrl !== (config.ollama_base_url ?? "") || model !== (config.model ?? "");

  // Re-syncs the form with the saved state after a save from outside (the
  // parent owns the source of truth) — mirrors GoogleCredentialsForm.
  useEffect(() => {
    setOllamaBaseUrl(config.ollama_base_url ?? "");
    setModel(config.model ?? "");
  }, [config.ollama_base_url, config.model]);

  function loadModels(url: string): void {
    const requestId = ++modelsRequestId.current;
    setModelsPending(true);
    fetchAssistModels(url)
      .then((result) => {
        if (modelsRequestId.current === requestId) {
          setModels(result.models);
        }
      })
      .catch(() => {
        if (modelsRequestId.current === requestId) {
          setModels([]);
        }
      })
      .finally(() => {
        if (modelsRequestId.current === requestId) {
          setModelsPending(false);
        }
      });
  }

  // Populates the dropdown against the saved URL on mount, and again
  // whenever a save changes it — never against unsaved typing, which is
  // what the explicit "Refresh models" button below is for instead.
  useEffect(() => {
    if (!config.ollama_base_url) {
      modelsRequestId.current += 1; // invalidates any fetch already in flight
      setModels([]);
      return;
    }
    loadModels(config.ollama_base_url);
  }, [config.ollama_base_url]);

  function handleRefreshModels(): void {
    if (modelsPending || !ollamaBaseUrl) {
      return;
    }
    loadModels(ollamaBaseUrl);
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    setTestResult(null);
    saveAssistConfig({ ollamaBaseUrl, model })
      .then((saved) => {
        setPending(false);
        onSaved(saved);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
        setPending(false);
      });
  }

  async function handleRemove(): Promise<void> {
    await removeAssistConfig();
    setOllamaBaseUrl("");
    setModel("");
    setTestResult(null);
    onSaved({ ollama_base_url: null, model: null });
  }

  function handleTest(): void {
    if (testPending || isDirty) {
      return;
    }
    setTestPending(true);
    setTestResult(null);
    fetchAssistStatus()
      .then((status) => {
        setTestResult(status.available);
        setTestPending(false);
      })
      .catch(() => {
        setTestResult(false);
        setTestPending(false);
      });
  }

  return (
    <form className="assist-config-form settings-form" onSubmit={handleSubmit}>
      <div className="settings-field">
        <label htmlFor="settings-assist-ollama-base-url">Ollama base URL</label>
        <input
          id="settings-assist-ollama-base-url"
          name="assist-ollama-base-url"
          type="text"
          placeholder="http://localhost:11434"
          value={ollamaBaseUrl}
          disabled={pending}
          onChange={(event) => setOllamaBaseUrl(event.target.value)}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="settings-assist-model">Model</label>
        <div className="settings-field-with-action">
          {models.length > 0 ? (
            <select
              id="settings-assist-model"
              name="assist-model"
              value={model}
              disabled={pending}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="">Select a model…</option>
              {/* The saved/typed model might not (or no longer) be among
               * what's installed — kept as its own option rather than
               * silently dropped, so switching to the dropdown never loses
               * what was already configured. */}
              {(model && !models.includes(model) ? [model, ...models] : models).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="settings-assist-model"
              name="assist-model"
              type="text"
              placeholder="qwen3:14b"
              value={model}
              disabled={pending}
              onChange={(event) => setModel(event.target.value)}
            />
          )}
          <button
            type="button"
            onClick={handleRefreshModels}
            disabled={modelsPending || !ollamaBaseUrl}
          >
            {modelsPending ? "Refreshing…" : "Refresh models"}
          </button>
        </div>
      </div>
      {error !== null && <p role="alert">{error}</p>}
      <div className="settings-form-actions">
        <button type="submit" className="settings-primary-action" disabled={pending}>
          {pending ? "Saving…" : "Save Assist settings"}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testPending || isDirty}
          title={isDirty ? "Save your changes before testing" : undefined}
        >
          {testPending ? "Testing…" : "Test connection"}
        </button>
        {(config.ollama_base_url !== null || config.model !== null) && (
          <button type="button" onClick={() => void handleRemove()} disabled={pending}>
            Remove
          </button>
        )}
      </div>
      {isDirty && testResult === null && (
        <p className="settings-hint">Save your changes before testing the connection.</p>
      )}
      {testResult !== null && (
        <p role="status" className={testResult ? "settings-hint" : undefined}>
          {testResult
            ? "Assist is available — Ollama is reachable and the model is installed."
            : "Assist is unavailable — check that Ollama is running and the model is installed."}
        </p>
      )}
    </form>
  );
}

interface AssistantConfigFormProps {
  config: AssistantConfig;
  onSaved: (config: AssistantConfig) => void;
}

/** The Assistant's provider configuration form (ADR 0009; issue #185):
 * base URL and model, plain text like AssistConfigForm's — plus a
 * write-only API key (mirrors GoogleCredentialsForm's client secret: a
 * masked placeholder once one is saved, with an explicit choice to
 * overwrite it) and a free-text planning-preferences textarea.
 *
 * "Test connection" re-runs the same availability check the Assistant's own
 * gate polls, against only what's actually saved — disabled whenever the
 * form has unsaved edits, so it can never report on stale config.
 *
 * "Remove" clears every field server-side, the only way back to the
 * unconfigured, invisible state once something is saved. */
function AssistantConfigForm({ config, onSaved }: AssistantConfigFormProps): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(config.base_url ?? "");
  const [model, setModel] = useState(config.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [overwriteApiKey, setOverwriteApiKey] = useState(!config.api_key_set);
  const [planningPreferences, setPlanningPreferences] = useState(config.planning_preferences ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testPending, setTestPending] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);

  const isDirty =
    baseUrl !== (config.base_url ?? "") ||
    model !== (config.model ?? "") ||
    (overwriteApiKey && apiKey !== "") ||
    planningPreferences !== (config.planning_preferences ?? "");

  useEffect(() => {
    setBaseUrl(config.base_url ?? "");
    setModel(config.model ?? "");
    setOverwriteApiKey(!config.api_key_set);
    setPlanningPreferences(config.planning_preferences ?? "");
  }, [config.base_url, config.model, config.api_key_set, config.planning_preferences]);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    setTestResult(null);
    saveAssistantConfig({
      baseUrl,
      model,
      ...(overwriteApiKey && apiKey !== "" ? { apiKey } : {}),
      planningPreferences,
    })
      .then((saved) => {
        setApiKey("");
        setOverwriteApiKey(!saved.api_key_set);
        setPending(false);
        onSaved(saved);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
        setPending(false);
      });
  }

  async function handleRemove(): Promise<void> {
    await removeAssistantConfig();
    setBaseUrl("");
    setModel("");
    setApiKey("");
    setOverwriteApiKey(true);
    setPlanningPreferences("");
    setTestResult(null);
    onSaved({ base_url: null, model: null, api_key_set: false, planning_preferences: null });
  }

  function handleTest(): void {
    if (testPending || isDirty) {
      return;
    }
    setTestPending(true);
    setTestResult(null);
    fetchAssistantStatus()
      .then((status) => {
        setTestResult(status.available);
        setTestPending(false);
      })
      .catch(() => {
        setTestResult(false);
        setTestPending(false);
      });
  }

  return (
    <form className="assistant-config-form settings-form" onSubmit={handleSubmit}>
      <div className="settings-field">
        <label htmlFor="settings-assistant-base-url">Base URL</label>
        <input
          id="settings-assistant-base-url"
          name="assistant-base-url"
          type="text"
          placeholder="https://api.openai.com/v1"
          value={baseUrl}
          disabled={pending}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="settings-assistant-model">Assistant model</label>
        <input
          id="settings-assistant-model"
          name="assistant-model"
          type="text"
          placeholder="gpt-4o-mini"
          value={model}
          disabled={pending}
          onChange={(event) => setModel(event.target.value)}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="settings-assistant-api-key">API key</label>
        {config.api_key_set && !overwriteApiKey ? (
          <p className="settings-hint">
            An API key is already saved.{" "}
            <button type="button" onClick={() => setOverwriteApiKey(true)} disabled={pending}>
              Replace it
            </button>
          </p>
        ) : (
          <input
            id="settings-assistant-api-key"
            name="assistant-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={pending}
            onChange={(event) => setApiKey(event.target.value)}
          />
        )}
      </div>
      <div className="settings-field">
        <label htmlFor="settings-assistant-planning-preferences">Planning preferences</label>
        <textarea
          id="settings-assistant-planning-preferences"
          name="assistant-planning-preferences"
          placeholder="work 9-6, lunch 1-2, gym Tue/Thu 7pm, keep Friday afternoons free"
          value={planningPreferences}
          disabled={pending}
          onChange={(event) => setPlanningPreferences(event.target.value)}
        />
      </div>
      {error !== null && <p role="alert">{error}</p>}
      <div className="settings-form-actions">
        <button type="submit" className="settings-primary-action" disabled={pending}>
          {pending ? "Saving…" : "Save Assistant settings"}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testPending || isDirty}
          title={isDirty ? "Save your changes before testing" : undefined}
        >
          {testPending ? "Testing…" : "Test Assistant connection"}
        </button>
        {(config.base_url !== null || config.model !== null || config.api_key_set) && (
          <button type="button" onClick={() => void handleRemove()} disabled={pending}>
            Remove Assistant configuration
          </button>
        )}
      </div>
      {isDirty && testResult === null && (
        <p className="settings-hint">Save your changes before testing the connection.</p>
      )}
      {testResult !== null && (
        <p role="status" className={testResult ? "settings-hint" : undefined}>
          {testResult
            ? "The Assistant is available — the provider is reachable."
            : "The Assistant is unavailable — check the base URL, model, and API key."}
        </p>
      )}
    </form>
  );
}

/** Half-hour labels "00:00" … "24:00" — the Active-hours grid (issue #210). */
const HALF_HOUR_LABELS: string[] = Array.from({ length: 49 }, (_, index) => {
  const minutes = index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

/** Active hours (issue #210): the band of the day the Calendar renders at
 * double height. The selects only offer valid half-hour times, so the one
 * reachable invalid state is start ≥ end (which includes a band that would
 * wrap past midnight); that shows inline and isn't saved. */
function ActiveHoursSettingsForm(): JSX.Element {
  const [settings, setSettings] = useState<ActiveHoursSettings>({
    enabled: false,
    start: "09:00",
    end: "17:00",
  });

  useEffect(() => {
    void fetchActiveHoursSettings().then(setSettings);
  }, []);

  const invalid = timeMinutes(settings.start) >= timeMinutes(settings.end);

  function apply(next: ActiveHoursSettings): void {
    setSettings(next);
    if (timeMinutes(next.start) < timeMinutes(next.end)) {
      void updateActiveHoursSettings(next).then(setSettings);
    }
  }

  return (
    <div className="settings-field">
      <label>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={() => apply({ ...settings, enabled: !settings.enabled })}
        />
        Active hours
      </label>
      <p className="settings-hint">
        Marks the part of the day you&rsquo;re usually active. The calendar&rsquo;s Week and Day
        grids draw those hours at double height, so short tasks stay readable in place, and compress
        the hours outside — dead time costs little scroll.
      </p>
      <div className="settings-field-with-action">
        <label>
          Start
          <select
            value={settings.start}
            onChange={(event) => apply({ ...settings, start: event.target.value })}
          >
            {HALF_HOUR_LABELS.slice(0, -1).map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          End
          <select
            value={settings.end}
            onChange={(event) => apply({ ...settings, end: event.target.value })}
          >
            {HALF_HOUR_LABELS.slice(1).map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {invalid && (
        <p role="alert">
          Active hours must start before they end, and can&rsquo;t wrap past midnight.
        </p>
      )}
    </div>
  );
}

function databaseTestConnectionMessage(result: DatabaseTestConnectionResult): string {
  if (result.ok) {
    const dataState = result.has_existing_data ? "already holds tuk-tuk data" : "is empty";
    // `version` already reads "PostgreSQL 16.4" — the server sends the
    // version, not the build banner, so don't prefix the name again.
    return `Connected — ${result.version ?? "unknown version"}. The database ${dataState}.`;
  }
  return result.message ?? "The connection attempt failed.";
}

/** Settings > Database (issue #256). Read-only status plus a connection
 * probe that never switches or saves anything — the connection-url field
 * is local component state only, cleared on every mount, and the probe
 * result is never fed back into anything persisted. */
function DatabaseSettingsForm(): JSX.Element {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [connectionUrl, setConnectionUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<DatabaseTestConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchDatabaseStatus().then(setStatus);
  }, []);

  async function handleTestConnection(): Promise<void> {
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      const outcome = await testDatabaseConnection(connectionUrl);
      setResult(outcome);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The connection attempt failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="settings-field">
      <p className="settings-hint">
        {status === null
          ? "Loading…"
          : status.engine === "sqlite"
            ? "Currently using SQLite, the default embedded database."
            : `Currently using PostgreSQL — host ${status.host ?? "unknown"}, database ${status.database ?? "unknown"}.`}
      </p>
      <p className="settings-hint">
        Testing a connection here does not switch the database and does not save the address — it
        only checks whether the server responds. See the README&rsquo;s &ldquo;Moving to
        PostgreSQL&rdquo; section for the real switching steps.
      </p>
      <label>
        Connection URL
        <input
          type="text"
          autoComplete="off"
          value={connectionUrl}
          onChange={(event) => setConnectionUrl(event.target.value)}
          placeholder="postgresql://user:password@host:5432/database"
        />
      </label>
      <button
        type="button"
        disabled={testing || connectionUrl.trim() === ""}
        onClick={() => void handleTestConnection()}
      >
        {testing ? "Testing database connection…" : "Test database connection"}
      </button>
      {error !== null && <p role="alert">{error}</p>}
      {result !== null && (
        <p role={result.ok ? "status" : "alert"}>{databaseTestConnectionMessage(result)}</p>
      )}
    </div>
  );
}

/** The Settings screen. Asks the Google status endpoint once on mount. The
 * Google Calendar section itself is always shown once that answer is in —
 * unlike before issue #117, its credentials form is how an operator gets
 * from unconfigured to configured in the first place — but the account list
 * and Connect button inside it stay invisible, not greyed-out, until the
 * backend reports credentials are actually set. See CONTEXT.md's Assist
 * glossary entry. */
export function SettingsView({
  googleOAuthError = false,
  themePreference,
  onThemeChange,
}: SettingsViewProps): JSX.Element {
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  // Enabled by default (issue #140) so the toggle doesn't flash off before
  // the real value loads — mirrors the App-level nav item's own default.
  const [standupEnabled, setStandupEnabled] = useState(true);
  // Enabled by default (this feature), same reasoning as standupEnabled
  // above — mirrors the App-level nav items' own default.
  const [sectionSettings, setSectionSettings] = useState<SectionSettings>({
    calendar: true,
    goals: true,
    habits: true,
    focus: true,
    assistant: true,
  });
  const [assistConfig, setAssistConfig] = useState<AssistConfig | null>(null);
  const [assistantConfig, setAssistantConfig] = useState<AssistantConfig | null>(null);

  useEffect(() => {
    void fetchStandupSettings().then((settings) => setStandupEnabled(settings.enabled));
  }, []);

  useEffect(() => {
    void fetchSectionSettings().then(setSectionSettings);
  }, []);

  useEffect(() => {
    void fetchAssistConfig().then(setAssistConfig);
  }, []);

  useEffect(() => {
    void fetchAssistantConfig().then(setAssistantConfig);
  }, []);

  async function handleStandupToggle(): Promise<void> {
    const updated = await updateStandupSettings(!standupEnabled);
    setStandupEnabled(updated.enabled);
  }

  async function handleSectionToggle(section: keyof SectionSettings): Promise<void> {
    const updated = await updateSectionSettings({
      ...sectionSettings,
      [section]: !sectionSettings[section],
    });
    setSectionSettings(updated);
  }

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
      <section aria-label="Appearance" className="settings-section">
        <h2>Appearance</h2>
        <AppearanceSettings themePreference={themePreference} onThemeChange={onThemeChange} />
      </section>
      <section aria-label="Features" className="settings-section">
        <h2>Features</h2>
        <div className="settings-feature-toggles">
          <label>
            <input
              type="checkbox"
              checked={sectionSettings.calendar}
              onChange={() => void handleSectionToggle("calendar")}
            />
            Calendar
          </label>
          <label>
            <input
              type="checkbox"
              checked={sectionSettings.goals}
              onChange={() => void handleSectionToggle("goals")}
            />
            Goals
          </label>
          <label>
            <input
              type="checkbox"
              checked={sectionSettings.habits}
              onChange={() => void handleSectionToggle("habits")}
            />
            Habits
          </label>
          <label>
            <input
              type="checkbox"
              checked={sectionSettings.focus}
              onChange={() => void handleSectionToggle("focus")}
            />
            Focus
          </label>
          <label>
            <input
              type="checkbox"
              checked={sectionSettings.assistant}
              onChange={() => void handleSectionToggle("assistant")}
            />
            Assistant
          </label>
          <label>
            <input
              type="checkbox"
              checked={standupEnabled}
              onChange={() => void handleStandupToggle()}
            />
            Stand-up
          </label>
        </div>
      </section>
      <section aria-label="Active hours" className="settings-section">
        <h2>Active hours</h2>
        <ActiveHoursSettingsForm />
      </section>
      <section aria-label="Database" className="settings-section">
        <h2>Database</h2>
        <DatabaseSettingsForm />
      </section>
      <section aria-label="About" className="settings-section">
        <h2>About</h2>
        <p className="settings-hint">
          tuk-tuk version <span className="app-version">{APP_VERSION}</span>
        </p>
      </section>
      {assistConfig !== null && (
        <section aria-label="Assist" className="settings-section">
          <h2>Assist</h2>
          <p className="settings-hint">
            Local — runs entirely on your own machine via Ollama. No data leaves this device.
            Unconfigured (or removed) means Assist stays off everywhere.
          </p>
          <AssistConfigForm config={assistConfig} onSaved={setAssistConfig} />
        </section>
      )}
      {assistantConfig !== null && (
        <section aria-label="Assistant" className="settings-section">
          <h2>Assistant</h2>
          <p className="settings-hint">
            Cloud — every turn sends the current week's tasks, today's Events, your List and Tag
            names, habits, and your planning preferences to the configured provider. Task
            descriptions and Check Item text are never sent. Unconfigured (or removed) means the
            Assistant stays off everywhere.
          </p>
          <AssistantConfigForm config={assistantConfig} onSaved={setAssistantConfig} />
        </section>
      )}
      {googleStatus !== null && (
        <section aria-label="Google Calendar" className="settings-section">
          <h2>Google Calendar</h2>
          <div className="settings-subsection">
            <h3>Google API credentials</h3>
            <GoogleCredentialsForm status={googleStatus} onSaved={handleCredentialsSaved} />
          </div>
          {googleStatus.configured && (
            <div className="settings-subsection">
              {googleOAuthError && (
                <p role="alert">Connecting to Google didn't complete. Please try again.</p>
              )}
              {accounts.length === 0 ? (
                <p className="settings-hint">No accounts connected.</p>
              ) : (
                <ul className="google-accounts">
                  {accounts.map((account) => (
                    <li key={account.id} className="google-account">
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
            </div>
          )}
        </section>
      )}
    </div>
  );
}
