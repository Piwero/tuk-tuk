# Upgrade and back up

⏱ 5 min · Run every command from the `tuk-tuk` folder

**Do this first:** take a backup (below). It takes 30 seconds.

## Back up

Your data is one file, `tuk_tuk.db`, inside the Docker volume. While the app
is running:

1. Make a safe copy inside the container:
   ```sh
   docker compose -f docker-compose.prod.yml exec backend python -c "import sqlite3; sqlite3.connect('/data/tuk_tuk.db').backup(sqlite3.connect('/data/backup.db'))"
   ```
2. Copy it out to your computer:
   ```sh
   docker compose -f docker-compose.prod.yml cp backend:/data/backup.db ./tuk-tuk-backup.db
   ```
3. Store `tuk-tuk-backup.db` **and** your `.env` somewhere safe, such as a
   password manager or an encrypted drive.

The backup contains all your tasks, habits, goals and your password hash. Keep
it private.

## Restore a backup

1. Stop the backend:
   ```sh
   docker compose -f docker-compose.prod.yml stop backend
   ```
2. Copy the backup in, fix its file owner, and start again:
   ```sh
   docker compose -f docker-compose.prod.yml cp ./tuk-tuk-backup.db backend:/data/tuk_tuk.db
   docker compose -f docker-compose.prod.yml run --rm data-permissions
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
