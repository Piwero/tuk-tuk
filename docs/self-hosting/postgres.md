# Use your own PostgreSQL server (optional, advanced)

⏱ 15 min · Needs: a PostgreSQL 16 server you already run and back up

**Do this first:** decide if you need this. Most people don't. Tuk Tuk comes
with its own PostgreSQL in `docker-compose.prod.yml`, and that handles one
person's data with room to spare. Switch only if you already run a
PostgreSQL server and want Tuk Tuk's data there, for example so your
existing backups cover it.

## Before you start

- **Still one copy of the app.** Pointing at your own server does not make it
  safe to run more than one backend. See
  [Security → Rules to follow](security.md#rules-to-follow).
- Create an empty database and a user that owns it. Tuk Tuk creates its own
  tables on first start.
- Take a [backup](upgrade.md#back-up) of the bundled database first.

## Steps

1. **Test the connection.** In **Settings → Database**, paste your server's
   URL (`postgresql+psycopg://user:password@host:5432/dbname`) and click
   **Test connection**. It should report the server as reachable, the
   credentials as OK, and the database as empty.
2. **Move your data.** With the app stopped
   (`docker compose -f docker-compose.prod.yml stop backend`), load the
   backup into the new database:
   ```sh
   psql "postgresql://user:password@host:5432/dbname" -v ON_ERROR_STOP=1 -q -o /dev/null < tuk-tuk-backup.sql
   ```
3. **Point the app at it.** In `docker-compose.prod.yml`, set the backend's
   `DATABASE_URL` to the same URL, then start the app with
   `docker compose -f docker-compose.prod.yml up -d backend`. The bundled
   `postgres` service is no longer used; you can remove it and its
   `pgdata` volume once you're happy.
4. **Check it worked:** log in, confirm your lists, tasks, habits and goals
   are there, then **create one new task**.

## On Kubernetes

`DATABASE_URL` comes from the `tuk-tuk-db` 1Password item. See
[`backend/chart/README.md`](../../backend/chart/README.md#database).

Background: [ADR 0013](../adr/0013-optional-external-postgres.md),
[ADR 0017](../adr/0017-postgres-only-tests-on-testcontainers.md).

## Next

→ [Back to docs home](../README.md)
