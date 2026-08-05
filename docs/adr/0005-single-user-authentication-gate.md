# Single-user authentication gate

## Status

Accepted

## Context

tuk-tuk is a single-user app (see CONTEXT.md): every row already carries an
`owner` column (ADR 0002), but that column has been dormant since it was
added — no request has ever needed to distinguish between owners, because
there has only ever been one. The app is not deployed behind a private
network by default; it needs to stop being trivially reachable by anyone
who finds the URL, without turning into a multi-tenant product.

## Decision

Add a single shared password that gates access to the whole app: a global
password check produces a stateless signed cookie (long-lived, ~30 rolling
days), which the backend verifies on every request. There is no per-user
identity, no user table growth, and no session store. Authentication
happens in the application itself, not at the edge/ingress.

## Considered options (and why they were rejected)

- **Multi-tenancy (per-user accounts) instead of a single shared gate.**
  Rejected — there is exactly one real user (see CONTEXT.md's single-user
  note); building accounts, per-user data isolation, and login/signup flows
  would be speculative complexity for a need that doesn't exist. A gate is
  the honest shape of the problem.
- **Edge/ingress authentication instead of in-app authentication.**
  Rejected — it would split the auth story across two systems (the ingress
  config and the app), make local/dev parity harder, and couple the app's
  security model to whatever's deployed in front of it. Doing it in the app
  keeps one code path to reason about and test, deployable the same way
  everywhere.
- **An external identity provider or passkeys instead of a single password.**
  Rejected — both solve problems tuk-tuk doesn't have (multiple identities,
  account recovery across humans). A single shared password is proportional
  to "one household, one gate" and adds no third-party dependency or
  enrollment ceremony.
- **Server-side sessions instead of a stateless signed cookie.**
  Rejected — a session store is another piece of state to provision,
  back up, and reason about restarting cleanly, for a single-user app where
  the value it buys (fine-grained per-session revocation) isn't needed. A
  signed cookie needs no storage and no cleanup job.
- **Fail-open instead of fail-closed.**
  Rejected — for a gate whose entire job is to keep the app private, any
  ambiguous state (missing secret, verification error) must deny access.
  Failing open would silently reopen the app to the public exactly when
  something is already wrong.
- **Per-IP rate limiting instead of a global failure delay.**
  Rejected — per-IP limiting needs state (a table or cache of attempts per
  IP) and is trivially defeated by rotating source IPs; it also assumes a
  trustworthy client IP, which isn't guaranteed behind arbitrary proxies. A
  global delay on failed attempts slows brute-forcing without needing to
  track or trust any IP at all.
- **Populating the `owner` column from the password gate instead of leaving
  it untouched.** Rejected — the gate authenticates "is this the owner of
  the whole app", not "which owner does this row belong to"; there is only
  one owner, so writing to that column would be a no-op wearing the
  costume of a real feature. The column stays exactly as ADR 0002 left it:
  present, defaulted, and dormant.

## Decision: the session cookie is `SameSite=Lax`, not `Strict`

The cookie is `HttpOnly`, `Secure`, and `SameSite=Lax`. `Lax` still denies
the cookie to cross-site subresource requests and to any non-GET
request — the cases CSRF actually exploits — so this is not a weakening of
the gate.

`Strict` was tried first and had to be abandoned: the Google Calendar
integration's OAuth callback (ADR 0006, `routers/v1/google.py`) is a
top-level GET navigation that Google's own server initiates by redirecting
the browser from `accounts.google.com` back to this app. That redirect is
a cross-site top-level navigation, and browsers never attach a `Strict`
cookie to one — so `SessionAuthMiddleware` saw no cookie at all and
rejected the callback as unauthenticated, even for a user who was already
logged in. `Lax` is the standard, narrowest setting that still allows a
cookie on a top-level cross-site GET, which is exactly what a
redirect-based OAuth return leg requires.

## Accepted trade-offs

- The SPA shell (static HTML/JS/CSS) stays publicly served; only the API
  behind it is gated. Serving the shell itself isn't a data exposure, and
  gating it too would need its own delivery mechanism for no security
  benefit.
- A stolen cookie is valid for the full ~30 rolling days: there is no
  server-side session to invalidate mid-window. This is the accepted cost
  of not running a session store.
- Revocation is key rotation: rotating the signing secret invalidates every
  outstanding cookie at once, logging out every device simultaneously.
  There is no way to revoke a single device's cookie without the others.
- The `SameSite` attribute a cookie was issued with does not change on its
  own — a cookie issued under an older `Strict` build stays `Strict` in the
  browser until it's reissued. Any deployment that ships the `Lax` change
  needs every already-logged-in device to log out and back in once before
  the Google Calendar connect flow will work there.

## Future work

If tuk-tuk ever needs real multi-user support, it needs its own ADR and its
own migration: populating `owner` meaningfully, deciding what per-user
means for shared Lists/Tags/Habits, and revisiting whether a stateless
cookie is still the right shape. This ADR's decisions (single password,
signed cookie, fail-closed, global delay) are specific to the single-user
case and should not be assumed to carry over.
