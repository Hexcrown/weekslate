from datetime import date

from calendar_source import events_from_ics

SAMPLE = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:dance@test
DTSTART;TZID=America/New_York:20261008T180000
DTEND;TZID=America/New_York:20261008T193000
RRULE:FREQ=WEEKLY;BYDAY=TH
SUMMARY:Dance practice
LOCATION:Davis Dance Company
END:VEVENT
BEGIN:VEVENT
UID:trip@test
DTSTART;VALUE=DATE:20261010
DTEND;VALUE=DATE:20261012
SUMMARY:Weekend trip
END:VEVENT
END:VCALENDAR
"""


def test_recurring_timed_event():
    evs = events_from_ics(SAMPLE, date(2026, 10, 1), date(2026, 10, 31))
    dance = [e for e in evs if e["title"] == "Dance practice"]
    assert [e["date"] for e in dance] == ["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]
    assert dance[0]["start_time"] == "18:00" and dance[0]["end_time"] == "19:30"


def test_all_day_spans_days_with_exclusive_end():
    evs = events_from_ics(SAMPLE, date(2026, 10, 1), date(2026, 10, 31))
    trip = [e for e in evs if e["title"] == "Weekend trip"]
    assert [e["date"] for e in trip] == ["2026-10-10", "2026-10-11"]
    assert all(e["all_day"] for e in trip)
