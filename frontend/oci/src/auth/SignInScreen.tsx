import { useEffect, useRef, useState } from "react";

import { ApiError, fetchSignInProviders, login, startGoogleSignIn } from "../api";
import { browserNavigation } from "../navigation";
import { AuthBrand } from "./AuthBrand";

/** Why the gate is showing sign-in without the person having tried yet:
 * their session ended because the account was disabled. */
export type SignInNotice = "account-disabled";

const DISABLED_MESSAGE = "This account is disabled. Contact your admin.";

/** Why a Google sign-in came back without signing in (#586), by the code
 * the backend's callback put in the URL. */
const GOOGLE_ERRORS: Record<string, string> = {
  not_recognized:
    "That Google account doesn’t have access. Ask your admin for an invitation, or sign in with your password.",
  account_disabled: DISABLED_MESSAGE,
  google_email_unverified:
    "Google hasn’t verified that account’s email, so it can’t be used to sign in.",
  google_cancelled: "Signing in with Google was canceled.",
};
const GOOGLE_FAILED = "Signing in with Google didn’t complete. Try again.";

/** The Google sign-in outcome the URL carries, if any. */
function googleErrorFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get("signInError");
  return code === null ? null : (GOOGLE_ERRORS[code] ?? GOOGLE_FAILED);
}

/** The three things a sign-in can be told (#468), by the backend's error
 * code. A wrong password and an unknown name share one message, so the
 * screen never reveals who has an account. */
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "invalid_credentials":
        return "Incorrect username, email or password.";
      case "too_many_attempts":
        return "Too many attempts. Wait a few minutes, then try again.";
      case "account_disabled":
        return DISABLED_MESSAGE;
    }
  }
  return "Something went wrong. Try again.";
}

const ERROR_ID = "auth-gate-sign-in-error";

export function SignInScreen({
  notice,
  onSuccess,
}: {
  notice: SignInNotice | null;
  onSuccess: () => Promise<void>;
}): React.JSX.Element {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    () => googleErrorFromUrl() ?? (notice === "account-disabled" ? DISABLED_MESSAGE : null),
  );
  const [googleOffered, setGoogleOffered] = useState(false);
  const loginRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [refocus, setRefocus] = useState(0);

  useEffect(() => {
    loginRef.current?.focus();
  }, []);

  // The outcome is shown once; a reload shouldn't show it again.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("signInError")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let live = true;
    fetchSignInProviders().then(
      (providers) => {
        if (live) setGoogleOffered(providers.google);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  function continueWithGoogle(): void {
    setPending(true);
    setError(null);
    startGoogleSignIn().then(
      (url) => browserNavigation.assign(url),
      () => {
        setError(GOOGLE_FAILED);
        setPending(false);
      },
    );
  }

  // After a failed attempt the fields come back enabled; put the person
  // back in the password field they need to retype.
  useEffect(() => {
    if (refocus > 0) {
      passwordRef.current?.focus();
    }
  }, [refocus]);

  const describedBy = error !== null ? ERROR_ID : undefined;

  return (
    <div className="auth-gate">
      <form
        className="auth-gate-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) {
            return;
          }
          setPending(true);
          setError(null);
          login(loginName, password)
            .then(onSuccess)
            .catch((err: unknown) => {
              setError(messageFor(err));
              setPassword("");
              setPending(false);
              setRefocus((count) => count + 1);
            });
        }}
      >
        <AuthBrand />
        <h1>Sign in</h1>
        <label htmlFor="auth-gate-login">Username or email</label>
        <input
          ref={loginRef}
          id="auth-gate-login"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={loginName}
          disabled={pending}
          aria-describedby={describedBy}
          onChange={(event) => setLoginName(event.target.value)}
        />
        <label htmlFor="auth-gate-password">Password</label>
        <input
          ref={passwordRef}
          id="auth-gate-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={pending}
          aria-describedby={describedBy}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error !== null && (
          <p id={ERROR_ID} className="auth-gate-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {googleOffered && (
          <>
            <p className="auth-gate-divider">or</p>
            <button
              className="btn-secondary"
              type="button"
              disabled={pending}
              onClick={continueWithGoogle}
            >
              Continue with Google
            </button>
          </>
        )}
        <p className="auth-gate-footnote">Forgot your password? Ask your admin to reset it.</p>
        {/* Migration 0035 named the single pre-existing account "admin" (with
            no email), and nothing else would tell its owner so. */}
        <p className="auth-gate-footnote">
          Set up before usernames? Sign in as admin with your existing password.
        </p>
      </form>
    </div>
  );
}
