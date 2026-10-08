from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import calendar_source
from db import connect
from deps import require_admin

# Every calendar-management route needs the PIN (when one is set).
router = APIRouter(prefix="/api/calendars", tags=["calendars"],
                   dependencies=[Depends(require_admin)])


class CalendarIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    url: str
    color: int = Field(0, ge=0, le=5)             # legacy; events now take their person's color
    person_id: Optional[int] = None               # None = everyone


class CalendarEdit(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=60)
    color: Optional[int] = Field(None, ge=0, le=5)
    person_id: Optional[int] = None               # only applied when the field is sent


class LinkIn(BaseModel):
    url: str


def _public(row) -> dict:
    """What the browser may see: the link is masked, never returned in full."""
    d = dict(row)
    d["error"] = calendar_source.errors.get(d["url"])
    d["url"] = calendar_source.mask_url(d["url"])
    return d


def _check_person(db, person_id):
    if person_id is not None and not db.execute(
            "SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone():
        raise HTTPException(422, "That person doesn't exist.")


@router.get("")
def list_calendars():
    with connect() as db:
        return [_public(r) for r in db.execute("SELECT * FROM calendars ORDER BY id")]


@router.post("/test")
def test_link(body: LinkIn):
    try:
        return calendar_source.test_url(body.url)
    except calendar_source.LinkError as exc:
        return {"ok": False, "error": str(exc)}


@router.post("", status_code=201)
def add_calendar(body: CalendarIn):
    try:
        url = calendar_source.normalize_url(body.url)
    except calendar_source.LinkError as exc:
        raise HTTPException(422, str(exc))
    with connect() as db:
        _check_person(db, body.person_id)
        cur = db.execute("INSERT INTO calendars (name, url, color, person_id) VALUES (?, ?, ?, ?)",
                         (body.name.strip(), url, body.color, body.person_id))
        return {"id": cur.lastrowid}


@router.put("/{calendar_id}")
def edit_calendar(calendar_id: int, body: CalendarEdit):
    with connect() as db:
        row = db.execute("SELECT * FROM calendars WHERE id = ?", (calendar_id,)).fetchone()
        if not row:
            raise HTTPException(404, "calendar not found")
        name = body.name.strip() if body.name is not None else row["name"]
        color = body.color if body.color is not None else row["color"]
        person_id = row["person_id"]
        if "person_id" in body.model_fields_set:
            _check_person(db, body.person_id)
            person_id = body.person_id
        db.execute("UPDATE calendars SET name = ?, color = ?, person_id = ? WHERE id = ?",
                   (name, color, person_id, calendar_id))
    return {"id": calendar_id}


@router.delete("/{calendar_id}", status_code=204)
def delete_calendar(calendar_id: int):
    with connect() as db:
        row = db.execute("SELECT url FROM calendars WHERE id = ?", (calendar_id,)).fetchone()
        db.execute("DELETE FROM calendars WHERE id = ?", (calendar_id,))
    if row:
        calendar_source.forget(row["url"])
