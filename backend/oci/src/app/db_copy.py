"""Copy the tuk-tuk database from one URL to another — SQLite to PostgreSQL,
or SQLite to SQLite for the test suite. Operator tool (issue #255), following
the `app.hash_password` precedent: a thin CLI shell over an in-process
function. Run via `mise run backend:copy-db`.

The source is never written to, except by an explicit `--prune-orphans`.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field

from sqlalchemy import Column, Engine, Table, create_engine, exists, inspect, select
from sqlalchemy.exc import SQLAlchemyError

from app import models  # noqa: F401 -- registers every table on Base.metadata
from app.db import Base, run_migrations, sync_migration_url

# SQLAlchemy topologically sorts by foreign key dependency, so this is
# already a valid copy (and delete-reverse) order — no manual table list
# to keep in sync with app.models by hand.
_TABLES: list[Table] = list(Base.metadata.sorted_tables)


class DatabaseCopyError(Exception):
    """Base for every refusal/failure this tool raises, so a CLI caller can
    print `str(exc)` and exit non-zero instead of a bare traceback."""


class OrphanedRowsError(DatabaseCopyError):
    def __init__(self, orphans: dict[str, dict[str, list[int]]]) -> None:
        self.orphans = orphans
        lines = ["Refusing to copy: the source has orphaned rows:"]
        for table_name, columns in orphans.items():
            for column_name, ids in columns.items():
                sample = ", ".join(str(i) for i in ids[:5])
                more = f" (+{len(ids) - 5} more)" if len(ids) > 5 else ""
                lines.append(
                    f"  {table_name}.{column_name}: {len(ids)} row(s) point at a missing row "
                    f"(ids: {sample}{more})"
                )
        lines.append("Re-run with prune_orphans=True (CLI: --prune-orphans) to delete them.")
        super().__init__("\n".join(lines))


class TargetNotEmptyError(DatabaseCopyError):
    def __init__(self, populated_tables: list[str]) -> None:
        self.populated_tables = populated_tables
        tables = ", ".join(populated_tables)
        super().__init__(
            f"Refusing to copy: the target already has data in: {tables}. "
            "Re-run with force=True (CLI: --force) to overwrite it."
        )


class CopyVerificationError(DatabaseCopyError):
    def __init__(self, mismatches: list[str]) -> None:
        self.mismatches = mismatches
        lines = ["Copy verification failed:", *(f"  {m}" for m in mismatches)]
        super().__init__("\n".join(lines))


@dataclass
class TableReport:
    source_count: int
    target_count: int
    source_max_id: int | None
    target_max_id: int | None

    @property
    def matches(self) -> bool:
        return self.source_count == self.target_count and self.source_max_id == self.target_max_id


@dataclass
class CopyReport:
    tables: dict[str, TableReport] = field(default_factory=dict)
    pruned: dict[str, int] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return all(t.matches for t in self.tables.values())

    def __str__(self) -> str:
        lines = []
        if self.pruned:
            lines.append("Pruned orphaned rows:")
            lines.extend(f"  {table}: {count}" for table, count in self.pruned.items())
        lines.append("Copy report (table: source -> target, max id source -> target):")
        for name, t in self.tables.items():
            marker = "OK" if t.matches else "MISMATCH"
            lines.append(
                f"  [{marker}] {name}: {t.source_count} -> {t.target_count} rows, "
                f"max id {t.source_max_id} -> {t.target_max_id}"
            )
        lines.append("SUCCESS" if self.success else "FAILURE")
        return "\n".join(lines)


def _id_column(table: Table) -> Column[int] | None:
    """`task_tags` (an association table) has no surrogate id; every other
    table does. Callers that need a per-row identity skip tables without
    one instead of assuming `id` exists."""
    return table.c.get("id")


def _find_orphans(engine: Engine) -> dict[str, dict[str, list[int]]]:
    """Reports every orphan by the *identifying* column of the offending
    row: its own `id` where the table has one, else the FK column itself
    (task_tags — an association row has no other identity)."""
    orphans: dict[str, dict[str, list[int]]] = {}
    with engine.connect() as conn:
        for table in _TABLES:
            id_col = _id_column(table)
            select_col = id_col if id_col is not None else None
            for fk in table.foreign_keys:
                parent_col = fk.parent
                ref_col = fk.column
                ref_table = ref_col.table
                subq = select(ref_table.c[ref_col.name]).where(ref_col == parent_col)
                target_col = select_col if select_col is not None else parent_col
                stmt = select(target_col).where(parent_col.isnot(None), ~exists(subq))
                ids = [row[0] for row in conn.execute(stmt)]
                if ids:
                    orphans.setdefault(table.name, {})[parent_col.name] = ids
    return orphans


def _prune_orphans(engine: Engine) -> dict[str, int]:
    """Deletes orphaned rows, re-scanning until stable — deleting an
    orphaned parent can turn its own children into new orphans."""
    pruned: dict[str, int] = {}
    for _ in range(len(_TABLES) + 1):
        orphans = _find_orphans(engine)
        if not orphans:
            break
        with engine.begin() as conn:
            for table_name, columns in orphans.items():
                table = Base.metadata.tables[table_name]
                id_col = _id_column(table)
                for column_name, ids in columns.items():
                    match_col = id_col if id_col is not None else table.c[column_name]
                    conn.execute(table.delete().where(match_col.in_(ids)))
                    pruned[table_name] = pruned.get(table_name, 0) + len(ids)
    return pruned


def _populated_tables(engine: Engine) -> list[str]:
    existing = set(inspect(engine).get_table_names())
    populated = []
    with engine.connect() as conn:
        for table in _TABLES:
            if table.name not in existing:
                continue
            row = conn.execute(select(table).limit(1)).first()
            if row is not None:
                populated.append(table.name)
    return populated


def _clear_target(engine: Engine) -> None:
    with engine.begin() as conn:
        for table in reversed(_TABLES):
            conn.execute(table.delete())


def _copy_table(source_engine: Engine, target_engine: Engine, table: Table) -> None:
    with source_engine.connect() as source_conn:
        rows = [dict(row) for row in source_conn.execute(select(table)).mappings()]
    if not rows:
        return
    with target_engine.begin() as target_conn:
        target_conn.execute(table.insert(), rows)


def _reseed_sequences(target_engine: Engine, target_url: str) -> None:
    if not target_url.startswith("postgresql"):
        return
    with target_engine.begin() as conn:
        for table in _TABLES:
            if _id_column(table) is None:
                continue
            conn.exec_driver_sql(
                f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                f"(SELECT COALESCE(MAX(id), 1) FROM {table.name}), true)"
            )


def _table_stats(engine: Engine, table: Table) -> tuple[int, int | None]:
    id_col = _id_column(table)
    with engine.connect() as conn:
        if id_col is not None:
            rows = conn.execute(select(id_col)).scalars().all()
            return len(rows), (max(rows) if rows else None)
        # task_tags has no surrogate id — row count is the only comparable
        # stat (no meaningful "max id" for an association table).
        count = conn.execute(select(table)).all()
        return len(count), None


def copy_database(
    source_url: str,
    target_url: str,
    *,
    prune_orphans: bool = False,
    force: bool = False,
) -> CopyReport:
    """Copies every table from `source_url` to `target_url`, preserving ids
    and relationships. Raises `DatabaseCopyError` (or a subclass) on any
    preflight refusal or verification failure; never partially reports
    success. The source is opened read-only in effect — the only mutation
    this function ever makes to it is the explicit `prune_orphans=True`
    deletion, run before anything is copied.
    """
    try:
        source_engine = create_engine(sync_migration_url(source_url))
        target_engine = create_engine(sync_migration_url(target_url))

        orphans = _find_orphans(source_engine)
        report = CopyReport()
        if orphans:
            if not prune_orphans:
                raise OrphanedRowsError(orphans)
            report.pruned = _prune_orphans(source_engine)

        populated = _populated_tables(target_engine)
        if populated and not force:
            raise TargetNotEmptyError(populated)
        if populated and force:
            _clear_target(target_engine)

        run_migrations(target_url)

        for table in _TABLES:
            _copy_table(source_engine, target_engine, table)

        _reseed_sequences(target_engine, target_url)

        mismatches = []
        for table in _TABLES:
            source_count, source_max = _table_stats(source_engine, table)
            target_count, target_max = _table_stats(target_engine, table)
            table_report = TableReport(source_count, target_count, source_max, target_max)
            report.tables[table.name] = table_report
            if not table_report.matches:
                mismatches.append(
                    f"{table.name}: source has {source_count} rows (max id {source_max}), "
                    f"target has {target_count} rows (max id {target_max})"
                )
        if mismatches:
            raise CopyVerificationError(mismatches)

        return report
    except DatabaseCopyError:
        raise
    except SQLAlchemyError as exc:
        raise DatabaseCopyError(
            f"Unexpected database error while copying: {exc}. No partial state is "
            "guaranteed — inspect the target before retrying."
        ) from exc


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Copy the tuk-tuk database from a source DATABASE_URL to a target."
    )
    parser.add_argument(
        "source_url", help="Source database URL (read-only, except with --prune-orphans)"
    )
    parser.add_argument("target_url", help="Target database URL")
    parser.add_argument(
        "--prune-orphans",
        action="store_true",
        help="Delete orphaned rows found in the source instead of refusing to proceed",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite an already-populated target instead of refusing to proceed",
    )
    args = parser.parse_args()

    try:
        report = copy_database(
            args.source_url,
            args.target_url,
            prune_orphans=args.prune_orphans,
            force=args.force,
        )
    except DatabaseCopyError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None

    print(report)
    raise SystemExit(0 if report.success else 1)


if __name__ == "__main__":
    main()
