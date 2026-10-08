from datetime import date, timedelta

from fastapi import APIRouter

from db import connect

router = APIRouter(prefix="/api/scores", tags=["scores"])


@router.get("")
def scores(days: int = 7):
    """Points earned per person over the last N days (for a little leaderboard)."""
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    with connect() as db:
        rows = db.execute(
            "SELECT p.id, p.name, p.color, COALESCE(SUM(done.points), 0) AS points"
            " FROM people p"
            " LEFT JOIN ("
            "     SELECT c.person_id, c.points"
            "     FROM completions x JOIN chores c ON c.id = x.chore_id"
            "     WHERE x.day >= ?"
            " ) done ON done.person_id = p.id"
            " GROUP BY p.id ORDER BY points DESC",
            (since,),
        ).fetchall()
        return [dict(r) for r in rows]
