import { useState } from "react";

import type { AdminUser } from "../api";
import { generateTemporaryPassword } from "../auth/temporaryPassword";
import { Modal } from "./Modal";
import { OneTimePassword } from "./OneTimePassword";

type Stage =
  { kind: "confirm"; pending: boolean } | { kind: "done"; password: string; ready: boolean };

interface ResetPasswordDialogProps {
  account: AdminUser;
  isSelf: boolean;
  /** Sends the new temporary password. Rejects when the reset failed; the
   * panel says so on the row and this dialog closes. */
  onReset: (password: string) => Promise<void>;
  onClose: () => void;
}

/** Settings › Users › Reset password (#480): a confirm that says what a
 * reset does, then the generated temporary password, shown once in the same
 * block as New user (#479). Until the Admin has copied it or confirmed they
 * have it, nothing closes the dialog. */
export function ResetPasswordDialog({
  account,
  isSelf,
  onReset,
  onClose,
}: ResetPasswordDialogProps): JSX.Element {
  const [stage, setStage] = useState<Stage>({ kind: "confirm", pending: false });
  const name = account.username;

  function reset(): void {
    const password = generateTemporaryPassword();
    setStage({ kind: "confirm", pending: true });
    onReset(password).then(() => setStage({ kind: "done", password, ready: false }), onClose);
  }

  // One Modal for both stages, so it stays mounted and returns focus to the
  // row's menu button it opened from.
  return (
    <Modal
      title={
        stage.kind === "confirm" ? `Reset password for ${name}?` : `Password reset for ${name}`
      }
      onClose={onClose}
      dismissible={stage.kind === "confirm" ? !stage.pending : stage.ready}
    >
      {stage.kind === "confirm" ? (
        <>
          <p className="users-confirm-lead">
            {isSelf
              ? "You are signed out everywhere, here included, and must choose a new password at next sign-in."
              : `${name} is signed out everywhere and must choose a new password at next sign-in.`}
          </p>
          <div className="users-confirm-actions">
            <button
              type="button"
              className="btn-secondary"
              autoFocus
              disabled={stage.pending}
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={stage.pending} onClick={reset}>
              {stage.pending ? "Resetting…" : "Reset password"}
            </button>
          </div>
        </>
      ) : (
        <div className="new-user-created">
          <OneTimePassword
            username={name}
            password={stage.password}
            ready={stage.ready}
            onReadyChange={(ready) => setStage({ ...stage, ready })}
          />
          <div className="new-user-actions">
            <button
              type="button"
              className="settings-primary-action"
              onClick={onClose}
              disabled={!stage.ready}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
