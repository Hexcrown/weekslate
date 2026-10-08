"""Recurrence logic: decides whether an event/chore happens on a given date.

A rule is a plain dict (stored as JSON in SQLite):

    {"type": "none"}                                  one-time, only on its start date
    {"type": "daily",   "interval": 1}                every day
    {"type": "daily",   "interval": 3}                every 3 days
    {"type": "weekly",  "interval": 1, "days": [1,3]} every Tue and Thu (0=Mon ... 6=Sun)
    {"type": "weekly",  "interval": 2, "days": [5]}   every other Saturday
    {"type": "monthly", "interval": 1}                same day-of-month as start
    optional: "until": "YYYY-MM-DD"                   stop repeating after this date

`start` is the first date the item can occur (the date it was created for).
"""
from datetime import date, timedelta
import calendar


def _monday(d: date) -> date:
    """Return the Monday of the week containing d."""
    return d - timedelta(days=d.weekday())


def occurs_on(rule: dict | None, start: date, day: date) -> bool:
    rule = rule or {"type": "none"}
    kind = rule.get("type", "none")
    interval = max(1, int(rule.get("interval", 1)))

    if day < start:
        return False

    until = rule.get("until")
    if until and day > date.fromisoformat(until):
        return False

    if kind == "none":
        return day == start

    if kind == "daily":
        return (day - start).days % interval == 0

    if kind == "weekly":
        days = rule.get("days") or [start.weekday()]
        if day.weekday() not in days:
            return False
        weeks_apart = (_monday(day) - _monday(start)).days // 7
        return weeks_apart % interval == 0

    if kind == "monthly":
        months_apart = (day.year - start.year) * 12 + (day.month - start.month)
        if months_apart % interval != 0:
            return False
        # If start is the 31st and the month is shorter, use the last day.
        last_day = calendar.monthrange(day.year, day.month)[1]
        return day.day == min(start.day, last_day)

    return False


def occurrences_between(rule: dict | None, start: date, first: date, last: date):
    """Yield every date in [first, last] on which the rule occurs."""
    d = max(first, start)
    while d <= last:
        if occurs_on(rule, start, d):
            yield d
        d += timedelta(days=1)
