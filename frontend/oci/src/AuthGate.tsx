import { useEffect, useRef, useState } from "react";

import { App } from "./App";
import { ApiError, checkSession, login, logout, onUnauthorized } from "./api";

type GateState = "checking" | "locked" | "unlocked";

/** Sits above App: probes the session on mount and shows the password
 * screen or the app itself, and returns to the password screen if any
 * later request reports the session has lapsed. Composed at the entry
 * point rather than inside App, so App's own bootstrap effects — and its
 * whole test suite — never need to know authentication exists. */
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
      .catch(() => {
        if (!cancelled) {
          setState("locked");
        }
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
  return <PasswordScreen onSuccess={() => setState("unlocked")} />;
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
