# Upgrade and back up

⏱ 5 min · Run every command from the `tuk-tuk` folder

**Do this first:** take a backup (below). It takes 30 seconds.

## Back up

Your data lives in the `postgres` container. While the app is running:

1. Dump it to a file on your computer:
   ```sh
   docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U tuktuk --clean --if-exists tuktuk > tuk-tuk-backup.sql
   ```
2. Store `tuk-tuk-backup.sql` **and** your `.env` somewhere safe, such as a
   password manager or an encrypted drive.

The backup contains everyone's tasks, habits and goals, and their password
hashes. Keep it private.

## Restore a backup

This replaces everything in the database with the backup.

1. Stop the backend:
   ```sh
   docker compose -f docker-compose.prod.yml stop backend
   ```
2. Load the backup and start again:
   ```sh
   docker compose -f docker-compose.prod.yml exec -T postgres psql -U tuktuk -d tuktuk -v ON_ERROR_STOP=1 -q -o /dev/null < tuk-tuk-backup.sql
   docker compose -f docker-compose.prod.yml start backend
   ```
3. Log in with the password that was set when the backup was taken.

Use the same `.env` as when you took the backup. With a different master key,
your saved Google and AI credentials can't be read and have to be entered again.

## Upgrade (2–5 min)

1. [Back up](#back-up).
2. Get the latest version:
   ```sh
   git pull
   ```
3. Rebuild and restart:
   ```sh
   docker compose -f docker-compose.prod.yml up -d --build
   ```

Database changes are applied automatically on start. Check the
[CHANGELOG](../../CHANGELOG.md) for anything new.

## Upgrading to multi-user

Read this once if your install still has **one password** and no
usernames. The upgrade turns it into an install with accounts, one per
person, and gives all your existing data to the first account, the Admin.
Allow 10 minutes.

> **There is no way back.** An older version can't read the upgraded
> database. Take a [backup](#back-up) first. To undo the upgrade, restore that
> backup and go back to the version you had.

1. [Back up](#back-up).
2. Check for data the upgrade refuses. Two things that used to be allowed
   are now unique for each account: tag names, ignoring upper and lower
   case, and the Inbox. While the old version is still running:
   ```sh
   docker compose -f docker-compose.prod.yml exec -T postgres psql -U tuktuk -d tuktuk <<'SQL'
   -- Tags whose names differ only in case, such as "Work" and "work"
   SELECT id, name FROM tags
   WHERE lower(name) IN (SELECT lower(name) FROM tags GROUP BY lower(name) HAVING count(*) > 1)
   ORDER BY lower(name), id;
   -- Lists marked as an Inbox: there must be at most one
   SELECT id, name FROM lists WHERE is_inbox ORDER BY id;
   SQL
   ```
   Both empty, or one Inbox: go to step 3. Otherwise fix what it lists:
   - **Tags:** rename all but one of each clashing set, in the app or with
     `UPDATE tags SET name = 'work (2)' WHERE id = 9;` (your own id and name).
   - **Inboxes:** keep one. Turn each other one into an ordinary list, with
     its tasks intact:
     `UPDATE lists SET is_inbox = false WHERE id = 5;` (your own id).

   If you skip this step and the data needs fixing, the new version stops
   on start and changes nothing. Its log
   (`docker compose -f docker-compose.prod.yml logs backend`) names the same
   rows. The database keeps running, so fix them with the same commands,
   then start again with `docker compose -f docker-compose.prod.yml up -d`.
3. Get the new version and restart, as in [Upgrade](#upgrade-25-min) above
   (steps 2 and 3).
4. **Everyone signs in again.** Sessions from before the upgrade no longer
   work, on every device.
5. Sign in with the username **`admin`** and your existing password. The app
   then asks you to complete your profile: choose your own username, add
   your email, and set a new password. Your lists, tasks, habits and goals
   are all there.

   If your install never had a password, the app opens the setup screen
   instead. The account you create there gets all your data.
6. To let someone else in, create their account in **Settings → Users**.
   Nobody can sign up on their own.

The command-line client now signs in with a username as well as a
password. A remote MCP server needs no password either: each User connects
with their own MCP token, see [Run one MCP server for every User](shared-mcp-server.md).

Background: [ADR 0018](../adr/0018-multi-user-row-level-isolation.md).

## Upgrading from SQLite (v2.21 and earlier)

Up to v2.21, Tuk Tuk kept everything in one SQLite file in the
`tuk-tuk-prod_data` volume. Newer versions only run on PostgreSQL, so your
data has to be copied across once. The copy uses the v2.21.1 image, the last
version that can read SQLite. Allow 10 minutes.

1. **Before you pull**, back up the SQLite file while the old version is
   still running:
   ```sh
   docker compose -f docker-compose.prod.yml exec backend python -c "import sqlite3; sqlite3.connect('/data/tuk_tuk.db').backup(sqlite3.connect('/data/backup.db'))"
   docker compose -f docker-compose.prod.yml cp backend:/data/backup.db ./tuk-tuk-backup.db
   ```
2. Stop the app (never with `-v`), get the new version, and add a database
   password:
   ```sh
   docker compose -f docker-compose.prod.yml down
   git pull
   echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
   ```
3. Start only the database:
   ```sh
   docker compose -f docker-compose.prod.yml up -d --wait postgres
   ```
4. Copy the data with v2.21.1's copy tool, the last version that reads
   SQLite. It runs from a separate checkout of that version, inside a
   throwaway container on the database's network, and works on a copy of
   the backup, because the fix for orphaned rows (below) edits the file it
   reads:
   ```sh
   git worktree add ../tuk-tuk-v2.21.1 v2.21.1
   mkdir tuk-tuk-copy && cp tuk-tuk-backup.db tuk-tuk-copy/source.db
   PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
   docker run --rm --user "$(id -u):$(id -g)" -e UV_CACHE_DIR=/tmp/uv \
     --network tuk-tuk-prod_default \
     -v "$PWD/../tuk-tuk-v2.21.1/backend/oci:/app" -w /app \
     -v "$PWD/tuk-tuk-copy:/copy" \
     ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm-slim \
     uv run --no-dev --frozen -q python -m app.copy_database \
     sqlite:////copy/source.db "postgresql+psycopg://tuktuk:$PW@postgres:5432/tuktuk"
   ```
   It prints row counts for each table and ends with `SUCCESS`. Then remove
   the checkout and the working copy:
   `git worktree remove --force ../tuk-tuk-v2.21.1 && rm -r tuk-tuk-copy`.
5. Start everything:
   ```sh
   docker compose -f docker-compose.prod.yml up -d --build
   ```
6. **Check it worked:** log in, confirm your lists, tasks, habits and goals are
   there, then **create one new task**. Then [take a fresh backup](#back-up).

If the copy refuses:

| Message is about | What to do |
| --- | --- |
| Orphaned rows in the source | Run the same `docker run` command again with `--prune-orphans` added at the end. This deletes rows left behind by deleted tasks (tag links, checklist items). Every deleted id is listed. `tuk-tuk-backup.db` stays untouched. |
| Target already has data | A previous attempt got part of the way. Add `--force` to start over. **This empties the database first**, which is fine here because it holds nothing else yet. |

The old `tuk-tuk-prod_data` volume is no longer used. Keep it until you're
happy, then remove it with `docker volume rm tuk-tuk-prod_data`.

Background: [ADR 0017](../adr/0017-postgres-only-tests-on-testcontainers.md).

## Upgrading from before v2

Older versions kept the password and Google credentials in `.env`
(`AUTH_PASSWORD_HASH`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ASSIST_*`).
The first start after upgrading copies them into the database, so you stay
logged in and Google stays connected.

- This happens **once**. After that the app ignores those lines, and you can
  delete them.
- You must add `APP_MASTER_KEY` to `.env` before starting. The app won't
  start without it.

Background: [ADR 0008](../adr/0008-ui-managed-settings.md).

## Next

→ [Security](security.md)
