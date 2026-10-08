from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from db import connect, row_to_dict
from deps import require_admin
from recurrence import occurs_on
from schemas import ChoreIn, rule_json

router = APIRouter(prefix="/api/chores", tags=["chores"])


@router.get("")
def list_chores():
    with connect() as db:
        return [row_to_dict(r) for r in db.execute("SELECT * FROM chores ORDER BY title")]


@router.post("", status_code=201, dependencies=[Depends(require_admin)])
def add_chore(c: ChoreIn):
    with connect() as db:
        cur = db.execute(
            "INSERT INTO chores (title, start_date, rule, person_id, points) VALUES (?, ?, ?, ?, ?)",
            (c.title, c.start_date.isoformat(), rule_json(c.rule), c.person_id, c.points),
        )
        return {"id": cur.lastrowid}


@router.put("/{chore_id}", dependencies=[Depends(require_admin)])
def update_chore(chore_id: int, c: ChoreIn):
    with connect() as db:
        cur = db.execute(
            "UPDATE chores SET title=?, start_date=?, rule=?, person_id=?, points=? WHERE id=?",
            (c.title, c.start_date.isoformat(), rule_json(c.rule), c.person_id, c.points, chore_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "chore not found")
    return {"id": chore_id}


@router.delete("/{chore_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_chore(chore_id: int):
    with connect() as db:
        db.execute("DELETE FROM chores WHERE id = ?", (chore_id,))


@router.get("/day")
def chores_for_day(day: Optional[date] = None):
    """Chores due on a given day (default: today) with done/not-done status."""
    day = day or date.today()
    with connect() as db:
        rows = db.execute(
            "SELECT c.*, p.name AS person_name, p.color AS person_color,"
            "       (SELECT 1 FROM completions x WHERE x.chore_id = c.id AND x.day = ?) AS done"
            " FROM chores c LEFT JOIN people p ON p.id = c.person_id",
            (day.isoformat(),),
        ).fetchall()
    out = []
    for r in rows:
        c = row_to_dict(r)
        if occurs_on(c["rule"], date.fromisoformat(c["start_date"]), day):
            c["done"] = bool(c["done"])
            c["date"] = day.isoformat()
            out.append(c)
    out.sort(key=lambda c: (c["done"], c["title"].lower()))
    return out


@router.post("/{chore_id}/complete")
def complete_chore(chore_id: int, day: Optional[date] = None):
    day = day or date.today()
    with connect() as db:
        if not db.execute("SELECT 1 FROM chores WHERE id = ?", (chore_id,)).fetchone():
            raise HTTPException(404, "chore not found")
        db.execute("INSERT OR IGNORE INTO completions (chore_id, day) VALUES (?, ?)",
                   (chore_id, day.isoformat()))
    return {"chore_id": chore_id, "day": day.isoformat(), "done": True}


@router.delete("/{chore_id}/complete")
def uncomplete_chore(chore_id: int, day: Optional[date] = None):
    day = day or date.today()
    with connect() as db:
        db.execute("DELETE FROM completions WHERE chore_id = ? AND day = ?",
                   (chore_id, day.isoformat()))
    return {"chore_id": chore_id, "day": day.isoformat(), "done": False}
