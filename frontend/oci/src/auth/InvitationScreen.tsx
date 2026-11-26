import { useEffect, useRef, useState } from "react";

import {
  acceptInvitation,
  ApiError,
  fetchGoogleStatus,
  googleConnectUrl,
  type InvitationStatus,
  lookupInvitation,
  startInvitationSignIn,
} from "../api";
import { browserNavigation } from "../navigation";
import { AuthBrand } from "./AuthBrand";

/** Where the invitation link's token is kept for this tab between leaving
 * for Google and coming back (#586). The link carries it in the fragment,
 * which never reaches a server; it is moved here and wiped from the
 * address bar at once, and dropped once the account exists. */
const TOKEN_KEY = "tuktuk.invitationToken";

/** Why Google sent the person back without an account (#586), by the code
 * the backend's callback put in the URL. */
const UNAVAILABLE = "This invitation can no longer be accepted. Ask your admin for a new one.";
const IDENTITY_IN_USE = "That Google account already signs in to another account here.";
const EMAIL_IN_USE =
  "An account already uses this email. Sign in to it instead, or ask your admin.";
const CALLBACK_ERRORS: Record<string, string> = {
  email_mismatch:
    "That Google account isn’t the one invited. Continue with the Google account for the invited email.",
  google_email_unverified:
    "Google hasn’t verified that account’s email. Use a Google account with a verified email.",
  identity_in_use: IDENTITY_IN_USE,
  email_in_use: EMAIL_IN_USE,
  invitation_unavailable: UNAVAILABLE,
  google_cancelled: "Signing in with Google was canceled. Continue with Google when you’re ready.",
};
const GOOGLE_FAILED = "Signing in with Google didn’t complete. Try again.";

const CLOSED: Record<Exclude<InvitationStatus, "pending">, string> = {
  expired: "This invitation has expired. Ask your admin to send it again.",
  canceled: "This invitation was canceled. Ask your admin for a new one.",
  accepted: "This invitation was already used. Sign in instead.",
};

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function keepToken(token: string | null): void {
  try {
    if (token === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Without storage the link still works, just not a retry after Google.
  }
}

/** Reads what the URL says once, then wipes it: the token from the
 * fragment (kept for this tab), the step or error from the query. */
function takeFromUrl(): { step: string | null; error: string | null } {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("token");
  if (token !== null) keepToken(token);
  const query = new URLSearchParams(window.location.search);
  const taken = { step: query.get("step"), error: query.get("error") };
  window.history.replaceState(null, "", "/invite");
  return taken;
}

type Stage = { kind: "welcome" } | { kind: "username" } | { kind: "calendar" };

const ERROR_ID = "invitation-error";

/** Accepting an invitation (#586): who the link is for, then Google, then a
 * username, then an optional offer to connect Google Calendar. Rendered by
 * the gate for /invite with no application chrome. `onDone` lands the new
 * User in the app. */
export function InvitationScreen({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [initial] = useState(takeFromUrl);
  const [stage, setStage] = useState<Stage>(
    initial.step === "username" ? { kind: "username" } : { kind: "welcome" },
  );
  const [error, setError] = useState<string | null>(
    initial.error === null ? null : (CALLBACK_ERRORS[initial.error] ?? GOOGLE_FAILED),
  );

  if (stage.kind === "calendar") {
    return <CalendarOffer onDone={onDone} />;
  }
  return (
    <div className="auth-gate">
      <div className="auth-gate-form">
        <AuthBrand />
        {stage.kind === "username" ? (
          <UsernameStep
            onAccepted={() => {
              keepToken(null);
              setStage({ kind: "calendar" });
            }}
          />
        ) : (
          <Welcome error={error} onError={setError} />
        )}
      </div>
    </div>
  );
}

type Lookup =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "found"; email: string; status: InvitationStatus };

function Welcome({
  error,
  onError,
}: {
  error: string | null;
  onError: (message: string | null) => void;
}): React.JSX.Element {
  const [token] = useState(readToken);
  const [lookup, setLookup] = useState<Lookup>(
    token === null ? { kind: "missing" } : { kind: "loading" },
  );
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (token === null) return;
    let live = true;
    lookupInvitation(token).then(
      (found) => {
        if (live) setLookup({ kind: "found", ...found });
      },
      () => {
        if (live) setLookup({ kind: "missing" });
      },
    );
    return () => {
      live = false;
    };
  }, [token]);

  function continueWithGoogle(): void {
    if (token === null) return;
    setPending(true);
    onError(null);
    startInvitationSignIn(token).then(
      (url) => browserNavigation.assign(url),
      (err: unknown) => {
        onError(
          err instanceof ApiError && err.code === "invitation_unavailable"
            ? UNAVAILABLE
            : GOOGLE_FAILED,
        );
        setPending(false);
      },
    );
  }

  const closed =
    lookup.kind === "missing"
      ? "This invitation link isn’t valid. Ask your admin for a new one."
      : lookup.kind === "found" && lookup.status !== "pending"
        ? CLOSED[lookup.status]
        : null;
  const message = closed ?? error;

  return (
    <>
      <h1>You’re invited</h1>
      {lookup.kind === "found" && (
        <p className="auth-gate-invited">
          This invitation is for <strong>{lookup.email}</strong>. Continue with the Google account
          for that email.
        </p>
      )}
      {message !== null && (
        <p className="auth-gate-error" role="alert">
          {message}
        </p>
      )}
      {lookup.kind === "found" && lookup.status === "pending" && (
        <button
          className="btn-primary"
          type="button"
          disabled={pending}
          onClick={continueWithGoogle}
        >
          Continue with Google
        </button>
      )}
      {closed !== null && (
        <a className="auth-gate-footnote" href="/">
          Go to sign in
        </a>
      )}
    </>
  );
}

function usernameError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "username_taken":
        return "That username is already taken.";
      case "invalid_username":
        return "Choose a username of 1 to 64 characters.";
      case "acceptance_not_started":
        return "Your Google sign-in timed out. Open your invitation link again.";
      case "invitation_unavailable":
        return UNAVAILABLE;
      case "identity_in_use":
        return IDENTITY_IN_USE;
      case "email_taken":
        return EMAIL_IN_USE;
    }
  }
  return "Something went wrong. Try again.";
}

function UsernameStep({ onAccepted }: { onAccepted: () => void }): React.JSX.Element {
  const [username, setUsername] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <form
      className="auth-gate-step-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError(null);
        acceptInvitation(username).then(onAccepted, (err: unknown) => {
          setError(usernameError(err));
          setPending(false);
          field.current?.focus();
        });
      }}
    >
      <h1>Choose a username</h1>
      <p className="auth-gate-invited">
        Google confirmed your email. Pick the name you’ll go by here.
      </p>
      <label htmlFor="invitation-username">Username</label>
      <input
        ref={field}
        id="invitation-username"
        name="username"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={username}
        disabled={pending}
        aria-describedby={error !== null ? ERROR_ID : undefined}
        onChange={(event) => setUsername(event.target.value)}
      />
      {error !== null && (
        <p id={ERROR_ID} className="auth-gate-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn-primary" type="submit" disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </button>
    </form>
  );
}

/** The optional Calendar step (#586): connecting is a separate, read-only
 * consent, skippable without losing anything. Skipped silently when this
 * instance offers no Google Calendar at all. */
function CalendarOffer({ onDone }: { onDone: () => void }): React.JSX.Element | null {
  const [offered, setOffered] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    fetchGoogleStatus().then(
      (status) => {
        if (!live) return;
        if (status.configured) setOffered(true);
        else onDone();
      },
      () => {
        if (live) onDone();
      },
    );
    return () => {
      live = false;
    };
  }, [onDone]);

  if (offered !== true) return null;
  return (
    <div className="auth-gate">
      <div className="auth-gate-form">
        <AuthBrand />
        <h1>Connect Google Calendar?</h1>
        <p className="auth-gate-invited">
          See your Events next to your Tasks. Tuk Tuk only reads your calendars and never changes
          them. You can connect a different Google account, or do this later in Settings.
        </p>
        {/* A full-page navigation: the consent is a browser round trip
         * through Google that only the backend can broker. */}
        <a className="btn-primary" href={googleConnectUrl()}>
          Connect Google Calendar
        </a>
        <button className="btn-secondary" type="button" onClick={onDone}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
