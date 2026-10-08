import os
import tempfile

import db
from calendar_source import assign_people

PEOPLE = [
    {"id": 1, "name": "Alex", "color": "#4f8cff"},
    {"id": 2, "name": "Ava", "color": "#a56cf0"},
]


def ev(title):
    return {"title": title}


def test_calendar_owner_colors_events():
    out = assign_people([ev("Dentist")], PEOPLE, 2, match_names=False)
    assert out[0]["person"] == "Ava" and out[0]["color"] == "#a56cf0" and out[0]["person_id"] == 2


def test_no_owner_means_everyone():
    out = assign_people([ev("Beach week")], PEOPLE, None)
    assert out[0]["person_id"] is None and out[0]["color"] == "" and out[0]["person"] == ""


def test_name_in_title_wins_over_calendar():
    out = assign_people([ev("Ava dance recital"), ev("Alex's dentist"), ev("Take AVA to school")], PEOPLE, None)
    assert [e["person"] for e in out] == ["Ava", "Alex", "Ava"]


def test_two_names_or_part_of_a_word_do_not_match():
    out = assign_people([ev("Ava and Alex hike"), ev("Avalanche safety"), ev("Alexander Hamilton show")], PEOPLE, 1)
    assert [e["person"] for e in out] == ["Alex", "Alex", "Alex"]      # fall back to the owner


def test_matching_can_be_turned_off():
    out = assign_people([ev("Ava dance recital")], PEOPLE, None, match_names=False)
    assert out[0]["person"] == ""


def test_names_with_regex_characters_are_safe():
    people = [{"id": 9, "name": "A.J. (dad)", "color": "#111111"}]
    out = assign_people([ev("Pick up A.J. (dad) at 5"), ev("AxJx (dad)")], people, None)
    assert out[0]["person_id"] == 9 and out[1]["person_id"] is None


def test_deleting_a_person_makes_their_calendar_everyone():
    db.DB_PATH = os.path.join(tempfile.mkdtemp(), "t.sqlite")
    db.init_db()
    with db.connect() as c:
        pid = c.execute("INSERT INTO people (name) VALUES ('Ava')").lastrowid
        c.execute("INSERT INTO calendars (name, url, person_id) VALUES ('Ava', 'https://x.test/a.ics', ?)", (pid,))
    with db.connect() as c:
        c.execute("DELETE FROM people WHERE id = ?", (pid,))
    with db.connect() as c:
        assert c.execute("SELECT person_id FROM calendars").fetchone()["person_id"] is None


def test_existing_install_upgrades_keeping_calendars():
    path = os.path.join(tempfile.mkdtemp(), "t.sqlite")
    db.DB_PATH = path
    n = len(db.MIGRATIONS)
    db.MIGRATIONS = db.MIGRATIONS[:2]            # simulate a database from before this feature
    db.init_db()
    with db.connect() as c:
        c.execute("INSERT INTO calendars (name, url) VALUES ('Family', 'https://x.test/f.ics')")
    import importlib
    importlib.reload(db)
    db.DB_PATH = path
    assert len(db.MIGRATIONS) == n
    db.init_db()
    with db.connect() as c:
        row = c.execute("SELECT name, person_id FROM calendars").fetchone()
        assert row["name"] == "Family" and row["person_id"] is None
