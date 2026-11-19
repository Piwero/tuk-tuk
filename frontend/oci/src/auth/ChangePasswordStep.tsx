import { useEffect, useRef, useState } from "react";

import { ApiError, completeStep } from "../api";
import { Icon } from "../components/Icon";
import { MIN_PASSWORD_LENGTH } from "./rules";

/** One line of the checklist: a tick once met, an empty ring until then,
 * with the state also spoken, since the glyph alone is decorative. */
function Rule({ met, children }: { met: boolean; children: string }): JSX.Element {
  return (
    <li className="auth-gate-rule" data-met={met}>
      {met ? <Icon name="check" /> : <span className="auth-gate-rule-ring" aria-hidden="true" />}
      {children}
      <span className="visually-hidden">{met ? ": done" : ": not yet"}</span>
    </li>
  );
}

interface Failure {
  /** Whether it is about the new password, so marks that field. */
  onField: boolean;
  message: string;
}

const ERROR_ID = "auth-gate-new-password-error";

/** The server's rejection in words for this step. Its 422s are about the
 * new password; anything else (a network failure, say) is a message on the
 * form alone. */
function failureFor(err: unknown): Failure {
  if (err instanceof ApiError && err.code === "password_unchanged") {
    return {
      onField: true,
      message: "Choose a password different from your temporary password.",
    };
  }
  if (err instanceof ApiError && err.code === "invalid_password") {
    return { onField: true, message: err.message };
  }
  return { onField: false, message: "Something went wrong. Try again." };
}

/** The temporary-password step's form (#471): a person signed in with a
 * password an admin chose replaces it before anything else. Rendered inside
 * the forced-step frame, which supplies the heading and the way out.
 * `onComplete` runs once the server has accepted the new password; the gate
 * then re-reads the account record, so the step never clears on its own.
 * The server alone knows the temporary password, so it is what rejects a
 * new one equal to it; the rejection is reported on the field. */
export function ChangePasswordStep({
  onComplete,
}: {
  onComplete: () => Promise<void>;
}): JSX.Element {
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Bumped to move focus back to the new password after a rejection.
  const [focusRequest, setFocusRequest] = useState(0);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const longEnough = newPassword.length >= MIN_PASSWORD_LENGTH;
  const matching = confirmation !== "" && confirmation === newPassword;
  const invalid = failure?.onField === true;

  useEffect(() => {
    newPasswordRef.current?.focus();
  }, [focusRequest]);

  return (
    <form
      className="auth-gate-step-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || !(longEnough && matching)) {
          return;
        }
        setPending(true);
        setFailure(null);
        completeStep({ newPassword })
          .then(onComplete)
          .catch((err: unknown) => {
            setPending(false);
            setFailure(failureFor(err));
            setFocusRequest((count) => count + 1);
          });
      }}
    >
      <p className="auth-gate-lead">
        You signed in with a temporary password. Replace it with one only you know.
      </p>
      <label htmlFor="auth-gate-new-password">New password</label>
      <input
        ref={newPasswordRef}
        id="auth-gate-new-password"
        name="new-password"
        type="password"
        autoComplete="new-password"
        disabled={pending}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? ERROR_ID : undefined}
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
      />
      <label htmlFor="auth-gate-confirm-new-password">Confirm new password</label>
      <input
        id="auth-gate-confirm-new-password"
        name="confirm-new-password"
        type="password"
        autoComplete="new-password"
        disabled={pending}
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
      />
      <ul className="auth-gate-rules" aria-label="Password requirements">
        <Rule met={longEnough}>{`At least ${MIN_PASSWORD_LENGTH} characters`}</Rule>
        <Rule met={matching}>Both entries match</Rule>
      </ul>
      {failure !== null && (
        <p id={ERROR_ID} className="auth-gate-error" role="alert">
          {failure.message}
        </p>
      )}
      <button className="btn-primary" type="submit" disabled={pending || !(longEnough && matching)}>
        {pending ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
