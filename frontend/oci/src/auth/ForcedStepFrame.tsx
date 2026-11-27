import type { ReactNode } from "react";

/** The card both forced steps share (#468): a badge, the step's heading,
 * its form, and a footer saying who is signed in with a way to log out.
 * Rendered by the gate with no application chrome — no sidebar, tab bar or
 * other navigation — so the step plainly cannot be skipped. The step's own
 * form (#471 the temporary password, #472 the profile) is the children. */
export function ForcedStepFrame({
  title,
  footer,
  onLogout,
  children,
}: {
  title: string;
  footer: string;
  onLogout: () => void;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="auth-gate">
      <div className="auth-gate-form">
        <p className="auth-gate-badge">One step before you start</p>
        <h1>{title}</h1>
        {children}
        <div className="auth-gate-step-footer">
          <span>{footer}</span>
          <button type="button" className="btn-quiet" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
