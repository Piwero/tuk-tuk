# UI-managed settings, not deploy-time env vars

## Status

Accepted

## Context

Three pieces of configuration currently live only in `.env`, set before the
container starts: the login password (`AUTH_PASSWORD_HASH`, ADR 0005), the
session-cookie signing key (`SECRET_KEY`, ADR 0005), and the Google
Calendar integration's OAuth client credentials plus the key that encrypts
stored refresh tokens (`GOOGLE_CLIENT_ID`/`SECRET`/`GOOGLE_ENCRYPTION_KEY`,
ADR 0006). Changing any of them today means editing `.env` and restarting
the process — there is no way to change the password, rotate credentials,
or connect Google Calendar for the first time without shell access to the
host.

tuk-tuk is meant to be operable entirely from the app itself once deployed.
Requiring shell access for routine account maintenance (changing a
password) or one-time setup (registering a Google OAuth client) doesn't
fit that, and is the opposite of what the app asks of its one user for
everything else it manages.

## Decision: password, session key, and Google credentials move into a DB-backed `settings` table, managed from the UI

A new `settings` table holds the password hash, the session signing key,
and the Google OAuth client ID/secret. All of it is set and changed through
the app's own Settings screen rather than `.env`.

### First boot and the `/setup` gate

A fresh deployment has an empty `settings` table. On boot, the app
generates a session signing key and writes it to the table itself — this
one value must exist for cookies to work at all, and unlike the password it
carries no meaning a person needs to choose. Every route is otherwise
gated behind a one-time `/setup` screen (enforced by the same
`SessionAuthMiddleware` that gates everything else) until a password is
set. Once a password exists, `/setup` stops being reachable — it cannot be
replayed to bypass the gate it was created to satisfy.

### Upgrade path for deployments that already have `.env` values

On first boot after upgrading, if the `settings` table is empty and
`AUTH_PASSWORD_HASH`/`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are present
in the environment, they are imported into the table once and `/setup` is
skipped. This is a one-time seed, not an ongoing sync: after that boot, the
DB is authoritative and the env vars are inert. This exists so that
deploying this change doesn't itself log the owner out or disconnect an
already-connected Google account.

### Changing the password rotates the session key

Settings gains a "change password" form (current password + new password;
reachable only with a valid session — see "What this does not add"
below). Saving it also regenerates the session signing key, which
invalidates every outstanding session cookie, including — deliberately —
the one that just made the change; the response re-issues a fresh cookie
for that request. This is the only revocation mechanism ADR 0005
established, and changing the password is the moment a user most plausibly
wants every other logged-in device signed out.

### Google credentials move into the same Settings screen

A "Google API credentials" form (client ID + client secret) sits above the
existing account-connect UI in the Google Calendar settings section. The
client secret field is write-only: the settings-read endpoint reports only
whether it's set, never its value, so the browser is never handed a
credential it didn't just type in. Saving new credentials while accounts
are already connected flips every connected account to the existing
`needs_reconnect` state (ADR 0006/0007's failure-isolation banner) — a
refresh token is only valid for the OAuth client that minted it, so a
credential swap silently breaking calendar reads on next load would be
worse than surfacing it immediately through a path the UI already has. A
"Remove Google integration" action clears both fields and disconnects all
accounts, returning to today's behavior when the feature is unconfigured:
invisible, not greyed out.

## Decision: one secret stays outside the database — `APP_MASTER_KEY`

Moving the Google client secret and the key that encrypts stored Google
refresh tokens into the database creates a key-encrypts-itself problem: if
the value protecting other DB-stored secrets is itself a DB-stored secret,
a copy of the SQLite file discloses everything in it, encryption included.
`APP_MASTER_KEY` is a new env var, generated once at deploy time the same
way `SECRET_KEY` is today, that never appears in the UI or the database.
It encrypts the Google client secret at rest and encrypts Google refresh
tokens directly — which is also why `GOOGLE_ENCRYPTION_KEY` (ADR 0006) is
retired as a separate concept rather than migrated: a second DB-adjacent
key protecting DB-stored data has the same self-encryption problem
`APP_MASTER_KEY` exists to avoid, and one root secret outside the database
covers what two did.

The password hash needs no such protection — Argon2id is one-way, so
storing it in the DB reveals nothing an attacker could use directly,
exactly as it doesn't today sitting in `.env`.

## Considered options (and why they were rejected)

- **Keep `GOOGLE_ENCRYPTION_KEY` as its own DB-managed setting, encrypted
  by `APP_MASTER_KEY`.** Rejected — it reintroduces a layer
  `APP_MASTER_KEY` already makes unnecessary. ADR 0006 separated it from
  `SECRET_KEY` so that rotating the session key wouldn't affect Google
  tokens; `APP_MASTER_KEY` is not rotated on password change (only
  `SECRET_KEY` is, per the decision above), so that property is preserved
  without a second key.
- **No master key — store the Google client secret and encrypt tokens with
  a DB-stored key.** Rejected — this is the self-encryption problem
  itself: an attacker with the SQLite file gets the client secret in the
  clear and, for tokens, both the ciphertext and the key that opens it.
- **Locked-out password recovery (a "forgot password" flow).** Rejected
  for this change — tuk-tuk has no email or external identity provider
  (ADR 0005), so there is no delivery mechanism for a reset link, and
  building one is a separable, larger decision. Recovery when locked out
  remains a break-glass operation outside the UI (direct DB access on the
  host), unchanged from today's `.env`-edit-and-restart reality.
- **A `SETUP_TOKEN` env var gating `/setup`.** Rejected — `/setup` is
  already unreachable once a password exists, which is the only window an
  attacker could exploit; a token would add deploy-time ceremony back for
  a race that closes itself on the first real setup.

## Accepted trade-offs

- `APP_MASTER_KEY` reintroduces exactly one piece of deploy-time,
  shell-managed configuration into a change whose goal was removing that
  category — accepted because removing it entirely trades a small,
  one-time deploy step for the database becoming a single point of total
  compromise.
- Losing `APP_MASTER_KEY` (host lost without backup, secret misplaced)
  makes the Google client secret and every stored refresh token
  unrecoverable — indistinguishable in effect from losing `.env` today,
  since neither was ever backed up by the app itself.
- There is still no self-service path for a locked-out password; recovery
  requires host access, same as `.env` editing did.

## What would justify revisiting this

Wanting self-service password recovery would require deciding on a
delivery mechanism (email, out-of-band token) that doesn't exist yet and
deserves its own ADR rather than folding into this one. Wanting
independent rotation of the Google-token encryption key without touching
`APP_MASTER_KEY` would justify reintroducing a separate DB-stored key —
the option rejected above — if that need becomes concrete rather than
speculative.
