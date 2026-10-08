from fastapi import APIRouter, Depends, HTTPException

from db import connect
from deps import require_admin
from schemas import PersonIn

router = APIRouter(prefix="/api/people", tags=["people"])


@router.get("")
def list_people():
    with connect() as db:
        return [dict(r) for r in db.execute("SELECT * FROM people ORDER BY name")]


@router.post("", status_code=201, dependencies=[Depends(require_admin)])
def add_person(p: PersonIn):
    with connect() as db:
        cur = db.execute("INSERT INTO people (name, color) VALUES (?, ?)", (p.name, p.color))
        return {"id": cur.lastrowid, **p.model_dump()}


@router.put("/{person_id}", dependencies=[Depends(require_admin)])
def update_person(person_id: int, p: PersonIn):
    with connect() as db:
        cur = db.execute("UPDATE people SET name = ?, color = ? WHERE id = ?",
                         (p.name, p.color, person_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "person not found")
    return {"id": person_id, **p.model_dump()}


@router.delete("/{person_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_person(person_id: int):
    with connect() as db:
        db.execute("DELETE FROM people WHERE id = ?", (person_id,))
