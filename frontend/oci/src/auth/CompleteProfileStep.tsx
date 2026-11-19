import { useEffect, useRef, useState } from "react";

import { ApiError, completeStep } from "../api";
import { NewPasswordFields } from "./NewPasswordFields";
import { EMAIL_PATTERN, MAX_USERNAME_LENGTH, newPasswordReady } from "./rules";

type Field = "username" | "email" | "newPassword";

interface Failure {
  /** The field it is about, which is marked and focused; null for a
   * failure of the form as a whole. */
  field: Field | null;
  message: string;
}

/** The backend's per-field codes for this step (auth router, ADR 0018), so
 * a rejection marks the field it is about. */
const FIELD_FOR_CODE: Record<string, Field> = {
  profile_required: "username",
  invalid_username: "username",
  username_taken: "username",
  invalid_email: "email",
  email_taken: "email",
  invalid_password: "newPassword",
  password_unchanged: "newPassword",
};

/** Caught client-side, in field order, before any request; the password
 * rules are held by the checklist and the button. The server's validation
 * is the backstop. */
function validate(username: string, email: string): Failure | null {
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
  return null;
}

function failureFor(err: unknown): Failure {
  if (err instanceof ApiError && err.code === "password_unchanged") {
    return {
      field: "newPassword",
      message: "Choose a password different from your current password.",
    };
  }
  if (err instanceof ApiError && err.code in FIELD_FOR_CODE) {
    return { field: FIELD_FOR_CODE[err.code] ?? null, message: err.message };
  }
  return { field: null, message: "Something went wrong. Try again." };
}

const EMAIL_HINT_ID = "auth-gate-profile-email-hint";
const ERROR_ID = "auth-gate-profile-error";

/** The upgraded single user's step (#472): after the move to several users
 * they signed in with the password they already had (as "admin", the name
 * migration 0035 gave them), and now choose a username, an email and a new
 * password, together. Rendered inside the forced-step frame, which supplies
 * the heading and the way out. `onComplete` runs once the server has
 * accepted all three; the gate then re-reads the account record, so the
 * step never clears on its own. */
export function CompleteProfileStep({
  onComplete,
}: {
  onComplete: () => Promise<void>;
}): JSX.Element {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: Field }>({ field: "username" });
  const refs = {
    username: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    newPassword: useRef<HTMLInputElement>(null),
  };
  const ready = newPasswordReady(newPassword, confirmation);

  useEffect(() => {
    refs[focusRequest.field].current?.focus();
    // refs are stable; only a new request moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const fail = (next: Failure): void => {
    setFailure(next);
    if (next.field !== null) {
      setFocusRequest({ field: next.field });
    }
  };

  const invalid = (field: Field): boolean => failure?.field === field;

  return (
    <form
      className="auth-gate-step-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || !ready) {
          return;
        }
        const invalidInput = validate(username, email);
        if (invalidInput !== null) {
          fail(invalidInput);
          return;
        }
        setPending(true);
        setFailure(null);
        completeStep({ newPassword, username: username.trim(), email: email.trim() })
          .then(onComplete)
          .catch((err: unknown) => {
            setPending(false);
            fail(failureFor(err));
          });
      }}
    >
      <p className="auth-gate-lead">
        Tuk Tuk now supports several users. Your tasks and settings are untouched; your account
        needs a name.
      </p>
      <label htmlFor="auth-gate-profile-username">Username</label>
      <input
        ref={refs.username}
        id="auth-gate-profile-username"
        name="username"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        disabled={pending}
        aria-invalid={invalid("username") || undefined}
        aria-describedby={invalid("username") ? ERROR_ID : undefined}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
      />
      <label htmlFor="auth-gate-profile-email">Email</label>
      <input
        ref={refs.email}
        id="auth-gate-profile-email"
        name="email"
        type="email"
        autoComplete="email"
        disabled={pending}
        aria-invalid={invalid("email") || undefined}
        aria-describedby={invalid("email") ? `${EMAIL_HINT_ID} ${ERROR_ID}` : EMAIL_HINT_ID}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <p id={EMAIL_HINT_ID} className="auth-gate-hint">
        Stored for password resets later. Nothing is sent yet.
      </p>
      <NewPasswordFields
        newPassword={newPassword}
        confirmation={confirmation}
        onNewPasswordChange={setNewPassword}
        onConfirmationChange={setConfirmation}
        disabled={pending}
        invalid={invalid("newPassword")}
        errorId={ERROR_ID}
        newPasswordRef={refs.newPassword}
      />
      {failure !== null && (
        <p id={ERROR_ID} className="auth-gate-error" role="alert">
          {failure.message}
        </p>
      )}
      <button className="btn-primary" type="submit" disabled={pending || !ready}>
        {pending ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
