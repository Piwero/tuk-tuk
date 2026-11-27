import { useState } from "react";

import { type AdminUser, ApiError } from "../api";
import { Modal } from "./Modal";
import { LAST_ADMIN_REASON } from "./UserActionsMenu";

export function DeleteUserDialog({
  account,
  onDelete,
  onClose,
}: {
  account: AdminUser;
  onDelete: (email: string) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = account.email !== null && email === account.email;

  return (
    <Modal title={`Delete ${account.username}’s account?`} onClose={onClose} dismissible={!pending}>
      <form
        className="users-email-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!matches || pending) return;
          setPending(true);
          setError(null);
          onDelete(email).then(onClose, (err: unknown) => {
            setError(
              err instanceof ApiError && err.code === "last_admin"
                ? LAST_ADMIN_REASON
                : "Couldn’t delete the account. Check the email and try again.",
            );
            setPending(false);
          });
        }}
      >
        <p className="users-confirm-lead">
          This permanently deletes {account.username}’s account and all their data, including tasks,
          habits, goals, settings and integration credentials. Their sessions and tokens stop
          working. This cannot be undone. External services and existing backups are not changed.
        </p>
        <p>Re-enter {account.email} to confirm.</p>
        <label htmlFor="users-delete-email">Re-enter email</label>
        <input
          id="users-delete-email"
          type="email"
          autoComplete="off"
          value={email}
          disabled={pending}
          autoFocus
          onChange={(event) => setEmail(event.target.value)}
        />
        {error !== null && (
          <p role="alert" className="users-row-error">
            {error}
          </p>
        )}
        <div className="users-confirm-actions">
          <button type="button" className="btn-secondary" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary users-confirm-danger"
            disabled={!matches || pending}
          >
            {pending ? "Deleting…" : "Permanently delete account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
