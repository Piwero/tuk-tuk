import { useEffect, useRef, useState } from "react";

import { App } from "./App";
import { ApiError, checkSession, login, logout, onUnauthorized, setup } from "./api";
import { Logo } from "./components/Logo";

type GateState = "checking" | "setup" | "locked" | "unlocked";

/** Sits above App: probes the session on mount and shows the first-run
 * setup screen, the password screen, or the app itself, and returns to the
 * password screen if any later request reports the session has lapsed.
 * Composed at the entry point rather than inside App, so App's own
 * bootstrap effects — and its whole test suite — never need to know
 * authentication exists. */
export function AuthGate(): JSX.Element | null {
  const [state, setState] = useState<GateState>("checking");

  useEffect(() => {
    let cancelled = false;
    checkSession()
      .then(() => {
        if (!cancelled) {
          setState("unlocked");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        // "setup_required" (app.middleware, ADR 0008) means no password
        // exists yet on a fresh deployment — every other failure means a
        // password exists and this browser just isn't logged in.
        setState(err instanceof ApiError && err.code === "setup_required" ? "setup" : "locked");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => onUnauthorized(() => setState("locked")), []);

  if (state === "checking") {
    return null;
  }
  if (state === "unlocked") {
    // Clearing the cookie server-side is what actually ends the session;
    // locking regardless of the request's outcome just gets the password
    // screen back up promptly, and unmounts App so no Task or List content
    // is left sitting in component state behind it.
    return <App onLogout={() => void logout().finally(() => setState("locked"))} />;
  }
  if (state === "setup") {
    return <SetupScreen onSuccess={() => setState("unlocked")} />;
  }
  return <PasswordScreen onSuccess={() => setState("unlocked")} />;
}

function SetupScreen({ onSuccess }: { onSuccess: () => void }): JSX.Element {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="auth-gate">
      <form
        className="auth-gate-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) {
            return;
          }
          // Caught client-side, before any request: a typo here is a
          // person mistyping their own new password, not something the
          // backend needs to weigh in on.
          if (password !== confirmPassword) {
            setError("Password and confirmation don't match.");
            return;
          }
          setPending(true);
          setError(null);
          setup(password)
            .then(onSuccess)
            .catch((err: unknown) => {
              setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
              setPending(false);
            });
        }}
      >
        <Logo size={32} />
        <h1>Tuk Tuk</h1>
        <p>Choose a password to finish setting up this deployment.</p>
        <label htmlFor="auth-gate-setup-password">Password</label>
        <input
          ref={inputRef}
          id="auth-gate-setup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          disabled={pending}
          onChange={(event) => setPassword(event.target.value)}
        />
        <label htmlFor="auth-gate-setup-confirm-password">Confirm password</label>
        <input
          id="auth-gate-setup-confirm-password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          disabled={pending}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        {error !== null && (
          <p className="auth-gate-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? "Setting up…" : "Set password"}
        </button>
      </form>
    </div>
  );
}

function PasswordScreen({ onSuccess }: { onSuccess: () => void }): JSX.Element {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="auth-gate">
      <form
        className="auth-gate-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) {
            return;
          }
          setPending(true);
          setError(null);
          login(password)
            .then(onSuccess)
            .catch((err: unknown) => {
              setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
              setPassword("");
              setPending(false);
            });
        }}
      >
        <Logo size={32} />
        <h1>Tuk Tuk</h1>
        <label htmlFor="auth-gate-password">Password</label>
        <input
          ref={inputRef}
          id="auth-gate-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={pending}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error !== null && (
          <p className="auth-gate-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
