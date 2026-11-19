import { useEffect, useRef, useState } from "react";

import { ApiError, login } from "../api";
import { AuthBrand } from "./AuthBrand";

/** Why the gate is showing sign-in without the person having tried yet:
 * their session ended because the account was disabled. */
export type SignInNotice = "account-disabled";

const DISABLED_MESSAGE = "This account is disabled. Contact your admin.";

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
}): JSX.Element {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    notice === "account-disabled" ? DISABLED_MESSAGE : null,
  );
  const loginRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [refocus, setRefocus] = useState(0);

  useEffect(() => {
    loginRef.current?.focus();
  }, []);

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
