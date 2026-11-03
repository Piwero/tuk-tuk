# Move to PostgreSQL (optional, advanced)

⏱ 20 min · Needs: a PostgreSQL server, and [mise](https://mise.jdx.dev/) set up as in [CONTRIBUTING.md](../../CONTRIBUTING.md)

**Do this first:** decide if you need this. Most people don't. The built-in
SQLite file handles one person's data with room to spare. Move only if you
already run PostgreSQL and want Tuk Tuk's data there.

## Before you start

- **It's one-way.** The SQLite file is left untouched as a backup, but there's
  no tool to copy data back from PostgreSQL to SQLite.
- **Still one copy of the app.** Moving to PostgreSQL does not make it safe to run more than
  one backend. See [Security → Rules to follow](security.md#rules-to-follow).
- Take a [backup](upgrade.md#back-up) first.

## Steps

1. **Test the connection.** In **Settings → Database**, paste your PostgreSQL
   URL and click **Test connection**.
2. **Take a fresh [backup](upgrade.md#back-up), then stop the app**
   (`docker compose -f docker-compose.prod.yml down`) so nothing changes
   after the copy. The backup file is what you copy from.
3. **Run the copy** from the `tuk-tuk` folder:
   ```sh
   mise run backend:copy-db -- sqlite:///$PWD/tuk-tuk-backup.db postgresql+psycopg://user:pass@host/db
   ```
   It prints row counts for each table and confirms the copy when it's done.
4. **Point the app at PostgreSQL.** In `docker-compose.prod.yml`, change
   `DATABASE_URL` to the same PostgreSQL URL, then start the app.
5. **Check it worked:** log in, confirm your lists, tasks, habits and goals are
   there and Google still shows as connected, then **create one new task**. If
   that works, the database's ID counters were set up correctly.

## If the copy refuses

| Message is about | What to do |
| --- | --- |
| Orphaned rows in the source | Add `--prune-orphans` to delete them. This also deletes rows left orphaned by those deletions. Every deleted id is listed in the report. |
| Target already has data | Add `--force` to retry a failed attempt. **This deletes every row in the target** and replaces it with the source. It's for retrying, not for merging two databases. |

An empty target is set up automatically, so you don't need to prepare tables.

## On Kubernetes

Follow [`backend/chart/README.md`](../../backend/chart/README.md#moving-to-postgresql)
instead. The same five steps, but the copy runs as a one-off Job, and
`DATABASE_URL` is set on a 1Password item. That page also explains what
switching back costs.

Background: [ADR 0013](../adr/0013-optional-external-postgres.md).

## Next

→ [Back to docs home](../README.md)
