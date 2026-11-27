# Multi-user, row-level isolation

## Status

Accepted. Supersedes:

- [0002](0002-single-user-no-auth.md): tuk-tuk is no longer single-user.
  Its rule that collaboration features stay out of the domain model still
  holds (see "What this does not add").
- [0005 (gate)](0005-single-user-authentication-gate.md): the shared
  password becomes a per-user password. The stateless signed cookie,
  fail-closed handling, in-app (not ingress) authentication and
  `SameSite=Lax` carry over. The cookie now names a User.
- [0008](0008-ui-managed-settings.md): the `settings` singleton no longer
  holds the password or any integration credentials. Settings stay
  UI-managed, but per user. `APP_MASTER_KEY` stays an environment
  variable, as 0008 decided.
- [0013](0013-optional-external-postgres.md): its remaining single-user
  premises. [0017](0017-postgres-only-tests-on-testcontainers.md) already
  made PostgreSQL the only engine, which this record relies on.

Amends [0014](0014-non-browser-clients-credential-write-boundary.md) and
[0015](0015-voice-assistant-cloud-agent-browser-relayed-writes.md); each
carries an amendment section pointing here. The pod-held password of
[0016](0016-mcp-network-transport.md) gives way to the API token through
the 0014 amendment, and 0016's status says so. Older records are
otherwise left unedited.

Spec: issue #405.

Amended by [0021](0021-invite-only-google-sign-in.md) (issue #586): an
Admin may invite an email address, which is emailed, and accepting creates
a regular User who may have no password and signs in with Google.
Invitations are account admission only; nothing below about isolation or
collaboration changes. Disabling a User now also revokes their API and MCP
tokens.

## Context

Several people want to use one self-hosted instance, each seeing only
their own Tasks, Habits, Goals and integrations. Collaboration is out of
scope: nothing is shared, nobody is invited, nothing is assigned. ADR 0002
asked that adding accounts later be "a data migration, not a remodel", and
every row already carries a dormant `owner` string column. This record
decides what an account is, how data is kept apart, and how the
single-user records that assumed one person give way.

## Decision: row-level isolation through `owner_id` on every owned table

`users` is a real table. Every owned table carries a non-null `owner_id`
foreign key to it. This includes child tables (Sections, Check Items,
Completed Occurrences, Check-ins, Key Results, Stand-up Bullets, Google
Calendars and so on), not just roots. The dormant `owner` string columns
are dropped.

Children carry their own `owner_id` even though it could be derived from
the parent. That way one central filter covers every table with no joins.
A query on a child table cannot leak because someone forgot to join
through the parent.

Uniqueness that used to be global becomes per owner. Examples: a Tag name
is unique per owner, a Stand-up entry is unique per date per owner, and
each owner has exactly one Inbox.

## Decision: isolation is enforced centrally, and proven by an A/B test

A contextvar holds the current user's id. The auth middleware sets it.
A SQLAlchemy `do_orm_execute` hook applies `with_loader_criteria` on
`owner_id` to every owned model. A `before_flush` hook fills `owner_id` on
new rows and refuses to change it on existing ones. With no user in
context, a query on an owned table raises (fails closed). Only explicit
system code paths are exempt.

Any foreign-key id accepted from the API resolves through the filtered
session. Another user's id therefore returns 404, never 403, so whether
it exists is not revealed.

The proof is one parametrized test. User A creates one of every resource.
User B gets 404 on GET, PATCH and DELETE of each, cannot use A's ids as
parents, and sees none of A's rows in any list, search, Smart List,
calendar or statistics read. A new resource type is not isolated until
this test covers it.

## Decision: accounts are created by an admin; the admin cannot see users' data

A User has a username and a **mandatory** email. Email is stored now for
future invites and password reset. Nothing is sent yet. There is no
self-signup. An Admin (`is_admin`) creates accounts with a temporary
password and the user must change it on first login.

Admin is an account-management role only. The admin endpoints return
account fields and never another user's data. An admin's own data is
isolated like anyone else's. The last active admin cannot be demoted or
disabled.

Accounts may be disabled or permanently deleted. A disabled User cannot
log in and is logged out immediately, and their rows stay where they are.

Amendment (2026-11-27): an Admin can choose **Delete user account**, then
re-enter that User's current email and confirm permanent deletion. The
backend checks the email and refuses deletion of the last active Admin.
Legacy accounts without an email must have one set first. One transaction
erases every owned row, settings, credentials and invitations received by
that User, then the account itself. Invitations sent to other people stay
usable with their inviter reference removed. Other Users' data stays intact.
Existing user foreign keys remain restrictive; the explicit child-first
cleanup also erases durable creation receipts. Process caches are purged
after commit. External provider resources, already-running external calls,
sent email, client storage and existing backups are outside this deletion.
Removing the last password-bearing User must not reopen public setup when
Google sign-in accounts remain.

On upgrade, all existing `"local"` data goes to user #1. That user is
seeded as an admin from the current password hash and must complete their
profile (username, email) on first login. On a fresh install with no
users, `/setup` creates the first admin.

## Decision: stateless cookie carrying `user_id` and `session_epoch`

The session stays the stateless signed cookie from ADR 0005. Its payload
gains the user's id and that user's `session_epoch`. The middleware loads
the user on each request and rejects the cookie if the user is disabled
or the epoch no longer matches. Changing a password, an admin reset, and
disabling all bump the epoch, which logs out every session that user has.

This fixes the gap ADR 0005 accepted, where revocation meant rotating the
one signing key and logging out every device at once. Revocation is now
per user, still with no session store. The signing key stays global
(`session_key` is the one value left on `settings`). Rotating it logs out
every user, so it is an operator action, not part of changing a password.

Login lockout moves from the settings singleton to the user row, so it
is per user.

## Decision: all settings are per user, except the session key

A `user_settings` row, 1:1 with each user, holds everything the
`settings` singleton held apart from `session_key`. That covers the Google
OAuth client, the Assist providers, the LiveKit credentials, the feature
toggles and Active hours. Each user brings their own integrations.
Secrets are still encrypted with `APP_MASTER_KEY`, which stays one global
environment variable as ADR 0008 decided.

## Decision: MCP pods and voice workers are deployed by the admin, on request

**Amended by issue #525 for MCP:** there are no per-User MCP pods any more.
One shared deployment serves every User, each with their own MCP token
([ADR 0016's amendment](0016-mcp-network-transport.md#amendment-one-shared-server-for-every-user-issue-525)).
The voice half of this decision is unchanged.

The MCP server's HTTP mode authenticates with a personal API token (see
the amendment to ADR 0014). The Voice Assistant uses each user's own
LiveKit project (see the amendment to ADR 0015). Neither is provisioned
automatically. When a user asks, the admin deploys an MCP pod holding
that user's token, or a voice-agent worker in that user's LiveKit
project, by following the runbook. Self-service provisioning would need
the app to create cluster workloads, which is a much larger trust surface
than one admin running a documented step.

## Decision: the database connection test is admin-only

ADR 0013's Database section tests a connection to any URL it is given.
0013 accepted that server-side request forgery because tuk-tuk had
"exactly one user". That premise is gone, so the section is now an
Admin's alone: its status read and its connection test both answer a
non-admin with 403 `admin_required`. The database is the instance's, not a
User's, and the Admin is already trusted with the deployment (see
"Accepted trade-offs"). Neither is reachable with an API token, even an
Admin's: a stolen token must not be able to make the server connect
anywhere on its network.

## What this does not add

Workspaces, sharing, assignees, @-mentions and PostgreSQL row-level
security remain out of scope. Invitations and email delivery were added by
ADR 0021; permanent account deletion by the amendment above. ADR 0002's
rule still holds for the collaboration features: an "Assigned to Me"
Smart List, member permissions and @-mentions do not enter the domain
model until a record decides collaboration.

## Considered options (and why they were rejected)

- **Workspaces now (data owned by a workspace, users as members).**
  Rejected as YAGNI. With no sharing, every workspace would hold exactly
  one member and add a second join for nothing. If collaboration comes,
  moving from `owner_id` to a workspace is mechanical: create one
  workspace per user and rewrite the foreign key.
- **Physically separate databases (or schemas) per user.** Rejected. It
  means one migration run, connection pool and backup per user, and
  routing each request to the right database. That is more operational
  weight than one self-hosted instance should carry. It would also make
  any future sharing a cross-database problem.
- **PostgreSQL row-level security now.** Rejected for now. The
  application connects as one role, so RLS would need a per-request
  `SET` of the user id on the connection and careful handling of pooled
  connections. The central ORM filter, plus the A/B test that proves it,
  covers the same threat at this scale. RLS stays a possible
  defence-in-depth layer later.
- **Owner filters written by hand in each router.** Rejected. It works
  only as long as every new query remembers it, and nothing catches the
  one that forgets. The Stand-up router's existing hand-written filter is
  removed in favour of the central one.
- **Optional email.** Rejected. Invites and password reset will both
  need it, and backfilling emails later means chasing every user.
- **Self-signup.** Rejected. A self-hosted instance is opened to people
  its admin chooses, not to whoever finds the URL.
- **Server-side sessions for revocation.** Rejected again, as in ADR
  0005. The epoch gives per-user revocation with one integer column
  instead of a session store.

## Accepted trade-offs

- Revocation is per user, not per device. Bumping the epoch logs out all
  of that user's devices, as key rotation used to do for everyone. API
  tokens are the exception, because each can be revoked on its own.
- Lockout is per account, so trying one password against many usernames
  is not slowed the way a global counter would slow it. Accepted because
  accounts are few and created by the admin, not discoverable by signup.
- The isolation filter is application-level. A raw SQL query, or a code
  path explicitly marked as system, bypasses it. The fail-closed default
  and the A/B test are what stop that from going unnoticed.
- The admin is trusted with the deployment, including the database and
  `APP_MASTER_KEY`. "The admin cannot see users' data" is a property of
  the app, not a promise against the person who runs the host.

## What would justify revisiting this

Any sharing (a shared List, an assignee, an invite) is the moment to
decide workspaces and needs its own record. A requirement for isolation
that holds even against a bug in the application layer is the moment to
add PostgreSQL row-level security under the ORM filter.
