"""App settings stored in the database (the `settings` table).

Plain settings are JSON values limited to the keys in DEFAULTS. Secrets (the PIN
hash) are stored raw under separate helpers and are never part of get_all().
"""
import json

from db import connect

DEFAULTS = {
    "theme": "dark",             # dark | light
    "default_view": "week",      # week | month
    "week_start": 0,             # 0 = Sunday, 1 = Monday
    "show_points": True,
    "match_names": True,         # an event title naming a person goes to that person
    "setup_complete": False,
}


def get_all() -> dict:
    out = dict(DEFAULTS)
    with connect() as db:
        for row in db.execute("SELECT key, value FROM settings"):
            if row["key"] in DEFAULTS:
                try:
                    out[row["key"]] = json.loads(row["value"])
                except ValueError:
                    pass          # corrupt value: fall back to the default
    return out


def set_value(key: str, value) -> None:
    if key not in DEFAULTS:
        raise KeyError(key)
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                   (key, json.dumps(value)))


def get_secret(key: str):
    with connect() as db:
        row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_secret(key: str, value: str) -> None:
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))


def delete_secret(key: str) -> None:
    with connect() as db:
        db.execute("DELETE FROM settings WHERE key = ?", (key,))
