import os
import tempfile
import time

import db
import security
import settings_store


def fresh_db():
    db.DB_PATH = os.path.join(tempfile.mkdtemp(), "t.sqlite")
    db.init_db()
    security._sessions.clear()
    security._fails.clear()


def test_pin_format():
    assert security.valid_pin_format("1234")
    assert security.valid_pin_format("12345678")
    for bad in ("123", "123456789", "12a4", "", None, "12 34"):
        assert not security.valid_pin_format(bad)


def test_hash_is_salted_and_verifies():
    a, b = security.hash_pin("4821"), security.hash_pin("4821")
    assert a != b                                  # different salts
    assert security.verify_pin("4821", a)
    assert not security.verify_pin("4822", a)
    assert not security.verify_pin("4821", "garbage")


def test_login_flow_and_no_plain_pin_stored():
    fresh_db()
    assert not security.pin_is_set()
    security.set_pin("2468")
    assert security.pin_is_set()
    assert "2468" not in settings_store.get_secret("pin_hash")
    token = security.login("2468", "10.0.0.5")
    assert security.session_valid(token)
    try:
        security.login("0000", "10.0.0.5")
        assert False, "wrong PIN should fail"
    except security.BadPin:
        pass


def test_lockout_after_five_wrong_pins_then_recovers():
    fresh_db()
    security.set_pin("2468")
    for _ in range(security.MAX_FAILS):
        try:
            security.login("1111", "kid-ipad")
        except security.BadPin:
            pass
    try:
        security.login("2468", "kid-ipad")         # even the right PIN is refused while locked
        assert False, "should be locked"
    except security.Locked as exc:
        assert 0 < exc.wait <= security.LOCK_SECONDS
    # another device is not affected
    assert security.session_valid(security.login("2468", "parent-phone"))
    # time passes
    security._fails["kid-ipad"] = [time.time() - security.LOCK_SECONDS - 1] * security.MAX_FAILS
    assert security.session_valid(security.login("2468", "kid-ipad"))


def test_changing_or_clearing_pin_ends_sessions():
    fresh_db()
    security.set_pin("2468")
    token = security.login("2468", "a")
    security.set_pin("1357")
    assert not security.session_valid(token)
    token = security.login("1357", "a")
    security.clear_pin()
    assert not security.pin_is_set()
    assert not security.session_valid(token)


def test_sessions_expire_and_slide():
    fresh_db()
    token = security.new_session()
    assert security.session_valid(token)
    security._sessions[token] = time.time() - 1
    assert not security.session_valid(token)
    assert not security.session_valid(None)
    assert not security.session_valid("not-a-token")
    t2 = security.new_session()
    security._sessions[t2] = time.time() + 10
    assert security.session_valid(t2)
    assert security._sessions[t2] > time.time() + security.SESSION_TTL - 5   # renewed


def test_logout_ends_session():
    fresh_db()
    token = security.new_session()
    security.end_session(token)
    assert not security.session_valid(token)
