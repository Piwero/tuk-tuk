import { useRef, useState } from "react";

import { updateProfile, type CurrentUser } from "../api";
import { identityProblem, identityRejection, type IdentityField } from "../auth/rules";
import { GoogleSignInRow } from "./GoogleSignInRow";
import { PasswordRow } from "./PasswordRow";

type ProfileFieldName = IdentityField;

/** The server's rejection, worded for the field it names. */
function rejectionMessage(err: unknown): string {
  return identityRejection(err)?.message ?? "Something went wrong. Try again.";
}

interface ProfileFieldProps {
  field: ProfileFieldName;
  label: string;
  saved: string;
  onSaved: (user: CurrentUser) => void;
  /** Shown instead of editing, when the User can't change this field. */
  lockedReason?: string;
}

/** One profile field with its own Save: each field saves on its own and
 * reports a taken or invalid value on itself (#474). Save appears once the
 * value differs from the saved one. */
function ProfileField({
  field,
  label,
  saved,
  onSaved,
  lockedReason,
}: ProfileFieldProps): React.JSX.Element {
  const [value, setValue] = useState(saved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = `settings-profile-${field}`;
  const errorId = `${id}-error`;
  const lockedId = `${id}-locked`;
  const dirty = value.trim() !== saved;

  function fail(message: string): void {
    setError(message);
    inputRef.current?.focus();
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (pending || !dirty) {
      return;
    }
    const next = value.trim();
    setSuccess(false);
    const reason = identityProblem(field, next);
    if (reason !== null) {
      fail(reason);
      return;
    }
    setPending(true);
    setError(null);
    updateProfile({ [field]: next })
      .then((user) => {
        setPending(false);
        setValue(user[field] ?? "");
        setSuccess(true);
        onSaved(user);
      })
      .catch((err: unknown) => {
        setPending(false);
        fail(rejectionMessage(err));
      });
  }

  return (
    <form className="settings-field profile-field" onSubmit={handleSubmit} noValidate>
      <label htmlFor={id}>{label}</label>
      <div className="profile-field-row">
        <input
          ref={inputRef}
          id={id}
          name={field}
          type={field === "email" ? "email" : "text"}
          autoComplete={field}
          value={value}
          disabled={pending}
          readOnly={lockedReason !== undefined}
          aria-invalid={error !== null || undefined}
          aria-describedby={
            error !== null ? errorId : lockedReason !== undefined ? lockedId : undefined
          }
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
            setSuccess(false);
          }}
        />
        {dirty && (
          <button
            type="submit"
            className="btn-secondary"
            aria-label={`Save ${label.toLowerCase()}`}
            disabled={pending}
          >
            Save
          </button>
        )}
      </div>
      {lockedReason !== undefined && (
        <p id={lockedId} className="settings-hint">
          {lockedReason}
        </p>
      )}
      {error !== null && (
        <p role="alert" id={errorId}>
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="settings-success">
          {label} saved.
        </p>
      )}
    </form>
  );
}

interface ProfileCardProps {
  user: CurrentUser;
  onUserChange: (user: CurrentUser) => void;
}

/** Settings › My account's Profile card (#474): the signed-in User's own
 * username and email, each saved on its own. */
export function ProfileCard({ user, onUserChange }: ProfileCardProps): React.JSX.Element {
  return (
    <section aria-label="Profile" id="settings-profile" className="settings-section">
      <div className="settings-section-head">
        <h2>Profile</h2>
      </div>
      <div className="profile-fields">
        <ProfileField
          field="username"
          label="Username"
          saved={user.username}
          onSaved={onUserChange}
        />
        <ProfileField
          field="email"
          label="Email"
          saved={user.email ?? ""}
          onSaved={onUserChange}
          lockedReason={
            user.google_email !== null
              ? "Your email matches your Google sign-in. Ask an admin to change it."
              : undefined
          }
        />
      </div>
      <PasswordRow user={user} onUserChange={onUserChange} />
      <GoogleSignInRow user={user} />
    </section>
  );
}
