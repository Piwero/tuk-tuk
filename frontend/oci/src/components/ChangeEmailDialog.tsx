import { useState } from "react";

import { type AdminUser, ApiError } from "../api";
import { Modal } from "./Modal";

function emailError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "invalid_email") return "Enter a valid email address.";
    if (err.code === "email_taken") return "Another account already uses that email.";
  }
  return "Couldn’t change the email. Try again.";
}

/** Settings › Users › Change email (#586): an Admin's deliberate
 * reconciliation, for instance before someone links a Google account with
 * a different address. It never moves an existing Google sign-in. */
export function ChangeEmailDialog({
  account,
  onSave,
  onClose,
}: {
  account: AdminUser;
  /** Saves the address; rejects with the server's error. */
  onSave: (email: string) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState(account.email ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title={`Change ${account.username}’s email`} onClose={onClose} dismissible={!pending}>
      <form
        className="users-email-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setError(null);
          onSave(email).then(onClose, (err: unknown) => {
            setError(emailError(err));
            setPending(false);
          });
        }}
      >
        <p className="users-confirm-lead">
          Change it only after confirming the new address with {account.username}.
          {account.google_email !== null &&
            ` They keep signing in with Google as ${account.google_email}.`}
        </p>
        <label htmlFor="users-change-email">Email</label>
        <input
          id="users-change-email"
          type="email"
          value={email}
          disabled={pending}
          autoFocus
          aria-describedby={error !== null ? "users-change-email-error" : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
        {error !== null && (
          <p id="users-change-email-error" role="alert" className="users-row-error">
            {error}
          </p>
        )}
        <div className="users-confirm-actions">
          <button type="button" className="btn-secondary" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={pending}>
            Save email
          </button>
        </div>
      </form>
    </Modal>
  );
}
