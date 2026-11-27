import type { Ref } from "react";

import { Icon } from "../components/Icon";
import { MIN_PASSWORD_LENGTH } from "./rules";

/** One line of the checklist: a tick once met, an empty ring until then,
 * with the state also spoken, since the glyph alone is decorative. */
function Rule({ met, children }: { met: boolean; children: string }): React.JSX.Element {
  return (
    <li className="auth-gate-rule" data-met={met}>
      {met ? <Icon name="check" /> : <span className="auth-gate-rule-ring" aria-hidden="true" />}
      {children}
      <span className="visually-hidden">{met ? ": done" : ": not yet"}</span>
    </li>
  );
}

/** The new password, its confirmation and a checklist that ticks as the
 * person types — shared by both forced steps (#471, #472), which each set a
 * password the person has not typed before. `invalid` and `errorId` mark the
 * new password field when the server rejects it. */
export function NewPasswordFields({
  newPassword,
  confirmation,
  onNewPasswordChange,
  onConfirmationChange,
  disabled,
  invalid,
  errorId,
  newPasswordRef,
}: {
  newPassword: string;
  confirmation: string;
  onNewPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  errorId: string;
  newPasswordRef?: Ref<HTMLInputElement>;
}): React.JSX.Element {
  return (
    <>
      <label htmlFor="auth-gate-new-password">New password</label>
      <input
        ref={newPasswordRef}
        id="auth-gate-new-password"
        name="new-password"
        type="password"
        autoComplete="new-password"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        value={newPassword}
        onChange={(event) => onNewPasswordChange(event.target.value)}
      />
      <label htmlFor="auth-gate-confirm-new-password">Confirm new password</label>
      <input
        id="auth-gate-confirm-new-password"
        name="confirm-new-password"
        type="password"
        autoComplete="new-password"
        disabled={disabled}
        value={confirmation}
        onChange={(event) => onConfirmationChange(event.target.value)}
      />
      <ul className="auth-gate-rules" aria-label="Password requirements">
        <Rule met={newPassword.length >= MIN_PASSWORD_LENGTH}>
          {`At least ${MIN_PASSWORD_LENGTH} characters`}
        </Rule>
        <Rule met={confirmation !== "" && confirmation === newPassword}>Both entries match</Rule>
      </ul>
    </>
  );
}
