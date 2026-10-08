from datetime import date
from recurrence import occurs_on, occurrences_between


def test_one_time():
    start = date(2026, 10, 7)
    assert occurs_on({"type": "none"}, start, start)
    assert not occurs_on({"type": "none"}, start, date(2026, 10, 8))


def test_daily_interval():
    start = date(2026, 10, 1)
    rule = {"type": "daily", "interval": 3}
    assert occurs_on(rule, start, date(2026, 10, 4))
    assert not occurs_on(rule, start, date(2026, 10, 5))
    assert not occurs_on(rule, start, date(2026, 9, 28))  # before start


def test_weekly_tue_thu():
    start = date(2026, 10, 6)  # a Tuesday
    rule = {"type": "weekly", "interval": 1, "days": [1, 3]}
    assert occurs_on(rule, start, date(2026, 10, 8))   # Thu
    assert occurs_on(rule, start, date(2026, 10, 13))  # next Tue
    assert not occurs_on(rule, start, date(2026, 10, 7))  # Wed


def test_every_other_saturday():
    start = date(2026, 10, 3)  # a Saturday
    rule = {"type": "weekly", "interval": 2, "days": [5]}
    assert occurs_on(rule, start, date(2026, 10, 17))
    assert not occurs_on(rule, start, date(2026, 10, 10))


def test_monthly_clamps_short_months():
    start = date(2026, 1, 31)
    rule = {"type": "monthly", "interval": 1}
    assert occurs_on(rule, start, date(2026, 2, 28))
    assert occurs_on(rule, start, date(2026, 3, 31))


def test_until():
    start = date(2026, 10, 1)
    rule = {"type": "daily", "interval": 1, "until": "2026-10-03"}
    assert occurs_on(rule, start, date(2026, 10, 3))
    assert not occurs_on(rule, start, date(2026, 10, 4))


def test_occurrences_between():
    start = date(2026, 10, 1)
    rule = {"type": "weekly", "interval": 1, "days": [0]}  # Mondays
    got = list(occurrences_between(rule, start, date(2026, 10, 1), date(2026, 10, 31)))
    assert got == [date(2026, 10, 5), date(2026, 10, 12), date(2026, 10, 19), date(2026, 10, 26)]
