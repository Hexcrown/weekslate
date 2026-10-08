"""Calendar source: reads events from calendar links (Apple "Public Calendar",
Google "secret address in iCal format", Nextcloud, Radicale, ...).

Events are NOT stored in Weekslate. The links live in the `calendars` table
(managed on the Settings page). We fetch each .ics feed, cache it for a few
minutes, and expand recurring events for whatever date range is asked for.

To add a different kind of source later (CalDAV login, built-in events), keep
`get_events(start, end)` returning the same list of dicts.

Environment:
    CALENDAR_URLS   optional comma-separated links, used only when no calendars
                    have been added on the Settings page (older installs)
    CALENDAR_TTL    seconds to cache a feed (default 300)
    TZ              display timezone (default America/New_York)
"""
import os
import re
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import settings_store
from db import connect

LOCAL_TZ = ZoneInfo(os.environ.get("TZ", "America/New_York"))
TTL = int(os.environ.get("CALENDAR_TTL", "300"))
MAX_BYTES = 10 * 1024 * 1024

# url -> (fetched_at, ics_text)
_cache: dict[str, tuple[float, str]] = {}
# url -> friendly message for feeds that failed on their last attempt
errors: dict[str, str] = {}
status = {"configured": 0, "last_ok": None, "last_error": None}


class LinkError(ValueError):
    """A problem with a calendar link, worded for the person who typed it."""


# ---------- links ----------

def normalize_url(raw) -> str:
    url = (raw or "").strip() if isinstance(raw, str) else ""
    if not url or len(url) > 2048 or re.search(r"\s", url):
        raise LinkError("Paste the full calendar link.")
    if url.lower().startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise LinkError("The link should start with webcal://, https://, or http://.")
    return url


def mask_url(url: str) -> str:
    """Show enough to recognise a link without revealing its secret path."""
    parts = urlsplit(url)
    tail = (parts.path + ("?" + parts.query if parts.query else ""))[-4:]
    return parts.netloc + "/…" + tail


def _explain(exc: Exception) -> str:
    if isinstance(exc, LinkError):
        return str(exc)
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code in (401, 403):
            return "The calendar refused access. Check that it's shared publicly."
        if exc.code == 404:
            return "That link wasn't found. It may have been turned off or mistyped."
        return "The calendar service answered with an error (" + str(exc.code) + ")."
    if isinstance(exc, urllib.error.URLError):
        return "Couldn't reach that address from this server."
    if isinstance(exc, TimeoutError):
        return "The calendar took too long to answer."
    if isinstance(exc, ValueError):
        return "That link didn't return a calendar."
    return "Couldn't load that calendar."


def _download(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Weekslate/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise LinkError("That calendar is too large to load.")
    return data.decode("utf-8", errors="replace")


def _sync_status() -> None:
    status["last_error"] = next(iter(errors.values()), None)


def _fetch(url: str) -> str:
    """Download a feed through the cache. On failure, fall back to stale data."""
    now = time.time()
    cached = _cache.get(url)
    if cached and now - cached[0] < TTL:
        return cached[1]
    try:
        text = _download(url)
    except Exception as exc:
        errors[url] = _explain(exc)
        _sync_status()
        if cached:
            return cached[1]          # serve stale rather than a blank wall display
        raise
    _cache[url] = (now, text)
    errors.pop(url, None)
    status["last_ok"] = datetime.now(LOCAL_TZ).isoformat(timespec="seconds")
    _sync_status()
    return text


def forget(url: str) -> None:
    """Drop cached data and errors for a calendar that was removed."""
    _cache.pop(url, None)
    errors.pop(url, None)
    _sync_status()


def test_url(raw) -> dict:
    """Try a link without saving it. Raises LinkError with a friendly message."""
    try:
        url = normalize_url(raw)
        text = _download(url)
        start = date.today()
        count = len(events_from_ics(text, start, start + timedelta(days=30)))
        return {"ok": True, "events": count}
    except Exception as exc:
        raise LinkError(_explain(exc)) from None


# ---------- parsing ----------

def _to_local(dt):
    if dt.tzinfo is None:                    # "floating" time: treat as local
        return dt.replace(tzinfo=LOCAL_TZ)
    return dt.astimezone(LOCAL_TZ)


def events_from_ics(text: str, start: date, end: date, source: str = "", color: int = 0) -> list[dict]:
    """Expand an .ics document into one dict per event per day in [start, end]."""
    import icalendar
    import recurring_ical_events

    cal = icalendar.Calendar.from_ical(text)
    components = recurring_ical_events.of(cal).between(start, end + timedelta(days=1))
    out = []
    for comp in components:
        title = str(comp.get("SUMMARY", "(no title)"))
        location = str(comp.get("LOCATION", "")) or None
        uid = str(comp.get("UID", ""))
        dtstart = comp.get("DTSTART").dt
        dtend_prop = comp.get("DTEND")
        dtend = dtend_prop.dt if dtend_prop is not None else None

        if not isinstance(dtstart, datetime):
            # All-day event; DTEND is exclusive. Emit one row per day it covers.
            last = (dtend - timedelta(days=1)) if isinstance(dtend, date) else dtstart
            day = max(dtstart, start)
            while day <= min(last, end):
                out.append({"uid": uid, "title": title, "date": day.isoformat(),
                            "all_day": True, "start_time": None, "end_time": None,
                            "location": location, "source": source, "color": color})
                day += timedelta(days=1)
        else:
            s = _to_local(dtstart)
            e = _to_local(dtend) if isinstance(dtend, datetime) else None
            if start <= s.date() <= end:
                out.append({"uid": uid, "title": title, "date": s.date().isoformat(),
                            "all_day": False, "start_time": s.strftime("%H:%M"),
                            "end_time": e.strftime("%H:%M") if e else None,
                            "location": location, "source": source, "color": color})
    out.sort(key=lambda ev: (ev["date"], ev["start_time"] or ""))
    return out


# ---------- the public entry point ----------

def _env_urls() -> list[str]:
    urls = []
    for raw in os.environ.get("CALENDAR_URLS", "").split(","):
        try:
            urls.append(normalize_url(raw))
        except LinkError:
            pass
    return urls


def _calendars() -> list[dict]:
    with connect() as db:
        rows = db.execute("SELECT id, name, url, color, person_id FROM calendars ORDER BY id").fetchall()
    cals = [dict(r) for r in rows]
    if not cals:                              # older installs configured via .env
        for i, url in enumerate(_env_urls()):
            cals.append({"id": -(i + 1), "name": "Calendar" if i == 0 else "Calendar " + str(i + 1),
                         "url": url, "color": i % 6, "person_id": None})
    return cals


def _people() -> list[dict]:
    with connect() as db:
        return [dict(r) for r in db.execute("SELECT id, name, color FROM people ORDER BY id")]


def assign_people(events: list[dict], people: list[dict], owner_id, match_names: bool = True) -> list[dict]:
    """Decide whose event each one is and give it that person's color.

    1. If match_names is on and the title names exactly one person ("Ava dance
       recital", "Alex's dentist"), it belongs to that person.
    2. Otherwise it belongs to the calendar's owner.
    3. No owner means everyone: color is "" and the wall uses the neutral family color.
    """
    by_id = {p["id"]: p for p in people}
    patterns = [(p, re.compile(r"(?<!\w)" + re.escape(p["name"].strip()) + r"(?!\w)", re.I))
                for p in people if p["name"].strip()]
    for ev in events:
        who = by_id.get(owner_id)
        if match_names:
            hits = {p["id"]: p for p, rx in patterns if rx.search(ev["title"] or "")}
            if len(hits) == 1:
                who = next(iter(hits.values()))
        ev["person_id"] = who["id"] if who else None
        ev["person"] = who["name"] if who else ""
        ev["color"] = who["color"] if who else ""
    return events


def get_events(start: date, end: date) -> list[dict]:
    cals = _calendars()
    people = _people()
    match = settings_store.get_all()["match_names"]
    status["configured"] = len(cals)
    events, failures, last_exc = [], 0, None
    for cal in cals:
        try:
            text = _fetch(cal["url"])
            found = events_from_ics(text, start, end, source=cal["name"], color=cal["color"])
            events.extend(assign_people(found, people, cal.get("person_id"), match))
        except Exception as exc:              # one bad calendar shouldn't hide the others
            failures += 1
            last_exc = exc
            errors.setdefault(cal["url"], _explain(exc))
            _sync_status()
    if cals and failures == len(cals):
        raise last_exc
    events.sort(key=lambda ev: (ev["date"], ev["start_time"] or ""))
    return events
