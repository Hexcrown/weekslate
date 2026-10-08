import json
import os
import sqlite3
import tempfile

import db
import settings_store
from calendar_source import LinkError, mask_url, normalize_url


def fresh_db():
    db.DB_PATH = os.path.join(tempfile.mkdtemp(), "t.sqlite")
    db.init_db()


def test_defaults_and_roundtrip():
    fresh_db()
    s = settings_store.get_all()
    assert s["theme"] == "dark" and s["week_start"] == 0 and s["setup_complete"] is False
    settings_store.set_value("theme", "light")
    settings_store.set_value("show_points", False)
    settings_store.set_value("week_start", 1)
    s = settings_store.get_all()
    assert s["theme"] == "light" and s["show_points"] is False and s["week_start"] == 1


def test_unknown_key_rejected_and_secret_never_listed():
    fresh_db()
    try:
        settings_store.set_value("pin_hash", "x")
        assert False
    except KeyError:
        pass
    settings_store.set_secret("pin_hash", "salt$hash")
    assert "pin_hash" not in settings_store.get_all()
    assert settings_store.get_secret("pin_hash") == "salt$hash"
    settings_store.delete_secret("pin_hash")
    assert settings_store.get_secret("pin_hash") is None


def test_migrations_are_idempotent():
    fresh_db()
    db.init_db()
    db.init_db()
    with db.connect() as c:
        assert c.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] == len(db.MIGRATIONS)
        assert c.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == len(db.MIGRATIONS)


def test_existing_install_skips_first_run_setup():
    """An install made before migration 2, with people or chores, must not see the wizard."""
    path = os.path.join(tempfile.mkdtemp(), "old.sqlite")
    raw = sqlite3.connect(path)
    raw.executescript(db.MIGRATIONS[0])
    raw.execute("INSERT INTO people (name) VALUES ('Ava')")
    raw.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)")
    raw.execute("INSERT INTO schema_version VALUES (1)")
    raw.commit()
    raw.close()
    db.DB_PATH = path
    db.init_db()
    assert settings_store.get_all()["setup_complete"] is True
    with db.connect() as c:
        assert c.execute("SELECT name FROM people").fetchone()[0] == "Ava"   # data kept


def test_brand_new_install_sees_setup():
    fresh_db()
    assert settings_store.get_all()["setup_complete"] is False


def test_link_normalising():
    assert normalize_url("webcal://p12-caldav.icloud.com/published/2/AbC") == \
        "https://p12-caldav.icloud.com/published/2/AbC"
    assert normalize_url("  https://calendar.google.com/x/basic.ics ") == "https://calendar.google.com/x/basic.ics"
    for bad in ("", "   ", "file:///etc/passwd", "ftp://x.example/cal.ics", "javascript:alert(1)",
                "not a link", "https://", "http://a b.example/", None, 5, "https://x.example/" + "a" * 3000):
        try:
            normalize_url(bad)
            assert False, "should reject " + repr(bad)[:40]
        except LinkError:
            pass


def test_masked_links_hide_the_secret():
    url = "https://p12-caldav.icloud.com/published/2/AAAAsecretBBBBtokenCCCC1234"
    masked = mask_url(url)
    assert masked.startswith("p12-caldav.icloud.com/")
    assert masked.endswith("1234")
    assert "secret" not in masked and "published" not in masked
