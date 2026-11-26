import { useEffect, useState } from "react";

import {
  ApiError,
  cancelInvitation,
  createInvitation,
  fetchInvitationAvailability,
  fetchInvitationLink,
  fetchInvitations,
  type Invitation,
  type InvitationAvailability,
  type InvitationStatus,
  resendInvitation,
  retryInvitationDelivery,
} from "../api";

const STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  expired: "Expired",
  canceled: "Canceled",
};

const STATUS_STATE: Record<InvitationStatus, string> = {
  pending: "pending",
  accepted: "active",
  expired: "disabled",
  canceled: "disabled",
};

/** What the app knows of an invitation's email (#586). "Emailed" means the
 * mail server took it, never that it reached an inbox. */
function deliveryLabel(invitation: Invitation): string {
  switch (invitation.delivery) {
    case "sent":
      return "Emailed";
    case "failed":
      return `Not emailed: ${invitation.delivery_error ?? "the email couldn’t be sent"}`;
    case "not_sent":
      return "Not emailed yet";
  }
}

function inviteError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "invalid_email":
        return "Enter a valid email address.";
      case "email_taken":
        return "Someone already has an account with that email.";
      case "invitation_exists":
        return "That email already has an invitation. Resend it instead.";
      case "google_sign_in_unavailable":
        return "Invitations need Google sign-in, which isn’t set up on this instance.";
    }
  }
  return "Couldn’t send the invitation. Try again.";
}

type Load =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; availability: InvitationAvailability; items: Invitation[] };

/** Settings › Users › Invitations (#586): invite an email address, then
 * follow each invitation's status and delivery. An invitation admits a
 * regular User only; making them an Admin stays a separate step. */
export function InvitationsPanel(): React.JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    let live = true;
    Promise.all([fetchInvitationAvailability(), fetchInvitations()]).then(
      ([availability, page]) => {
        if (live) setLoad({ kind: "loaded", availability, items: page.items });
      },
      () => {
        if (live) setLoad({ kind: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  function put(updated: Invitation): void {
    setLoad((current) =>
      current.kind === "loaded"
        ? {
            ...current,
            items: current.items.some((item) => item.id === updated.id)
              ? current.items.map((item) => (item.id === updated.id ? updated : item))
              : [updated, ...current.items],
          }
        : current,
    );
  }

  function act(invitation: Invitation, what: string, action: () => Promise<Invitation>): void {
    setRowErrors((errors) => {
      const others = { ...errors };
      delete others[invitation.id];
      return others;
    });
    setNotice(null);
    action().then(put, () =>
      setRowErrors((errors) => ({
        ...errors,
        [invitation.id]: `Couldn’t ${what} the invitation for ${invitation.email}. Try again.`,
      })),
    );
  }

  function copyLink(invitation: Invitation): void {
    setNotice(null);
    fetchInvitationLink(invitation.id)
      .then(({ url }) => navigator.clipboard.writeText(url))
      .then(
        () => setNotice("Link copied."),
        () =>
          setRowErrors((errors) => ({
            ...errors,
            [invitation.id]: `Couldn’t copy the link for ${invitation.email}. Try again.`,
          })),
      );
  }

  if (load.kind === "loading") {
    return <section aria-label="Invitations" className="users-invitations" aria-busy="true" />;
  }
  if (load.kind === "failed") {
    return (
      <section aria-label="Invitations" className="users-invitations">
        <h2>Invitations</h2>
        <p className="settings-hint">Couldn’t load invitations.</p>
      </section>
    );
  }

  const { availability, items } = load;
  return (
    <section aria-label="Invitations" className="users-invitations">
      <h2>Invitations</h2>
      {!availability.google_sign_in ? (
        <p className="settings-hint">
          Invitations need Google sign-in, which isn’t set up on this instance.
        </p>
      ) : (
        <>
          <p className="users-boundary">
            The person accepts by signing in with the Google account for that email, and becomes a
            member. Links expire after seven days.
          </p>
          {!availability.email_delivery && (
            <p className="settings-hint">
              Email isn’t set up on this instance: copy each invitation’s link and send it yourself.
            </p>
          )}
          <form
            className="users-invite-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (pending) return;
              setPending(true);
              setError(null);
              setNotice(null);
              createInvitation(email).then(
                (created) => {
                  put(created);
                  setEmail("");
                  setPending(false);
                  setNotice(
                    created.delivery === "sent"
                      ? `Invitation sent to ${created.email}.`
                      : `Invitation created for ${created.email}, but not emailed. Copy its link.`,
                  );
                },
                (err: unknown) => {
                  setError(inviteError(err));
                  setPending(false);
                },
              );
            }}
          >
            <label htmlFor="users-invite-email">Email to invite</label>
            <input
              id="users-invite-email"
              type="email"
              autoComplete="off"
              value={email}
              disabled={pending}
              aria-describedby={error !== null ? "users-invite-error" : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button type="submit" className="settings-primary-action" disabled={pending}>
              Invite
            </button>
          </form>
          {error !== null && (
            <p id="users-invite-error" role="alert" className="users-row-error">
              {error}
            </p>
          )}
        </>
      )}
      <p role="status" className="settings-success">
        {notice}
      </p>
      {items.length > 0 && (
        <table aria-label="Invitations" className="users-table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Status</th>
              <th scope="col">Email delivery</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((invitation) => {
              const open = invitation.status === "pending" || invitation.status === "expired";
              return (
                <tr key={invitation.id} className="users-row">
                  <th scope="row" className="users-cell-user">
                    {invitation.email}
                    {rowErrors[invitation.id] !== undefined && (
                      <p role="alert" className="users-row-error">
                        {rowErrors[invitation.id]}
                      </p>
                    )}
                  </th>
                  <td>
                    <span className="users-status" data-status={STATUS_STATE[invitation.status]}>
                      {STATUS_LABEL[invitation.status]}
                    </span>
                  </td>
                  <td>{invitation.status === "pending" ? deliveryLabel(invitation) : "—"}</td>
                  <td className="users-invitation-actions">
                    {invitation.status === "pending" && (
                      <>
                        <button
                          type="button"
                          className="btn-quiet"
                          onClick={() => copyLink(invitation)}
                        >
                          Copy link
                        </button>
                        {invitation.delivery !== "sent" && (
                          <button
                            type="button"
                            className="btn-quiet"
                            onClick={() =>
                              act(invitation, "email", () => retryInvitationDelivery(invitation.id))
                            }
                          >
                            Retry sending
                          </button>
                        )}
                      </>
                    )}
                    {open && (
                      <>
                        <button
                          type="button"
                          className="btn-quiet"
                          onClick={() =>
                            act(invitation, "resend", () => resendInvitation(invitation.id))
                          }
                        >
                          Resend
                        </button>
                        <button
                          type="button"
                          className="btn-quiet"
                          onClick={() =>
                            act(invitation, "cancel", () => cancelInvitation(invitation.id))
                          }
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
