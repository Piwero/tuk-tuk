import { useEffect, useRef, useState } from "react";

import { ApiError, setup } from "../api";
import { AuthBrand } from "./AuthBrand";
import { EMAIL_PATTERN, MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH } from "./rules";

type Field = "username" | "email" | "password";

interface FieldError {
  field: Field | null;
  message: string;
}

/** Caught client-side, in field order, before any request: the server's
 * validation is the backstop, not the only check. */
function validate(username: string, email: string, password: string): FieldError | null {
  const name = username.trim();
  if (name === "" || name.length > MAX_USERNAME_LENGTH) {
    return {
      field: "username",
      message: `Enter a username of 1 to ${MAX_USERNAME_LENGTH} characters.`,
    };
  }
  if (!EMAIL_PATTERN.test(email.trim())) {
    return { field: "email", message: "Enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      field: "password",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  return null;
}

/** The backend's per-field codes (auth router, ADR 0018), so a server-side
 * rejection marks the same field a client-side one would. */
const FIELD_FOR_CODE: Record<string, Field> = {
  invalid_username: "username",
  username_taken: "username",
  invalid_email: "email",
  email_taken: "email",
  invalid_password: "password",
};

const ERROR_ID = "auth-gate-setup-error";
const PASSWORD_HINT_ID = "auth-gate-setup-password-hint";

/** First run (#470): the first visitor to an instance with no users creates
 * the admin account. Reachable only while the server says setup is needed;
 * if someone else finishes it first, the server's 404 sends this browser to
 * sign-in instead. */
export function SetupScreen({
  onSuccess,
  onAlreadySetUp,
}: {
  onSuccess: () => Promise<void>;
  onAlreadySetUp: () => void;
}): JSX.Element {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: Field } | null>({
    field: "username",
  });
  const refs = {
    username: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    if (focusRequest !== null) {
      refs[focusRequest.field].current?.focus();
    }
    // refs are stable; only a new request moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const fail = (failure: FieldError): void => {
    setError(failure);
    if (failure.field !== null) {
      setFocusRequest({ field: failure.field });
    }
  };

  const fieldProps = (field: Field, hintId?: string) => {
    const invalid = error?.field === field;
    const describedBy = [hintId, invalid ? ERROR_ID : undefined].filter(Boolean).join(" ");
    return {
      ref: refs[field],
      id: `auth-gate-setup-${field}`,
      name: field,
      disabled: pending,
      "aria-invalid": invalid || undefined,
      "aria-describedby": describedBy || undefined,
    };
  };

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
          const invalid = validate(username, email, password);
          if (invalid !== null) {
            fail(invalid);
            return;
          }
          setPending(true);
          setError(null);
          setup({ username: username.trim(), email: email.trim(), password })
            .then(onSuccess)
            .catch((err: unknown) => {
              if (err instanceof ApiError && err.code === "not_found") {
                onAlreadySetUp();
                return;
              }
              setPending(false);
              fail(
                err instanceof ApiError
                  ? { field: FIELD_FOR_CODE[err.code] ?? null, message: err.message }
                  : { field: null, message: "Something went wrong. Try again." },
              );
            });
        }}
      >
        <AuthBrand />
        <h1>Create the admin account</h1>
        <p className="auth-gate-lead">
          This instance has no users yet. The first account manages the others.
        </p>
        <label htmlFor="auth-gate-setup-username">Username</label>
        <input
          {...fieldProps("username")}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label htmlFor="auth-gate-setup-email">Email</label>
        <input
          {...fieldProps("email")}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="auth-gate-setup-password">Password</label>
        <input
          {...fieldProps("password", PASSWORD_HINT_ID)}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p id={PASSWORD_HINT_ID} className="auth-gate-hint">
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
        {error !== null && (
          <p id={ERROR_ID} className="auth-gate-error" role="alert">
            {error.message}
          </p>
        )}
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </div>
  );
}
