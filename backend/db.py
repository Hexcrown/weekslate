"""SQLite storage layer + simple versioned migrations.

To change the schema later: APPEND a new SQL string to MIGRATIONS. Never edit
an old one. On startup, any migration the database hasn't seen yet is applied
in order, so existing data is kept.
"""
import json
import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get(
    "WEEKSLATE_DB", os.path.join(os.path.dirname(__file__), "data", "weekslate.sqlite")
)

MIGRATIONS = [
    # 1: initial schema (events live in Apple Calendar, not here)
    """
    CREATE TABLE people (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        name    TEXT NOT NULL,
        color   TEXT NOT NULL DEFAULT '#4f8cff'
    );

    CREATE TABLE chores (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT NOT NULL,
        start_date  TEXT NOT NULL,                         -- YYYY-MM-DD
        rule        TEXT NOT NULL DEFAULT '{"type":"daily","interval":1}',  -- JSON, see recurrence.py
        person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
        points      INTEGER NOT NULL DEFAULT 1
    );

    -- One row per (chore, day) once it's checked off.
    CREATE TABLE completions (
        chore_id     INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
        day          TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chore_id, day)
    );
    """,
    # 2: calendars are managed in the web UI; app settings live in the database
    """
    CREATE TABLE calendars (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        name   TEXT NOT NULL,
        url    TEXT NOT NULL,
        color  INTEGER NOT NULL DEFAULT 0      -- 0..5, index into the chalk colors
    );

    CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL                   -- JSON; secrets such as pin_hash are stored raw
    );

    -- Existing installs that already have people or chores skip the first-run setup.
    INSERT OR IGNORE INTO settings (key, value)
    SELECT 'setup_complete', 'true'
    WHERE EXISTS (SELECT 1 FROM chores) OR EXISTS (SELECT 1 FROM people);
    """,
    # 3: a calendar can belong to one person (NULL = everyone / the whole family)
    """
    ALTER TABLE calendars ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE SET NULL;
    """,
    # 4: next change goes here, e.g. "ALTER TABLE chores ADD COLUMN notes TEXT;"
]


@contextmanager
def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
        db.commit()
    finally:
        db.close()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with connect() as db:
        db.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        current = db.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] or 0
        for number, sql in enumerate(MIGRATIONS[current:], start=current + 1):
            db.executescript(sql)
            db.execute("INSERT INTO schema_version (version) VALUES (?)", (number,))


def row_to_dict(row):
    """sqlite3.Row -> dict, decoding the JSON recurrence rule if present."""
    d = dict(row)
    if isinstance(d.get("rule"), str):
        d["rule"] = json.loads(d["rule"])
    return d
