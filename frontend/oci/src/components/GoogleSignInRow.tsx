import { useEffect, useState } from "react";

import { ApiError, type CurrentUser, fetchSignInProviders, startGoogleLink } from "../api";
import { browserNavigation } from "../navigation";
import { Modal } from "./Modal";

/** Where Google sends the browser back to after a link round trip. */
const RETURN_PATH = "/settings/account";

/** What the link round trip came back with (#586), by the code the
 * backend's callback put in `googleLink`. */
const OUTCOMES: Record<string, string> = {
  email_mismatch:
    "That Google account’s email doesn’t match this account’s. Ask an admin to update your email first.",
  identity_in_use: "That Google account already signs in to another account.",
  google_email_unverified: "Google hasn’t verified that account’s email, so it can’t be linked.",
  google_already_linked: "This account already signs in with Google.",
  google_cancelled: "Linking was canceled.",
};
const LINK_FAILED = "Linking Google didn’t complete. Try again.";

function takeOutcome(): { linked: boolean; error: string | null } {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("googleLink");
  if (code === null) return { linked: false, error: null };
  params.delete("googleLink");
  const rest = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
  return code === "linked"
    ? { linked: true, error: null }
    : { linked: false, error: OUTCOMES[code] ?? LINK_FAILED };
}

function LinkDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title="Link a Google account" onClose={onClose} dismissible={!pending}>
      <form
        className="settings-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setError(null);
          startGoogleLink(password, RETURN_PATH).then(
            (url) => browserNavigation.assign(url),
            (err: unknown) => {
              setError(
                err instanceof ApiError && err.code === "invalid_current_password"
                  ? "Current password is incorrect."
                  : err instanceof ApiError && err.code === "too_many_attempts"
                    ? "Too many attempts. Wait a few minutes, then try again."
                    : LINK_FAILED,
              );
              setPassword("");
              setPending(false);
            },
          );
        }}
      >
        <p className="settings-lead">
          Confirm your password, then choose the Google account with the same email as this account.
          You’ll keep your password and everything you own.
        </p>
        <div className="settings-field">
          <label htmlFor="google-link-password">Current password</label>
          <input
            id="google-link-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            disabled={pending}
            aria-describedby={error !== null ? "google-link-error" : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error !== null && (
          <p id="google-link-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-actions">
          <button type="button" className="btn-secondary" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={pending}>
            Continue with Google
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Settings › My account's Google sign-in (#586): which Google account the
 * User signs in with, or a way to link one after confirming their
 * password. Hidden when the instance offers no Google sign-in. */
export function GoogleSignInRow({ user }: { user: CurrentUser }): React.JSX.Element | null {
  const [offered, setOffered] = useState(false);
  const [outcome] = useState(takeOutcome);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let live = true;
    fetchSignInProviders().then(
      (providers) => {
        if (live) setOffered(providers.google);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  if (!offered && user.google_email === null) return null;
  return (
    <section aria-label="Sign in with Google" className="settings-field profile-google">
      <h3>Sign in with Google</h3>
      {user.google_email !== null ? (
        <p>Signs in with Google as {user.google_email}</p>
      ) : (
        <div className="profile-field-row">
          <span>Not linked</span>
          {user.has_password && (
            <button type="button" className="btn-secondary" onClick={() => setLinking(true)}>
              Link Google account
            </button>
          )}
        </div>
      )}
      {outcome.linked && <p role="status">Google account linked.</p>}
      {outcome.error !== null && <p role="alert">{outcome.error}</p>}
      {linking && <LinkDialog onClose={() => setLinking(false)} />}
    </section>
  );
}
