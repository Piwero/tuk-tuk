import "./OneTimePassword.css";
import { useRef, useState } from "react";

interface OneTimePasswordProps {
  /** Whose password it is, named in the reminder to pass it on. */
  username: string;
  password: string;
  /** Whether the Admin has the password: Copy succeeded, or they ticked
   * "I have it". The dialog holding this keeps itself open until then. */
  ready: boolean;
  onReadyChange: (ready: boolean) => void;
}

/** A temporary password shown exactly once (#468), shared by New user (#479)
 * and Reset password (#480): the value with Copy, what happens next, and the
 * "I have it" confirmation for an Admin who saved it another way. The value
 * lives only in the caller's state; it is gone once the dialog closes. */
export function OneTimePassword({
  username,
  password,
  ready,
  onReadyChange,
}: OneTimePasswordProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const value = useRef<HTMLElement>(null);

  /** Where the clipboard is unavailable or refused, select the text so the
   * Admin can copy it by hand (and then confirm "I have it"). */
  function selectValue(): void {
    if (value.current !== null) {
      window.getSelection()?.selectAllChildren(value.current);
    }
  }

  function copy(): void {
    if (navigator.clipboard === undefined) {
      selectValue();
      return;
    }
    navigator.clipboard.writeText(password).then(() => {
      setCopied(true);
      onReadyChange(true);
    }, selectValue);
  }

  return (
    <div className="one-time-password">
      <p className="one-time-password-label">Temporary password</p>
      <div className="one-time-password-box">
        <code ref={value}>{password}</code>
        <button type="button" className="btn-secondary" onClick={copy} autoFocus>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <ul className="one-time-password-notes">
        <li>Shown once. Copy it now and pass it to {username} yourself; tuk-tuk sends no email.</li>
        <li>At first sign-in they must choose a new password before anything else.</li>
      </ul>
      <label className="one-time-password-confirm">
        <input
          type="checkbox"
          checked={ready}
          onChange={(event) => onReadyChange(event.target.checked)}
        />
        I have it
      </label>
    </div>
  );
}
