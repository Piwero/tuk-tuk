import "./AuthGate.css";
import { useCallback, useEffect, useState } from "react";

import { App } from "./App";
import { ApiError, type CurrentUser, fetchCurrentUser, logout, onUnauthorized } from "./api";
import { ChangePasswordStep } from "./auth/ChangePasswordStep";
import { CompleteProfileStep } from "./auth/CompleteProfileStep";
import { ForcedStepFrame } from "./auth/ForcedStepFrame";
import { SetupScreen } from "./auth/SetupScreen";
import { type SignInNotice, SignInScreen } from "./auth/SignInScreen";
import { clearSignedInData } from "./layoutPrefs";
import { pathForSmartView } from "./routes";

/** What the gate shows, resolved from the current-user request (#468).
 * Only "signed-in" renders the app; the two forced steps render with no
 * application chrome, whatever the URL, and are cleared only by the
 * server's answer to completing them — the gate re-reads the account
 * record rather than trusting client state. */
export type GateState =
  | { kind: "checking" }
  | { kind: "needs-setup" }
  | { kind: "signed-out"; notice: SignInNotice | null }
  | { kind: "must-change-password"; user: CurrentUser }
  | { kind: "must-complete-profile"; user: CurrentUser }
  | { kind: "signed-in"; user: CurrentUser };

const SIGNED_OUT: GateState = { kind: "signed-out", notice: null };

/** A profile to complete outranks a password to replace, as it does in the
 * backend's middleware: completing the profile sets a new password too. */
function stateForUser(user: CurrentUser): GateState {
  if (user.must_complete_profile) {
    return { kind: "must-complete-profile", user };
  }
  if (user.must_change_password) {
    return { kind: "must-change-password", user };
  }
  return { kind: "signed-in", user };
}

/** A 401's code: no User yet, a disabled account (which says so on the
 * sign-in screen), or anything else — no session, or one ended elsewhere. */
function stateForAuthCode(code: string | null): GateState {
  if (code === "setup_required") {
    return { kind: "needs-setup" };
  }
  if (code === "account_disabled") {
    return { kind: "signed-out", notice: "account-disabled" };
  }
  return SIGNED_OUT;
}

/** Sits above App: reads who is signed in on mount and shows first-run
 * setup, sign-in, a pending forced step, or the app itself, and returns to
 * sign-in if any later request reports the session has ended. Composed at
 * the entry point rather than inside App, so App's own bootstrap effects —
 * and its whole test suite — never need to know authentication exists. */
export function AuthGate({
  voiceProvider,
}: { voiceProvider?: import("./voice/session").VoiceProvider } = {}): React.JSX.Element | null {
  const [state, setState] = useState<GateState>({ kind: "checking" });

  const resolve = useCallback(
    (): Promise<void> =>
      fetchCurrentUser().then(
        (user) => setState(stateForUser(user)),
        (err: unknown) => setState(stateForAuthCode(err instanceof ApiError ? err.code : null)),
      ),
    [],
  );

  useEffect(() => {
    void resolve();
  }, [resolve]);

  useEffect(() => onUnauthorized((code) => setState(stateForAuthCode(code))), []);

  // Clearing the cookie server-side is what actually ends the session;
  // signing out regardless of the request's outcome just gets the sign-in
  // screen back up promptly, and unmounts App so no Task or List content is
  // left sitting in component state behind it. What the browser stored for
  // this person is dropped first, before sign-in renders (#473).
  const signOut = useCallback(
    () =>
      void logout().finally(() => {
        clearSignedInData();
        setState(SIGNED_OUT);
      }),
    [],
  );

  // A completed step or a new admin lands on Today, whatever URL they came
  // in at, once the server has said so.
  const landOnToday = useCallback((): Promise<void> => {
    window.history.replaceState(null, "", pathForSmartView("today"));
    return resolve();
  }, [resolve]);

  switch (state.kind) {
    case "checking":
      return null;
    case "needs-setup":
      return <SetupScreen onSuccess={landOnToday} onAlreadySetUp={() => setState(SIGNED_OUT)} />;
    case "signed-out":
      return <SignInScreen notice={state.notice} onSuccess={resolve} />;
    case "must-change-password":
      return (
        <ForcedStepFrame
          title="Choose a new password"
          footer={`Signed in as ${state.user.username}`}
          onLogout={signOut}
        >
          <ChangePasswordStep onComplete={landOnToday} />
        </ForcedStepFrame>
      );
    case "must-complete-profile":
      return (
        <ForcedStepFrame
          title="Complete your profile"
          footer="Signed in with your existing password"
          onLogout={signOut}
        >
          <CompleteProfileStep onComplete={landOnToday} />
        </ForcedStepFrame>
      );
    case "signed-in":
      return <App voiceProvider={voiceProvider} user={state.user} onLogout={signOut} />;
  }
}
