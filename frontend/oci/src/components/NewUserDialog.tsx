import { useEffect, useRef, useState } from "react";

import { type AdminUser, createAdminUser } from "../api";
import { identityProblem, identityRejection, type IdentityField } from "../auth/rules";
import { generateTemporaryPassword } from "../auth/temporaryPassword";
import { Modal } from "./Modal";
import { OneTimePassword } from "./OneTimePassword";

type Field = IdentityField;
/** Per field, plus `form` for a failure that belongs to no field. */
type FieldErrors = Partial<Record<Field | "form", string>>;

const EMAIL_HINT = "Kept for password resets later. tuk-tuk sends no email.";

/** Caught before any request, every field at once; the server's checks are
 * the backstop. */
function validate(username: string, email: string): FieldErrors {
  const errors: FieldErrors = {};
  for (const [field, value] of [
    ["username", username],
    ["email", email],
  ] as const) {
    const problem = identityProblem(field, value);
    if (problem !== null) {
      errors[field] = problem;
    }
  }
  return errors;
}

/** The server's rejection, on the field it names (#412's per-field codes). */
function rejection(err: unknown): { field: Field | "form"; message: string } {
  return (
    identityRejection(err) ?? { field: "form", message: "Couldn’t create the user. Try again." }
  );
}

type Stage =
  { kind: "form" } | { kind: "created"; account: AdminUser; password: string; ready: boolean };

interface NewUserDialogProps {
  onClose: () => void;
  /** Runs after each account is created, while the dialog stays open on its
   * temporary password. */
  onCreated: (account: AdminUser) => void;
}

/** Settings › Users › New user (#479): username, email and the Administrator
 * switch; then the generated temporary password, shown once. Until the
 * Admin has copied it or confirmed they have it, nothing closes the dialog. */
export function NewUserDialog({ onClose, onCreated }: NewUserDialogProps): JSX.Element {
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ field: Field } | null>(null);
  const fields = {
    username: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
  };

  // After the render that re-enables the fields: a disabled input can't take
  // focus.
  useEffect(() => {
    if (focusRequest !== null) {
      fields[focusRequest.field].current?.focus();
    }
    // `fields` holds refs, stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (pending) {
      return;
    }
    const name = username.trim();
    const address = email.trim();
    const invalid = validate(name, address);
    const first = (["username", "email"] as const).find((field) => invalid[field] !== undefined);
    if (first !== undefined) {
      setErrors(invalid);
      setFocusRequest({ field: first });
      return;
    }
    const password = generateTemporaryPassword();
    setPending(true);
    setErrors({});
    createAdminUser({ username: name, email: address, temp_password: password, is_admin: isAdmin })
      .then((account) => {
        setPending(false);
        setStage({ kind: "created", account, password, ready: false });
        onCreated(account);
      })
      .catch((err: unknown) => {
        setPending(false);
        const { field, message } = rejection(err);
        setErrors({ [field]: message });
        setFocusRequest({ field: field === "form" ? "username" : field });
      });
  }

  function addAnother(): void {
    setUsername("");
    setEmail("");
    setIsAdmin(false);
    setErrors({});
    setStage({ kind: "form" });
    setFocusRequest({ field: "username" });
  }

  if (stage.kind === "created") {
    const { account, password, ready } = stage;
    return (
      <Modal title="User created" onClose={onClose} dismissible={ready}>
        <div className="new-user-created">
          <dl className="new-user-summary">
            <div>
              <dt>Username</dt>
              <dd>{account.username}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{account.email}</dd>
            </div>
            <div>
              <dt>Administrator</dt>
              <dd>{account.is_admin ? "Yes" : "No"}</dd>
            </div>
          </dl>
          <OneTimePassword
            username={account.username}
            signIn="first"
            password={password}
            ready={ready}
            onReadyChange={(next) => setStage({ ...stage, ready: next })}
          />
          <div className="new-user-actions">
            <button type="button" className="btn-secondary" onClick={addAnother} disabled={!ready}>
              Add another
            </button>
            <button
              type="button"
              className="settings-primary-action"
              onClick={onClose}
              disabled={!ready}
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  function field(name: Field, label: string, value: string, onChange: (v: string) => void) {
    const id = `new-user-${name}`;
    const hintId = name === "email" ? `${id}-hint` : null;
    const error = errors[name];
    const errorId = error !== undefined ? `${id}-error` : null;
    const describedBy = [hintId, errorId].filter((part) => part !== null).join(" ");
    return (
      <div className="settings-field">
        <label htmlFor={id}>{label}</label>
        <input
          ref={fields[name]}
          id={id}
          name={name}
          type={name === "email" ? "email" : "text"}
          autoComplete="off"
          autoFocus={name === "username"}
          value={value}
          disabled={pending}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          onChange={(event) => {
            onChange(event.target.value);
            setErrors((previous) => ({ ...previous, [name]: undefined }));
          }}
        />
        {hintId !== null && (
          <p className="settings-hint" id={hintId}>
            {EMAIL_HINT}
          </p>
        )}
        {errorId !== null && (
          <p role="alert" id={errorId}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <Modal title="New user" onClose={onClose}>
      <form className="settings-form new-user-form" onSubmit={handleSubmit} noValidate>
        {field("username", "Username", username, setUsername)}
        {field("email", "Email", email, setEmail)}
        <label className="new-user-admin">
          <input
            type="checkbox"
            role="switch"
            checked={isAdmin}
            disabled={pending}
            onChange={(event) => setIsAdmin(event.target.checked)}
          />
          Administrator
        </label>
        {errors.form !== undefined && <p role="alert">{errors.form}</p>}
        <div className="new-user-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="settings-primary-action" disabled={pending}>
            {pending ? "Creating…" : "Create user"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
