import { useEffect, useRef, useState } from "react";

import { ApiError, completeStep } from "../api";
import { NewPasswordFields } from "./NewPasswordFields";
import { newPasswordReady } from "./rules";

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
}): React.JSX.Element {
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Bumped to move focus back to the new password after a rejection.
  const [focusRequest, setFocusRequest] = useState(0);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const ready = newPasswordReady(newPassword, confirmation);
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
        if (pending || !ready) {
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
      <NewPasswordFields
        newPassword={newPassword}
        confirmation={confirmation}
        onNewPasswordChange={setNewPassword}
        onConfirmationChange={setConfirmation}
        disabled={pending}
        invalid={invalid}
        errorId={ERROR_ID}
        newPasswordRef={newPasswordRef}
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
