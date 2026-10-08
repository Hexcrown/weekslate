"""PIN and session logic. No web-framework imports here, so it is easy to test.

The PIN only guards *changing* things (settings, people, chores, calendars).
Checking off chores and viewing the calendar stay open so the wall display works.
Sessions live in memory: restarting the server logs everyone out, which is fine.
"""
import hashlib
import hmac
import re
import secrets
import time

import settings_store

SESSION_TTL = 12 * 3600       # seconds; renewed each time the session is used
MAX_FAILS = 5                 # wrong PINs allowed ...
LOCK_SECONDS = 60             # ... per client, per this many seconds
PBKDF2_ROUNDS = 200_000
PIN_RE = re.compile(r"^\d{4,8}$")

_sessions: dict[str, float] = {}      # token -> expiry time
_fails: dict[str, list[float]] = {}   # client -> times of recent wrong PINs


class Locked(Exception):
    def __init__(self, wait: int):
        super().__init__(f"locked for {wait}s")
        self.wait = wait


class BadPin(Exception):
    pass


# ---------- PIN storage ----------

def valid_pin_format(pin) -> bool:
    return isinstance(pin, str) and bool(PIN_RE.match(pin))


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, PBKDF2_ROUNDS)
    return salt.hex() + "$" + digest.hex()


def verify_pin(pin: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt_hex), PBKDF2_ROUNDS)
    except ValueError:
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


def pin_is_set() -> bool:
    return settings_store.get_secret("pin_hash") is not None


def set_pin(pin: str) -> None:
    settings_store.set_secret("pin_hash", hash_pin(pin))
    _sessions.clear()                 # everyone must sign in again with the new PIN


def clear_pin() -> None:
    settings_store.delete_secret("pin_hash")
    _sessions.clear()


# ---------- sessions ----------

def new_session() -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time() + SESSION_TTL
    return token


def session_valid(token) -> bool:
    if not token:
        return False
    now = time.time()
    for t in [t for t, exp in _sessions.items() if exp < now]:
        del _sessions[t]              # tidy up expired sessions
    if token not in _sessions:
        return False
    _sessions[token] = now + SESSION_TTL   # sliding expiry
    return True


def end_session(token) -> None:
    _sessions.pop(token, None)


# ---------- login with rate limiting ----------

def lock_wait(client: str, now: float | None = None) -> int:
    """Seconds this client must still wait, or 0."""
    now = time.time() if now is None else now
    recent = [t for t in _fails.get(client, []) if now - t < LOCK_SECONDS]
    _fails[client] = recent
    if len(recent) >= MAX_FAILS:
        return max(1, int(LOCK_SECONDS - (now - recent[0])))
    return 0


def login(pin: str, client: str) -> str:
    """Return a session token, or raise Locked / BadPin."""
    wait = lock_wait(client)
    if wait:
        raise Locked(wait)
    stored = settings_store.get_secret("pin_hash")
    if stored is None or not isinstance(pin, str) or not verify_pin(pin, stored):
        _fails.setdefault(client, []).append(time.time())
        raise BadPin()
    _fails.pop(client, None)
    return new_session()
