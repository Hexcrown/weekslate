"""Request body shapes shared by the routers."""
import json
from datetime import date
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field


class Rule(BaseModel):
    type: Literal["none", "daily", "weekly", "monthly"] = "none"
    interval: int = Field(1, ge=1, le=52)
    days: Optional[list[Annotated[int, Field(ge=0, le=6)]]] = None   # weekly: 0=Mon ... 6=Sun
    until: Optional[date] = None


class PersonIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: str = Field("#8ecfc0", pattern=r"^#[0-9a-fA-F]{6}$")


class ChoreIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    start_date: date
    rule: Rule = Rule(type="daily")
    person_id: Optional[int] = None
    points: int = Field(1, ge=0, le=20)


def rule_json(rule: Rule) -> str:
    return json.dumps(rule.model_dump(mode="json", exclude_none=True))
