from datetime import date

from fastapi import APIRouter, HTTPException

import calendar_source

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


@router.get("")
def calendar(start: date, end: date):
    """Events from the Apple Calendar link(s) between start and end (inclusive),
    recurrences already expanded. The wall display calls this to draw the grid."""
    if end < start or (end - start).days > 400:
        raise HTTPException(400, "bad date range")
    try:
        return calendar_source.get_events(start, end)
    except Exception as exc:
        raise HTTPException(502, f"could not load calendar: {exc}")


@router.get("/status")
def calendar_status():
    """Quick health check: is a link configured, and did the last fetch work?"""
    return calendar_source.status
