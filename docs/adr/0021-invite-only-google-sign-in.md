# Invite-only Google sign-in, separate from Calendar

## Status

Accepted. Amends:

- [0018](0018-multi-user-row-level-isolation.md): "nobody is invited" and
  "email delivery" are no longer out of scope for **account admission**. An
  Admin may now invite an email address, and the invitation is emailed.
  Collaboration invites (shared Lists, assignees) stay out of scope, as do
  self-signup and workspaces. A User's password becomes optional.
- [0006](0006-google-calendar-read-only-live-fetch.md) and
  [0008](0008-ui-managed-settings.md): new Google Calendar connections use a
  deployment-wide OAuth client, configured by the operator, instead of each
  User's own. The read-only, live-fetch Calendar boundary is unchanged.

Spec: issue #586.

## Context

An Admin creates every account with a temporary password and passes it on
by hand. Each User who wants Google Calendar must create their own Google
Cloud project and OAuth client. Both are friction for the people an
instance is meant for. The fix must not open registration, weaken account
isolation, or tie app access to Calendar consent.

## Decision: three separate things

- **Admission** is an Invitation (or an Admin creating an account, as
  before). Nothing else creates an account. A Google account no User has
  linked is refused, whatever its email, and creates nothing.
- **Login identity** is Google's stable account id (`sub`), stored on the
  User and unique across Users. Sign-in matches it and nothing else, never
  the email, so a changed or reused address cannot move an identity.
- **Calendar connection** (a Google Account) stays an owned, optional,
  read-only consent. It never becomes a login identity, can be a different
  Google account from the one used to sign in, and several may exist.

## Decision: an invitation is admission, created on acceptance

An Invitation names an email address and carries a single-use link valid
for seven days. Accepting needs that link, a Google account whose **verified**
email matches the invited one (trimmed, case ignored, no Gmail dot or
plus-address folding), and a unique username the person chooses. Accepting
consumes the invitation and creates the regular User, their settings and
Inbox in one transaction, under a row lock on the invitation, so a repeat or
concurrent acceptance creates nobody. A refused username consumes nothing.
Resend issues a new link and invalidates older ones; cancel closes it.

The link's token is in the URL fragment, which never reaches a server, so it
stays out of access logs. It is stored hashed for lookup and encrypted with
`APP_MASTER_KEY` so an Admin can copy the link or retry its email.

Delivery is recorded apart from the lifecycle: not sent, sent (the SMTP
server accepted it, which is no proof of delivery), or failed with a safe
reason. Without SMTP, invitations are still created and their links copied.

## Decision: identity-only sign-in, guarded by state, nonce and PKCE

Signing in asks Google for `openid email` only: no Calendar scope and no
refresh token, so declining Calendar never blocks app access. The ID token
is verified in the app: RS256 signature against Google's keys, issuer,
audience, expiry, and nonce. Each round trip's state, nonce and PKCE
verifier (Calendar consent's too) live in a short-lived signed cookie on the browser that started
it, cleared by the callback, which defeats login CSRF, ID-token replay and
authorization-code interception. Return addresses are same-site paths only.

The login and invitation callback is public. Linking Google to an existing
account has its own callback that needs the signed-in User who started it,
after they confirmed their password (counted toward the same lockout as
login), and a matching verified email. Neither callback accepts the other's
round trip. A Google sign-in uses the existing stateless session cookie,
marked as a Google session.

## Decision: passwords are optional; recovery stays with the Admin

A User admitted by invitation has no password and is never asked for one.
Password login, first-Admin `/setup` and the forced steps are unchanged for
password accounts. To recover a lost Google account, an Admin verifies the
person out of band, removes the Google sign-in (ending their sessions),
resets a temporary password, which is replaced at the next password login
(never asked of a Google session, nor of the tokens of a User who signs in
with Google), and the User links their new Google account. An Admin cannot
remove their own Google sign-in, nor the last active Admin's only way in. The User, their id and their
data never change. An email mismatch is reconciled by an Admin changing
the account's email; a User with a linked Google identity cannot change it
themselves. Disabled accounts stay disabled through all of this.

## Decision: disabling ends every way in

Disabling a User bumps their session epoch (both sign-in methods) and
revokes every API and MCP token, which also stops any MCP access credential
already issued. Re-enabling restores none of them. It does not delete data
or encrypted Calendar credentials, and does not revoke anything at Google:
Calendar is only ever read during the User's own requests, so a disabled
User's Calendar is not read, and it resumes after re-enabling if Google
still accepts the stored token.

## Decision: shared Google client and SMTP are deployment secrets

`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` and `SMTP_*` are
environment variables, like `APP_MASTER_KEY`: an Admin can neither view nor
edit them in the app, which reports only whether each is available. This
reverses ADR 0008's UI-managed Google credentials **for new connections
only**: each Google Account records whether its refresh token was minted by
the shared client or its User's own, and keeps refreshing with that one.
Existing per-User clients and tokens are never migrated, re-encrypted or
disconnected. SMTP uses the standard library, and the backend refuses to
start with cleartext SMTP outside development.

## Considered options (and why they were rejected)

- **Admit any Google account from an allowed domain.** Rejected: admission
  stays per person, chosen by an Admin.
- **Match existing Users by email on first Google sign-in.** Rejected: the
  stored email was never verified, so anyone controlling a Google account
  with that address would take the account over.
- **Treat an existing Calendar connection as the login identity.** Rejected:
  a Calendar connection may be a shared or secondary account.
- **Ask for Calendar scope at sign-in.** Rejected: declining it would block
  access, and it would mint refresh tokens nobody asked for.
- **Server-side OAuth state store.** Rejected for the same reason as
  sessions (ADR 0005): a signed, short-lived cookie bound to the browser
  gives the same guarantees without a store.
- **A hosted email vendor.** Rejected: plain SMTP works with any provider.

## Accepted trade-offs

- Passing the "unverified app" screen for the Calendar scope is the
  operator's job with Google; until then people see Google's warning.
  Google may still revoke refresh tokens; that only ever affects Calendar.
- An invited person must have a Google account for the invited address.
  Anyone else still gets an Admin-created password account.
- "Emailed" means the SMTP server accepted the message, nothing more.
- Each open invitation's link is stored encrypted, not only hashed, so an
  Admin can copy it or retry its email. Someone holding both the database
  and `APP_MASTER_KEY` can read live links, as they can already read every
  stored Google refresh token. A link still only works with a Google
  account verified for the invited email.
- While an invitation is open, its email cannot be taken by a profile edit
  or a new account. An existing User can still change their own unlinked
  email to one their Google account has, then link it: that proves they
  control both, so it is not treated as needing an Admin.
