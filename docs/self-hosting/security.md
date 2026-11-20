# Security

⏱ 4 min read

**Do this first:** check that your `.env` is backed up and that the app isn't
reachable from the public internet over plain `http://`.

## How login works

Everyone has **their own account**: a username, an email and a password
([ADR 0018](../adr/0018-multi-user-row-level-isolation.md)). Each person sees
only their own data, and an Admin can't see anyone else's either.

- **Admins create accounts.** There is no sign-up. An Admin adds a person in
  **Settings → Users** with a temporary password, and that person must
  choose their own the first time they sign in. Accounts are disabled, never
  deleted: a disabled account is signed out at once and its data is kept.
- **Stored safely.** Only a one-way Argon2id hash of each password is saved, never the password itself.
- **30-day sessions.** Each visit extends the session, so a browser you use
  regularly stays signed in. One left unused for 30 days is signed out.
- **Guessing gets slow, per account.** After 5 wrong passwords in a row, each
  further wrong one doubles the wait before that account can try again, up
  to 30 seconds. A correct password resets it, and so does an Admin's
  password reset. Other accounts are not affected.
- **Sign out everywhere** by changing your password in **Settings → My
  account**. Every other device of yours is signed out at once; nobody
  else's is.
- **Everything is locked** until you sign in, including the API. The only exceptions are the `/health` check and the MCP token exchange, which needs the MCP server's service key.

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

## Remote MCP server

Optional. If you deploy `tuk-mcp --http` on Kubernetes
([`mcp/oci/README.md`](../../mcp/oci/README.md),
[ADR 0016](../adr/0016-mcp-network-transport.md)), know what it changes. One
deployment serves every User ([runbook](shared-mcp-server.md)).

- **Tailnet only.** It is published as `tuk-tuk-mcp` through a Tailscale
  Ingress with Funnel off. Never give it a public hostname.
- **Each User brings their own MCP token.** Users create it in
  **Settings → My account → API tokens** (Used by: MCP server). It works only
  at the MCP server: the API refuses it. Revoking it, or disabling the User,
  cuts it off on the next request, with no restart.
- **Checked on every request.** The server sends the token, with its service
  key, to the backend before reading anything else, and caches nothing. A
  backend it cannot reach means `503`, never data.
- **The pod holds no User's credential.** Only `MCP_SERVICE_KEY` (32+
  characters), shared with the backend through the `tuk-tuk-mcp-service`
  item. Alone, it reaches no data. Anyone who has it and a User's MCP token
  could get that User's MCP access without the MCP server, so keep both secret;
  rotate the key by changing the item and restarting the backend and MCP pods.
- **Users are kept apart.** Each request runs with a 2-minute credential for
  its own User. The read-before-write allowlist is per MCP token: one User's
  reads never let another write.
- An MCP-token holder can read that User's tasks and use the write tools, but
  not delete, and cannot reach admin pages, other tokens or the password.
- This is not the MCP specification's OAuth flow. Supported clients are ones
  that send a static `Authorization` header (Claude Code, Codex CLI, OpenCode).

## Forgotten password

There's no reset email. An Admin resets the password instead: in
**Settings → Users**, pick the person and reset their password. They get a
temporary password, are signed out everywhere, and must choose a new one
when they next sign in. Their data is kept.

If the only Admin has forgotten their own password, whoever runs the server
can give them a temporary one from the command line:

1. From the `tuk-tuk` folder, make a hash of a temporary password. It asks
   for the password twice and prints the hash:
   ```sh
   docker compose -f docker-compose.prod.yml exec backend python -m app.hash_password
   ```
2. Put it on the account, replacing the hash and the username with your own.
   This also lifts any wait from wrong guesses and signs the account out
   everywhere:
   ```sh
   docker compose -f docker-compose.prod.yml exec -T postgres psql -U tuktuk -d tuktuk <<'SQL'
   UPDATE users
   SET password_hash = 'PASTE-THE-HASH-HERE',
       password_changed_at = now(),
       must_change_password = true,
       login_failed_attempts = 0,
       login_locked_until = NULL,
       session_epoch = session_epoch + 1
   WHERE username = 'your-username';
   SQL
   ```
   It should print `UPDATE 1`.
3. Sign in with the temporary password and choose a new one.

On your own PostgreSQL server, run the same `UPDATE` with `psql` against it.

## Report a vulnerability

Report it privately, as described in [`SECURITY.md`](../../SECURITY.md). Don't open a public issue.

## Next

→ [Use your own PostgreSQL server](postgres.md) (optional)
