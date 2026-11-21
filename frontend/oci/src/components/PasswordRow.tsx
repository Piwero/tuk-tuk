import { useEffect, useRef, useState } from "react";

import { ApiError, changePassword, type CurrentUser, fetchCurrentUser } from "../api";
import { formatTimeAgo } from "../dates";
import { Modal } from "./Modal";

// Mirrors the backend's MIN_PASSWORD_LENGTH (app.users, issue #338).
const MIN_PASSWORD_LENGTH = 12;

type PasswordFieldName = "current" | "new" | "confirm";

interface FieldError {
  message: string;
  field: PasswordFieldName;
}

const ERROR_ID = "change-password-error";

interface ChangePasswordDialogProps {
  onClose: () => void;
  onChanged: () => void;
}

/** Current password plus the new one twice (#475). The server bumps the
 * User's session epoch, signing out every other session of theirs, and
 * hands this one a fresh cookie, so this device stays signed in. */
function ChangePasswordDialog({
  onClose,
  onChanged,
}: ChangePasswordDialogProps): React.JSX.Element {
  const [values, setValues] = useState<Record<PasswordFieldName, string>>({
    current: "",
    new: "",
    confirm: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const fields = {
    current: useRef<HTMLInputElement>(null),
    new: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  function fail(message: string, field: PasswordFieldName): void {
    setError({ message, field });
  }

  // After the render that re-enables the fields: a disabled input can't
  // take focus.
  useEffect(() => {
    if (error !== null) {
      fields[error.field].current?.focus();
    }
    // `fields` holds refs, stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (pending) {
      return;
    }
    // Caught before any request: neither is worth spending a throttled
    // attempt on (a wrong current password shares one counter with login).
    if (values.new.length < MIN_PASSWORD_LENGTH) {
      fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, "new");
      return;
    }
    if (values.new !== values.confirm) {
      fail("New password and confirmation don't match.", "confirm");
      return;
    }
    setPending(true);
    setError(null);
    changePassword(values.current, values.new)
      .then(onChanged)
      .catch((err: unknown) => {
        setPending(false);
        if (err instanceof ApiError && err.code === "invalid_current_password") {
          fail("Current password is incorrect.", "current");
          return;
        }
        fail(err instanceof ApiError ? err.message : "Something went wrong. Try again.", "current");
      });
  }

  function field(name: PasswordFieldName, label: string, hint?: string): React.JSX.Element {
    const id = `change-password-${name}`;
    const invalid = error?.field === name;
    const describedBy = [hint !== undefined ? `${id}-hint` : null, invalid ? ERROR_ID : null]
      .filter((part) => part !== null)
      .join(" ");
    return (
      <div className="settings-field">
        <label htmlFor={id}>{label}</label>
        {hint !== undefined && (
          <p className="settings-hint" id={`${id}-hint`}>
            {hint}
          </p>
        )}
        <input
          ref={fields[name]}
          id={id}
          name={`${name}-password`}
          type="password"
          autoComplete={name === "current" ? "current-password" : "new-password"}
          autoFocus={name === "current"}
          value={values[name]}
          disabled={pending}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          onChange={(event) => {
            setValues((previous) => ({ ...previous, [name]: event.target.value }));
            setError(null);
          }}
        />
      </div>
    );
  }

  return (
    <Modal title="Change password" onClose={onClose}>
      <form className="settings-form change-password-form" onSubmit={handleSubmit} noValidate>
        <p className="settings-lead">
          Your other devices and sessions will be signed out. This one stays signed in.
        </p>
        {field("current", "Current password")}
        {field("new", "New password", `At least ${MIN_PASSWORD_LENGTH} characters.`)}
        {field("confirm", "Confirm new password")}
        {error !== null && (
          <p role="alert" id={ERROR_ID}>
            {error.message}
          </p>
        )}
        <div className="change-password-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="settings-primary-action" disabled={pending}>
            {pending ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface PasswordRowProps {
  user: CurrentUser;
  onUserChange: (user: CurrentUser) => void;
}

/** The Profile card's Password row (#475): when the password last changed,
 * and the dialog to change it. */
export function PasswordRow({ user, onUserChange }: PasswordRowProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);

  function handleChanged(): void {
    setOpen(false);
    setChanged(true);
    // Re-read the record so the row shows the server's time, not a guess.
    void fetchCurrentUser().then(onUserChange);
  }

  return (
    <div className="password-row">
      <div>
        <h3>Password</h3>
        <p className="settings-hint">Changed {formatTimeAgo(new Date(user.password_changed_at))}</p>
        {changed && (
          <p role="status" className="settings-success">
            Password changed. Your other devices will need to sign in again.
          </p>
        )}
      </div>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          setChanged(false);
          setOpen(true);
        }}
      >
        Change password
      </button>
      {open && <ChangePasswordDialog onClose={() => setOpen(false)} onChanged={handleChanged} />}
    </div>
  );
}
