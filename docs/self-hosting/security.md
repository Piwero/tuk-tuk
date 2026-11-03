# Security

⏱ 4 min read

**Do this first:** check that your `.env` is backed up and that the app isn't
reachable from the public internet over plain `http://`.

## How login works

Tuk Tuk has **one password** and no user accounts
([ADR 0005](../adr/0005-single-user-authentication-gate.md)).

- **Stored safely.** Only a one-way Argon2id hash of the password is saved, never the password itself.
- **30-day sessions.** Each visit extends the session, so a browser you use
  regularly stays logged in. One left unused for 30 days is logged out.
- **Guessing gets slow.** Each wrong password doubles the wait before the next
  try, up to 30 seconds. A correct login resets it.
- **Log out everywhere** by changing the password in **Settings → Security**.
  Every other device is logged out at once.
- **Everything is locked** until you log in, including the API. The only exception is the `/health` check.

## The master key

`APP_MASTER_KEY` in `.env` encrypts the secrets you save in Settings: Google
credentials, Google sign-ins and AI API keys. It never appears in the app or the API.

1. A copy of the database alone doesn't reveal those secrets.
2. The app won't start without the key.
3. Lose the key and you'll need to enter those secrets again. Tasks and other data are fine.
4. Don't change it on a running install for the same reason.

## Rules to follow

1. **HTTPS outside your home network.** Use HTTPS (for example via
   `tailscale serve` or Caddy) and set `AUTH_COOKIE_SECURE=true` in `.env`.
   See [Install → Use it from other devices](install.md#use-it-from-other-devices).
2. **One copy of the app per database.** Never run two backends against the same
   database. The wrong-password slowdown would stop working properly, and you'd get no error
   ([ADR 0013](../adr/0013-optional-external-postgres.md)).
3. **Treat backups like passwords.** Store them encrypted.

## Forgotten password

There's no reset email. Whoever runs the server can clear the password, and
the app then shows the "choose a password" screen again. Your data is kept.

1. From the `tuk-tuk` folder, run:
   ```sh
   docker compose -f docker-compose.prod.yml exec backend python -c "import sqlite3; c = sqlite3.connect('/data/tuk_tuk.db'); c.execute('UPDATE settings SET password_hash = NULL'); c.commit()"
   ```
2. Open the app and choose a new password **straight away**. Until you do, anyone
   who can reach the app can set it.

On PostgreSQL, run `UPDATE settings SET password_hash = NULL;` with `psql` instead.

## Report a vulnerability

Report it privately, as described in [`SECURITY.md`](../../SECURITY.md). Don't open a public issue.

## Next

→ [Move to PostgreSQL](postgres.md) (optional)
